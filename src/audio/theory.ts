/** Чистые функции звука: частоты, параметры мотора, паттерны секвенсора (без Web Audio, тестируются в Node). */
import type { EngineAudioParams, MusicTrack } from '../core/types';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** MIDI-нота → частота, Гц (A4 = 69 = 440 Гц). */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---------------------------------------------------------------------------
// Мотор
// ---------------------------------------------------------------------------

export interface EngineTargets {
  /** Основная частота, Гц */
  freq: number;
  /** Срез lowpass, Гц */
  cutoff: number;
  /** Громкость мотора (0..~0.4) */
  gain: number;
  /** Громкость шипения нитро */
  nitroGain: number;
  /** Центр полосового фильтра шипения, Гц */
  nitroFreq: number;
  /** Громкость визга шин */
  skidGain: number;
  /** Центр полосового фильтра визга, Гц */
  skidFreq: number;
}

/** Порог визга по skid (0..1). */
export const SKID_THRESHOLD = 0.15;

/** Целевые значения параметров синтеза мотора по данным физики. */
export function computeEngineTargets(p: EngineAudioParams, out: EngineTargets): EngineTargets {
  const rpm = clamp(Number.isFinite(p.rpm) ? p.rpm : 0, 0, 1);
  const thr = clamp(Number.isFinite(p.throttle) ? p.throttle : 0, 0, 1);
  const skid = clamp(Number.isFinite(p.skid) ? p.skid : 0, 0, 1);
  const speed = Number.isFinite(p.speed) ? Math.abs(p.speed) : 0;

  let freq = 55 + rpm * 190;
  let cutoff = lerp(400, 3500, thr) + rpm * 250;
  let gain = 0.18 + thr * 0.2;
  if (!p.onGround) {
    freq *= 1.1; // в воздухе колёса раскручиваются
    cutoff *= 1.35;
    gain *= 0.9;
  }
  if (p.nitro) {
    freq *= 1.05;
    cutoff *= 1.15;
  }
  out.freq = freq;
  out.cutoff = clamp(cutoff, 200, 9000);
  out.gain = gain;
  out.nitroGain = p.nitro ? 0.1 + thr * 0.06 : 0;
  out.nitroFreq = p.nitro ? 2600 + rpm * 800 : 2200;
  const skidOn = p.onGround && speed > 5 && skid > SKID_THRESHOLD;
  out.skidGain = skidOn ? ((skid - SKID_THRESHOLD) / (1 - SKID_THRESHOLD)) * 0.2 : 0;
  out.skidFreq = 1200 + skid * 1300;
  return out;
}

/**
 * Ускорение (бонус за дрифт/старт): тон мотора чуть выше, поверх — мягкое «шипение» через нитро-слой.
 * Меняет out на месте (без аллокаций); boost 0 — без изменений. boost — сила ускорения 0..1.
 */
export function applyBoost(out: EngineTargets, boost: number): EngineTargets {
  const b = clamp(Number.isFinite(boost) ? boost : 0, 0, 1);
  if (b <= 0) return out;
  out.freq *= 1 + 0.06 * b;
  out.cutoff = clamp(out.cutoff * (1 + 0.2 * b), 200, 9000);
  out.nitroGain = Math.max(out.nitroGain, 0.04 + 0.05 * b);
  out.nitroFreq = Math.max(out.nitroFreq, 2400 + 900 * b);
  return out;
}

export function makeEngineTargets(): EngineTargets {
  return { freq: 55, cutoff: 400, gain: 0, nitroGain: 0, nitroFreq: 2200, skidGain: 0, skidFreq: 1200 };
}

// ---------------------------------------------------------------------------
// Кривые и импульсы
// ---------------------------------------------------------------------------

/** Кривая мягкого клиппинга для WaveShaper (нечётная, монотонная, в пределах [-1, 1]). */
export function makeSoftClipCurve(amount: number, samples = 512): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(samples);
  const k = Math.max(0.01, amount);
  const norm = Math.tanh(k);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

