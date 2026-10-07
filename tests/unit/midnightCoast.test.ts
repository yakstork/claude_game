import { describe, expect, it } from 'vitest';
import { Track } from '../../src/world/track';
import { MIDNIGHT_COAST, TRACKS } from '../../src/world/trackData';
import { trackKnowledge } from '../../src/ai/knowledge';

describe('трасса Midnight Coast', () => {
  const t = new Track(MIDNIGHT_COAST);

  it('третья в списке меню', () => {
    expect(TRACKS.length).toBeGreaterThanOrEqual(3);
    expect(TRACKS[2]).toBe(MIDNIGHT_COAST);
    expect(new Set(TRACKS.map((d) => d.id)).size).toBe(TRACKS.length);
  });

  it('длина 1.9–2.4 км, без эстакад (нет пересечений даже на разных уровнях)', () => {
    expect(t.length).toBeGreaterThan(1900);
    expect(t.length).toBeLessThan(2400);
    for (let a = 0; a < t.length; a += 4) {
      const pa = t.sampleAt(a).position.clone();
      for (let b = a + 90; b < t.length && b < a + t.length - 90; b += 4) {
        const pb = t.sampleAt(b).position;
        expect(Math.hypot(pa.x - pb.x, pa.z - pb.z), `s=${a}/${b}`).toBeGreaterThan(34);
      }
    }
  });

  it('нет резких изломов: курс меняется плавно, кривизна не меньше R≈20 м', () => {
    let prev = t.sampleAt(0).tangent.clone();
    let maxStep = 0;
    for (let s = 1; s < t.length + 1; s += 1) {
      const cur = t.sampleAt(s).tangent;
      maxStep = Math.max(maxStep, prev.angleTo(cur));
      prev = cur.clone();
    }
    expect(maxStep).toBeLessThan(0.07); // < 4° на метр ≈ R 14 м
    for (let s = 0; s < t.length; s += 2) expect(Math.abs(t.curvatureAt(s))).toBeLessThan(1 / 18);
  });

  it('характер: длинная скоростная дуга, шпилька и пара драйфтовых поворотов', () => {
    const k = trackKnowledge(t);
    const drift = k.corners.filter((c) => c.driftable);
    expect(drift.length).toBeGreaterThanOrEqual(5);
    expect(drift.some((c) => c.s1 - c.s0 > 100 && 1 / c.peak > 60)).toBe(true); // длинная дуга
    expect(drift.some((c) => c.s1 - c.s0 > 90 && 1 / c.peak < 30)).toBe(true); // шпилька
  });

  it('трамплин: гребень выше дороги вокруг, тоннель на прямой', () => {
    let maxY = 0;
    for (let s = 0; s < t.length; s += 1) maxY = Math.max(maxY, t.sampleAt(s).position.y);
    expect(maxY).toBeGreaterThan(2.5);
    expect(maxY).toBeLessThan(5);
    expect(MIDNIGHT_COAST.tunnels?.length).toBe(1);
  });
});
