/**
 * Карьера: неон-кредиты (NC), улучшения машин, покупка цветов. Чистая логика без DOM/рендера.
 * Сохранение — localStorage `neonrush.career.v1` с валидацией.
 */
import type { Difficulty, RaceMode } from '../core/types';
import type { HandlingConfig } from '../vehicle/handling';
import { CUSTOM_PALETTE } from '../vehicle/specs';

export const CAREER_KEY = 'neonrush.career.v1';

export type UpgradeBranch = 'engine' | 'grip' | 'nitro';
export const BRANCHES: readonly UpgradeBranch[] = ['engine', 'grip', 'nitro'];
export const MAX_LEVEL = 5;

export const BRANCH_LABEL: Record<UpgradeBranch, string> = { engine: 'МОТОР', grip: 'СЦЕПЛЕНИЕ', nitro: 'НИТРО' };
export const BRANCH_DESC: Record<UpgradeBranch, string> = {
  engine: 'Тяга и макс. скорость',
  grip: 'Боковое сцепление',
  nitro: 'Ёмкость и заряд нитро',
};

export type UpgradeLevels = Record<UpgradeBranch, number>;
export type ColorKind = 'body' | 'neon';

export interface CarCareer {
  levels: UpgradeLevels;
  /** Выбранный цвет кузова/неона заводской машины; null — заводской */
  body: number | null;
  neon: number | null;
  /** Узор полосы: 0 — нет, 1..STRIPE_COUNT (должен быть куплен) */
  stripe: number;
  /** Номер на борту 0..99 или null; доступен после покупки «слота номера» для машины */
  number: number | null;
  numberOwned: boolean;
}

export interface Career {
  credits: number;
  /** Всего заработано (статистика) */
  earned: number;
  cars: Record<string, CarCareer>;
  /** Купленные цвета (общие для всех заводских машин) */
  owned: { body: number[]; neon: number[]; stripes: number[] };
}

// ─── Цены ──────────────────────────────────────────────────────────────────

const PRICE_BASE = [150, 260, 420, 650, 950];
const BRANCH_PRICE_MUL: Record<UpgradeBranch, number> = { engine: 1, grip: 0.9, nitro: 0.8 };
export const COLOR_PRICE: Record<ColorKind, number> = { body: 180, neon: 140 };
export const STRIPE_COUNT = 3;
export const STRIPE_NAMES = ['—', 'ЦЕНТР', 'ДВА', 'БОРТ'];
export const STRIPE_PRICE = 220;
export const NUMBER_PRICE = 100;

/** Цена перехода на уровень `target` (1..5); null — вне диапазона */
export function upgradePrice(branch: UpgradeBranch, target: number): number | null {
  if (!Number.isInteger(target) || target < 1 || target > MAX_LEVEL) return null;
  return Math.round((PRICE_BASE[target - 1] * BRANCH_PRICE_MUL[branch]) / 10) * 10;
}

// ─── Состояние ─────────────────────────────────────────────────────────────

export function emptyCarCareer(): CarCareer {
  return { levels: { engine: 0, grip: 0, nitro: 0 }, body: null, neon: null, stripe: 0, number: null, numberOwned: false };
}

export function emptyCareer(): Career {
  return { credits: 0, earned: 0, cars: {}, owned: { body: [], neon: [], stripes: [] } };
}

/** Прогресс машины (создаётся при первом обращении) */
export function carCareer(c: Career, carId: string): CarCareer {
  return (c.cars[carId] ??= emptyCarCareer());
}

export function levelsOf(c: Career, carId: string): UpgradeLevels {
  return c.cars[carId]?.levels ?? { engine: 0, grip: 0, nitro: 0 };
}

export function nextUpgradePrice(c: Career, carId: string, branch: UpgradeBranch): number | null {
  return upgradePrice(branch, levelsOf(c, carId)[branch] + 1);
}

export type BuyResult = 'ok' | 'maxed' | 'poor' | 'invalid' | 'owned';

