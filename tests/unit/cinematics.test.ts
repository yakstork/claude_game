import { describe, expect, it } from 'vitest';
import { FINISH_ORBIT_DURATION, createPose, finishPose, introPose } from '../../src/core/cinematics';

describe('cinematics', () => {
  it('облёт заканчивается в позиции обычной дальней chase-камеры', () => {
    const p = createPose();
    const h = 0.7;
    introPose(1, 10, 0.5, -20, h, 100, 0, 100, p);
    expect(p.px).toBeCloseTo(10 - Math.sin(h) * 7.6, 3);
    expect(p.pz).toBeCloseTo(-20 - Math.cos(h) * 7.6, 3);
    expect(p.py).toBeCloseTo(0.5 + 2.9, 3);
    expect(p.fov).toBeCloseTo(62, 3);
  });
  it('облёт начинается высоко и далеко, значения конечны', () => {
    const p = createPose();
    introPose(0, 0, 0, 0, 0, 0, 0, 170, p);
    expect(p.py).toBeGreaterThan(15);
    for (let u = 0; u <= 1; u += 0.05) {
      introPose(u, 1, 0, 2, 1, 5, 0, 90, p);
      expect(Object.values(p).every(Number.isFinite)).toBe(true);
    }
  });
  it('орбита финиша держит расстояние и смотрит на машину', () => {
    const p = createPose();
    finishPose(FINISH_ORBIT_DURATION / 2, 5, 0, 5, 0, 5, 14, 5, p);
    const d = Math.hypot(p.px - 5, p.pz - 5);
    expect(d).toBeGreaterThan(7);
    expect(d).toBeLessThan(14);
    expect(p.ly).toBeGreaterThan(0.9);
    expect(p.lx).toBeCloseTo(5);
  });
});
