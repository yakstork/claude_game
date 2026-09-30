/**
 * AudioManager — синтезированный звук (GAME_DESIGN.md §4.6, §6.7).
 * Граф: [engine → engineBus → sfxBus] и musicBus → master → compressor → destination.
 * До unlock() (первый жест) все методы — безопасные no-op; желаемые громкость,
 * трек и пауза запоминаются и применяются после unlock.
 */
import type { EngineAudioParams, MusicTrack, SfxName } from '../core/types';
import { EngineSynth } from './engine';
import { MusicSequencer } from './music';
import { SfxPlayer } from './sfx';

interface WebkitWindow {
  webkitAudioContext?: typeof AudioContext;
}

/** Множитель уровня шины музыки (музыка тише мотора в гонке). */
const MUSIC_TRIM = 0.5;
/** Множитель уровня шины эффектов. */
const SFX_TRIM = 0.9;
/** Приглушение музыки на паузе (-12 дБ). */
const PAUSE_DUCK = Math.pow(10, -12 / 20);
/** Сглаживание изменений громкости, с. */
const VOL_TC = 0.05;

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export class AudioManager {
  private ctx: AudioContext | null = null;
  private unavailable = false;

  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private engineBus: GainNode | null = null;
  private engine: EngineSynth | null = null;
  private sfx: SfxPlayer | null = null;
  private music: MusicSequencer | null = null;

  // Желаемое состояние (применяется после unlock)
  private volMaster = 0.8;
  private volMusic = 0.7;
  private volSfx = 0.9;
  private wantedTrack: MusicTrack | null = null;
  private paused = false;

  private visibilityBound = false;
  private gestureBound = false;

  /**
   * Создать/возобновить AudioContext. Вызывать в обработчике жеста (pointerdown/keydown, а для iOS —
   * touchend/click). Всё, что требует жеста (создание контекста, resume(), тихий буфер), выполняется
   * синхронно до первого await — иначе iOS/Safari не считает вызов частью жеста.
   */
  unlock(): Promise<void> {
    if (this.unavailable) return Promise.resolve();
    let resumed: Promise<void>;
    try {
      if (!this.ctx && !this.createContext()) return Promise.resolve();
      resumed = this.kick();
    } catch {
      // Web Audio недоступен или сломан — тихий no-op
      this.teardownAfterFailure();
      return Promise.resolve();
    }
    // resume() без жеста может не завершиться — не ждём дольше секунды
    return Promise.race([resumed, new Promise<void>((r) => setTimeout(r, 1000))]);
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.volMaster = clamp01(master);
    this.volMusic = clamp01(music);
    this.volSfx = clamp01(sfx);
    this.safe(() => this.applyVolumes(false));
  }

  playMusic(track: MusicTrack | null): void {
    this.wantedTrack = track;
    this.safe(() => {
      if (this.music) this.music.setTrack(track);
    });
  }

  updateEngine(p: EngineAudioParams | null): void {
    if (!this.engine || this.paused) return;
    this.safe(() => this.engine?.update(p));
  }

  play(sfx: SfxName): void {
    if (!this.sfx) return;
    this.safe(() => this.sfx?.play(sfx));
  }

  setPaused(p: boolean): void {
    if (this.paused === p) return;
    this.paused = p;
    this.safe(() => {
      if (p) this.engine?.silence();
      this.applyVolumes(false);
    });
  }

  // ---------------------------------------------------------------------------

  /** Создать контекст и граф (синхронно). false — Web Audio нет. */
  private createContext(): boolean {
    const w = globalThis as unknown as WebkitWindow & { AudioContext?: typeof AudioContext };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) {
      this.unavailable = true;
      return false;
    }
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.buildGraph(ctx);
    this.bindVisibility();
    this.bindGestureResume();
    // запомненный трек стартует, как только контекст пошёл (и при любом последующем возобновлении)
    ctx.onstatechange = () => {
      if (ctx.state === 'running') this.safe(() => this.music?.setTrack(this.wantedTrack));
    };
    return true;
  }

  /**
   * Возобновить контекст прямо в обработчике жеста: resume() синхронно + классический
   * iOS-unlock — проиграть тихий буфер в 1 сэмпл.
   */
  private kick(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve();
    let p: Promise<void> = Promise.resolve();
    if (ctx.state !== 'running') {
      try {
        p = ctx.resume().catch(() => undefined);
      } catch {
        /* контекст закрыт или запрещён — остаёмся тихими */
      }
      this.playSilentBuffer(ctx);
    }
    return p.then(() => {
      this.safe(() => this.music?.setTrack(this.wantedTrack));
    });
  }

  private playSilentBuffer(ctx: AudioContext): void {
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* не критично */
    }
  }

  /** Если контекст снова приостановлен (iOS: звонок, блокировка экрана) — следующий жест его возобновит. */
  private bindGestureResume(): void {
    if (this.gestureBound || typeof window === 'undefined') return;
    this.gestureBound = true;
    const handler = (): void => {
      const ctx = this.ctx;
      if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
        try {
          void this.kick();
        } catch {
          /* игнорируем */
        }
      }
    };
    for (const ev of ['touchend', 'pointerup', 'click', 'keydown']) {
      window.addEventListener(ev, handler, { capture: true, passive: true });
    }
  }

  private buildGraph(ctx: AudioContext): void {
    const master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    master.connect(comp);
    comp.connect(ctx.destination);

    const musicBus = ctx.createGain();
    const sfxBus = ctx.createGain();
    const engineBus = ctx.createGain();
    musicBus.connect(master);
    sfxBus.connect(master);
    engineBus.connect(sfxBus);

    this.master = master;
    this.musicBus = musicBus;
    this.sfxBus = sfxBus;
    this.engineBus = engineBus;
    this.engine = new EngineSynth(ctx, engineBus);
    this.sfx = new SfxPlayer(ctx, sfxBus);
    this.music = new MusicSequencer(ctx, musicBus);
    this.applyVolumes(true);
  }

  private applyVolumes(immediate: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.musicBus || !this.sfxBus || !this.engineBus) return;
    const now = ctx.currentTime;
    const set = (g: GainNode, v: number): void => {
      if (immediate) {
        g.gain.value = v;
      } else {
        g.gain.setTargetAtTime(v, now, VOL_TC);
      }
    };
    set(this.master, this.volMaster);
    set(this.musicBus, this.volMusic * MUSIC_TRIM * (this.paused ? PAUSE_DUCK : 1));
    set(this.sfxBus, this.volSfx * SFX_TRIM);
    set(this.engineBus, this.paused ? 0 : 1);
  }

  private bindVisibility(): void {
    if (this.visibilityBound || typeof document === 'undefined') return;
    this.visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      const ctx = this.ctx;
      if (!ctx) return;
      try {
        if (document.hidden) {
          void ctx.suspend().catch(() => undefined);
        } else {
          void ctx.resume().catch(() => undefined);
        }
      } catch {
        /* игнорируем */
      }
    });
  }

  private teardownAfterFailure(): void {
    this.unavailable = true;
    this.engine = null;
    this.sfx = null;
    this.music = null;
    const ctx = this.ctx;
    this.ctx = null;
    try {
      void ctx?.close().catch(() => undefined);
    } catch {
      /* игнорируем */
    }
  }

  /** Любая ошибка Web Audio не должна ронять игру. */
  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      /* тихий no-op */
    }
  }
}
