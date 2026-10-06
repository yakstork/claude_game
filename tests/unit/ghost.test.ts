import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { GHOST_DT, GhostPlayer, GhostRecorder, isGhostData } from '../../src/race/ghost';

/** Прямолинейный круг: 20 м/с вдоль +Z, 10 с */
function recordStraight(): GhostRecorder {
  const rec = new GhostRecorder();
  rec.begin();
  const p = new Vector3();
  const q = new Quaternion();
  for (let t = 0; t <= 10 + 1e-9; t += 1 / 120) {
    p.set(0, 0.5, t * 20);
    rec.record(t, p, q, t * 20);
  }
  return rec;
}

describe('ghost', () => {
  it('пишет кадры с шагом GHOST_DT', () => {
    const rec = recordStraight();
    expect(rec.frameCount).toBeGreaterThanOrEqual(Math.floor(10 / GHOST_DT));
    expect(rec.frameCount).toBeLessThanOrEqual(Math.floor(10 / GHOST_DT) + 2);
  });

  it('воспроизводит позу с интерполяцией', () => {
    const data = recordStraight().finish(10)!;
    expect(isGhostData(data)).toBe(true);
    const g = new GhostPlayer(data);
    const p = new Vector3();
    const q = new Quaternion();
    expect(g.sample(3.333, p, q)).toBe(true);
    expect(p.z).toBeCloseTo(66.66, 0);
    expect(q.w).toBeCloseTo(1, 5);
    expect(g.sample(12, p, q)).toBe(false);
  });

  it('время по дистанции даёт дельту к лучшему кругу', () => {
    const g = new GhostPlayer(recordStraight().finish(10)!);
    expect(g.timeAtDistance(100)).toBeCloseTo(5, 1);
    expect(g.timeAtDistance(0)).toBe(0);
    expect(g.timeAtDistance(-5)).toBeNull();
    expect(g.timeAtDistance(500)).toBeNull();
  });

  it('дистанция монотонна при откате назад', () => {
    const rec = new GhostRecorder();
    rec.begin();
    const p = new Vector3();
    const q = new Quaternion();
    rec.record(0, p, q, 0);
    rec.record(0.05, p, q, 10);
    rec.record(0.1, p, q, 5);
    rec.record(0.15, p, q, 20);
    const g = new GhostPlayer(rec.finish(0.15)!);
    expect(g.timeAtDistance(10)).toBeCloseTo(0.05, 5);
  });

  it('отбрасывает битые данные', () => {
    expect(isGhostData(null)).toBe(false);
    expect(isGhostData({ v: 1, lapTime: 5, dt: 0.05, frames: [1, 2, 3] })).toBe(false);
    expect(isGhostData({ v: 1, lapTime: 5, dt: 0.05, frames: new Array(16).fill(NaN) })).toBe(false);
    expect(new GhostRecorder().finish(5)).toBeNull();
  });
});
