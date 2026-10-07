/**
 * Кампания «Неоновая лига»: 12 событий в 3 главах, цели на 1–3 звезды, прогресс и разблокировки.
 * Чистая логика без DOM/рендера. Сохранение — localStorage `neonrush.campaign.v1`.
 */
import type { Difficulty } from '../core/types';
import type { StorageLike } from './career';

export const CAMPAIGN_KEY = 'neonrush.campaign.v1';

export type GoalKind = 'position' | 'lap' | 'drift';
/** Пороги для 1, 2 и 3 звёзд: место ≤, время круга ≤ (с), очки дрифта ≥ */
export type StarGoal = { kind: GoalKind; stars: [number, number, number] };

export interface CampaignEvent {
  id: string;
  chapter: number;
  title: string;
  /** Короткое условие (рус.) */
  brief: string;
  trackId: string;
  mode: 'race' | 'timeAttack';
  laps: number;
  difficulty: Difficulty;
  /** Фиксированная машина (id) или null — своя из меню */
  carId: string | null;
  goal: StarGoal;
}

export interface CampaignChapter {
  id: number;
  title: string;
  /** Сколько звёзд всего нужно, чтобы открыть главу */
  need: number;
}

export const CHAPTERS: CampaignChapter[] = [
  { id: 1, title: 'РАЗГОН', need: 0 },
  { id: 2, title: 'ГОРОД НЕ СПИТ', need: 6 },
  { id: 3, title: 'ЛИГА', need: 15 },
];

export const STAR_REWARD = 100;

export const EVENTS: CampaignEvent[] = [
  // Глава 1
  { id: 'c1e1', chapter: 1, title: 'Первый заезд', brief: 'Sunset Loop · 1 круг', trackId: 'sunset', mode: 'race', laps: 1, difficulty: 'easy', carId: null, goal: { kind: 'position', stars: [5, 3, 1] } },
  { id: 'c1e2', chapter: 1, title: 'На время', brief: 'Sunset Loop · лучший круг', trackId: 'sunset', mode: 'timeAttack', laps: 3, difficulty: 'normal', carId: 'razor', goal: { kind: 'lap', stars: [64, 59, 55] } },
  { id: 'c1e3', chapter: 1, title: 'Высота', brief: 'Neon Heights · 3 круга', trackId: 'heights', mode: 'race', laps: 3, difficulty: 'easy', carId: 'razor', goal: { kind: 'position', stars: [4, 2, 1] } },
  { id: 'c1e4', chapter: 1, title: 'Король заноса', brief: 'Sunset Loop · очки дрифта', trackId: 'sunset', mode: 'race', laps: 3, difficulty: 'normal', carId: 'grizzly', goal: { kind: 'drift', stars: [1500, 4000, 8000] } },
  // Глава 2
  { id: 'c2e1', chapter: 2, title: 'Спринт по небу', brief: 'Neon Heights · лучший круг', trackId: 'heights', mode: 'timeAttack', laps: 3, difficulty: 'normal', carId: null, goal: { kind: 'lap', stars: [82, 76, 71] } },
  { id: 'c2e2', chapter: 2, title: 'Полуночный берег', brief: 'Midnight Coast · 3 круга', trackId: 'coast', mode: 'race', laps: 3, difficulty: 'normal', carId: null, goal: { kind: 'position', stars: [4, 2, 1] } },
  { id: 'c2e3', chapter: 2, title: 'Прибой', brief: 'Midnight Coast · лучший круг', trackId: 'coast', mode: 'timeAttack', laps: 3, difficulty: 'normal', carId: 'photon', goal: { kind: 'lap', stars: [64, 58, 54] } },
  { id: 'c2e4', chapter: 2, title: 'Гроза', brief: 'Storm Boulevard · 3 круга', trackId: 'storm', mode: 'race', laps: 3, difficulty: 'normal', carId: 'photon', goal: { kind: 'position', stars: [4, 2, 1] } },
  // Глава 3
  { id: 'c3e1', chapter: 3, title: 'Закат: хард', brief: 'Sunset Loop · сложность ВЫСОКАЯ', trackId: 'sunset', mode: 'race', laps: 3, difficulty: 'hard', carId: 'razor', goal: { kind: 'position', stars: [4, 2, 1] } },
  { id: 'c3e2', chapter: 3, title: 'Тяжёлая высота', brief: 'Neon Heights · сложность ВЫСОКАЯ', trackId: 'heights', mode: 'race', laps: 3, difficulty: 'hard', carId: 'grizzly', goal: { kind: 'position', stars: [4, 2, 1] } },
  { id: 'c3e3', chapter: 3, title: 'Дрифт-шоу', brief: 'Midnight Coast · очки дрифта', trackId: 'coast', mode: 'race', laps: 3, difficulty: 'hard', carId: 'grizzly', goal: { kind: 'drift', stars: [3000, 7000, 12000] } },
  { id: 'c3e4', chapter: 3, title: 'Финал лиги', brief: 'Storm Boulevard · 5 кругов', trackId: 'storm', mode: 'race', laps: 5, difficulty: 'hard', carId: null, goal: { kind: 'position', stars: [3, 2, 1] } },
];

