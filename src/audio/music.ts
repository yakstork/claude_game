/** Синтвейв-секвенсор с lookahead-планированием (ноты создаются с точным start(time)). */
import type { MusicTrack } from '../core/types';
import { createImpulseResponse, disconnectAll, playNoise, playTone } from './noise';
import { getStepEvents, getTrackConfig, loopSteps, midiToFreq, RACE_VARIANTS, stepDuration } from './theory';
import type { SongStyle } from './theory';
import type { ArpEvent, BassEvent, PadEvent } from './theory';

/** Как далеко вперёд планируем ноты, с. */
export const LOOKAHEAD_S = 0.12;
/** Период проверки планировщика, мс. */
export const TICK_MS = 25;
/** Постоянная времени кроссфейда (≈98% за 0.8 с). */
const FADE_TC = 0.2;
/** Срез общего фильтра мелодики: обычный / финальный круг, Гц. */
const DULL_CUT = 5200;
const BRIGHT_CUT = 16000;
/** Переход к финальному кругу, с (≈98% за 1.6 с). */
const INTENSITY_TC = 0.4;

/** Один играющий трек: свой подграф (шина, delay, reverb) и позиция секвенсора. */
class TrackPlayer {
  readonly out: GainNode;
  private readonly drums: GainNode;
  /** Шина мелодических партий (бас/пэд/арпеджио/эхо) — сюда «приседание» сайдчейна на бочке. */
  private readonly mel: GainNode;
  private readonly melFilter: BiquadFilterNode;
  private readonly baseDrums: number;
  private intensity: 0 | 1 = 0;
  private readonly style: SongStyle | undefined;
  private readonly duckDepth: number;
  private readonly delaySend: GainNode;
  private readonly reverbSend: GainNode;
  private readonly persistent: AudioNode[] = [];
  private readonly stepDur: number;
  private readonly total: number;
  private nextTime = 0;
  private step = 0;
  private stopped = false;
  private disposeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    readonly track: MusicTrack,
    readonly variant = 0,
  ) {
    const cfg = getTrackConfig(track, variant);
    this.style = cfg.style;
    this.duckDepth = cfg.style ? cfg.style.duck : track === 'race' ? 0.5 : 0.25;
    this.stepDur = stepDuration(cfg.bpm);
    this.total = loopSteps(track, variant);
    const race = track === 'race';

    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);

    this.baseDrums = race ? 1 : 0.8;
    this.drums = ctx.createGain();
    this.drums.gain.value = this.baseDrums;
    this.drums.connect(this.out);

    this.mel = ctx.createGain();
    this.mel.gain.value = 1;
    // общий lowpass мелодики: на финальном круге открывается (ярче)
    this.melFilter = ctx.createBiquadFilter();
    this.melFilter.type = 'lowpass';
    this.melFilter.Q.value = 0.4;
    this.melFilter.frequency.value = DULL_CUT;
    this.mel.connect(this.melFilter);
    this.melFilter.connect(this.out);

    // эхо арпеджио: точка с долей (3 шестнадцатых), обратная связь с lowpass
    const delay = ctx.createDelay(1);
    delay.delayTime.value = this.stepDur * 3;
    const fb = ctx.createGain();
    fb.gain.value = race ? 0.35 : 0.45;
    const fbFilter = ctx.createBiquadFilter();
    fbFilter.type = 'lowpass';
    fbFilter.frequency.value = 2400;
    const delayWet = ctx.createGain();
    delayWet.gain.value = race ? 0.45 : 0.6;
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 1;
    this.delaySend.connect(delay);
    delay.connect(fbFilter);
    fbFilter.connect(fb);
    fb.connect(delay);
    delay.connect(delayWet);
    delayWet.connect(this.mel);

    // реверб: гейт-реверб для снэра в гонке, мягкий «зал» в меню (для пэда/арпеджио)
    const conv = ctx.createConvolver();
    conv.buffer = race ? createImpulseResponse(ctx, 0.45, 3, 0.7) : createImpulseResponse(ctx, 1.8, 4.5);
    const reverbWet = ctx.createGain();
    reverbWet.gain.value = race ? 0.55 : 0.4;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    this.reverbSend.connect(conv);
    conv.connect(reverbWet);
    reverbWet.connect(this.mel);

    this.persistent.push(
      this.out, this.drums, this.mel, this.melFilter, delay, fb, fbFilter, delayWet, this.delaySend, conv, reverbWet, this.reverbSend,
    );
  }

  /** Финальный круг: фильтр открыт, барабаны громче, добавляются хэт 1/16 и октавный бас. Плавно. */
  setIntensity(level: 0 | 1): void {
    this.intensity = level;
    const now = this.ctx.currentTime;
    this.melFilter.frequency.setTargetAtTime(level ? BRIGHT_CUT : DULL_CUT, now, INTENSITY_TC);
    this.drums.gain.setTargetAtTime(this.baseDrums * (level ? 1.18 : 1), now, INTENSITY_TC);
  }

  /** Запуск с плавным появлением. */
  start(at: number): void {
    this.nextTime = at;
    this.step = 0;
    const g = this.out.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(0.0001, at);
    g.setTargetAtTime(1, at, FADE_TC);
  }

  /** Спланировать все шаги, начинающиеся раньше `until`. */
  pump(until: number): void {
    if (this.stopped) return;
    // если планировщик сильно отстал (вкладка тормозила) — пропускаем шаги, сохраняя сетку
    const now = this.ctx.currentTime;
    if (this.nextTime < now - 0.1) {
      const skip = Math.ceil((now + 0.03 - this.nextTime) / this.stepDur);
      this.step = (this.step + skip) % this.total;
      this.nextTime += skip * this.stepDur;
    }
    while (this.nextTime < until) {
      this.scheduleStep(this.step, this.nextTime);
      this.step = (this.step + 1) % this.total;
      this.nextTime += this.stepDur;
    }
  }

  /** Плавно погасить, перестать планировать, освободить узлы после хвостов. */
  fadeOutAndDispose(): void {
    if (this.stopped) return;
    this.stopped = true;
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(0, now, FADE_TC);
    this.disposeTimer = setTimeout(() => this.dispose(), 3500);
  }

  dispose(): void {
    this.stopped = true;
    if (this.disposeTimer !== null) {
      clearTimeout(this.disposeTimer);
      this.disposeTimer = null;
    }
    disconnectAll(...this.persistent);
  }

  // ---------------------------------------------------------------------------

  private scheduleStep(step: number, t: number): void {
    const ev = getStepEvents(this.track, step, this.variant);
    if (ev.pad) this.pad(t, ev.pad);
    if (ev.kick !== undefined) {
      this.kick(t, ev.kick);
      this.duck(t, ev.kick);
    }
    if (ev.snare !== undefined) this.snare(t, ev.snare);
    if (ev.clap !== undefined) this.clap(t, ev.clap);
    if (ev.hat) this.hat(t, ev.hat.vel, ev.hat.open);
    else if (this.intensity && this.track === 'race') this.hat(t, 0.45, false); // хэт 1/16
    if (ev.crash !== undefined) this.crash(t, ev.crash);
    if (ev.bass) {
      this.bass(t, ev.bass);
      if (this.intensity) this.octaveBass(t, ev.bass);
    }
    if (ev.arp) this.arp(t, ev.arp);
  }

  /** Сайдчейн: мелодика «приседает» на ударе бочки и плавно возвращается. */
  private duck(t: number, vel: number): void {
    const g = this.mel.gain;
    g.setValueAtTime(1 - this.duckDepth * Math.min(1, vel), t);
    g.setTargetAtTime(1, t + 0.015, 0.075);
  }

  private kick(t: number, vel: number): void {
    playTone(this.ctx, this.drums, {
      type: 'sine', freq: 150, freqEnd: 45, sweep: 0.12, start: t, dur: 0.42, gain: 0.9 * vel, attack: 0.002,
    });
    // короткий клик для атаки
    playNoise(this.ctx, this.drums, { filter: 'lowpass', freq: 2500, q: 0.5, start: t, dur: 0.02, gain: 0.12 * vel, attack: 0.001 });
  }

  private snare(t: number, vel: number): void {
    const n = playNoise(this.ctx, this.drums, { filter: 'highpass', freq: 1600, q: 0.7, start: t, dur: 0.2, gain: 0.34 * vel, attack: 0.001 });
    playTone(this.ctx, this.drums, { type: 'triangle', freq: 230, freqEnd: 150, sweep: 0.08, start: t, dur: 0.12, gain: 0.25 * vel, attack: 0.001 });
    if (this.track === 'race') n.connect(this.reverbSend);
  }

  private clap(t: number, vel: number): void {
    const race = this.track === 'race';
    for (let i = 0; i < 3; i++) {
      const last = i === 2;
      const g = playNoise(this.ctx, this.drums, {
        filter: 'bandpass', freq: 1500, q: 1.1, start: t + i * 0.011, dur: last ? 0.16 : 0.025, gain: 0.3 * vel, attack: 0.001,
      });
      if (race && last) g.connect(this.reverbSend);
    }
  }

  private hat(t: number, vel: number, open: boolean): void {
    playNoise(this.ctx, this.drums, {
      filter: 'highpass', freq: 7500, q: 0.6, start: t, dur: open ? 0.16 : 0.04, gain: 0.17 * vel, attack: 0.001,
    });
  }

  private crash(t: number, vel: number): void {
    playNoise(this.ctx, this.drums, { filter: 'highpass', freq: 4500, q: 0.5, start: t, dur: 1.2, gain: 0.13 * vel, attack: 0.002 });
  }

  private bass(t: number, e: BassEvent): void {
    const ctx = this.ctx;
    const race = this.track === 'race';
    const dur = e.steps * this.stepDur * 0.92;
    const f = midiToFreq(e.midi);
    const osc = ctx.createOscillator();
    osc.type = this.style ? this.style.bassType : race ? 'sawtooth' : 'square';
    osc.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = race ? 3 : 1.5;
    lp.frequency.setValueAtTime(this.style ? this.style.bassCut : race ? 1300 : 700, t);
    lp.frequency.setTargetAtTime(this.style ? this.style.bassCutEnd : race ? 280 : 260, t, race ? 0.09 : 0.12);
    const g = ctx.createGain();
    const level = (race ? 0.3 : 0.24) * e.vel;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 0.006);
    g.gain.setValueAtTime(level, t + dur * 0.7);
    g.gain.setTargetAtTime(0, t + dur * 0.7, 0.03);
    osc.connect(lp);
    lp.connect(g);
    g.connect(this.mel);
    // саб-синус для веса
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = f;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.linearRampToValueAtTime(0.25 * e.vel, t + 0.006);
    sg.gain.setValueAtTime(0.25 * e.vel, t + dur * 0.7);
    sg.gain.setTargetAtTime(0, t + dur * 0.7, 0.03);
    sub.connect(sg);
    sg.connect(this.mel);
    osc.start(t);
    sub.start(t);
    osc.stop(t + dur + 0.2);
    sub.stop(t + dur + 0.2);
    osc.onended = () => disconnectAll(osc, lp, g, sub, sg);
  }

  /** Октавный бас поверх основного (финальный круг). */
  private octaveBass(t: number, e: BassEvent): void {
    playTone(this.ctx, this.mel, {
      type: 'triangle', freq: midiToFreq(e.midi + 12), start: t, dur: e.steps * this.stepDur * 0.8,
      gain: 0.11 * e.vel, attack: 0.006, cutoff: 1600,
    });
  }

  private arp(t: number, e: ArpEvent): void {
    const race = this.track === 'race';
    const dur = e.steps * this.stepDur * (race ? (this.style && this.style.arpSteps > 1 ? 0.9 : 1.0) : 1.3);
    const g = playTone(this.ctx, this.mel, {
      type: this.style ? this.style.arpType : 'square',
      freq: midiToFreq(e.midi), start: t, dur, gain: (race ? 0.05 : 0.04) * e.vel, attack: 0.004,
      cutoff: this.style ? this.style.arpCut : race ? 3200 : 2300,
    });
    // отправка в эхо (и в зал в меню)
    g.connect(this.delaySend);
    if (!race) g.connect(this.reverbSend);
  }

  private pad(t: number, e: PadEvent): void {
    const ctx = this.ctx;
    const race = this.track === 'race';
    const dur = e.steps * this.stepDur;
    const attack = race ? 0.12 : 0.7;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.8;
    lp.frequency.value = this.style ? this.style.padCut : race ? 1500 : 1200;
    const g = ctx.createGain();
    const level = race ? 0.05 : 0.06;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setValueAtTime(level, t + dur - 0.1);
    g.gain.setTargetAtTime(0, t + dur - 0.1, 0.3);
    lp.connect(g);
    g.connect(this.mel);
    if (!race) g.connect(this.reverbSend);
    const oscs: OscillatorNode[] = [];
    for (const n of e.notes) {
      for (const det of [-9, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiToFreq(n);
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 1.6);
        oscs.push(o);
      }
    }
    const last = oscs[oscs.length - 1];
    if (last) last.onended = () => disconnectAll(...oscs, lp, g);
  }
}

