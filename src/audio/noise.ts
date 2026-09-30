/** Web Audio-хелперы: шумовые буферы, процедурные импульсы реверба, простые голоса. */
import { impulseEnvelope } from './theory';

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Общий буфер белого шума (2 с, моно); кешируется на контекст. */
export function getNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    const len = Math.floor(ctx.sampleRate * 2);
    buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // детерминированный xorshift — одинаковый шум между запусками
    let x = 0x2545f491;
    for (let i = 0; i < len; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      d[i] = ((x >>> 0) / 4294967295) * 2 - 1;
    }
    noiseCache.set(ctx, buf);
  }
  return buf;
}

/** Зацикленный источник шума со случайным смещением. */
export function createNoiseSource(ctx: BaseAudioContext, loop = true): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  src.loop = loop;
  return src;
}

/** Стерео-импульс реверба из шума с экспоненциальным спадом (gate > 0 — гейт-реверб). */
export function createImpulseResponse(ctx: BaseAudioContext, seconds: number, decay: number, gate = 0): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  let x = 0x1234abcd;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      const n = ((x >>> 0) / 4294967295) * 2 - 1;
      d[i] = n * impulseEnvelope(i / ctx.sampleRate, seconds, decay, gate);
    }
  }
  return buf;
}

/** Безопасно отключить узлы (повторный disconnect не должен ронять). */
export function disconnectAll(...nodes: (AudioNode | null | undefined)[]): void {
  for (const n of nodes) {
    if (!n) continue;
    try {
      n.disconnect();
    } catch {
      /* уже отключён */
    }
  }
}

export interface ToneOpts {
  type: OscillatorType;
  freq: number;
  /** конечная частота (экспоненциальный sweep за dur) */
  freqEnd?: number;
  /** время sweep-а до freqEnd, с (по умолчанию = dur) */
  sweep?: number;
  start: number;
  dur: number;
  gain: number;
  attack?: number;
  /** lowpass-срез, Гц */
  cutoff?: number;
  detune?: number;
}

/** Одноразовый тон: осциллятор → (lowpass) → gain-огибающая → dest. Сам отключается после окончания. Возвращает выходной gain (для дополнительных отправок). */
export function playTone(ctx: BaseAudioContext, dest: AudioNode, o: ToneOpts): GainNode {
  const osc = ctx.createOscillator();
  osc.type = o.type;
  const g = ctx.createGain();
  const attack = Math.min(o.attack ?? 0.005, o.dur * 0.5);
  const end = o.start + o.dur;
  osc.frequency.setValueAtTime(o.freq, o.start);
  if (o.freqEnd !== undefined && o.freqEnd > 0) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, o.start + (o.sweep ?? o.dur));
  if (o.detune) osc.detune.value = o.detune;
  g.gain.setValueAtTime(0.0001, o.start);
  g.gain.linearRampToValueAtTime(o.gain, o.start + attack);
  g.gain.setTargetAtTime(0, o.start + attack, Math.max(0.005, (o.dur - attack) / 4));
  let tail: AudioNode = osc;
  let lp: BiquadFilterNode | null = null;
  if (o.cutoff) {
    lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.cutoff;
    osc.connect(lp);
    tail = lp;
  }
  tail.connect(g);
  g.connect(dest);
  osc.start(o.start);
  osc.stop(end + 0.05);
  osc.onended = () => disconnectAll(osc, lp, g);
  return g;
}

export interface NoiseOpts {
  filter: BiquadFilterType;
  freq: number;
  freqEnd?: number;
  q?: number;
  start: number;
  dur: number;
  gain: number;
  attack?: number;
}

/** Одноразовый шумовой всплеск через фильтр. Возвращает выходной gain-узел (для отправки в реверб и т.п.). */
export function playNoise(ctx: BaseAudioContext, dest: AudioNode, o: NoiseOpts): GainNode {
  const src = createNoiseSource(ctx, true);
  const f = ctx.createBiquadFilter();
  f.type = o.filter;
  f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.freq, o.start);
  const end = o.start + o.dur;
  if (o.freqEnd !== undefined && o.freqEnd > 0) f.frequency.exponentialRampToValueAtTime(o.freqEnd, end);
  const g = ctx.createGain();
  const attack = Math.min(o.attack ?? 0.003, o.dur * 0.6);
  g.gain.setValueAtTime(0.0001, o.start);
  g.gain.linearRampToValueAtTime(o.gain, o.start + attack);
  g.gain.setTargetAtTime(0, o.start + attack, Math.max(0.005, (o.dur - attack) / 4));
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  // случайное смещение внутри буфера, чтобы удары не были одинаковыми
  src.start(o.start, Math.random() * 1.5);
  src.stop(end + 0.05);
  src.onended = () => disconnectAll(src, f, g);
  return g;
}
