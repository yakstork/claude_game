import { describe, expect, it } from 'vitest';
import { Track } from '../../src/world/track';
import { STORM_BOULEVARD, TRACKS } from '../../src/world/trackData';

describe('трасса Storm Boulevard', () => {
  const t = new Track(STORM_BOULEVARD);

  it('четвёртая в списке меню, id storm', () => {
    expect(TRACKS[3]).toBe(STORM_BOULEVARD);
    expect(STORM_BOULEVARD.id).toBe('storm');
    expect(new Set(TRACKS.map((d) => d.id)).size).toBe(TRACKS.length);
  });

  it('длина 2.0–2.6 км, кривизна не острее R≈18 м', () => {
    expect(t.length).toBeGreaterThan(2000);
    expect(t.length).toBeLessThan(2600);
    for (let s = 0; s < t.length; s += 2) expect(Math.abs(t.curvatureAt(s))).toBeLessThan(1 / 18);
  });

  it('эстакада над стартовой прямой: пересечение в плане с разницей высот > 8 м', () => {
    let found = false;
    for (let a = 0; a < t.length && !found; a += 3) {
      const pa = t.sampleAt(a).position;
      for (let b = a + 100; b < t.length - 100 && !found; b += 3) {
        const pb = t.sampleAt(b).position;
        if (Math.hypot(pa.x - pb.x, pa.z - pb.z) < 6 && Math.abs(pa.y - pb.y) > 8) found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('трамплин на старте и минимум 5 прямых углов', () => {
    let jump = 0;
    for (let s = 0; s < 300; s += 1) jump = Math.max(jump, t.sampleAt(s).position.y);
    expect(jump).toBeGreaterThan(2.5);
    let corners = 0;
    let inCorner = false;
    for (let s = 0; s < t.length; s += 2) {
      const hot = Math.abs(t.curvatureAt(s)) > 1 / 60;
      if (hot && !inCorner) corners++;
      inCorner = hot;
    }
    expect(corners).toBeGreaterThanOrEqual(5);
  });
});
