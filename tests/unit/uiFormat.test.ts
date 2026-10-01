import { describe, expect, it } from 'vitest';
import {
  comboScale,
  formatPercent,
  formatPercentRaw,
  formatPlace,
  formatScore,
  formatSpeed,
  formatTime,
  NO_TIME,
  resultTitle,
  speedFraction,
  stepSlider,
} from '../../src/ui/format';

describe('formatTime', () => {
  it('форматирует m:ss.mmm', () => {
    expect(formatTime(0)).toBe('0:00.000');
    expect(formatTime(62.345)).toBe('1:02.345');
    expect(formatTime(5.007)).toBe('0:05.007');
    expect(formatTime(599.9996)).toBe('10:00.000');
    expect(formatTime(131.25)).toBe('2:11.250');
  });
  it('плейсхолдер для null/NaN, отрицательные — в ноль', () => {
    expect(formatTime(null)).toBe(NO_TIME);
    expect(formatTime(undefined)).toBe(NO_TIME);
    expect(formatTime(Number.NaN)).toBe(NO_TIME);
    expect(formatTime(-3)).toBe('0:00.000');
  });
});

describe('formatScore', () => {
  it('группирует тысячи неразрывным пробелом', () => {
    expect(formatScore(0)).toBe('0');
    expect(formatScore(999)).toBe('999');
    expect(formatScore(1250)).toBe('1 250');
    expect(formatScore(1234567.6)).toBe('1 234 568');
  });
});

describe('места и заголовки', () => {
  it('formatPlace / resultTitle', () => {
    expect(formatPlace(3)).toBe('3-Е МЕСТО');
    expect(resultTitle(1)).toBe('1-Е МЕСТО');
    expect(resultTitle(3)).toBe('ФИНИШ: 3-Е МЕСТО');
  });
});

describe('спидометр и комбо', () => {
  it('speedFraction зажимается в 0..1 по шкале 320', () => {
    expect(speedFraction(-10)).toBe(0);
    expect(speedFraction(160)).toBeCloseTo(0.5);
    expect(speedFraction(400)).toBe(1);
  });
  it('formatSpeed округляет', () => {
    expect(formatSpeed(187.4)).toBe('187');
    expect(formatSpeed(-2)).toBe('0');
  });
  it('comboScale растёт с множителем и ограничен', () => {
    expect(comboScale(1)).toBe(1);
    expect(comboScale(3)).toBeCloseTo(1.08);
    expect(comboScale(100)).toBeCloseTo(1.36);
  });
});

describe('слайдер', () => {
  it('stepSlider шагает по 0.1 без накопления ошибки и зажимает', () => {
    expect(stepSlider(0.7, 1)).toBe(0.8);
    expect(stepSlider(0.3, -1)).toBe(0.2);
    expect(stepSlider(1, 1)).toBe(1);
    expect(stepSlider(0, -1)).toBe(0);
    let v = 0;
    for (let i = 0; i < 10; i++) v = stepSlider(v, 1);
    expect(v).toBe(1);
  });
  it('formatPercent', () => {
    expect(formatPercent(0.7)).toBe('70%');
    expect(formatPercent(1.4)).toBe('100%');
    expect(formatPercentRaw(1.4)).toBe('140%');
    expect(formatPercentRaw(0.7)).toBe('70%');
    expect(formatPercentRaw(1.5)).toBe('150%');
  });
});