/**
 * Огибающая импульса реверба: экспоненциальный спад; gate > 0 — резкий обрыв
 * (гейт-реверб) на доле gate от длительности.
 */
export function impulseEnvelope(t: number, dur: number, decay: number, gate = 0): number {
  if (t < 0 || t >= dur) return 0;
  const x = t / dur;
  let e = Math.exp(-decay * x);
  if (gate > 0) {
    if (x >= gate) return 0;
    const tail = 0.08; // короткое сглаживание перед обрывом
    if (x > gate - tail) e *= (gate - x) / tail;
  }
  return e;
}

// ---------------------------------------------------------------------------
// Секвенсор: паттерны (16-е доли)
// ---------------------------------------------------------------------------

export const STEPS_PER_BAR = 16;

export interface BassEvent {
  midi: number;
  /** длительность в 16-х */
  steps: number;
  vel: number;
}
export interface ArpEvent {
  midi: number;
  steps: number;
  vel: number;
}
export interface PadEvent {
  notes: number[];
  /** длительность в 16-х */
  steps: number;
}
export interface StepEvents {
  kick?: number;
  snare?: number;
  clap?: number;
  hat?: { vel: number; open: boolean };
  crash?: number;
  bass?: BassEvent;
  arp?: ArpEvent;
  pad?: PadEvent;
}

export interface TrackConfig {
  bpm: number;
  bars: number;
  /** MIDI-корни баса по тактам прогрессии (1 такт = 1 аккорд) */
  bassRoots: number[];
  /** Ноты пэда/арпеджио (аккорды по тактам прогрессии) */
  chords: number[][];
  /** Тембры и рисунок партий (для гоночных вариантов 1+; у варианта 0 и меню — по умолчанию) */
  style?: SongStyle;
}

/** Рисунок и тембры вариантной гоночной композиции. Паттерны — по 16 шагов такта. */
export interface SongStyle {
  /** Бас: смещение в полутонах от корня или -1 (пауза); нота звучит до следующей (макс. 8 шагов) */
  bass: readonly number[];
  /** Громкость бочки по шагам (0 — нет) */
  kick: readonly number[];
  /** Малый барабан/хлопок по шагам (0 — нет) */
  snare: readonly number[];
  /** Хэты по шагам: >0 закрытый, <0 открытый (модуль — громкость) */
  hat: readonly number[];
  /** Арпеджио: индексы аккордовых тонов 0..5 или -1; A — такты 0-3, B — 4-7 */
  arpA: readonly number[];
  arpB: readonly number[];
  /** Длительность ноты арпеджио в 16-х */
  arpSteps: number;
  bassType: OscillatorType;
  bassCut: number;
  bassCutEnd: number;
  arpType: OscillatorType;
  arpCut: number;
  padCut: number;
  /** Глубина сайдчейна 0..1 (на сколько прижимаются бас/пэд/арпеджио на бочке) */
  duck: number;
}

const MENU: TrackConfig = {
  bpm: 96,
  bars: 8,
  // Am – F – C – G
  bassRoots: [33, 29, 36, 31],
  chords: [
    [57, 60, 64],
    [57, 60, 65],
    [55, 60, 64],
    [55, 59, 62],
  ],
};

const RACE: TrackConfig = {
  bpm: 118,
  bars: 8,
  // Fm – Db – Ab – Eb
  bassRoots: [29, 37, 32, 39],
  chords: [
    [56, 60, 65],
    [56, 61, 65],
    [56, 60, 63],
    [55, 58, 63],
  ],
};

export const TRACKS: Record<MusicTrack, TrackConfig> = { menu: MENU, race: RACE };

