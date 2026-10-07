/**
 * «Вызов дня»: набор условий (трасса, машина, время суток, режим, сложность, модификатор)
 * детерминированно зависит от даты UTC (seed = YYYYMMDD). Цель с медалями, лучший результат
 * дня и серия дней подряд — localStorage `neonrush.daily.v1`. Чистая логика без DOM/рендера.
 */
import type { Difficulty, RaceMode, TimeOfDay } from '../core/types';
import { medalThresholds } from './driftChallenge';
import type { StorageLike } from './career';

export const DAILY_KEY = 'neonrush.daily.v1';

export type DailyModifier = 'none' | 'nitroCans' | 'doubleBoost' | 'cleanRun';
export type DailyMode = Extract<RaceMode, 'race' | 'timeAttack' | 'drift' | 'elimination'>;
/** 0 — без медали, 1 — бронза, 2 — серебро, 3 — золото */
export type DailyMedal = 0 | 1 | 2 | 3;
export type DailyGoalKind = 'position' | 'lap' | 'drift';

export const MODIFIERS: Record<DailyModifier, { title: string; desc: string }> = {
  none: { title: 'БЕЗ МОДИФИКАТОРА', desc: 'Обычные правила.' },
  nitroCans: { title: 'НИТРО ТОЛЬКО С КАНИСТР', desc: 'Нитро не копится от заноса и слипстрима — только канистры на трассе. Старт с пустым баком.' },
  doubleBoost: { title: 'ДВОЙНЫЕ БУСТЫ', desc: 'Бустер-пластины дают вдвое более долгий и сильный буст.' },
  cleanRun: { title: 'ЧИСТЫЙ ЗАЕЗД', desc: 'Золото — только без единого удара о стену.' },
};

export const MODE_NAMES: Record<DailyMode, string> = {
  race: 'ГОНКА',
  timeAttack: 'НА ВРЕМЯ',
  drift: 'ДРИФТ-ВЫЗОВ',
  elimination: 'ВЫБЫВАНИЕ',
};

export const DIFFICULTY_NAMES: Record<Difficulty, string> = { easy: 'ЛЁГКАЯ', normal: 'СРЕДНЯЯ', hard: 'ВЫСОКАЯ' };
export const TOD_NAMES: Record<TimeOfDay, string> = { sunset: 'ЗАКАТ', night: 'НОЧЬ', dawn: 'РАССВЕТ' };

export interface DailyChallenge {
  /** YYYYMMDD (UTC) */
  seed: number;
  /** 'YYYY-MM-DD' */
  dateKey: string;
  trackId: string;
  carId: string;
  timeOfDay: TimeOfDay;
  mode: DailyMode;
  laps: number;
  difficulty: Difficulty;
  modifier: DailyModifier;
  goal: { kind: DailyGoalKind; thresholds: [number, number, number] };
}

export interface DailyContext {
  trackIds: readonly string[];
  carIds: readonly string[];
  /** Длина круга трассы, м (для порогов заезда на время) */
  trackLength(trackId: string): number;
}

