/** Одноразовые звуковые эффекты (все синтезируются на лету, узлы отключаются после окончания). */
import { playNoise, playTone } from './noise';
import { midiToFreq } from './theory';
import type { SfxName } from '../core/types';

/** Минимальный интервал между одинаковыми эффектами, мс. */
export const SFX_MIN_INTERVAL_MS: Record<SfxName, number> = {
  countdown: 150,
  go: 300,
  lap: 300,
  finish: 500,
  hit: 80,
  combo: 60,
  comboLost: 150,
  nitroStart: 300,
  land: 100,
  uiMove: 40,
  uiSelect: 60,
  uiBack: 60,
};

/** Минимальный интервал между «вжух» ускорения, мс. */
const BOOST_MIN_INTERVAL_MS = 250;

export class SfxPlayer {
  private readonly last = new Map<SfxName, number>();
  private lastBoostMs = -1e9;
  /** Входной gain эффектов (общий подъём уровня относительно музыки). */
  private readonly dest: GainNode;

  constructor(
    private readonly ctx: BaseAudioContext,
    out: AudioNode,
  ) {
    this.dest = ctx.createGain();
    this.dest.gain.value = 1.8;
    this.dest.connect(out);
  }

  /** Радио: шум-свип переключения станции (полоса вверх-вниз + короткий «щелчок настройки») */
  playRadioSweep(): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const d = this.dest;
    playNoise(ctx, d, { filter: 'bandpass', freq: 400, freqEnd: 4200, q: 3, start: t, dur: 0.18, gain: 0.22, attack: 0.02 });
    playNoise(ctx, d, { filter: 'bandpass', freq: 4200, freqEnd: 700, q: 3, start: t + 0.17, dur: 0.2, gain: 0.2, attack: 0.02 });
    playTone(ctx, d, { type: 'sine', freq: 900, freqEnd: 1400, start: t + 0.34, dur: 0.06, gain: 0.05, attack: 0.005 });
  }

  /**
   * Ускорение (бонус за дрифт/старт): восходящий «вжух» с бас-ударом; power 0..1 — сила
   * (громче, выше свип, дольше хвост). Отдельный метод: SfxName расширять нельзя.
   */
  playBoost(power: number): void {
    const ctx = this.ctx;
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (nowMs - this.lastBoostMs < BOOST_MIN_INTERVAL_MS) return;
    this.lastBoostMs = nowMs;
    const p = Number.isFinite(power) ? Math.min(1, Math.max(0, power)) : 0;
    const t = ctx.currentTime + 0.01;
    const d = this.dest;
    const dur = 0.45 + 0.25 * p;
    // «вжух»: шум с bandpass-свипом вверх
    playNoise(ctx, d, { filter: 'bandpass', freq: 500, freqEnd: 3800 + 2200 * p, q: 2.2, start: t, dur, gain: 0.2 + 0.2 * p, attack: 0.07 });
    // восходящий тон-«реактивный» подъём
    playTone(ctx, d, { type: 'sawtooth', freq: 110, freqEnd: 360 + 280 * p, start: t, dur: dur * 0.9, gain: 0.06 + 0.05 * p, attack: 0.06, cutoff: 1500 });
    // бас-удар в начале
    playTone(ctx, d, { type: 'sine', freq: 140, freqEnd: 40, start: t, dur: 0.3, gain: 0.34 + 0.2 * p, attack: 0.002 });
    playNoise(ctx, d, { filter: 'lowpass', freq: 600, freqEnd: 140, q: 0.7, start: t, dur: 0.12, gain: 0.15 + 0.1 * p, attack: 0.002 });
  }

  play(name: SfxName): void {
    const ctx = this.ctx;
    // ограничение частоты по реальному времени (currentTime может стоять при suspend)
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const prev = this.last.get(name);
    if (prev !== undefined && nowMs - prev < SFX_MIN_INTERVAL_MS[name]) return;
    this.last.set(name, nowMs);
    const t = ctx.currentTime + 0.01;
    const d = this.dest;

    switch (name) {
      case 'countdown':
        playTone(ctx, d, { type: 'square', freq: 660, start: t, dur: 0.15, gain: 0.2, attack: 0.004, cutoff: 3200 });
        playTone(ctx, d, { type: 'sine', freq: 660, start: t, dur: 0.15, gain: 0.18, attack: 0.004 });
        break;

      case 'go': {
        // мажорный аккорд E: E5 G#5 B5 + яркий бип 1320 Гц
        const notes = [76, 80, 83];
        for (const n of notes) {
          playTone(ctx, d, { type: 'sawtooth', freq: midiToFreq(n), start: t, dur: 0.7, gain: 0.09, attack: 0.008, cutoff: 4500 });
        }
        playTone(ctx, d, { type: 'square', freq: 1320, start: t, dur: 0.55, gain: 0.16, attack: 0.004, cutoff: 5000 });
        playTone(ctx, d, { type: 'sine', freq: 660, start: t, dur: 0.6, gain: 0.16, attack: 0.004 });
        playTone(ctx, d, { type: 'sine', freq: midiToFreq(40), start: t, dur: 0.6, gain: 0.2, attack: 0.01 });
        break;
      }

      case 'lap':
        playTone(ctx, d, { type: 'square', freq: midiToFreq(84), start: t, dur: 0.12, gain: 0.14, cutoff: 4500 });
        playTone(ctx, d, { type: 'square', freq: midiToFreq(88), start: t + 0.1, dur: 0.32, gain: 0.14, cutoff: 4500 });
        playTone(ctx, d, { type: 'sine', freq: midiToFreq(88), start: t + 0.1, dur: 0.32, gain: 0.12 });
        break;

      case 'finish': {
        // арпеджио до-мажор вверх, затем торжественный аккорд ~1.5 с
        const arp = [72, 76, 79, 84, 88];
        arp.forEach((n, i) => {
          playTone(ctx, d, { type: 'square', freq: midiToFreq(n), start: t + i * 0.09, dur: 0.22, gain: 0.085, cutoff: 4500 });
        });
        const tc = t + arp.length * 0.09;
        for (const n of [60, 67, 72, 76, 79, 84]) {
          playTone(ctx, d, {
            type: 'sawtooth',
            freq: midiToFreq(n),
            start: tc,
            dur: 1.1,
            gain: 0.06,
            attack: 0.02,
            cutoff: 3800,
            detune: n % 2 === 0 ? 6 : -6,
          });
        }
        playTone(ctx, d, { type: 'sine', freq: midiToFreq(48), start: tc, dur: 1.1, gain: 0.12, attack: 0.02 });
        break;
      }

      case 'hit':
        // глухой корпус + хруст металла + короткий расстроенный «звон»
        playNoise(ctx, d, { filter: 'lowpass', freq: 1400, freqEnd: 180, q: 0.8, start: t, dur: 0.25, gain: 0.5, attack: 0.002 });
        playNoise(ctx, d, { filter: 'bandpass', freq: 2600, freqEnd: 900, q: 1.4, start: t, dur: 0.12, gain: 0.28, attack: 0.001 });
        playTone(ctx, d, { type: 'sine', freq: 130, freqEnd: 45, start: t, dur: 0.28, gain: 0.5, attack: 0.002 });
        playTone(ctx, d, { type: 'square', freq: 310, freqEnd: 190, start: t, dur: 0.1, gain: 0.07, attack: 0.001, cutoff: 1800 });
        playTone(ctx, d, { type: 'square', freq: 337, freqEnd: 205, start: t, dur: 0.1, gain: 0.06, attack: 0.001, cutoff: 1800 });
        break;

      case 'combo':
        playTone(ctx, d, { type: 'triangle', freq: midiToFreq(79), start: t, dur: 0.1, gain: 0.2, cutoff: 5000 });
        playTone(ctx, d, { type: 'square', freq: midiToFreq(79), start: t, dur: 0.1, gain: 0.06, cutoff: 5000 });
        playTone(ctx, d, { type: 'triangle', freq: midiToFreq(86), start: t + 0.07, dur: 0.2, gain: 0.2, cutoff: 6000 });
        playTone(ctx, d, { type: 'square', freq: midiToFreq(86), start: t + 0.07, dur: 0.2, gain: 0.06, cutoff: 6000 });
        break;

      case 'comboLost':
        playTone(ctx, d, { type: 'sawtooth', freq: 620, freqEnd: 110, start: t, dur: 0.38, gain: 0.16, attack: 0.01, cutoff: 1800 });
        playTone(ctx, d, { type: 'sine', freq: 310, freqEnd: 60, start: t, dur: 0.38, gain: 0.16, attack: 0.01 });
        break;

      case 'nitroStart': {
        // «вжух»: шум с bandpass-свипом вверх + нарастающий низкий гул
        playNoise(ctx, d, { filter: 'bandpass', freq: 400, freqEnd: 4500, q: 2.5, start: t, dur: 0.55, gain: 0.45, attack: 0.15 });
        playNoise(ctx, d, { filter: 'highpass', freq: 3000, q: 0.6, start: t + 0.1, dur: 0.4, gain: 0.12, attack: 0.1 });
        playTone(ctx, d, { type: 'sawtooth', freq: 70, freqEnd: 260, start: t, dur: 0.5, gain: 0.12, attack: 0.1, cutoff: 900 });
        playTone(ctx, d, { type: 'sine', freq: 90, freqEnd: 38, start: t + 0.05, dur: 0.4, gain: 0.3, attack: 0.01 });
        break;
      }

      case 'land':
        playTone(ctx, d, { type: 'sine', freq: 95, freqEnd: 38, start: t, dur: 0.28, gain: 0.6, attack: 0.002 });
        playNoise(ctx, d, { filter: 'lowpass', freq: 380, freqEnd: 120, q: 0.7, start: t, dur: 0.16, gain: 0.3, attack: 0.002 });
        // скрежет подвески и пыль
        playNoise(ctx, d, { filter: 'bandpass', freq: 1800, freqEnd: 700, q: 1.2, start: t, dur: 0.14, gain: 0.1, attack: 0.002 });
        playTone(ctx, d, { type: 'triangle', freq: 220, freqEnd: 150, start: t, dur: 0.09, gain: 0.06, attack: 0.002 });
        break;

      case 'uiMove':
        playTone(ctx, d, { type: 'triangle', freq: 900, start: t, dur: 0.05, gain: 0.14, attack: 0.002 });
        break;

      case 'uiSelect':
        playTone(ctx, d, { type: 'square', freq: 1100, start: t, dur: 0.07, gain: 0.12, attack: 0.002, cutoff: 4000 });
        playTone(ctx, d, { type: 'square', freq: 1650, start: t + 0.05, dur: 0.12, gain: 0.12, attack: 0.002, cutoff: 4000 });
        break;

      case 'uiBack':
        playTone(ctx, d, { type: 'triangle', freq: 520, freqEnd: 340, start: t, dur: 0.1, gain: 0.17, attack: 0.002 });
        break;
    }
  }
}