/** Купить следующий уровень ветки (мутирует career) */
export function buyUpgrade(c: Career, carId: string, branch: UpgradeBranch): BuyResult {
  if (!BRANCHES.includes(branch) || !carId) return 'invalid';
  const cc = carCareer(c, carId);
  const price = upgradePrice(branch, cc.levels[branch] + 1);
  if (price === null) return 'maxed';
  if (c.credits < price) return 'poor';
  c.credits -= price;
  cc.levels[branch] += 1;
  return 'ok';
}

export function isPaletteColor(kind: ColorKind, color: number): boolean {
  return CUSTOM_PALETTE[kind].includes(color);
}

export function isColorOwned(c: Career, kind: ColorKind, color: number, factory: number): boolean {
  return color === factory || c.owned[kind].includes(color);
}

/** Купить цвет из палитры (общий для всех заводских машин) */
export function buyColor(c: Career, kind: ColorKind, color: number): BuyResult {
  if (!isPaletteColor(kind, color)) return 'invalid';
  if (c.owned[kind].includes(color)) return 'owned';
  const price = COLOR_PRICE[kind];
  if (c.credits < price) return 'poor';
  c.credits -= price;
  c.owned[kind].push(color);
  return 'ok';
}

/** Выбрать цвет машины (null — заводской). Только заводские цвета или купленные. */
export function selectColor(c: Career, carId: string, kind: ColorKind, color: number | null, factory: number): boolean {
  if (!carId) return false;
  if (color !== null && color !== factory && !(isPaletteColor(kind, color) && c.owned[kind].includes(color))) return false;
  carCareer(c, carId)[kind] = color === factory ? null : color;
  return true;
}

/** Купить узор полосы (общий для всех заводских машин) */
export function buyStripe(c: Career, pattern: number): BuyResult {
  if (!Number.isInteger(pattern) || pattern < 1 || pattern > STRIPE_COUNT) return 'invalid';
  if (c.owned.stripes.includes(pattern)) return 'owned';
  if (c.credits < STRIPE_PRICE) return 'poor';
  c.credits -= STRIPE_PRICE;
  c.owned.stripes.push(pattern);
  return 'ok';
}

/** Выбрать узор полосы для машины (0 — без полосы; иначе узор должен быть куплен) */
export function selectStripe(c: Career, carId: string, pattern: number): boolean {
  if (!carId || !Number.isInteger(pattern) || pattern < 0 || pattern > STRIPE_COUNT) return false;
  if (pattern > 0 && !c.owned.stripes.includes(pattern)) return false;
  carCareer(c, carId).stripe = pattern;
  return true;
}

/** Купить «слот номера» для машины */
export function buyNumberSlot(c: Career, carId: string): BuyResult {
  if (!carId) return 'invalid';
  const cc = carCareer(c, carId);
  if (cc.numberOwned) return 'owned';
  if (c.credits < NUMBER_PRICE) return 'poor';
  c.credits -= NUMBER_PRICE;
  cc.numberOwned = true;
  return 'ok';
}

/** Выбрать номер 0..99 (null — без номера); нужен купленный слот */
export function selectNumber(c: Career, carId: string, n: number | null): boolean {
  if (!carId) return false;
  const cc = carCareer(c, carId);
  if (n === null) {
    cc.number = null;
    return true;
  }
  if (!cc.numberOwned || !Number.isInteger(n) || n < 0 || n > 99) return false;
  cc.number = n;
  return true;
}

// ─── Эффекты улучшений ─────────────────────────────────────────────────────

/** Бонус на 5 уровне ветки, доля (умеренно: до ~+8%) */
const EFFECT_AT_MAX = { engineAccel: 0.08, engineSpeed: 0.05, grip: 0.08, nitro: 0.08 };

export interface UpgradeMultipliers {
  acceleration: number;
  maxSpeed: number;
  grip: number;
  /** Ёмкость нитро: расход уменьшается, заряд от дрифта растёт */
  nitroCapacity: number;
}

