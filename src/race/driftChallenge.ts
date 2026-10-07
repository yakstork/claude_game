/** Дрифт-вызов: 90 секунд на трассе, цель — максимум очков дрифта и трюков. Чистая логика без DOM. */

export const CHALLENGE_DURATION = 90;

export type Medal = 'none' | 'bronze' | 'silver' | 'gold';

/** Серебро по умолчанию (медиана автопилота skill 0.9 по машинам); бронза = 0.5×, золото = 1.5×. */
export const BASE_SILVER = 11000;

/**
 * Серебро по трассам: медиана очков (дрифт + трюки) автопилота skill 0.9 за 90 с по 5 машинам
 * (калибровка симуляцией в Node). Золото требует хорошей игры.
 */
const TRACK_SILVER: Record<string, number> = { sunset: 12900, heights: 14400, coast: 11200, storm: 6300, canyon: 7400 };

/** Пороги [бронза, серебро, золото] от серебра, округлённые до сотен. */
export function thresholdsFromSilver(silver: number): [number, number, number] {
  const r = (v: number) => Math.round(v / 100) * 100;
  return [r(silver * 0.5), r(silver), r(silver * 1.5)];
}

export function medalThresholds(trackId: string): [number, number, number] {
  return thresholdsFromSilver(TRACK_SILVER[trackId] ?? BASE_SILVER);
}

export function medalFor(score: number, trackId: string): Medal {
  const [b, s, g] = medalThresholds(trackId);
  return score >= g ? 'gold' : score >= s ? 'silver' : score >= b ? 'bronze' : 'none';
}

/** Ближайшая невзятая цель или null, если золото уже взято. */
export function nextGoal(score: number, trackId: string): { medal: Exclude<Medal, 'none'>; points: number } | null {
  const [b, s, g] = medalThresholds(trackId);
  if (score < b) return { medal: 'bronze', points: b };
  if (score < s) return { medal: 'silver', points: s };
  if (score < g) return { medal: 'gold', points: g };
  return null;
}

export const MEDAL_NAMES: Record<Medal, string> = { none: 'БЕЗ МЕДАЛИ', bronze: 'БРОНЗА', silver: 'СЕРЕБРО', gold: 'ЗОЛОТО' };

export class DriftChallenge {
  elapsed = 0;
  constructor(readonly duration = CHALLENGE_DURATION) {}

  reset(): void {
    this.elapsed = 0;
  }

  /** Возвращает true, когда время вышло. */
  update(dt: number): boolean {
    this.elapsed = Math.min(this.duration, this.elapsed + dt);
    return this.finished;
  }

  get remaining(): number {
    return Math.max(0, this.duration - this.elapsed);
  }

  get finished(): boolean {
    return this.elapsed >= this.duration;
  }
}

// ── рекорды по трассе и машине ──────────────────────────────────────────────

const KEY = 'neonrush.driftChallenge.v1';

export function challengeKey(trackId: string, carId: string): string {
  return `${trackId}:${carId}`;
}

export function loadChallengeBests(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY);
    const o = raw ? (JSON.parse(raw) as unknown) : null;
    if (!o || typeof o !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/** Лучший результат по трассе и машине (0 — нет). */
export function challengeBest(trackId: string, carId: string): number {
  return loadChallengeBests()[challengeKey(trackId, carId)] ?? 0;
}

/** Сохраняет результат, если он лучше прежнего. */
export function submitChallengeScore(trackId: string, carId: string, score: number): { previous: number; isRecord: boolean } {
  const bests = loadChallengeBests();
  const key = challengeKey(trackId, carId);
  const previous = bests[key] ?? 0;
  const isRecord = score > previous;
  if (isRecord) {
    bests[key] = Math.round(score);
    try {
      localStorage.setItem(KEY, JSON.stringify(bests));
    } catch {
      /* хранилище недоступно */
    }
  }
  return { previous, isRecord };
}
