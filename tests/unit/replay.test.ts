import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { FLAG_DRIFT, FLAG_NITRO, REPLAY_DT, ReplayRecorder, type PoseSource } from '../../src/race/replay';

function car(x: number, nitro = false, drifting = false): PoseSource {
  return { position: new Vector3(x, 0, 0), quaternion: new Quaternion(), nitroActive: nitro, drifting, onGround: true };
}

describe('replay', () => {
  it('пишет кадры на отметках 20 Гц и интерполирует по времени', () => {
    const rec = new ReplayRecorder();
    rec.begin(2);
    const a = car(0);
    const b = car(100);
    for (let t = 0; t <= 1.0001; t += 1 / 60) {
      a.position.x = t * 10;
      b.position.x = 100 + t * 20;
      rec.record(t, [a, b]);
    }
    expect(rec.frameCount).toBeGreaterThanOrEqual(20);
    const p = rec.finish()!;
    const out = new Vector3();
    const q = new Quaternion();
    p.sample(0.5, 0, out, q);
    expect(out.x).toBeCloseTo(5, 1);
    p.sample(0.525, 1, out, q);
    expect(out.x).toBeCloseTo(110.5, 1);
    p.velocity(0.5, 1, out);
    expect(out.x).toBeCloseTo(20, 0);
    // вне диапазона — зажимается
    p.sample(99, 0, out, q);
    expect(out.x).toBeGreaterThan(9);
    p.sample(-5, 0, out, q);
    expect(out.x).toBeCloseTo(0, 5);
  });

  it('флаги нитро и дрифта; буфер растёт сверх запаса', () => {
    const rec = new ReplayRecorder();
    rec.begin(1);
    const c = car(0);
    const total = 12000 + 50;
    for (let i = 0; i < total; i++) {
      c.nitroActive = i === 10;
      c.drifting = i === 20;
      rec.record(i * REPLAY_DT, [c]);
    }
    expect(rec.frameCount).toBe(total);
    const p = rec.finish()!;
    expect(p.flags(10 * REPLAY_DT, 0) & FLAG_NITRO).toBeTruthy();
    expect(p.flags(20 * REPLAY_DT, 0) & FLAG_DRIFT).toBeTruthy();
    expect(p.flags(30 * REPLAY_DT, 0)).toBe(0);
  });

  it('слишком короткая запись — null; кватернионы нормализуются', () => {
    const rec = new ReplayRecorder();
    rec.begin(1);
    rec.record(0, [car(0)]);
    expect(rec.finish()).toBeNull();
    rec.record(REPLAY_DT, [car(1)]);
    const p = rec.finish()!;
    const q = new Quaternion();
    p.sample(0.02, 0, new Vector3(), q);
    expect(q.length()).toBeCloseTo(1, 5);
  });
});
