import { describe, expect, it } from 'vitest';
import { Track } from '../../src/world/track';
import { checkTrack, generatePickups, generateTrack, GEN_MAX_LENGTH, GEN_MIN_LENGTH, GEN_MIN_RADIUS } from '../../src/world/trackGen';
import { VehiclePhysics } from '../../src/vehicle/physics';
import { resolveCarCollisions } from '../../src/vehicle/collisions';
import { BotDriver } from '../../src/ai/botDriver';
import { BOT_PROFILES, specById } from '../../src/vehicle/specs';
import { TRACKS, GEN_INDEX } from '../../src/world/trackData';

const SEEDS = Array.from({ length: 50 }, (_, i) => 1 + i * 7919 + (i % 3) * 13);

describe('генератор трасс', () => {
  it('50 seed: длина 1.8–2.6 км, радиус ≥ 25 м, нет самопересечений и наложений, замкнутость, трамплины, декор', () => {
    const t0 = Date.now();
    for (const seed of SEEDS) {
      const def = generateTrack(seed);
      expect(def.id).toBe(`gen-${seed}`);
      const c = checkTrack(def);
      expect(c.ok, `seed ${seed}: ${JSON.stringify(c)}`).toBe(true);
      expect(c.length).toBeGreaterThanOrEqual(GEN_MIN_LENGTH);
      expect(c.length).toBeLessThanOrEqual(GEN_MAX_LENGTH);
      expect(c.minRadius, `seed ${seed}`).toBeGreaterThanOrEqual(25);
      expect(c.minRadius).toBeGreaterThanOrEqual(GEN_MIN_RADIUS * 0.9);
      expect(c.minGap).toBeGreaterThanOrEqual(c.needGap);
      // 1–2 трамплина: гребни высотой ~3.4 м
      const crests = def.points.filter((p) => p[1] > 3).length;
      expect(crests >= 1 && crests <= 2, `seed ${seed}: гребней ${crests}`).toBe(true);
      expect(['city', 'canyon']).toContain(def.decor);
      const lay = def.pickups;
      expect(lay && lay.pads.length >= 4 && lay.cans.length >= 1, `seed ${seed}: пикапы`).toBe(true);
      for (const s of [...lay!.pads, ...lay!.cans]) {
        expect(s.f).toBeGreaterThan(0);
        expect(s.f).toBeLessThan(1);
      }
    }
    console.log(`50 трасс сгенерировано за ${Date.now() - t0} мс`);
  }, 120000);

  it('детерминизм: один seed — одна трасса; разные seed — разные', () => {
    expect(generateTrack(42)).toEqual(generateTrack(42));
    expect(generateTrack(42).points).not.toEqual(generateTrack(43).points);
  });

  it('раскладка пикапов строится по кривизне и входит в TRACKS как последняя карточка', () => {
    const def = TRACKS[GEN_INDEX];
    expect(def.id?.startsWith('gen-')).toBe(true);
    expect(GEN_INDEX).toBe(TRACKS.length - 1);
    const lay = generatePickups(new Track(def));
    expect(lay.pads.length).toBeGreaterThanOrEqual(4);
  });

  it('боты (и автопилот игрока — тот же BotDriver) проезжают круг без застреваний на 4 разных seed', () => {
    const DT = 1 / 120;
    for (const seed of [3, 11, 29, 101]) {
      const track = new Track(generateTrack(seed));
      const profiles = BOT_PROFILES.slice(0, 5).concat({ ...BOT_PROFILES[0], name: 'AUTO', carId: 'razor', skill: 0.9 });
      const cars = profiles.map((p, i) => {
        const c = new VehiclePhysics(specById(p.carId), track);
        const g = track.gridPose(i);
        c.reset(g.position, g.heading, g.s);
        return c;
      });
      const drivers = profiles.map((p, i) => new BotDriver(track, p, seed * 100 + i));
      const states = cars.map((c) => c.state);
      const dist = cars.map((c) => (c.state.trackS > track.length / 2 ? c.state.trackS - track.length : c.state.trackS));
      const prev = cars.map((c) => c.state.trackS);
      const done = cars.map(() => -1);
      const respawns = cars.map(() => 0);
      let maxStuck = 0;
      for (let k = 0; k < 120 * 200 && done.some((d) => d < 0); k++) {
        for (let i = 0; i < cars.length; i++) {
          cars[i].step(DT, drivers[i].update(DT, cars[i].state, cars[i].spec, states));
          const d = track.deltaS(prev[i], cars[i].state.trackS);
          prev[i] = cars[i].state.trackS;
          if (Math.abs(d) < 50) dist[i] += d;
          if (cars[i].needsRespawn) respawns[i]++;
          maxStuck = Math.max(maxStuck, drivers[i].stuckTime);
          if (done[i] < 0 && dist[i] >= track.length) done[i] = k * DT;
        }
        resolveCarCollisions(cars);
      }
      expect(done.every((d) => d > 0), `seed ${seed}: круг проехали ${done.map((d) => d.toFixed(0))}`).toBe(true);
      expect(Math.max(...respawns), `seed ${seed}: респауны`).toBeLessThanOrEqual(2);
      expect(maxStuck, `seed ${seed}: застревание, с`).toBeLessThan(8);
      expect(Math.max(...done) / (track.length / 45), `seed ${seed}: слишком медленно`).toBeLessThan(2.2);
    }
  }, 240000);
});