function levelFrac(l: number): number {
  return Math.min(MAX_LEVEL, Math.max(0, Math.floor(Number.isFinite(l) ? l : 0))) / MAX_LEVEL;
}

export function multipliersFor(levels: UpgradeLevels): UpgradeMultipliers {
  const e = levelFrac(levels.engine);
  return {
    acceleration: 1 + EFFECT_AT_MAX.engineAccel * e,
    maxSpeed: 1 + EFFECT_AT_MAX.engineSpeed * e,
    grip: 1 + EFFECT_AT_MAX.grip * levelFrac(levels.grip),
    nitroCapacity: 1 + EFFECT_AT_MAX.nitro * levelFrac(levels.nitro),
  };
}

export function hasUpgrades(levels: UpgradeLevels): boolean {
  return levels.engine > 0 || levels.grip > 0 || levels.nitro > 0;
}

/** Копия конфига машины с применёнными улучшениями (исходный объект не меняется) */
export function applyUpgrades(h: HandlingConfig, levels: UpgradeLevels): HandlingConfig {
  const m = multipliersFor(levels);
  const out: HandlingConfig = { ...h };
  out.acceleration = h.acceleration * m.acceleration;
  out.nitroBoost = h.nitroBoost * (1 + (m.acceleration - 1) * 0.5);
  out.maxSpeed = h.maxSpeed * m.maxSpeed;
  out.grip = h.grip * m.grip;
  out.driftGrip = h.driftGrip * (1 + (m.grip - 1) * 0.5);
  out.nitroUse = h.nitroUse / m.nitroCapacity;
  out.driftChargeRate = h.driftChargeRate * m.nitroCapacity;
  return out;
}

// ─── Награда за гонку ──────────────────────────────────────────────────────

export interface RewardInput {
  mode: RaceMode;
  difficulty: Difficulty;
  /** 1-based */
  position: number;
  racers: number;
  laps: number;
  driftScore: number;
  newBestLap: boolean;
  newBestRace: boolean;
  newBestDrift: boolean;
  /** Кубок завершён и игрок первый */
  cupWon: boolean;
  /** Сколько трюков выполнено (необязательно) */
  stunts?: number;
}

export interface RewardLine {
  label: string;
  value: number;
}

export interface Reward {
  total: number;
  lines: RewardLine[];
}

export const DIFFICULTY_MUL: Record<Difficulty, number> = { easy: 0.8, normal: 1, hard: 1.25 };
const PLACE_BONUS = [200, 120, 80, 40];
const PARTICIPATION = 60;

export function computeReward(i: RewardInput): Reward {
  const lapK = Math.min(1.7, Math.max(0.4, (Number.isFinite(i.laps) ? i.laps : 3) / 3));
  const raw: RewardLine[] = [];
  raw.push({ label: 'ЗАЕЗД', value: Math.round(PARTICIPATION * lapK) });
  if (i.mode !== 'timeAttack' && i.racers > 1) {
    const b = PLACE_BONUS[i.position - 1] ?? 0;
    if (b > 0) raw.push({ label: `${i.position}-Е МЕСТО`, value: Math.round(b * lapK) });
  }
  const drift = Math.min(250, Math.floor(Math.max(0, i.driftScore) / 80));
  if (drift > 0) raw.push({ label: 'ДРИФТ', value: drift });
  const stunts = Math.min(100, Math.max(0, Math.floor(i.stunts ?? 0)) * 10);
  if (stunts > 0) raw.push({ label: 'ТРЮКИ', value: stunts });
  if (i.newBestLap) raw.push({ label: 'РЕКОРД КРУГА', value: 50 });
  if (i.newBestRace) raw.push({ label: 'РЕКОРД ГОНКИ', value: 80 });
  if (i.newBestDrift) raw.push({ label: 'РЕКОРД ДРИФТА', value: 50 });
  if (i.cupWon) raw.push({ label: 'КУБОК', value: 300 });
  // множитель сложности уже учтён в значениях строк
  const mul = DIFFICULTY_MUL[i.difficulty] ?? 1;
  const lines = mul === 1 ? raw : raw.map((l) => ({ ...l, value: Math.round(l.value * mul) }));
  const total = lines.reduce((s, l) => s + l.value, 0);
  return { total, lines };
}

