/**
 * Система соперника: бот, ближайший к игроку по прошлым результатам, личные встречи и
 * реплики-«рации» из шаблонов. Чистая логика без DOM/рендера. Сохранение — `neonrush.rivals.v1`.
 */
import type { BotTrait } from '../core/types';
import type { StorageLike } from './career';

export const RIVALS_KEY = 'neonrush.rivals.v1';
/** «Забывание» старых гонок при подсчёте средней разницы мест */
const DECAY = 0.9;
/** Оценка разницы мест для бота, с которым ещё не встречались (нейтральная: не лучшее, не худшее) */
const UNSEEN_GAP = 1.5;

export interface BotRecord {
  /** Взвешенная сумма (место бота − место игрока): > 0 — бот обычно позади */
  diff: number;
  /** Взвешенное число гонок */
  n: number;
  /** Личные встречи: сколько раз игрок финишировал выше бота / бот выше игрока */
  you: number;
  bot: number;
}

export interface RivalsData {
  bots: Record<string, BotRecord>;
  /** Последний выбранный соперник */
  rival: string | null;
}

export function emptyRivals(): RivalsData {
  return { bots: {}, rival: null };
}

/** Насколько бот далёк от игрока по результатам (меньше — ближе) */
export function gapOf(rec: BotRecord | undefined): number {
  if (!rec || rec.n <= 0) return UNSEEN_GAP;
  return Math.abs(rec.diff / rec.n);
}

/** Соперник — бот с минимальной средней разницей мест; при равенстве — тот, что раньше в списке (на сетке ближе к лидеру) */
export function chooseRival(data: RivalsData, botNames: readonly string[]): string | null {
  let best: string | null = null;
  let bestGap = Infinity;
  for (const name of botNames) {
    const g = gapOf(data.bots[name]);
    // небольшой бонус прошлому сопернику: не прыгаем между ботами из-за шума
    const adj = name === data.rival ? g - 0.15 : g;
    if (adj < bestGap - 1e-9) {
      bestGap = adj;
      best = name;
    }
  }
  return best;
}

export interface RivalRow {
  name: string;
  position: number;
  isPlayer: boolean;
}

/** Записать итог гонки: обновляет статистику по каждому боту. Возвращает true, если данные изменились. */
export function recordRace(data: RivalsData, rows: readonly RivalRow[]): boolean {
  const player = rows.find((r) => r.isPlayer);
  if (!player) return false;
  let changed = false;
  for (const r of rows) {
    if (r.isPlayer) continue;
    const rec = (data.bots[r.name] ??= { diff: 0, n: 0, you: 0, bot: 0 });
    rec.diff = rec.diff * DECAY + (r.position - player.position);
    rec.n = rec.n * DECAY + 1;
    if (player.position < r.position) rec.you++;
    else rec.bot++;
    changed = true;
  }
  return changed;
}

export function headToHead(data: RivalsData, name: string): { you: number; bot: number } {
  const r = data.bots[name];
  return { you: r?.you ?? 0, bot: r?.bot ?? 0 };
}

// ─── Рация ─────────────────────────────────────────────────────────────────

export type RadioKind = 'botPassed' | 'playerPassed' | 'finalLap';
export const RADIO_MS = 2000;

const COMMON: Record<RadioKind, string[]> = {
  botPassed: ['Увидимся впереди!', 'Спасибо за след!', 'Пропускаю вперёд? Нет!', 'Держи моё нитро!'],
  playerPassed: ['Ловко! Но я рядом.', 'Это ещё не финиш!', 'Не расслабляйся.', 'Вижу тебя в зеркале… нет, наоборот!'],
  finalLap: ['Последний круг. Всё или ничего!', 'Финишная прямая решит всё.', 'Круг до финиша. Не подведи.'],
};

const BY_TRAIT: Partial<Record<BotTrait, Partial<Record<RadioKind, string[]>>>> = {
  aggressor: { botPassed: ['С дороги!', 'Моё место!'], playerPassed: ['Верну с процентами!'], finalLap: ['Пощады не будет!'] },
  clean: { botPassed: ['Чисто прошёл.', 'Аккуратно, без касаний.'], playerPassed: ['Чистый обгон. Уважаю.'], finalLap: ['Без ошибок до финиша.'] },
  drifter: { botPassed: ['Боком быстрее!', 'Дымим дальше!'], playerPassed: ['Займусь заносом, догоню!'], finalLap: ['Весь круг в заносе!'] },
  nitro: { botPassed: ['Нитро!', 'Жми на баллон!'], playerPassed: ['У меня ещё есть нитро.'], finalLap: ['Весь бак — на последний круг!'] },
  cunning: { botPassed: ['Я ждал этого момента.', 'Слипстрим — лучший друг.'], playerPassed: ['Так и задумано. Подожду.'], finalLap: ['Я берёг силы для этого круга.'] },
};

/** Реплика соперника из шаблонов (детерминированно по seed, без нецензурной лексики) */
export function radioLine(kind: RadioKind, trait: BotTrait | undefined, seed: number): string {
  const pool = [...(BY_TRAIT[trait as BotTrait]?.[kind] ?? []), ...COMMON[kind]];
  const i = Math.abs(Math.floor(seed)) % pool.length;
  return pool[i];
}

// ─── Сохранение ────────────────────────────────────────────────────────────

export function sanitizeRivals(raw: unknown): RivalsData {
  const d = emptyRivals();
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;
  if (typeof r.rival === 'string') d.rival = r.rival.slice(0, 24);
  const bots = r.bots;
  if (typeof bots === 'object' && bots !== null) {
    for (const [k, v] of Object.entries(bots as Record<string, unknown>).slice(0, 32)) {
      if (typeof v !== 'object' || v === null) continue;
      const o = v as Record<string, unknown>;
      const num = (x: unknown, lo: number, hi: number): number => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : 0);
      d.bots[k.slice(0, 24)] = { diff: num(o.diff, -1000, 1000), n: num(o.n, 0, 1000), you: Math.floor(num(o.you, 0, 100000)), bot: Math.floor(num(o.bot, 0, 100000)) };
    }
  }
  return d;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadRivals(storage: StorageLike | null = defaultStorage()): RivalsData {
  try {
    const raw = storage?.getItem(RIVALS_KEY);
    return raw ? sanitizeRivals(JSON.parse(raw)) : emptyRivals();
  } catch {
    return emptyRivals();
  }
}

export function saveRivals(d: RivalsData, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(RIVALS_KEY, JSON.stringify(d));
  } catch {
    /* без сохранения */
  }
}