/** Управляет текущим треком и кроссфейдом; планировщик тикает каждые TICK_MS. */
export class MusicSequencer {
  private current: TrackPlayer | null = null;
  private level: 0 | 1 = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Следующая гоночная композиция: старт случайный, дальше по кругу. */
  private nextRace = Math.floor(Math.random() * RACE_VARIANTS);

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly dest: AudioNode,
    private readonly useTimer = true,
  ) {}

  get track(): MusicTrack | null {
    return this.current ? this.current.track : null;
  }

  /** Номер играющей гоночной композиции (для отладки/тестов). */
  get variant(): number {
    return this.current ? this.current.variant : 0;
  }

  setTrack(track: MusicTrack | null): void {
    if ((this.current?.track ?? null) === track) return;
    if (this.current) {
      this.current.fadeOutAndDispose();
      this.current = null;
    }
    if (track !== null) {
      let variant = 0;
      if (track === 'race') {
        variant = this.nextRace;
        this.nextRace = (this.nextRace + 1) % RACE_VARIANTS;
      }
      const p = new TrackPlayer(this.ctx, this.dest, track, variant);
      const at = this.ctx.currentTime + 0.06;
      if (this.level) p.setIntensity(this.level);
      p.start(at);
      this.current = p;
      p.pump(this.ctx.currentTime + LOOKAHEAD_S);
      this.ensureTimer();
    } else {
      this.stopTimer();
    }
  }

  /** Финальный круг вкл/выкл; новый трек всегда стартует с 0. */
  setIntensity(level: 0 | 1): void {
    this.level = level;
    this.current?.setIntensity(level);
  }

  /** Спланировать ноты до `until` (в тестах с OfflineAudioContext вызывается вручную). */
  pump(until: number): void {
    this.current?.pump(until);
  }

  dispose(): void {
    this.stopTimer();
    this.current?.dispose();
    this.current = null;
  }

  private ensureTimer(): void {
    if (!this.useTimer || this.timer !== null) return;
    this.timer = setInterval(() => this.pump(this.ctx.currentTime + LOOKAHEAD_S), TICK_MS);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