/** Начислить награду (мутирует career) */
export function award(c: Career, r: Reward): void {
  const t = Math.max(0, Math.floor(r.total));
  c.credits += t;
  c.earned += t;
}

// ─── Валидация и сохранение ────────────────────────────────────────────────

const MAX_CREDITS = 999_999_999;

function int(v: unknown, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : lo;
}

function colorList(v: unknown, kind: ColorKind): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v) if (typeof x === 'number' && isPaletteColor(kind, x) && !out.includes(x)) out.push(x);
  return out;
}

function colorOrNull(v: unknown, kind: ColorKind): number | null {
  return typeof v === 'number' && isPaletteColor(kind, v) ? v : null;
}

/** Приводит произвольные данные к корректному Career (мусор → значения по умолчанию) */
export function sanitizeCareer(raw: unknown): Career {
  const c = emptyCareer();
  if (typeof raw !== 'object' || raw === null) return c;
  const r = raw as Record<string, unknown>;
  c.credits = int(r.credits, 0, MAX_CREDITS);
  c.earned = int(r.earned, 0, MAX_CREDITS);
  const owned = (typeof r.owned === 'object' && r.owned !== null ? r.owned : {}) as Record<string, unknown>;
  c.owned.body = colorList(owned.body, 'body');
  c.owned.neon = colorList(owned.neon, 'neon');
  if (Array.isArray(owned.stripes)) {
    for (const x of owned.stripes) if (typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= STRIPE_COUNT && !c.owned.stripes.includes(x)) c.owned.stripes.push(x);
  }
  if (typeof r.cars === 'object' && r.cars !== null && !Array.isArray(r.cars)) {
    for (const [id, v] of Object.entries(r.cars as Record<string, unknown>)) {
      if (typeof v !== 'object' || v === null || id === '__proto__') continue;
      const cv = v as Record<string, unknown>;
      const lv = (typeof cv.levels === 'object' && cv.levels !== null ? cv.levels : {}) as Record<string, unknown>;
      const body = colorOrNull(cv.body, 'body');
      const neon = colorOrNull(cv.neon, 'neon');
      c.cars[id] = {
        levels: { engine: int(lv.engine, 0, MAX_LEVEL), grip: int(lv.grip, 0, MAX_LEVEL), nitro: int(lv.nitro, 0, MAX_LEVEL) },
        // выбранный цвет должен быть куплен
        body: body !== null && c.owned.body.includes(body) ? body : null,
        neon: neon !== null && c.owned.neon.includes(neon) ? neon : null,
        stripe: 0,
        number: null,
        numberOwned: cv.numberOwned === true,
      };
      // поля ливреи появились позже: у старых сохранений их нет — значения по умолчанию
      const st = int(cv.stripe, 0, STRIPE_COUNT);
      c.cars[id].stripe = st === 0 || c.owned.stripes.includes(st) ? st : 0;
      if (c.cars[id].numberOwned && typeof cv.number === 'number' && Number.isInteger(cv.number) && cv.number >= 0 && cv.number <= 99) c.cars[id].number = cv.number;
    }
  }
  return c;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadCareer(storage: StorageLike | null = defaultStorage()): Career {
  try {
    const raw = storage?.getItem(CAREER_KEY);
    return raw ? sanitizeCareer(JSON.parse(raw)) : emptyCareer();
  } catch {
    return emptyCareer();
  }
}

export function saveCareer(c: Career, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(CAREER_KEY, JSON.stringify(c));
  } catch {
    /* приватный режим — без сохранения */
  }
}

export function formatCredits(n: number): string {
  return `${Math.max(0, Math.floor(n)).toLocaleString('en-US').replace(/,/g, ' ')} NC`;
}