const R = -1;
/** Гоночные композиции 1..3 (0 — исходная RACE). Разные тональности, темп, бас, ритм. */
const RACE_SONGS: readonly TrackConfig[] = [
  RACE,
  {
    // «Night Drive»: Cm – Ab – Eb – Bb, 126 bpm, оффбит-бас, четыре в корпус
    bpm: 126,
    bars: 8,
    bassRoots: [36, 32, 39, 34],
    chords: [
      [60, 63, 67],
      [56, 60, 63],
      [58, 63, 67],
      [58, 62, 65],
    ],
    style: {
      bass: [R, R, 0, R, R, R, 12, R, R, R, 0, R, R, R, 7, 12],
      kick: [1, 0, 0, 0, 0.9, 0, 0, 0, 0.9, 0, 0, 0, 0.9, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.9, 0, 0, 0, 0, 0, 0, 0, 0.9, 0, 0, 0],
      hat: [0, 0, -0.5, 0, 0, 0, -0.5, 0, 0, 0, -0.5, 0, 0, 0, -0.5, 0.25],
      arpA: [0, R, R, 2, R, R, 1, R, 3, R, R, 2, R, R, 4, R],
      arpB: [3, R, R, 5, R, R, 4, R, 2, R, R, 1, R, R, 2, R],
      arpSteps: 2,
      bassType: 'sawtooth',
      bassCut: 1500,
      bassCutEnd: 240,
      arpType: 'sawtooth',
      arpCut: 3600,
      padCut: 1700,
      duck: 0.6,
    },
  },
  {
    // «Chrome Horizon»: Em – C – G – D, 108 bpm, полтайм, тянущийся бас
    bpm: 108,
    bars: 8,
    bassRoots: [40, 36, 43, 38],
    chords: [
      [59, 64, 67],
      [60, 64, 67],
      [59, 62, 67],
      [57, 62, 66],
    ],
    style: {
      bass: [0, R, R, R, R, R, 12, R, 0, R, R, 0, R, R, 7, R],
      kick: [1, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0.85, 0, 0, 0, 0, 0],
      snare: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
      hat: [0.4, 0.15, 0.3, 0.15, 0.4, 0.15, 0.3, 0.15, 0.4, 0.15, 0.3, 0.15, 0.4, 0.15, -0.35, 0.15],
      arpA: [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 1, 2, 3, 2, 1],
      arpB: [5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0],
      arpSteps: 1,
      bassType: 'sawtooth',
      bassCut: 900,
      bassCutEnd: 200,
      arpType: 'triangle',
      arpCut: 4200,
      padCut: 1300,
      duck: 0.45,
    },
  },
  {
    // «Overdrive»: Dm – Bb – F – C, 136 bpm, рубленый 16-й бас, брейкбит
    bpm: 136,
    bars: 8,
    bassRoots: [38, 34, 41, 36],
    chords: [
      [62, 65, 69],
      [62, 65, 70],
      [60, 65, 69],
      [60, 64, 67],
    ],
    style: {
      bass: [0, 0, 12, 0, 0, 12, 0, 7, 0, 0, 12, 0, 0, 12, 7, 0],
      kick: [1, 0, 0, 0, 0.9, 0, 0, 0.5, 0, 0, 0.85, 0, 0.9, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.95, 0, 0, 0.3, 0, 0, 0, 0, 0.95, 0, 0, 0.3],
      hat: [0.4, 0.2, 0.3, 0.2, 0.4, 0.2, 0.3, 0.2, 0.4, 0.2, 0.3, 0.2, 0.4, 0.2, -0.45, 0.2],
      arpA: [0, 2, 1, 2, 3, 2, 1, 2, 0, 2, 4, 2, 3, 5, 4, 2],
      arpB: [5, 3, 4, 3, 2, 3, 4, 3, 5, 3, 1, 3, 2, 0, 1, 3],
      arpSteps: 1,
      bassType: 'square',
      bassCut: 1700,
      bassCutEnd: 320,
      arpType: 'square',
      arpCut: 3000,
      padCut: 1500,
      duck: 0.55,
    },
  },
];

