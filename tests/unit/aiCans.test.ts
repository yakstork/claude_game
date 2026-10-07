import { describe, expect, it } from 'vitest';
import { Track } from '../../src/world/track';
import { SUNSET_LOOP } from '../../src/world/trackData';
import { VehiclePhysics } from '../../src/vehicle/physics';
import { BotDriver, CAN_AIM_BELOW } from '../../src/ai/botDriver';
import { BOT_PROFILES, specById } from '../../src/vehicle/specs';

/** Бот с нитро < 40% смещает линию к доступной канистре на прямой (сдвиг ≤ 4 м); с полным баком или при недоступной канистре — нет. */

const DT = 1 / 120;
const track = new Track(SUNSET_LOOP);
const CAN_S = 420;
const CAN_LAT = 3;

function run(nitro: number, timer: number, withCan = true): Map<number, number> {
  const profile = BOT_PROFILES[0];
  const car = new VehiclePhysics(specById(profile.carId), track);
  const g = track.gridPose(0);
  car.reset(g.position, g.heading, g.s);
  const bot = new BotDriver(track, profile, 11);
  if (withCan) bot.setCans([CAN_S], [CAN_LAT], [timer]);
  const st = car.state;
  const lat = new Map<number, number>();
  for (let k = 0; k < 120 * 40; k++) {
    st.nitro = nitro; // держим заданный уровень, чтобы не зависеть от траты/подзарядки
    car.step(DT, bot.update(DT, st, car.spec, [st]));
    const s = st.trackS;
    if (s > CAN_S - 160 && s < CAN_S + 5) lat.set(Math.round(s), st.lateral);
    if (s > CAN_S + 5 && s < CAN_S + 100) break;
  }
  return lat;
}

describe('BotDriver: канистры нитро', () => {
  it('порог 40%', () => {
    expect(CAN_AIM_BELOW).toBe(0.4);
  });

  it('при нитро < 40% бот сближается с доступной канистрой не более чем на 4 м сдвига', () => {
    const base = run(0.9, 0);
    const low = run(0.1, 0);
    const at = CAN_S - 3;
    expect(base.has(at) && low.has(at)).toBe(true);
    const eBase = Math.abs(base.get(at)! - CAN_LAT);
    const eLow = Math.abs(low.get(at)! - CAN_LAT);
    expect(eBase - eLow).toBeGreaterThan(0.8);
    // сдвиг относительно обычной линии не больше ~4 м (+ запас на динамику)
    expect(Math.abs(low.get(at)! - base.get(at)!)).toBeLessThan(5);
  });

  it('канистра, которой ещё нет (таймер > 0), и отсутствие канистр линию не меняют', () => {
    const none = run(0.1, 0, false);
    const waiting = run(0.1, 5);
    const at = CAN_S - 3;
    expect(waiting.get(at)).toBeCloseTo(none.get(at)!, 3);
  });
});
