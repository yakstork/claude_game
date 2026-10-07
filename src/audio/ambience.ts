/** Амбиенс трассы (дождь / прибой) и раскаты грома — всё синтез, выход на шину эффектов. */
import { createNoiseSource, disconnectAll, playNoise, playTone } from './noise';

export type AmbienceKind = 'rain' | 'sea';

/** Целевая громкость слоя (до шины эффектов), мягко. */
const RAIN_LEVEL = 0.22;
const SEA_LEVEL = 0.3;
/** Постоянная времени входа/выхода слоя, с (≈98% за 2 с). */
const FADE_TC = 0.5;
const DROP_TICK_MS = 100;

/** Один зацикленный слой: свои узлы, плавный вход и выход. */
class Layer {
  readonly out: GainNode;
  private readonly nodes: AudioNode[] = [];
  private readonly srcs: AudioScheduledSourceNode[] = [];
  private disposeTimer: ReturnType<typeof setTimeout> | null = null;
  dead = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    readonly kind: AmbienceKind,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    this.nodes.push(this.out);
    if (kind === 'rain') this.buildRain();
    else this.buildSea();
  }

  private noise(): AudioBufferSourceNode {
    const s = createNoiseSource(this.ctx, true);
    this.srcs.push(s);
    return s;
  }

  private buildRain(): void {
    const ctx = this.ctx;
    // широкая «морось»: highpass + lowpass
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 600;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7500;
    const a = this.noise();
    a.connect(hp);
    hp.connect(lp);
    lp.connect(this.out);
    // слой «по крыше»: полоса 2–4 кГц чуть тише
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2800;
    bp.Q.value = 0.6;
    const bg = ctx.createGain();
    bg.gain.value = 0.5;
    const b = this.noise();
    b.connect(bp);
    bp.connect(bg);
    bg.connect(this.out);
    this.nodes.push(hp, lp, bp, bg);
    a.start(0, 0.3);
    b.start(0, 1.1);
  }

  private buildSea(): void {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.7;
    lp.frequency.value = 600;
    const swell = ctx.createGain();
    swell.gain.value = 0.55;
    const n = this.noise();
    n.connect(lp);
    lp.connect(swell);
    swell.connect(this.out);
    // волна: громкость и срез фильтра качаются медленным LFO (~9 с), вторая волна несинхронна
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.11;
    const lfoVol = ctx.createGain();
    lfoVol.gain.value = 0.45;
    const lfoCut = ctx.createGain();
    lfoCut.gain.value = 450;
    lfo.connect(lfoVol);
    lfoVol.connect(swell.gain);
    lfo.connect(lfoCut);
    lfoCut.connect(lp.frequency);
    const lfo2 = ctx.createOscillator();
    lfo2.type = 'sine';
    lfo2.frequency.value = 0.067;
    const lfo2Vol = ctx.createGain();
    lfo2Vol.gain.value = 0.12;
    lfo2.connect(lfo2Vol);
    lfo2Vol.connect(swell.gain);
    // тихая пенная «шипучка» поверх, пульсирует с волной
    const hiss = ctx.createBiquadFilter();
    hiss.type = 'bandpass';
    hiss.frequency.value = 3500;
    hiss.Q.value = 0.5;
    const hissG = ctx.createGain();
    hissG.gain.value = 0.1;
    const h = this.noise();
    h.connect(hiss);
    hiss.connect(hissG);
    hissG.connect(this.out);
    const lfoHiss = ctx.createGain();
    lfoHiss.gain.value = 0.08;
    lfo.connect(lfoHiss);
    lfoHiss.connect(hissG.gain);
    this.nodes.push(lp, swell, lfoVol, lfoCut, lfo2Vol, hiss, hissG, lfoHiss);
    this.srcs.push(lfo, lfo2);
    n.start(0, 0.7);
    h.start(0, 1.3);
    lfo.start(0);
    lfo2.start(0);
  }

  fadeIn(level: number): void {
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(level, now, FADE_TC);
  }

  /** Погасить и освободить узлы после хвоста. */
  fadeOutAndDispose(): void {
    if (this.dead) return;
    this.dead = true;
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(0, now, FADE_TC);
    this.disposeTimer = setTimeout(() => this.dispose(), 4000);
  }

  dispose(): void {
    this.dead = true;
    if (this.disposeTimer !== null) clearTimeout(this.disposeTimer);
    this.disposeTimer = null;
    for (const s of this.srcs) {
      try {
        s.stop();
      } catch {
        /* уже остановлен */
      }
    }
    disconnectAll(...this.srcs, ...this.nodes);
  }
}