/** Число гоночных композиций (выбор по кругу на каждую гонку). */
export const RACE_VARIANTS = RACE_SONGS.length;

/** Конфиг трека; variant — номер гоночной композиции (для menu игнорируется). */
export function getTrackConfig(track: MusicTrack, variant = 0): TrackConfig {
  if (track === 'menu') return MENU;
  return RACE_SONGS[((variant % RACE_VARIANTS) + RACE_VARIANTS) % RACE_VARIANTS] ?? RACE;
}

export const loopSteps = (track: MusicTrack, variant = 0): number => getTrackConfig(track, variant).bars * STEPS_PER_BAR;
/** Длительность 16-й доли, с. */
export const stepDuration = (bpm: number): number => 60 / bpm / 4;

// Индексы аккордовых тонов арпеджио: 0..2 — тоны, 3..5 — они же на октаву выше.
const RACE_ARP: readonly number[] = [0, 2, 1, 2, 3, 2, 1, 2, 0, 2, 4, 2, 3, 5, 4, 2];
const RACE_ARP_B: readonly number[] = [0, 1, 2, 3, 2, 1, 2, 4, 3, 2, 1, 2, 5, 4, 3, 2];
const MENU_ARP: readonly number[] = [0, 1, 2, 1];

function chordTone(chord: number[], idx: number): number {
  const base = chord[idx % 3] ?? chord[0] ?? 60;
  return base + (idx >= 3 ? 12 : 0);
}

/** События для 16-й доли `step` (номер берётся по модулю длины лупа). */
export function getStepEvents(track: MusicTrack, stepIn: number, variant = 0): StepEvents {
  const cfg = getTrackConfig(track, variant);
  if (cfg.style) return getSongStepEvents(cfg, cfg.style, stepIn);
  const total = cfg.bars * STEPS_PER_BAR;
  const step = ((stepIn % total) + total) % total;
  const bar = Math.floor(step / STEPS_PER_BAR);
  const s = step % STEPS_PER_BAR;
  const prog = bar % cfg.chords.length;
  const chord = cfg.chords[prog] ?? [];
  const root = cfg.bassRoots[prog] ?? 33;
  const ev: StepEvents = {};

  if (track === 'menu') {
    if (s === 0) ev.pad = { notes: chord, steps: STEPS_PER_BAR };
    if (s === 0 || s === 8) ev.kick = s === 0 ? 0.85 : 0.7;
    if (s % 4 === 2) ev.hat = { vel: 0.35, open: false };
    if (s === 14 && bar % 2 === 1) ev.hat = { vel: 0.4, open: true };
    if (s % 2 === 0) {
      // бас на восьмых: корень, иногда квинта/октава
      const k = s / 2;
      const up = k === 3 || (k === 7 && bar % 2 === 1) ? 12 : k === 5 ? 7 : 0;
      ev.bass = { midi: root + up, steps: 2, vel: k === 0 ? 1 : 0.8 };
      // мягкое арпеджио на восьмых; во второй половине лупа — октавой выше
      if (!(bar % 4 === 3 && s >= 12)) {
        const idx = MENU_ARP[k % MENU_ARP.length] ?? 0;
        const oct = bar >= 4 ? 12 : 0;
        ev.arp = { midi: chordTone(chord, idx) + 12 + oct, steps: 2, vel: k % 2 === 0 ? 0.8 : 0.6 };
      }
    }
    return ev;
  }

  // race
  const lastBar = bar === cfg.bars - 1;
  if (s === 0) ev.pad = { notes: chord, steps: STEPS_PER_BAR };
  if (step === 0) ev.crash = 0.6;
  if (s % 4 === 0) ev.kick = s === 0 ? 1 : 0.9;
  if (s === 4 || s === 12) {
    ev.snare = 0.9;
    ev.clap = 0.7;
  }
  // хэты: закрытые на 16-х (акцент на «и»), открытый на «и» каждой доли
  if (s % 4 === 2) ev.hat = { vel: 0.5, open: true };
  else if (s % 2 === 0) ev.hat = { vel: 0.3, open: false };
  else ev.hat = { vel: 0.18, open: false };
  // бас: пульсирующие октавы на восьмых
  if (s % 2 === 0) {
    const k = s / 2;
    ev.bass = { midi: root + (k % 2 === 1 ? 12 : 0), steps: 2, vel: k % 4 === 0 ? 1 : 0.85 };
  }
  // арпеджио шестнадцатыми
  {
    const idx = (bar >= 4 ? RACE_ARP_B : RACE_ARP)[s] ?? 0;
    ev.arp = { midi: chordTone(chord, idx) + 12, steps: 1, vel: s % 4 === 0 ? 0.9 : s % 2 === 0 ? 0.65 : 0.45 };
  }
  // филл в последнем такте: ролл малого барабана, убираем бочку и арпеджио на последней доле
  if (lastBar) {
    if (s >= 12) {
      ev.snare = 0.5 + ((s - 12) / 3) * 0.5;
      ev.clap = undefined;
      ev.kick = undefined;
      ev.arp = undefined;
      ev.hat = undefined;
    } else if (s >= 8 && s % 2 === 1) {
      ev.snare = 0.35;
    }
  }
  return ev;
}