export function eventById(id: string): CampaignEvent | undefined {
  return EVENTS.find((e) => e.id === id);
}

// ─── Звёзды ────────────────────────────────────────────────────────────────

export interface Outcome {
  position: number;
  bestLap: number | null;
  driftScore: number;
}

/** Сколько звёзд (0..3) даёт результат */
export function evaluateStars(goal: StarGoal, o: Outcome): number {
  let n = 0;
  for (const t of goal.stars) {
    const ok =
      goal.kind === 'position' ? o.position <= t : goal.kind === 'lap' ? o.bestLap !== null && o.bestLap <= t : o.driftScore >= t;
    if (ok) n++;
    else break;
  }
  return n;
}

export function goalText(goal: StarGoal, star: 1 | 2 | 3): string {
  const t = goal.stars[star - 1];
  if (goal.kind === 'position') return t === 1 ? 'Победа' : `Место не ниже ${t}-го`;
  if (goal.kind === 'lap') {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `Круг быстрее ${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
  }
  return `Дрифт от ${t} очков`;
}

// ─── Прогресс ──────────────────────────────────────────────────────────────

export interface CampaignProgress {
  stars: Record<string, number>;
}

export function emptyProgress(): CampaignProgress {
  return { stars: {} };
}

export function starsOf(p: CampaignProgress, id: string): number {
  return p.stars[id] ?? 0;
}

export function totalStars(p: CampaignProgress): number {
  let n = 0;
  for (const e of EVENTS) n += starsOf(p, e.id);
  return n;
}

export const MAX_STARS = EVENTS.length * 3;

export function isChapterUnlocked(p: CampaignProgress, chapter: number): boolean {
  const ch = CHAPTERS.find((c) => c.id === chapter);
  return !!ch && totalStars(p) >= ch.need;
}

/** Событие открыто: глава открыта, и предыдущее событие главы пройдено хотя бы на 1 звезду */
export function isEventUnlocked(p: CampaignProgress, id: string): boolean {
  const e = eventById(id);
  if (!e || !isChapterUnlocked(p, e.chapter)) return false;
  const inCh = EVENTS.filter((x) => x.chapter === e.chapter);
  const i = inCh.indexOf(e);
  return i === 0 || starsOf(p, inCh[i - 1].id) >= 1;
}

export interface RecordResult {
  newStars: number;
  reward: number;
}

/** Записать результат: хранится лучший. Награда — за каждую впервые полученную звезду. */
export function recordResult(p: CampaignProgress, id: string, stars: number): RecordResult {
  const s = Math.min(3, Math.max(0, Math.floor(stars)));
  const prev = starsOf(p, id);
  if (!eventById(id) || s <= prev) return { newStars: 0, reward: 0 };
  p.stars[id] = s;
  return { newStars: s - prev, reward: (s - prev) * STAR_REWARD };
}

// ─── Сохранение ────────────────────────────────────────────────────────────

export function sanitizeProgress(raw: unknown): CampaignProgress {
  const p = emptyProgress();
  if (typeof raw !== 'object' || raw === null) return p;
  const st = (raw as Record<string, unknown>).stars;
  if (typeof st !== 'object' || st === null) return p;
  for (const e of EVENTS) {
    const v = (st as Record<string, unknown>)[e.id];
    if (typeof v === 'number' && Number.isFinite(v)) {
      const n = Math.min(3, Math.max(0, Math.floor(v)));
      if (n > 0) p.stars[e.id] = n;
    }
  }
  return p;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadCampaign(storage: StorageLike | null = defaultStorage()): CampaignProgress {
  try {
    const raw = storage?.getItem(CAMPAIGN_KEY);
    return raw ? sanitizeProgress(JSON.parse(raw)) : emptyProgress();
  } catch {
    return emptyProgress();
  }
}

export function saveCampaign(p: CampaignProgress, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(CAMPAIGN_KEY, JSON.stringify(p));
  } catch {
    /* без сохранения */
  }
}