export class Ambience {
  private layer: Layer | null = null;
  private dropTimer: ReturnType<typeof setInterval> | null = null;
  /** Время, до которого капли уже распланированы. */
  private dropUntil = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly dest: AudioNode,
  ) {}

  get kind(): AmbienceKind | null {
    return this.layer && !this.layer.dead ? this.layer.kind : null;
  }

  set(kind: AmbienceKind | null): void {
    if (this.kind === kind) return;
    this.layer?.fadeOutAndDispose();
    this.layer = null;
    this.stopDrops();
    if (kind === null) return;
    const l = new Layer(this.ctx, this.dest, kind);
    l.fadeIn(kind === 'rain' ? RAIN_LEVEL : SEA_LEVEL);
    this.layer = l;
    if (kind === 'rain') {
      this.dropUntil = this.ctx.currentTime;
      this.dropTimer = setInterval(() => this.scheduleDrops(this.ctx.currentTime + 0.3), DROP_TICK_MS);
    }
  }

  /** Редкие капли по крыше/асфальту: короткий высокий «тик» и глухой «плюх» (с упреждением). */
  scheduleDrops(until: number): void {
    if (this.dropUntil < this.ctx.currentTime) this.dropUntil = this.ctx.currentTime;
    while (this.dropUntil < until) {
      // в среднем ~7 капель в секунду
      this.dropUntil += 0.05 + Math.random() * 0.2;
      const t = this.dropUntil;
      const v = 0.3 + Math.random() * 0.7;
      if (Math.random() < 0.6) {
        const f = 2200 + Math.random() * 3500;
        playTone(this.ctx, this.dest, { type: 'sine', freq: f, freqEnd: f * 0.7, sweep: 0.02, start: t, dur: 0.03, gain: 0.025 * v, attack: 0.001 });
      } else {
        playNoise(this.ctx, this.dest, { filter: 'bandpass', freq: 900 + Math.random() * 900, q: 2, start: t, dur: 0.04, gain: 0.04 * v, attack: 0.001 });
      }
    }
  }

  /** Раскат грома: треск, низкий гул с долгим хвостом и два запаздывающих переката. */
  thunder(intensity: number): void {
    const k = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0.5;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const out = this.dest;
    // треск
    playNoise(ctx, out, { filter: 'highpass', freq: 2500, freqEnd: 400, q: 0.7, start: t, dur: 0.18 + 0.12 * k, gain: 0.35 + 0.35 * k, attack: 0.002 });
    playNoise(ctx, out, { filter: 'bandpass', freq: 900, freqEnd: 250, q: 0.8, start: t + 0.03, dur: 0.5, gain: 0.3 + 0.3 * k, attack: 0.01 });
    // основной гул
    const dur = 2.5 + 3.5 * k;
    playNoise(ctx, out, { filter: 'lowpass', freq: 220 + 120 * k, freqEnd: 50, q: 0.9, start: t + 0.05, dur, gain: 0.5 + 0.7 * k, attack: 0.08 });
    // перекаты
    playNoise(ctx, out, { filter: 'lowpass', freq: 160, freqEnd: 45, q: 0.8, start: t + 0.5 + 0.3 * k, dur: dur * 0.7, gain: 0.3 + 0.4 * k, attack: 0.15 });
    playNoise(ctx, out, { filter: 'lowpass', freq: 130, freqEnd: 40, q: 0.8, start: t + 1.3 + 0.6 * k, dur: dur * 0.6, gain: 0.2 + 0.3 * k, attack: 0.2 });
    // саб-волна
    playTone(ctx, out, { type: 'sine', freq: 70, freqEnd: 32, sweep: dur * 0.6, start: t + 0.05, dur: dur * 0.8, gain: 0.25 + 0.3 * k, attack: 0.05 });
  }

  private stopDrops(): void {
    if (this.dropTimer !== null) clearInterval(this.dropTimer);
    this.dropTimer = null;
  }

  dispose(): void {
    this.stopDrops();
    this.layer?.dispose();
    this.layer = null;
  }
}
