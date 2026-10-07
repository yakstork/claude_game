/**
 * Статистика игрока (`neonrush.stats.v1`): пробег, гонки, победы, подиумы, время в игре, лучшее комбо дрифта,
 * удары о стены, бусты, любимая машина и трасса, победы по режимам. Чистая логика без DOM/рендера;
 * в горячих методах (addDistance/addTime) нет аллокаций.
 */
import type { StorageLike } from './career';

export const STATS_KEY = 'neonrush.stats.v1';

export interface PlayerStats {
  /** Пробег, м */
  distance: number;
  races: number;
  wins: number;
  podiums: number;
  /** Время в игре, с */
  playTime: number;
  bestCombo: number;
  wallHits: number;
  boosts: number;
  trackRaces: Record<string, number>;
  carRaces: Record<string, number>;
  modeWins: Record<string, number>;
}

export function emptyStats(): PlayerStats {
  return { distance: 0, races: 0, wins: 0, podiums: 0, playTime: 0, bestCombo: 0, wallHits: 0, boosts: 0, trackRaces: {}, carRaces: {}, modeWins: {} };
}

export interface RaceSummary {
  trackId: string;
  carId: string;
  mode: string;
  position: number;
  /** Число участников (1 — заезд на время/дрифт без соперников: победы и подиумы не считаются) */
  racers: number;
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

/** Ключ с максимальным значением (при равенстве — первый по порядку вставки) или null */
export function favorite(map: Record<string, number>): string | null {
  let best: string | null = null;
  let bv = 0;
  for (const k of Object.keys(map)) {
    if (map[k] > bv) {
      bv = map[k];
      best = k;
    }
  }
  return best;
}

const SAVE_EVERY = 20;

export class StatsTracker {
  data: PlayerStats;
  private dirty = false;
  private sinceSave = 0;

  constructor(
    data: PlayerStats = emptyStats(),
    private readonly storage: StorageLike | null = defaultStorage(),
  ) {
    this.data = data;
  }

  /** Пробег по скорости: вызывать в шаге физики во время гонки (без аллокаций) */
  addDistance(speed: number, dt: number): void {
    if (speed > 0 && dt > 0 && dt < 0.5) {
      this.data.distance += speed * dt;
      this.dirty = true;
    }
  }

  /** Время в игре; раз в SAVE_EVERY секунд сохраняет накопленное */
  addTime(dt: number): void {
    if (!(dt > 0) || dt > 1) return;
    this.data.playTime += dt;
    this.dirty = true;
    this.sinceSave += dt;
    if (this.sinceSave >= SAVE_EVERY) this.flush();
  }

  addWall(): void {
    this.data.wallHits++;
    this.dirty = true;
  }

  addBoost(): void {
    this.data.boosts++;
    this.dirty = true;
  }

  noteCombo(points: number): void {
    if (points > this.data.bestCombo) {
      this.data.bestCombo = Math.round(points);
      this.dirty = true;
    }
  }

  addRace(r: RaceSummary): void {
    const d = this.data;
    d.races++;
    this.dirty = true;
    bump(d.trackRaces, r.trackId);
    bump(d.carRaces, r.carId);
    if (r.racers > 1) {
      if (r.position === 1) {
        d.wins++;
        bump(d.modeWins, r.mode);
      }
      if (r.position <= 3) d.podiums++;
    }
    this.flush();
  }

  flush(): void {
    this.sinceSave = 0;
    if (!this.dirty) return;
    this.dirty = false;
    saveStats(this.data, this.storage);
  }

  reset(): void {
    this.data = emptyStats();
    this.dirty = false;
    this.sinceSave = 0;
    saveStats(this.data, this.storage);
  }
}

// ─── Отображение ───────────────────────────────────────────────────────────

export interface StatTile {
  label: string;
  value: string;
  tone: 'pink' | 'cyan' | 'orange' | 'yellow' | '';
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} ч ${m} мин` : m > 0 ? `${m} мин ${s % 60} с` : `${s} с`;
}

export const MODE_LABELS: Record<string, string> = {
  race: 'Гонка',
  timeAttack: 'На время',
  cup: 'Кубок',
  drift: 'Дрифт',
  elimination: 'Выбывание',
  versus: 'Вдвоём',
};

export function summarize(p: PlayerStats, names: { track(id: string): string; car(id: string): string }): StatTile[] {
  const fav = (m: Record<string, number>, f: (id: string) => string): string => {
    const k = favorite(m);
    return k ? `${f(k)} · ${m[k]}` : '—';
  };
  const modes = Object.keys(p.modeWins)
    .filter((k) => p.modeWins[k] > 0)
    .map((k) => `${MODE_LABELS[k] ?? k} ${p.modeWins[k]}`)
    .join(' · ');
  return [
    { label: 'ПРОБЕГ', value: `${(p.distance / 1000).toFixed(1)} км`, tone: 'cyan' },
    { label: 'ГОНОК', value: String(p.races), tone: '' },
    { label: 'ПОБЕД', value: String(p.wins), tone: 'yellow' },
    { label: 'ПОДИУМОВ', value: String(p.podiums), tone: 'orange' },
    { label: 'ВРЕМЯ В ИГРЕ', value: formatDuration(p.playTime), tone: '' },
    { label: 'ЛУЧШЕЕ КОМБО', value: p.bestCombo.toLocaleString('ru-RU'), tone: 'pink' },
    { label: 'УДАРОВ О СТЕНЫ', value: String(p.wallHits), tone: '' },
    { label: 'БУСТОВ', value: String(p.boosts), tone: 'cyan' },
    { label: 'ЛЮБИМАЯ МАШИНА', value: fav(p.carRaces, names.car), tone: 'pink' },
    { label: 'ЛЮБИМАЯ ТРАССА', value: fav(p.trackRaces, names.track), tone: 'orange' },
    { label: 'ПОБЕДЫ ПО РЕЖИМАМ', value: modes || '—', tone: 'yellow' },
  ];
}

// ─── Сохранение ────────────────────────────────────────────────────────────

function num(v: unknown, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(0, v)) : 0;
}

function counts(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof v !== 'object' || v === null) return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 32)) {
    const n = Math.floor(num(x, 1e7));
    if (n > 0) out[k.slice(0, 24)] = n;
  }
  return out;
}

export function sanitizeStats(raw: unknown): PlayerStats {
  const p = emptyStats();
  if (typeof raw !== 'object' || raw === null) return p;
  const r = raw as Record<string, unknown>;
  p.distance = num(r.distance, 1e10);
  p.races = Math.floor(num(r.races, 1e7));
  p.wins = Math.floor(num(r.wins, 1e7));
  p.podiums = Math.floor(num(r.podiums, 1e7));
  p.playTime = num(r.playTime, 1e9);
  p.bestCombo = Math.floor(num(r.bestCombo, 1e9));
  p.wallHits = Math.floor(num(r.wallHits, 1e8));
  p.boosts = Math.floor(num(r.boosts, 1e8));
  p.trackRaces = counts(r.trackRaces);
  p.carRaces = counts(r.carRaces);
  p.modeWins = counts(r.modeWins);
  return p;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadStats(storage: StorageLike | null = defaultStorage()): PlayerStats {
  try {
    const raw = storage?.getItem(STATS_KEY);
    return raw ? sanitizeStats(JSON.parse(raw)) : emptyStats();
  } catch {
    return emptyStats();
  }
}

export function saveStats(p: PlayerStats, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(STATS_KEY, JSON.stringify(p));
  } catch {
    /* без сохранения */
  }
}
