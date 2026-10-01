/** Чистая логика экрана «Своя сборка»: бюджет очков, шаги слайдеров, палитра. Без DOM — тестируется в Node. */
import type { CustomBuild } from '../core/types';
import { PALETTE } from '../world/palette';

export const SLIDER_KEYS = ['speed', 'handling', 'drift'] as const;
export type SliderKey = (typeof SLIDER_KEYS)[number];

/** Шаг клавиатуры/геймпада */
export const BUILD_STEP = 0.05;
/** Шаг привязки при перетаскивании мышью/пальцем */
export const BUILD_SNAP = 0.01;
/** Бюджет по умолчанию, если игра не передала свой */
export const DEFAULT_BUDGET = 2;

/** Разрешённые цвета по умолчанию (только из палитры игры, GAME_DESIGN.md §4.1) */
export interface CustomPalette {
  body: number[];
  neon: number[];
}

export const DEFAULT_PALETTE: CustomPalette = {
  body: [
    PALETTE.cyan,
    PALETTE.magenta,
    PALETTE.pink,
    PALETTE.orange,
    PALETTE.yellow,
    PALETTE.lilac,
    PALETTE.violet,
    PALETTE.white,
  ],
  neon: [PALETTE.magenta, PALETTE.cyan, PALETTE.pink, PALETTE.orange, PALETTE.yellow, PALETTE.lilac, PALETTE.white],
};

const COLOR_NAMES: [number, string][] = [
  [PALETTE.cyan, 'ЦИАН'],
  [PALETTE.magenta, 'МАДЖЕНТА'],
  [PALETTE.pink, 'РОЗОВЫЙ'],
  [PALETTE.orange, 'ОРАНЖЕВЫЙ'],
  [PALETTE.yellow, 'ЖЁЛТЫЙ'],
  [PALETTE.lilac, 'СИРЕНЕВЫЙ'],
  [PALETTE.violet, 'ФИОЛЕТОВЫЙ'],
  [PALETTE.white, 'БЕЛЫЙ'],
  [PALETTE.purple, 'ПУРПУРНЫЙ'],
  [PALETTE.deepViolet, 'ТЁМНЫЙ'],
  [PALETTE.void, 'НОЧЬ'],
];

/** Подпись цвета для экрана (название токена палитры или #hex) */
export function colorName(hex: number): string {
  for (const [c, n] of COLOR_NAMES) if (c === hex) return n;
  return `#${hex.toString(16).padStart(6, '0').toUpperCase()}`;
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const floor3 = (v: number): number => Math.floor(v * 1000 + 1e-6) / 1000;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const finite = (v: number, d: number): number => (Number.isFinite(v) ? v : d);

/** Сумма трёх слайдеров */
export function buildSum(b: CustomBuild): number {
  return b.speed + b.handling + b.drift;
}

/** Сколько очков осталось (не меньше 0) */
export function pointsLeft(b: CustomBuild, budget: number): number {
  return Math.max(0, r3(budget - buildSum(b)));
}

/** Максимум слайдера key: бюджет минус сумма двух остальных, в [0, 1] */
export function sliderCap(b: CustomBuild, key: SliderKey, budget: number): number {
  const others = buildSum(b) - b[key];
  return clamp(r3(budget - others), 0, 1);
}

/** Слайдеры в [0,1], сумма ≤ бюджета (пропорциональное сжатие вниз); цвета не трогает. */
export function fitToBudget(b: CustomBuild, budget: number): CustomBuild {
  let speed = clamp(finite(b.speed, 0.5), 0, 1);
  let handling = clamp(finite(b.handling, 0.5), 0, 1);
  let drift = clamp(finite(b.drift, 0.5), 0, 1);
  const sum = speed + handling + drift;
  if (sum > budget + 1e-9) {
    const k = Math.max(0, budget) / sum;
    speed = floor3(speed * k);
    handling = floor3(handling * k);
    drift = floor3(drift * k);
  } else {
    speed = r3(speed);
    handling = r3(handling);
    drift = r3(drift);
  }
  return { speed, handling, drift, bodyColor: b.bodyColor, neonColor: b.neonColor };
}

export interface SliderResult {
  build: CustomBuild;
  /** Запрошено больше доступного — значение упёрлось в бюджет (или в 1) */
  blocked: boolean;
}

/** Установить слайдер: значение зажимается в [0, cap]. Без изменений возвращает тот же объект. */
export function applySlider(b: CustomBuild, key: SliderKey, value: number, budget: number): SliderResult {
  const cap = sliderCap(b, key, budget);
  const want = r3(clamp(finite(value, b[key]), 0, 1));
  const v = Math.min(want, cap);
  const blocked = want > cap + 1e-6;
  if (v === b[key]) return { build: b, blocked };
  return { build: { ...b, [key]: v }, blocked };
}

/** Шаг слайдера клавишей: ±BUILD_STEP без привязки к сетке (0.66 → 0.71), упор в [0, cap]. */
export function stepBuildSlider(b: CustomBuild, key: SliderKey, dir: -1 | 1, budget: number): SliderResult {
  return applySlider(b, key, b[key] + dir * BUILD_STEP, budget);
}

/** Циклический индекс (выбор образца цвета) */
export function cycleIndex(i: number, dir: -1 | 1, n: number): number {
  if (n <= 0) return -1;
  if (i < 0) return dir > 0 ? 0 : n - 1;
  return (i + dir + n) % n;
}

/** «1.8», «1.98», «2.0»: без лишних нулей, но минимум один знак */
export function formatPoints(v: number): string {
  const x = Math.round(finite(v, 0) * 100) / 100;
  const s = x.toFixed(2);
  return s.endsWith('0') ? x.toFixed(1) : s;
}

/** Значение слайдера: всегда два знака («0.60») — ширина не прыгает */
export function formatSliderValue(v: number): string {
  return finite(v, 0).toFixed(2);
}

/** Сборка по умолчанию для «СБРОС»: слайдеры ≈ бюджет/3 с округлением вниз до шага клавиатуры (0.65 при бюджете 2.0), циан + маджента, если они разрешены. */
export function defaultCustomBuild(budget: number, palette: CustomPalette): CustomBuild {
  const v = clamp(r3(Math.floor((Math.max(0, budget) / 3 / BUILD_STEP) + 1e-6) * BUILD_STEP), 0, 1);
  const pick = (list: number[], want: number): number => (list.includes(want) ? want : (list[0] ?? want));
  return {
    speed: v,
    handling: v,
    drift: v,
    bodyColor: pick(palette.body, PALETTE.cyan),
    neonColor: pick(palette.neon, PALETTE.magenta),
  };
}
