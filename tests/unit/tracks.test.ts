import { describe, expect, it } from 'vitest';
import { Track } from '../../src/world/track';
import { TRACKS } from '../../src/world/trackData';
import { BARRIER_OFFSET, GROUND_Y, ROAD_CLEARANCE } from '../../src/world/constants';

for (const def of TRACKS) {
  describe(`трасса ${def.name}`, () => {
    const t = new Track(def);

    it('длина, id и чекпоинты', () => {
      expect(t.length).toBeGreaterThan(1800);
      expect(t.length).toBeLessThan(3200);
      expect(t.id.length).toBeGreaterThan(0);
      expect(t.checkpoints.length).toBe(def.checkpointCount);
    });

    it('нет самопересечений в одном уровне; на пересечениях — зазор под эстакадой', () => {
      let sameLevel = 0;
      let minClearance = Infinity;
      for (let a = 0; a < t.length; a += 3) {
        const pa = t.sampleAt(a).position.clone();
        for (let b = a + 90; b < t.length && b < a + t.length - 90; b += 3) {
          const pb = t.sampleAt(b).position;
          const dh = Math.hypot(pa.x - pb.x, pa.z - pb.z);
          if (dh < 2 * 12 + 6) {
            const dy = Math.abs(pa.y - pb.y);
            if (dy < 7) sameLevel++;
            else minClearance = Math.min(minClearance, dy);
          }
        }
      }
      expect(sameLevel).toBe(0);
      if (Number.isFinite(minClearance)) expect(minClearance).toBeGreaterThan(8);
    });

    it('всё полотно (с краями и виражами) выше земли', () => {
      const smp = t.sampleAt(0);
      let worst = Infinity;
      for (let s = 0; s < t.length; s += 0.5) {
        t.sampleAt(s, smp);
        for (const side of [-1, 1]) {
          const y = smp.position.y + smp.right.y * side * (smp.halfWidth + BARRIER_OFFSET);
          worst = Math.min(worst, y - GROUND_Y);
        }
      }
      expect(worst).toBeGreaterThanOrEqual(ROAD_CLEARANCE);
    });

    it('стартовая решётка позади линии и внутри дороги', () => {
      for (let i = 0; i < 6; i++) {
        const pose = t.gridPose(i);
        expect(t.deltaS(0, pose.s)).toBeLessThan(0);
        expect(Math.abs(t.project(pose.position, pose.s).lateral)).toBeLessThan(t.halfWidth - 2);
      }
    });

    it('тоннели лежат внутри круга', () => {
      for (const [f0, f1] of def.tunnels ?? []) {
        expect(f0).toBeGreaterThanOrEqual(0);
        expect(f1).toBeLessThanOrEqual(1);
        expect(f1).toBeGreaterThan(f0);
      }
    });
  });
}
