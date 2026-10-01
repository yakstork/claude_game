import { describe, expect, it } from 'vitest';
import {
  applyPointerKeys,
  effectiveTouchScale,
  emptyTouchState,
  hitTest,
  inRect,
  TOUCH_KEYS,
  TOUCH_LAYOUT,
  type RectLike,
  type TouchKey,
} from '../../src/ui/touchLogic';
import { fractionOf, stepRange, valueFromFraction } from '../../src/ui/format';

describe('effectiveTouchScale', () => {
  it('на обычных экранах масштаб = настройке (0.7..1.5)', () => {
    expect(effectiveTouchScale(1, 844, 390)).toBeCloseTo(1, 6);
    expect(effectiveTouchScale(1.5, 1024, 768)).toBeCloseTo(1.5, 6);
    expect(effectiveTouchScale(0.7, 844, 390)).toBeCloseTo(0.7, 6);
  });
  it('настройка вне диапазона зажимается', () => {
    expect(effectiveTouchScale(0.1, 1024, 768)).toBeCloseTo(0.7, 6);
    expect(effectiveTouchScale(9, 1024, 768)).toBeCloseTo(1.5, 6);
    expect(effectiveTouchScale(Number.NaN, 1024, 768)).toBeCloseTo(1, 6);
  });
  it('на узких/низких экранах ограничивается, но не меньше 0.7 (цель ≥ 44 px)', () => {
    const k = effectiveTouchScale(1.5, 568, 320);
    expect(k).toBeLessThan(1.5);
    expect(k).toBeGreaterThanOrEqual(0.7);
    // блоки не наезжают друг на друга и оставляют центр свободным
    const L = TOUCH_LAYOUT;
    expect(k * (L.leftW + L.rightW) + 2 * L.sidePad).toBeLessThanOrEqual(568 - L.minCenter + 1e-6);
    expect(k * L.blockH).toBeLessThanOrEqual(320 * L.maxHeightShare + 1e-6);
    expect(effectiveTouchScale(1.5, 320, 200)).toBeCloseTo(0.7, 6);
  });
  it('наименьшая видимая плашка кнопки (64 px) при size 0.7 не меньше 44 px', () => {
    expect(0.7 * 64).toBeGreaterThanOrEqual(44);
  });
});

describe('hitTest', () => {
  // две смежные кнопки 100×100 без зазора и одна отдельная
  const rects: RectLike[] = [
    { left: 0, top: 0, right: 100, bottom: 100 },
    { left: 100, top: 0, right: 200, bottom: 100 },
    { left: 300, top: 0, right: 400, bottom: 100 },
  ];
  it('попадание внутрь', () => {
    expect(hitTest(rects, 50, 50, 2)).toBe(0);
    expect(hitTest(rects, 150, 50, 2)).toBe(1);
    expect(hitTest(rects, 350, 99, 2)).toBe(2);
  });
  it('палец мимо — -1; допуск slop ловит край', () => {
    expect(hitTest(rects, 250, 50, 2)).toBe(-1);
    expect(hitTest(rects, 401.5, 50, 2)).toBe(2);
    expect(hitTest(rects, 403, 50, 2)).toBe(-1);
    expect(hitTest([], 1, 1, 2)).toBe(-1);
  });
  it('на границе смежных кнопок побеждает первая, сдвиг пальца на соседнюю переключает', () => {
    expect(hitTest(rects, 100, 50, 0)).toBe(0);
    expect(hitTest(rects, 100.5, 50, 0)).toBe(1);
  });
  it('inRect с допуском', () => {
    const r = rects[0];
    expect(inRect(r, 50, 50, 0)).toBe(true);
    expect(inRect(r, 104, 50, 0)).toBe(false);
    expect(inRect(r, 104, 50, 8)).toBe(true);
  });
});

describe('applyPointerKeys', () => {
  it('состояние = объединение кнопок под всеми пальцами', () => {
    const s = emptyTouchState();
    applyPointerKeys([{ key: 'throttle' }, { key: 'left' }, { key: 'nitro' }, { key: null }], s);
    expect(s).toEqual({ left: true, right: false, throttle: true, brake: false, drift: false, nitro: true });
  });
  it('два пальца на одной кнопке; нет пальцев — всё false (без «залипших»)', () => {
    const s = emptyTouchState();
    applyPointerKeys([{ key: 'drift' }, { key: 'drift' }], s);
    expect(s.drift).toBe(true);
    applyPointerKeys([], s);
    for (const k of TOUCH_KEYS as readonly TouchKey[]) expect(s[k]).toBe(false);
  });
});

describe('слайдеры настроек', () => {
  it('stepRange: шаг 0.1 в диапазоне 0.7..1.5 и 0.2..1 без накопления ошибок', () => {
    expect(stepRange(1, 1, 0.7, 1.5, 0.1)).toBe(1.1);
    expect(stepRange(0.7, -1, 0.7, 1.5, 0.1)).toBe(0.7);
    expect(stepRange(1.5, 1, 0.7, 1.5, 0.1)).toBe(1.5);
    expect(stepRange(0.2, -1, 0.2, 1, 0.1)).toBe(0.2);
    let v = 0.7;
    for (let i = 0; i < 8; i++) v = stepRange(v, 1, 0.7, 1.5, 0.1);
    expect(v).toBe(1.5);
  });
  it('valueFromFraction: привязка к шагу и зажим', () => {
    expect(valueFromFraction(0, 0.7, 1.5, 0.05)).toBe(0.7);
    expect(valueFromFraction(1, 0.7, 1.5, 0.05)).toBe(1.5);
    expect(valueFromFraction(0.5, 0.7, 1.5, 0.05)).toBe(1.1);
    expect(valueFromFraction(-3, 0.2, 1, 0.05)).toBe(0.2);
    expect(valueFromFraction(7, 0.2, 1, 0.05)).toBe(1);
    expect(valueFromFraction(Number.NaN, 0.2, 1, 0.05)).toBe(0.2);
    expect(valueFromFraction(0.334, 0, 1, 0.01)).toBe(0.33);
  });
  it('fractionOf: положение заливки', () => {
    expect(fractionOf(1.1, 0.7, 1.5)).toBeCloseTo(0.5, 6);
    expect(fractionOf(0.2, 0.2, 1)).toBe(0);
    expect(fractionOf(2, 0.2, 1)).toBe(1);
    expect(fractionOf(0.5, 1, 1)).toBe(0);
  });
});
