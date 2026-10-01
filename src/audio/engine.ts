/** Синтез мотора, шипения нитро и визга шин. Узлы создаются один раз, в кадре меняются только параметры. */
import { createNoiseSource, disconnectAll } from './noise';
import { applyBoost, computeEngineTargets, makeEngineTargets, makeSoftClipCurve } from './theory';
import type { EngineAudioParams } from '../core/types';

/** Постоянная времени сглаживания параметров, с. */
const TC = 0.06;
/** Минимальный интервал между обновлениями параметров, с (~30 Гц достаточно при сглаживании). */
const MIN_UPDATE_DT = 0.03;

export class EngineSynth {
  private readonly targets = makeEngineTargets();
  private built = false;
  private lastUpdate = -1;
  private silenced = true;
  /** Сила ускорения 0..1 (гул чуть выше и шипение); задаёт AudioManager.setBoostLevel. */
  private boost = 0;
  private teardownTimer: ReturnType<typeof setTimeout> | null = null;

  private oscA: OscillatorNode | null = null;
  private oscB: OscillatorNode | null = null;
  private oscSub: OscillatorNode | null = null;
  private lowpass: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private nitroBand: BiquadFilterNode | null = null;
  private nitroGain: GainNode | null = null;
  private skidBand: BiquadFilterNode | null = null;
  private skidGain: GainNode | null = null;
  private skidLfo: OscillatorNode | null = null;
  private noiseNitro: AudioBufferSourceNode | null = null;
  private noiseSkid: AudioBufferSourceNode | null = null;
  private nodes: AudioNode[] = [];

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly dest: AudioNode,
  ) {}

  setBoost(level: number): void {
    this.boost = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  }

  /** Обновить мотор (вызывается каждый кадр). null — плавно заглушить. */
  update(p: EngineAudioParams | null): void {
    if (p === null) {
      this.silence();
      return;
    }
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (this.teardownTimer !== null) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }
    if (!this.built) {
      this.build();
      this.lastUpdate = -1;
    }
    if (!this.silenced && now - this.lastUpdate < MIN_UPDATE_DT) return;
    this.lastUpdate = now;
    const wasSilent = this.silenced;
    this.silenced = false;

    const t = computeEngineTargets(p, this.targets);
    if (this.boost > 0) applyBoost(t, this.boost);
    // при старте после тишины — быстрое включение, дальше сглаживание
    const tc = wasSilent ? 0.03 : TC;
    this.oscA?.frequency.setTargetAtTime(t.freq, now, tc);
    this.oscB?.frequency.setTargetAtTime(t.freq * 2, now, tc);
    this.oscSub?.frequency.setTargetAtTime(t.freq * 0.5, now, tc);
    this.lowpass?.frequency.setTargetAtTime(t.cutoff, now, tc);
    this.engineGain?.gain.setTargetAtTime(t.gain, now, wasSilent ? 0.12 : tc);
    this.nitroGain?.gain.setTargetAtTime(t.nitroGain, now, p.nitro ? 0.05 : 0.15);
    this.nitroBand?.frequency.setTargetAtTime(t.nitroFreq, now, 0.1);
    this.skidGain?.gain.setTargetAtTime(t.skidGain, now, t.skidGain > 0 ? 0.05 : 0.1);
    this.skidBand?.frequency.setTargetAtTime(t.skidFreq, now, 0.08);
  }

  /** Плавно заглушить и через паузу освободить узлы. */
  silence(): void {
    if (!this.built) return;
    const now = this.ctx.currentTime;
    if (!this.silenced) {
      this.silenced = true;
      this.boost = 0;
      this.engineGain?.gain.setTargetAtTime(0, now, 0.06);
      this.nitroGain?.gain.setTargetAtTime(0, now, 0.05);
      this.skidGain?.gain.setTargetAtTime(0, now, 0.05);
    }
    if (this.teardownTimer === null) {
      this.teardownTimer = setTimeout(() => {
        this.teardownTimer = null;
        if (this.silenced) this.teardown();
      }, 600);
    }
  }

  /** Полностью освободить (при закрытии). */
  dispose(): void {
    if (this.teardownTimer !== null) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }
    this.teardown();
  }

  private build(): void {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.dest);

    // --- мотор: 2 пилы + суб-синус → мягкий клиппер → lowpass → gain
    const mix = ctx.createGain();
    mix.gain.value = 1;
    const mk = (type: OscillatorType, freq: number, level: number, detune = 0): OscillatorNode => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g);
      g.connect(mix);
      this.nodes.push(g);
      return o;
    };
    const oscA = mk('sawtooth', 110, 0.5);
    const oscB = mk('sawtooth', 220, 0.28, 9);
    const oscSub = mk('sine', 55, 0.55);

    const shaper = ctx.createWaveShaper();
    shaper.curve = makeSoftClipCurve(2.2);
    shaper.oversample = '2x';
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.Q.value = 2.5;
    lowpass.frequency.value = 400;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    mix.connect(shaper);
    shaper.connect(lowpass);
    lowpass.connect(engineGain);
    engineGain.connect(out);

    // --- нитро: шипение (bandpass 2–4 кГц)
    const noiseNitro = createNoiseSource(ctx);
    const nitroBand = ctx.createBiquadFilter();
    nitroBand.type = 'bandpass';
    nitroBand.Q.value = 1.2;
    nitroBand.frequency.value = 2800;
    const nitroGain = ctx.createGain();
    nitroGain.gain.value = 0;
    noiseNitro.connect(nitroBand);
    nitroBand.connect(nitroGain);
    nitroGain.connect(out);

    // --- визг шин: bandpass-шум + LFO на частоту
    const noiseSkid = createNoiseSource(ctx);
    const skidBand = ctx.createBiquadFilter();
    skidBand.type = 'bandpass';
    skidBand.Q.value = 5;
    skidBand.frequency.value = 1800;
    const skidGain = ctx.createGain();
    skidGain.gain.value = 0;
    const skidLfo = ctx.createOscillator();
    skidLfo.type = 'sine';
    skidLfo.frequency.value = 11;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 140;
    skidLfo.connect(lfoDepth);
    lfoDepth.connect(skidBand.frequency);
    noiseSkid.connect(skidBand);
    skidBand.connect(skidGain);
    skidGain.connect(out);

    const t0 = ctx.currentTime;
    // разные смещения фазы шума, чтобы слои не коррелировали
    oscA.start(t0);
    oscB.start(t0);
    oscSub.start(t0);
    noiseNitro.start(t0, 0.3);
    noiseSkid.start(t0, 1.1);
    skidLfo.start(t0);

    this.oscA = oscA;
    this.oscB = oscB;
    this.oscSub = oscSub;
    this.lowpass = lowpass;
    this.engineGain = engineGain;
    this.nitroBand = nitroBand;
    this.nitroGain = nitroGain;
    this.skidBand = skidBand;
    this.skidGain = skidGain;
    this.skidLfo = skidLfo;
    this.noiseNitro = noiseNitro;
    this.noiseSkid = noiseSkid;
    this.nodes.push(out, mix, shaper, lowpass, engineGain, nitroBand, nitroGain, skidBand, skidGain, lfoDepth);
    this.built = true;
    this.silenced = true;
  }

  private teardown(): void {
    if (!this.built) return;
    const sources: (AudioScheduledSourceNode | null)[] = [
      this.oscA,
      this.oscB,
      this.oscSub,
      this.skidLfo,
      this.noiseNitro,
      this.noiseSkid,
    ];
    for (const s of sources) {
      try {
        s?.stop();
      } catch {
        /* уже остановлен */
      }
    }
    disconnectAll(...sources, ...this.nodes);
    this.nodes = [];
    this.oscA = this.oscB = this.oscSub = this.skidLfo = null;
    this.lowpass = this.nitroBand = this.skidBand = null;
    this.engineGain = this.nitroGain = this.skidGain = null;
    this.noiseNitro = this.noiseSkid = null;
    this.built = false;
    this.silenced = true;
  }
}
