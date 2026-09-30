import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Track } from '../../src/world/track';
import { SUNSET_LOOP } from '../../src/world/trackData';

const track = new Track(SUNSET_LOOP);

describe('Track', () => {
  it('имеет разумную длину и чекпоинты', () => {
    expect(track.length).toBeGreaterThan(2000);
    expect(track.length).toBeLessThan(3200);
    expect(track.checkpoints.length).toBe(8);
    expect(track.checkpoints[0]).toBe(0);
  });

  it('wrapS и deltaS работают по кольцу', () => {
    const L = track.length;
    expect(track.wrapS(-1)).toBeCloseTo(L - 1, 5);
    expect(track.wrapS(L + 2)).toBeCloseTo(2, 5);
    expect(track.deltaS(L - 5, 5)).toBeCloseTo(10, 5);
    expect(track.deltaS(5, L - 5)).toBeCloseTo(-10, 5);
  });

  it('проекция точки на осевой возвращает её s и нулевое смещение', () => {
    for (const s of [0, 123, 777, 1500, track.length - 3]) {
      const smp = track.sampleAt(s);
      const pr = track.project(smp.position, s);
      expect(Math.abs(track.deltaS(pr.s, s))).toBeLessThan(0.5);
      expect(Math.abs(pr.lateral)).toBeLessThan(0.05);
      expect(pr.height).toBeCloseTo(smp.position.y, 2);
    }
  });

  it('смещение вправо даёт положительный lateral', () => {
    const smp = track.sampleAt(300);
    const p = smp.position.clone().addScaledVector(smp.right, 4);
    expect(track.project(p, 300).lateral).toBeCloseTo(4, 1);
  });

  it('подсказка s выбирает верхний или нижний уровень у эстакады', () => {
    // точка на стартовой прямой под эстакадой (x ≈ 0, z = 0, y = 0)
    const lower = track.project(new Vector3(0, 0.3, 0));
    expect(lower.height).toBeLessThan(1);
    const upper = track.project(new Vector3(0, 11.3, 0));
    expect(upper.height).toBeGreaterThan(9);
    // с подсказкой нижнего уровня проекция остаётся на нижнем
    const withHint = track.project(new Vector3(0, 11.3, 0), lower.s);
    expect(withHint.height).toBeLessThan(1);
  });

  it('трасса не пересекает сама себя в одном уровне', () => {
    const minSep = 2 * 12 + 6; // полосы + ограждения + зазор
    let violations = 0;
    const step = 4;
    for (let a = 0; a < track.length; a += step) {
      const pa = track.sampleAt(a).position.clone();
      for (let b = a + 90; b < track.length - 90 + a && b < track.length; b += step) {
        const pb = track.sampleAt(b).position;
        const dh = Math.hypot(pa.x - pb.x, pa.z - pb.z);
        if (dh < minSep && Math.abs(pa.y - pb.y) < 7) violations++;
      }
    }
    expect(violations).toBe(0);
  });

  it('кривизна: шпилька крутая, прямая — прямая', () => {
    let maxK = 0;
    for (let s = 0; s < track.length; s += 2) maxK = Math.max(maxK, Math.abs(track.curvatureAt(s)));
    expect(1 / maxK).toBeLessThan(60);
    expect(Math.abs(track.curvatureAt(400))).toBeLessThan(0.002);
  });

  it('стартовая решётка позади линии и внутри дороги', () => {
    for (let i = 0; i < 6; i++) {
      const pose = track.gridPose(i);
      expect(track.deltaS(0, pose.s)).toBeLessThan(0);
      const pr = track.project(pose.position, pose.s);
      expect(Math.abs(pr.lateral)).toBeLessThan(track.halfWidth - 2);
    }
  });
});