/** seed = YYYYMMDD по дате UTC */
export function dailySeed(date: Date): number {
  return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

export function dateKeyOf(seed: number): string {
  const y = Math.floor(seed / 10000);
  const m = Math.floor(seed / 100) % 100;
  const d = seed % 100;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Предыдущий день (seed → seed) */
export function previousSeed(seed: number): number {
  const y = Math.floor(seed / 10000);
  const m = Math.floor(seed / 100) % 100;
  const d = seed % 100;
  return dailySeed(new Date(Date.UTC(y, m - 1, d - 1)));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rnd: () => number, list: readonly T[]): T {
  return list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
}

function pickWeighted<T>(rnd: () => number, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let r = rnd() * total;
  for (const [v, w] of items) {
    r -= w;
    if (r < 0) return v;
  }
  return items[items.length - 1][0];
}

/** Скорость (м/с) для порогов заезда на время: бронза / серебро / золото */
const LAP_SPEEDS: [number, number, number] = [31, 34, 37];

export function dailyChallenge(seed: number, ctx: DailyContext): DailyChallenge {
  const rnd = mulberry32(seed * 2654435761 + 1013904223);
  const trackId = pick(rnd, ctx.trackIds);
  const carId = pick(rnd, ctx.carIds);
  const timeOfDay = pick(rnd, ['sunset', 'night', 'dawn'] as const);
  const mode = pickWeighted<DailyMode>(rnd, [
    ['race', 4],
    ['timeAttack', 2],
    ['drift', 2],
    ['elimination', 2],
  ]);
  const difficulty = pickWeighted<Difficulty>(rnd, [
    ['easy', 1],
    ['normal', 2],
    ['hard', 1],
  ]);
  // «нитро с канистр» и «чистый заезд» осмысленны не во всех режимах: в дрифт-вызове нитро не нужно
  let modifier = pickWeighted<DailyModifier>(rnd, [
    ['none', 2],
    ['nitroCans', 2],
    ['doubleBoost', 2],
    ['cleanRun', 2],
  ]);
  if (mode === 'drift' && modifier === 'nitroCans') modifier = 'doubleBoost';

  let goal: DailyChallenge['goal'];
  if (mode === 'timeAttack') {
    const L = ctx.trackLength(trackId);
    const r = (v: number) => Math.round(v * 10) / 10;
    goal = { kind: 'lap', thresholds: [r(L / LAP_SPEEDS[0]), r(L / LAP_SPEEDS[1]), r(L / LAP_SPEEDS[2])] };
  } else if (mode === 'drift') {
    goal = { kind: 'drift', thresholds: medalThresholds(trackId) };
  } else {
    goal = { kind: 'position', thresholds: [4, 2, 1] };
  }
  return { seed, dateKey: dateKeyOf(seed), trackId, carId, timeOfDay, mode, laps: 3, difficulty, modifier, goal };
}

// ─── Результат ─────────────────────────────────────────────────────────────

export interface DailyOutcome {
  position: number;
  bestLap: number | null;
  driftScore: number;
  wallHits: number;
}

export function evaluateMedal(ch: DailyChallenge, o: DailyOutcome): DailyMedal {
  let n = 0;
  for (const t of ch.goal.thresholds) {
    const ok =
      ch.goal.kind === 'position' ? o.position <= t : ch.goal.kind === 'lap' ? o.bestLap !== null && o.bestLap <= t : o.driftScore >= t;
    if (ok) n++;
    else break;
  }
  if (ch.modifier === 'cleanRun' && o.wallHits > 0) n = Math.min(n, 2);
  return n as DailyMedal;
}

/** Значение результата «чем больше, тем лучше» — для сравнения попыток внутри дня */
export function outcomeScore(ch: DailyChallenge, o: DailyOutcome): number {
  if (ch.goal.kind === 'position') return -o.position;
  if (ch.goal.kind === 'lap') return o.bestLap === null ? -1e6 : -o.bestLap;
  return o.driftScore;
}

export function goalText(ch: DailyChallenge, medal: 1 | 2 | 3): string {
  const t = ch.goal.thresholds[medal - 1];
  if (ch.goal.kind === 'position') return t === 1 ? 'Победа' : `Место не ниже ${t}-го`;
  if (ch.goal.kind === 'lap') {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `Круг быстрее ${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
  }
  return `Дрифт от ${t} очков`;
}

export function formatScore(ch: DailyChallenge, score: number): string {
  if (ch.goal.kind === 'position') return `${-score}-е место`;
  if (ch.goal.kind === 'lap') {
    const t = -score;
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
  }
  return `${Math.round(score)} очков`;
}

export const MEDAL_REWARD: readonly [number, number, number, number] = [0, 50, 100, 200];
export const MEDAL_LABELS = ['БЕЗ МЕДАЛИ', 'БРОНЗА', 'СЕРЕБРО', 'ЗОЛОТО'] as const;

// ─── Прогресс ──────────────────────────────────────────────────────────────

export interface DailyProgress {
  /** Лучший результат дня (только за seed `bestSeed`) */
  bestSeed: number;
  bestMedal: DailyMedal;
  bestScore: number;
  /** Серия дней подряд с медалью (≥ бронза) и последний засчитанный день */
  streak: number;
  lastDoneSeed: number;
  /** Рекордная серия */
  maxStreak: number;
}

export function emptyDaily(): DailyProgress {
  return { bestSeed: 0, bestMedal: 0, bestScore: 0, streak: 0, lastDoneSeed: 0, maxStreak: 0 };
}

/** Серия, видимая сейчас: оборвалась, если последний засчитанный день старше вчерашнего */
export function currentStreak(p: DailyProgress, today: number): number {
  if (p.lastDoneSeed === today || p.lastDoneSeed === previousSeed(today)) return p.streak;
  return 0;
}

/** Лучший результат именно сегодняшнего дня (иначе пусто) */
export function todayBest(p: DailyProgress, today: number): { medal: DailyMedal; score: number } | null {
  return p.bestSeed === today ? { medal: p.bestMedal, score: p.bestScore } : null;
}

export interface DailyRecord {
  medal: DailyMedal;
  /** Прирост медали относительно лучшего за день (для награды) */
  improved: number;
  reward: number;
  newBest: boolean;
  streak: number;
}

/** Записать попытку: хранится лучший результат дня; серия растёт при первой медали дня */
export function recordDaily(p: DailyProgress, ch: DailyChallenge, o: DailyOutcome): DailyRecord {
  const medal = evaluateMedal(ch, o);
  const score = outcomeScore(ch, o);
  const today = ch.seed;
  const prev = p.bestSeed === today ? p : null;
  const prevMedal = prev ? prev.bestMedal : 0;
  const newBest = !prev || score > prev.bestScore || medal > prev.bestMedal;
  if (newBest) {
    p.bestSeed = today;
    p.bestMedal = prev ? (Math.max(prev.bestMedal, medal) as DailyMedal) : medal;
    p.bestScore = prev ? Math.max(prev.bestScore, score) : score;
  }
  if (medal >= 1 && p.lastDoneSeed !== today) {
    p.streak = p.lastDoneSeed === previousSeed(today) ? p.streak + 1 : 1;
    p.lastDoneSeed = today;
    p.maxStreak = Math.max(p.maxStreak, p.streak);
  }
  let reward = 0;
  for (let m = prevMedal + 1; m <= medal; m++) reward += MEDAL_REWARD[m];
  return { medal, improved: Math.max(0, medal - prevMedal), reward, newBest, streak: p.streak };
}

// ─── Сохранение ────────────────────────────────────────────────────────────

export function sanitizeDaily(raw: unknown): DailyProgress {
  const p = emptyDaily();
  if (typeof raw !== 'object' || raw === null) return p;
  const r = raw as Record<string, unknown>;
  const int = (v: unknown, lo: number, hi: number): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : null;
  p.bestSeed = int(r.bestSeed, 0, 99991231) ?? 0;
  p.bestMedal = (int(r.bestMedal, 0, 3) ?? 0) as DailyMedal;
  p.bestScore = typeof r.bestScore === 'number' && Number.isFinite(r.bestScore) ? r.bestScore : 0;
  p.streak = int(r.streak, 0, 100000) ?? 0;
  p.lastDoneSeed = int(r.lastDoneSeed, 0, 99991231) ?? 0;
  p.maxStreak = Math.max(p.streak, int(r.maxStreak, 0, 100000) ?? 0);
  return p;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadDaily(storage: StorageLike | null = defaultStorage()): DailyProgress {
  try {
    const raw = storage?.getItem(DAILY_KEY);
    return raw ? sanitizeDaily(JSON.parse(raw)) : emptyDaily();
  } catch {
    return emptyDaily();
  }
}

export function saveDaily(p: DailyProgress, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(DAILY_KEY, JSON.stringify(p));
  } catch {
    /* без сохранения */
  }
}
