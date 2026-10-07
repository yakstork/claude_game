import { describe, expect, it } from 'vitest';
import { Track } from '../../src/world/track';
import { TRACKS } from '../../src/world/trackData';
import { PICKUP_LAYOUTS, pickupLayoutFor } from '../../src/world/pickups';
import { PICKUP_TUNING, PickupSystem, type PickupCar } from '../../src/race/pickups';

const car = (s: number, lateral: number, nitro = 0.2, onGround = true): PickupCar => ({ trackS: s, lateral, onGround, nitro });

describe('раскладка', () => {
  it('есть для каждой трассы: 3–6 пластин и канистры в пределах полотна', () => {
    for (const def of TRACKS) {
      const track = new Track(def);
      const lay = (def.pickups ?? pickupLayoutFor(track.id));
      expect(lay.pads.length).toBeGreaterThanOrEqual(3);
      expect(lay.pads.length).toBeLessThanOrEqual(7);
      expect(lay.cans.length).toBeGreaterThan(3);
      const sys = new PickupSystem(track, lay);
      for (let i = 0; i < sys.canCount; i++) {
        const hw = track.sampleAt(sys.canS[i]).halfWidth;
        expect(Math.abs(sys.canLateral[i])).toBeLessThanOrEqual(hw - 1);
      }
    }
    expect(Object.keys(PICKUP_LAYOUTS).sort()).toEqual(TRACKS.filter((t) => !t.id?.startsWith('gen-')).map((t) => t.id).sort());
  });
});

describe('PickupSystem', () => {
  const track = new Track(TRACKS[0]);
  const make = () => new PickupSystem(track, { pads: [{ f: 0.3, offset: 0 }], cans: [{ f: 0.6, offset: 4 }] });

  it('пластина срабатывает один раз за проезд и снова после кулдауна', () => {
    const sys = make();
    const hits: string[] = [];
    const h = (k: string, c: number, i: number) => hits.push(`${k}${c}:${i}`);
    const s0 = sys.padS[0];
    sys.update(0.016, [car(s0 - 20, 0)], h);
    expect(hits).toEqual([]);
    sys.update(0.016, [car(s0 - 2, 1)], h);
    sys.update(0.016, [car(s0 + 2, 1)], h);
    expect(hits).toEqual(['pad0:0']);
    sys.update(PICKUP_TUNING.padCooldown + 0.1, [car(s0 + 30, 0)], h);
    sys.update(0.016, [car(s0, 0)], h);
    expect(hits).toHaveLength(2);
  });

  it('пластина не срабатывает в воздухе и сбоку', () => {
    const sys = make();
    let n = 0;
    sys.update(0.016, [car(sys.padS[0], 0, 0.2, false)], () => n++);
    sys.update(0.016, [car(sys.padS[0], 8)], () => n++);
    expect(n).toBe(0);
  });

  it('канистра: +25% нитро, исчезает и возвращается через ~8 с', () => {
    const sys = make();
    const c = car(sys.canS[0], sys.canLateral[0], 0.2);
    let n = 0;
    sys.update(0.016, [c], () => n++);
    expect(c.nitro).toBeCloseTo(0.45, 5);
    expect(sys.canTimer[0]).toBeGreaterThan(7.9);
    const c2 = car(sys.canS[0], sys.canLateral[0], 0.2);
    sys.update(0.016, [c2], () => n++);
    expect(c2.nitro).toBe(0.2);
    sys.update(PICKUP_TUNING.canRespawn, [car(0, 0)], () => n++);
    expect(sys.canTimer[0]).toBe(0);
    sys.update(0.016, [c2], () => n++);
    expect(c2.nitro).toBeCloseTo(0.45, 5);
    expect(n).toBe(2);
  });

  it('полный бак канистру не забирает; нитро не выше 1', () => {
    const sys = make();
    const full = car(sys.canS[0], sys.canLateral[0], 1);
    sys.update(0.016, [full], () => {});
    expect(sys.canTimer[0]).toBe(0);
    const almost = car(sys.canS[0], sys.canLateral[0], 0.9);
    sys.update(0.016, [almost], () => {});
    expect(almost.nitro).toBe(1);
  });

  it('работает через шов круга (s около 0)', () => {
    const sys = new PickupSystem(track, { pads: [{ f: 0, offset: 0 }], cans: [] });
    let n = 0;
    sys.update(0.016, [car(track.length - 2, 0)], () => n++);
    expect(n).toBe(1);
  });
});
