import { describe, expect, it } from 'vitest';
import { Track } from '../../src/world/track';
import { SUNSET_LOOP } from '../../src/world/trackData';
import { VehiclePhysics } from '../../src/vehicle/physics';
import { BotDriver, PAD_AIM_RANGE } from '../../src/ai/botDriver';
import { BOT_PROFILES, specById } from '../../src/vehicle/specs';
import type { VehicleState } from '../../src/core/types';

/** Бот слегка смещает линию к ближайшей бустер-пластине на прямой (≤ 40 м), если не в обгоне. */

const DT = 1 / 120;
const track = new Track(SUNSET_LOOP);
const PAD_S = 420;
const PAD_LAT = 3;

/** Едем одним ботом до s = PAD_S; возвращаем lateral на каждом метре последних 60 м */
function run(withPad: boolean, slowCarAhead = false): Map<number, number> {
  const profile = BOT_PROFILES[0];
  const car = new VehiclePhysics(specById(profile.carId), track);
  const g = track.gridPose(0);
  car.reset(g.position, g.heading, g.s);
  const bot = new BotDriver(track, profile, 11);
  if (withPad) bot.setPads([PAD_S], [PAD_LAT]);
  const st = car.state;
  const others: VehicleState[] = [st];
  let blocker: VehiclePhysics | null = null;
  const lat = new Map<number, number>();
  for (let k = 0; k < 120 * 40; k++) {
    if (slowCarAhead && !blocker && st.trackS > PAD_S - 120 && st.trackS < PAD_S) {
      blocker = new VehiclePhysics(specById(profile.carId), track);
      const sm = track.sampleAt(PAD_S - 40);
      blocker.reset(sm.position, Math.atan2(sm.tangent.x, sm.tangent.z), PAD_S - 40);
      blocker.frozen = true;
      others.push(blocker.state);
    }
    car.step(DT, bot.update(DT, st, car.spec, others));
    const s = st.trackS;
    if (s > PAD_S - 160 && s < PAD_S + 5) lat.set(Math.round(s), st.lateral);
    if (s > PAD_S + 5 && s < PAD_S + 100) break;
  }
  return lat;
}

describe('BotDriver: бустер-пластины', () => {
  it('сближается с пластиной, лежащей сбоку от линии (в пределах дальности)', () => {
    const base = run(false);
    const aim = run(true);
    const at = PAD_S - 3;
    expect(base.has(at) && aim.has(at)).toBe(true);
    const eBase = Math.abs(base.get(at)! - PAD_LAT);
    const eAim = Math.abs(aim.get(at)! - PAD_LAT);
    expect(eAim).toBeLessThan(eBase);
    expect(eBase - eAim).toBeGreaterThan(1);
  });

  it('вне дальности прицеливания линия не меняется', () => {
    const base = run(false);
    const aim = run(true);
    const far = PAD_S - PAD_AIM_RANGE - 75;
    expect(aim.get(far)).toBeCloseTo(base.get(far)!, 3);
  });

  it('в обгоне (медленная машина впереди) не ломает движение: без ударов и застревания', () => {
    const aim = run(true, true);
    expect(aim.size).toBeGreaterThan(10);
    for (const v of aim.values()) expect(Math.abs(v)).toBeLessThan(track.halfWidth);
  });
});
