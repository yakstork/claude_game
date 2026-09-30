/** Чистые функции форматирования для UI (без DOM — тестируются в Node). */

/** Плейсхолдер времени, когда значения ещё нет. */
export const NO_TIME = '—:——.———';

/** Верхняя граница шкалы спидометра, км/ч. */
export const SPEEDO_MAX_KMH = 320;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Время в секундах → «m:ss.mmm»; null/NaN → «—:——.———». */
export function formatTime(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return NO_TIME;
  const ms = Math.round(Math.max(0, sec) * 1000);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${m}:${s < 10 ? '0' : ''}${s}.${r < 100 ? (r < 10 ? '00' : '0') : ''}${r}`;
}

/** Очки: округление и группировка тысяч неразрывным пробелом («1 250»). */
export function formatScore(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0);
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** «3-Е МЕСТО». */
export function formatPlace(position: number): string {
  return `${position}-Е МЕСТО`;
}

/** Заголовок экрана результатов: победа — «1-Е МЕСТО», иначе «ФИНИШ: 3-Е МЕСТО». */
export function resultTitle(position: number): string {
  return position === 1 ? formatPlace(1) : `ФИНИШ: ${formatPlace(position)}`;
}

/** Доля дуги спидометра 0..1 для скорости в км/ч. */
export function speedFraction(kmh: number, max: number = SPEEDO_MAX_KMH): number {
  if (!Number.isFinite(kmh) || kmh <= 0) return 0;
  return clamp(kmh / max, 0, 1);
}

/** Масштаб надписи комбо: слегка растёт с множителем (1 → 1.0, 10 → 1.36). */
export function comboScale(multiplier: number): number {
  return 1 + clamp(multiplier - 1, 0, 9) * 0.04;
}

/** Шаг слайдера 0.1 с округлением и зажимом в 0..1. */
export function stepSlider(value: number, dir: -1 | 1): number {
  return clamp(Math.round((value + dir * 0.1) * 10) / 10, 0, 1);
}

/** 0..1 → «70%». */
export function formatPercent(v: number): string {
  return `${Math.round(clamp(v, 0, 1) * 100)}%`;
}

/** Целые км/ч для цифр спидометра. */
export function formatSpeed(kmh: number): string {
  return String(Math.max(0, Math.round(Number.isFinite(kmh) ? kmh : 0)));
}

/** Шаг слайдера произвольного диапазона: value ± step, зажим в [min, max], без накопления ошибок float. */
export function stepRange(value: number, dir: -1 | 1, min: number, max: number, step: number): number {
  const v = clamp(Math.round(((value + dir * step) / step)) * step, min, max);
  return Math.round(v * 1000) / 1000;
}

/** Положение пальца (доля 0..1 по ширине дорожки) → значение в [min, max], привязанное к шагу. */
export function valueFromFraction(frac: number, min: number, max: number, step: number): number {
  const f = clamp(Number.isFinite(frac) ? frac : 0, 0, 1);
  const v = clamp(Math.round((min + f * (max - min)) / step) * step, min, max);
  return Math.round(v * 1000) / 1000;
}

/** Значение в [min, max] → доля 0..1 для заливки слайдера. */
export function fractionOf(value: number, min: number, max: number): number {
  return max > min ? clamp((value - min) / (max - min), 0, 1) : 0;
}
