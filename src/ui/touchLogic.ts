/**
 * Чистая логика сенсорных кнопок (без DOM — тестируется в Node):
 * попадание пальца в кнопку, итоговое состояние из набора пальцев, масштаб раскладки.
 */
import type { TouchState } from '../core/types';

export type TouchKey = keyof TouchState;

/** Порядок важен: совпадает с порядком прямоугольников в TouchControls. */
export const TOUCH_KEYS: readonly TouchKey[] = ['left', 'right', 'throttle', 'brake', 'drift', 'nitro'];

export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Габариты раскладки при масштабе 1, CSS px (вместе с зонами нажатия). */
export const TOUCH_LAYOUT = {
  /** Ширина левого блока (две кнопки руля) */
  leftW: 192,
  /** Ширина правого блока (тормоз + газ) */
  rightW: 192,
  /** Высота правого блока (ряд дрифт/нитро + ряд тормоз/газ) */
  blockH: 180,
  /** Отступ блоков от края экрана */
  sidePad: 10,
  /** Минимальная свободная ширина между блоками */
  minCenter: 100,
  /** Какую долю высоты экрана блок может занимать */
  maxHeightShare: 0.7,
} as const;

export const TOUCH_SIZE_MIN = 0.7;
export const TOUCH_SIZE_MAX = 1.5;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Реальный масштаб кнопок: желаемый (Settings.touchSize) ограничивается шириной и
 * высотой экрана, чтобы блоки не наезжали друг на друга и не занимали пол-кадра;
 * но не меньше 0.7 (цель нажатия ≥ 44 px) и не больше 1.5.
 */
export function effectiveTouchScale(size: number, viewW: number, viewH: number): number {
  const want = clamp(Number.isFinite(size) ? size : 1, TOUCH_SIZE_MIN, TOUCH_SIZE_MAX);
  const L = TOUCH_LAYOUT;
  const byW = (viewW - 2 * L.sidePad - L.minCenter) / (L.leftW + L.rightW);
  const byH = (viewH * L.maxHeightShare) / L.blockH;
  const cap = Math.min(byW, byH);
  return Math.max(TOUCH_SIZE_MIN, Math.min(want, Number.isFinite(cap) ? cap : want));
}

/**
 * Кнопка под точкой. Прямоугольники смежные (зоны нажатия без зазоров), slop — небольшой допуск.
 * Побеждает прямоугольник, содержащий точку; иначе ближайший в пределах slop; иначе null.
 */
export function hitTest(rects: readonly RectLike[], x: number, y: number, slop: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    const d = Math.hypot(dx, dy);
    if (d <= slop && d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function inRect(r: RectLike, x: number, y: number, slop: number): boolean {
  return x >= r.left - slop && x <= r.right + slop && y >= r.top - slop && y <= r.bottom + slop;
}

/** Состояние кнопок из набора пальцев: кнопка нажата, пока на ней есть хотя бы один палец. */
export function applyPointerKeys(pointers: Iterable<{ key: TouchKey | null }>, out: TouchState): void {
  out.left = out.right = out.throttle = out.brake = out.drift = out.nitro = false;
  for (const p of pointers) if (p.key !== null) out[p.key] = true;
}

export function emptyTouchState(): TouchState {
  return { left: false, right: false, throttle: false, brake: false, drift: false, nitro: false };
}
