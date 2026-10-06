/**
 * Призрак лучшего круга: запись позы машины игрока по ходу круга и
 * воспроизведение с интерполяцией. Чистая логика (без рендера и DOM).
 *
 * Кадр — 8 чисел: x, y, z, qx, qy, qz, qw, dist (метры от начала круга).
 */
import type { Quaternion, Vector3 } from 'three';

export const GHOST_VERSION = 1;
/** Шаг записи, с (20 Гц: плавно после интерполяции и компактно в localStorage) */
export const GHOST_DT = 0.05;
const STRIDE = 8;

export interface GhostData {
  v: number;
  lapTime: number;
  dt: number;
  frames: number[];
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r4 = (v: number): number => Math.round(v * 10000) / 10000;

export class GhostRecorder {
  private frames: number[] = [];
  private next = 0;
  private maxDist = -Infinity;

  begin(): void {
    this.frames = [];
    this.next = 0;
    this.maxDist = -Infinity;
  }

  /** t — время от начала круга, dist — пройденные метры круга */
  record(t: number, pos: Vector3, quat: Quaternion, dist: number): void {
    if (t + 1e-9 < this.next) return;
    this.next = (Math.floor(t / GHOST_DT + 1e-6) + 1) * GHOST_DT;
    // dist монотонен (откат назад — не прогресс): нужно для поиска по дистанции
    this.maxDist = Math.max(this.maxDist, dist);
    this.frames.push(r2(pos.x), r2(pos.y), r2(pos.z), r4(quat.x), r4(quat.y), r4(quat.z), r4(quat.w), r2(this.maxDist));
  }

  get frameCount(): number {
    return this.frames.length / STRIDE;
  }

  finish(lapTime: number): GhostData | null {
    if (this.frameCount < 2 || !Number.isFinite(lapTime) || lapTime <= 0) return null;
    return { v: GHOST_VERSION, lapTime, dt: GHOST_DT, frames: this.frames.slice() };
  }
}

export function isGhostData(d: unknown): d is GhostData {
  if (!d || typeof d !== 'object') return false;
  const g = d as Partial<GhostData>;
  return (
    g.v === GHOST_VERSION &&
    typeof g.lapTime === 'number' &&
    g.lapTime > 0 &&
    typeof g.dt === 'number' &&
    g.dt > 0 &&
    Array.isArray(g.frames) &&
    g.frames.length >= STRIDE * 2 &&
    g.frames.length % STRIDE === 0 &&
    g.frames.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

export class GhostPlayer {
  readonly count: number;
  constructor(readonly data: GhostData) {
    this.count = data.frames.length / STRIDE;
  }

  get lapTime(): number {
    return this.data.lapTime;
  }

  /** Поза призрака в момент t круга (с интерполяцией). false — круг призрака закончился. */
  sample(t: number, outPos: Vector3, outQuat: Quaternion): boolean {
    const f = this.data.frames;
    const x = Math.max(0, t / this.data.dt);
    let i = Math.floor(x);
    if (i >= this.count - 1) {
      i = this.count - 1;
      const o = i * STRIDE;
      outPos.set(f[o], f[o + 1], f[o + 2]);
      outQuat.set(f[o + 3], f[o + 4], f[o + 5], f[o + 6]).normalize();
      return t <= this.data.lapTime;
    }
    const a = x - i;
    const o = i * STRIDE;
    const p = o + STRIDE;
    outPos.set(f[o] + (f[p] - f[o]) * a, f[o + 1] + (f[p + 1] - f[o + 1]) * a, f[o + 2] + (f[p + 2] - f[o + 2]) * a);
    // nlerp по кратчайшему пути — достаточно для 50-мс шага
    const sgn = f[o + 3] * f[p + 3] + f[o + 4] * f[p + 4] + f[o + 5] * f[p + 5] + f[o + 6] * f[p + 6] < 0 ? -1 : 1;
    outQuat
      .set(
        f[o + 3] + (sgn * f[p + 3] - f[o + 3]) * a,
        f[o + 4] + (sgn * f[p + 4] - f[o + 4]) * a,
        f[o + 5] + (sgn * f[p + 5] - f[o + 5]) * a,
        f[o + 6] + (sgn * f[p + 6] - f[o + 6]) * a,
      )
      .normalize();
    return true;
  }

  /** Время призрака, когда он проехал `dist` метров круга; null — вне записи. */
  timeAtDistance(dist: number): number | null {
    const f = this.data.frames;
    const n = this.count;
    if (dist < f[7] || dist > f[(n - 1) * STRIDE + 7]) return null;
    // первый кадр с dist ≥ искомого
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (f[mid * STRIDE + 7] < dist) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return 0;
    const d0 = f[(lo - 1) * STRIDE + 7];
    const d1 = f[lo * STRIDE + 7];
    const a = d1 > d0 ? (dist - d0) / (d1 - d0) : 1;
    return (lo - 1 + a) * this.data.dt;
  }
}