/** События шага для вариантных гоночных композиций (данные из SongStyle). */
function getSongStepEvents(cfg: TrackConfig, st: SongStyle, stepIn: number): StepEvents {
  const total = cfg.bars * STEPS_PER_BAR;
  const step = ((stepIn % total) + total) % total;
  const bar = Math.floor(step / STEPS_PER_BAR);
  const s = step % STEPS_PER_BAR;
  const prog = bar % cfg.chords.length;
  const chord = cfg.chords[prog] ?? [];
  const root = cfg.bassRoots[prog] ?? 36;
  const ev: StepEvents = {};
  const lastBar = bar === cfg.bars - 1;

  if (s === 0) ev.pad = { notes: chord, steps: STEPS_PER_BAR };
  if (step === 0) ev.crash = 0.6;
  const k = st.kick[s] ?? 0;
  if (k > 0) ev.kick = k;
  const sn = st.snare[s] ?? 0;
  if (sn > 0) {
    ev.snare = sn;
    if (sn >= 0.8) ev.clap = sn * 0.75;
  }
  const h = st.hat[s] ?? 0;
  if (h !== 0) ev.hat = { vel: Math.abs(h), open: h < 0 };
  const b = st.bass[s] ?? -1;
  if (b >= 0) {
    let len = 1;
    while (len < 8 && s + len < STEPS_PER_BAR && (st.bass[s + len] ?? -1) < 0) len++;
    ev.bass = { midi: root + b, steps: len, vel: s === 0 ? 1 : b >= 12 ? 0.8 : 0.9 };
  }
  const ai = (bar >= 4 ? st.arpB : st.arpA)[s] ?? -1;
  if (ai >= 0) {
    let am = chordTone(chord, ai) + 12;
    if (am > 88) am -= 12;
    ev.arp = { midi: am, steps: st.arpSteps, vel: s % 4 === 0 ? 0.9 : s % 2 === 0 ? 0.65 : 0.5 };
  }
  // филл последнего такта: ролл малого, пауза бочки/арпеджио на последней доле
  if (lastBar) {
    if (s >= 12) {
      ev.snare = 0.5 + ((s - 12) / 3) * 0.5;
      ev.clap = undefined;
      ev.kick = undefined;
      ev.arp = undefined;
      ev.hat = undefined;
    } else if (s >= 8 && s % 2 === 1) {
      ev.snare = 0.35;
    }
  }
  return ev;
}
