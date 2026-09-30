import { describe, expect, it } from 'vitest';
import type { CustomBuild } from '../../src/core/types';
import { PALETTE } from '../../src/world/palette';
import {
  applySlider,
  buildSum,
  colorName,
  cycleIndex,
  DEFAULT_PALETTE,
  defaultCustomBuild,
  fitToBudget,
  formatPoints,
  formatSliderValue,
  pointsLeft,
  sliderCap,
  stepBuildSlider,
} from '../../src/ui/customLogic';

const B = 2;
const mk = (speed: number, handling: number, drift: number): CustomBuild => ({
  speed,
  handling,
  drift,
  bodyColor: PALETTE.cyan,
  neonColor: PALETTE.magenta,
});

describe('sliderCap / applySlider: бюджет очков', () => {
  it('max = бюджет − сумма остальных, не больше 1', () => {
    expect(sliderCap(mk(0.6, 0.6, 0.6), 'speed', B)).toBe(0.8);
    expect(sliderCap(mk(0.2, 0.3, 0.1), 'drift', B)).toBe(1);
    expect(sliderCap(mk(0.2, 1, 1), 'speed', B)).toBe(0);
  });

  it('значение упирается в cap и сообщает blocked', () => {
    const r = applySlider(mk(0.6, 0.6, 0.6), 'speed', 1, B);
    expect(r.build.speed).toBe(0.8);
    expect(r.blocked).toBe(true);
    expect(buildSum(r.build)).toBeCloseTo(B, 9);
  });

  it('в пределах cap — без упора; то же значение → тот же объект', () => {
    const b = mk(0.6, 0.6, 0.6);
    const r = applySlider(b, 'speed', 0.7, B);
    expect(r.blocked).toBe(false);
    expect(r.build.speed).toBe(0.7);
    const same = applySlider(b, 'speed', 0.6, B);
    expect(same.build).toBe(b);
    expect(same.blocked).toBe(false);
  });

  it('у упора повторный подъём — blocked, значение не меняется', () => {
    const b = mk(0.8, 0.6, 0.6);
    const r = stepBuildSlider(b, 'speed', 1, B);
    expect(r.build).toBe(b);
    expect(r.blocked).toBe(true);
  });

  it('уменьшение всегда разрешено и не блокируется; ниже 0 не уходит', () => {
    const r = stepBuildSlider(mk(0.02, 0.6, 0.6), 'speed', -1, B);
    expect(r.build.speed).toBe(0);
    expect(r.blocked).toBe(false);
  });

  it('шаг 0.05 без накопления погрешности', () => {
    let b = mk(0.65, 0.65, 0.65);
    b = stepBuildSlider(b, 'speed', 1, B).build;
    expect(b.speed).toBe(0.7);
    expect(stepBuildSlider(b, 'speed', 1, B).blocked).toBe(true);
    b = stepBuildSlider(b, 'speed', -1, B).build;
    expect(b.speed).toBe(0.65);
  });

  it('сумма никогда не превышает бюджет при любой последовательности шагов', () => {
    let b = mk(0.65, 0.65, 0.65);
    const keys = ['speed', 'handling', 'drift'] as const;
    for (let i = 0; i < 300; i++) {
      b = stepBuildSlider(b, keys[i % 3], i % 7 === 0 ? -1 : 1, B).build;
      expect(buildSum(b)).toBeLessThanOrEqual(B + 1e-9);
    }
  });

  it('NaN не ломает сборку', () => {
    const b = mk(0.5, 0.5, 0.5);
    expect(applySlider(b, 'speed', Number.NaN, B).build.speed).toBe(0.5);
  });
});

describe('fitToBudget', () => {
  it('зажимает в [0,1] и сводит сумму к бюджету', () => {
    const r = fitToBudget(mk(1, 1, 1), B);
    expect(buildSum(r)).toBeLessThanOrEqual(B);
    expect(buildSum(r)).toBeGreaterThan(B - 0.01);
    const n = fitToBudget(mk(-1, 2, Number.NaN), B);
    expect(n.speed).toBe(0);
    expect(n.handling).toBe(1);
    expect(n.drift).toBe(0.5);
  });

  it('допустимая сборка не меняется; цвета сохраняются', () => {
    const b = mk(0.6, 0.6, 0.6);
    expect(fitToBudget(b, B)).toEqual(b);
  });
});

describe('pointsLeft / форматирование', () => {
  it('pointsLeft не отрицателен', () => {
    expect(pointsLeft(mk(0.6, 0.6, 0.6), B)).toBe(0.2);
    expect(pointsLeft(mk(1, 1, 1), B)).toBe(0);
  });
  it('formatPoints: 1.8 / 2.0 / 1.98', () => {
    expect(formatPoints(1.8)).toBe('1.8');
    expect(formatPoints(2)).toBe('2.0');
    expect(formatPoints(1.98)).toBe('1.98');
    expect(formatPoints(Number.NaN)).toBe('0.0');
  });
  it('formatSliderValue: два знака', () => {
    expect(formatSliderValue(0.6)).toBe('0.60');
    expect(formatSliderValue(1)).toBe('1.00');
  });
});

describe('цвета и значения по умолчанию', () => {
  it('cycleIndex: обход по кругу, -1 → первый/последний', () => {
    expect(cycleIndex(0, -1, 4)).toBe(3);
    expect(cycleIndex(3, 1, 4)).toBe(0);
    expect(cycleIndex(-1, 1, 4)).toBe(0);
    expect(cycleIndex(-1, -1, 4)).toBe(3);
    expect(cycleIndex(0, 1, 0)).toBe(-1);
  });
  it('colorName: токен палитры или hex', () => {
    expect(colorName(PALETTE.cyan)).toBe('ЦИАН');
    expect(colorName(0x123456)).toBe('#123456');
  });
  it('defaultCustomBuild: ≈ бюджет/3 (0.65), cyan/magenta, сумма в бюджете', () => {
    const d = defaultCustomBuild(B, DEFAULT_PALETTE);
    expect(d.speed).toBe(0.65);
    expect(buildSum(d)).toBeLessThanOrEqual(B);
    expect(d.bodyColor).toBe(PALETTE.cyan);
    expect(d.neonColor).toBe(PALETTE.magenta);
  });
  it('defaultCustomBuild: если cyan/magenta не разрешены — первый из палитры', () => {
    const d = defaultCustomBuild(1.5, { body: [PALETTE.orange], neon: [PALETTE.yellow, PALETTE.pink] });
    expect(d.speed).toBe(0.5);
    expect(d.bodyColor).toBe(PALETTE.orange);
    expect(d.neonColor).toBe(PALETTE.yellow);
  });
  it('палитра по умолчанию — только цвета из PALETTE', () => {
    const all = new Set<number>(Object.values(PALETTE));
    for (const c of [...DEFAULT_PALETTE.body, ...DEFAULT_PALETTE.neon]) expect(all.has(c)).toBe(true);
  });
});
