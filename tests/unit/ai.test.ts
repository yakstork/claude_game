import { describe, expect, it } from 'vitest';
import { Track } from '../../src/world/track';
import { SUNSET_LOOP } from '../../src/world/trackData';
import { VehiclePhysics, createVehicleState } from '../../src/vehicle/physics';
import { resolveCarCollisions } from '../../src/vehicle/collisions';
import { BotDriver } from '../../src/ai/botDriver';
import { rubberBandFactor } from '../../src/ai/rubberBand';
import { BOT_PROFILES, CAR_SPECS, specById } from '../../src/vehicle/specs';
import type { BotProfile, VehicleState } from '../../src/core/types';

const DT = 1 / 120;
const track = new Track(SUNSET_LOOP);

/** Пять профилей из specs + шестой бот (в гонке ботов 5, но тест гоняет шестёрку) */
const PROFILES: BotProfile[] = [
  ...BOT_PROFILES,
  { ...BOT_PROFILES[2], name: 'SIX', skill: 0.78, carId: 'photon', lineBias: 0.15 },
];

function makeRace(profiles: BotProfile[] = PROFILES) {
  const cars = profiles.map((p, i) => {
    const car = new VehiclePhysics(specById(p.carId), track);
    const g = track.gridPose(i);
    car.reset(g.position, g.heading, g.s);
    return car;
  });
  const bots = profiles.map((p, i) => new BotDriver(track, p, 100 + i));
  const states = cars.map((c) => c.state);
  return { cars, bots, states };
}

describe('rubberBandFactor', () => {
  const L = track.length;

  it('в пределах 0.92..1.10 при любом отрыве', () => {
    for (let gap = -3000; gap <= 3000; gap += 25) {
      const f = rubberBandFactor(1000 + gap, 1000, L);
      expect(f).toBeGreaterThanOrEqual(0.92 - 1e-9);
      expect(f).toBeLessThanOrEqual(1.1 + 1e-9);
    }
  });

  it('вблизи игрока (±30 м) = 1', () => {
    expect(rubberBandFactor(1000, 1000, L)).toBe(1);
    expect(rubberBandFactor(1029, 1000, L)).toBe(1);
    expect(rubberBandFactor(971, 1000, L)).toBe(1);
  });

  it('бот позади на 250 м и дальше получает +10%, впереди — −8%', () => {
    expect(rubberBandFactor(750, 1000, L)).toBeCloseTo(1.1, 6);
    expect(rubberBandFactor(0, 1000, L)).toBeCloseTo(1.1, 6);
    expect(rubberBandFactor(1250, 1000, L)).toBeCloseTo(0.92, 6);
    expect(rubberBandFactor(5000, 1000, L)).toBeCloseTo(0.92, 6);
  });

  it('монотонно не возрастает по отрыву (позади — сильнее, впереди — слабее) и плавный', () => {
    let prev = Infinity;
    let maxStep = 0;
    let last = rubberBandFactor(1000 - 400, 1000, L);
    for (let gap = -400; gap <= 400; gap += 1) {
      const f = rubberBandFactor(1000 + gap, 1000, L);
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
      maxStep = Math.max(maxStep, Math.abs(f - last));
      last = f;
    }
    expect(maxStep).toBeLessThan(0.005);
  });

  it('середина диапазона плавная: на −140 м бот получает заметную, но неполную прибавку', () => {
    const f = rubberBandFactor(860, 1000, L);
    expect(f).toBeGreaterThan(1.02);
    expect(f).toBeLessThan(1.09);
  });
});

describe('BotDriver: базовое поведение', () => {
  it('возвращает один и тот же объект с допустимыми значениями', () => {
    const { cars, bots, states } = makeRace();
    let first: unknown = null;
    for (let k = 0; k < 600; k++) {
      const c = bots[0].update(DT, cars[0].state, cars[0].spec, states);
      if (first === null) first = c;
      expect(c).toBe(first);
      expect(c.throttle).toBeGreaterThanOrEqual(0);
      expect(c.throttle).toBeLessThanOrEqual(1);
      expect(c.brake).toBeGreaterThanOrEqual(0);
      expect(c.brake).toBeLessThanOrEqual(1);
      expect(Math.abs(c.steer)).toBeLessThanOrEqual(1);
      cars[0].step(DT, c);
    }
  });

  it('детерминирован: одинаковый seed — одинаковая езда', () => {
    const runOnce = (seed: number): number => {
      const car = new VehiclePhysics(specById('razor'), track);
      const g = track.gridPose(0);
      car.reset(g.position, g.heading, g.s);
      const bot = new BotDriver(track, BOT_PROFILES[2], seed);
      for (let k = 0; k < 120 * 15; k++) car.step(DT, bot.update(DT, car.state, car.spec, [car.state]));
      return car.state.trackS + car.state.lateral * 1e-3;
    };
    expect(runOnce(7)).toBe(runOnce(7));
    expect(runOnce(7)).not.toBe(runOnce(8));
  });

  it('на прямой полный газ и нитро при заряженной шкале', () => {
    const car = new VehiclePhysics(specById('razor'), track);
    const s0 = 300;
    const smp = track.sampleAt(s0);
    car.reset(smp.position, Math.atan2(smp.tangent.x, smp.tangent.z), s0);
    car.state.nitro = 1;
    const bot = new BotDriver(track, BOT_PROFILES[0], 1);
    let usedNitro = false;
    for (let k = 0; k < 120 * 3; k++) {
      const c = bot.update(DT, car.state, car.spec, [car.state]);
      if (c.nitro) usedNitro = true;
      car.step(DT, c);
    }
    expect(usedNitro).toBe(true);
    expect(car.state.speed).toBeGreaterThan(25);
  });

  it('обгон: сместившись на сторону с большим запасом ширины', () => {
    const s0 = 320;
    const smp = track.sampleAt(s0);
    const heading = Math.atan2(smp.tangent.x, smp.tangent.z);
    const mk = (s: number, lateral: number, speed: number): VehicleState => {
      const st = createVehicleState();
      const p = track.sampleAt(s);
      st.position.copy(p.position).addScaledVector(p.right, lateral);
      st.position.y = 0.36;
      st.heading = heading;
      st.trackS = s;
      st.lateral = lateral;
      st.speed = speed;
      st.velocity.set(Math.sin(heading) * speed, 0, Math.cos(heading) * speed);
      return st;
    };
    const steerWith = (otherLat: number | null): number => {
      const self = mk(s0, 0, 30);
      const others = [self];
      if (otherLat !== null) others.push(mk(s0 + 14, otherLat, 15));
      const bot = new BotDriver(track, { ...BOT_PROFILES[1], lineBias: 0 }, 5);
      let steer = 0;
      for (let k = 0; k < 120; k++) steer = bot.update(DT, self, CAR_SPECS[0], others).steer;
      return steer;
    };
    const free = steerWith(null);
    const otherRight = steerWith(2.5); // соперник правее осевой → уходим влево (steer < 0)
    const otherLeft = steerWith(-2.5);
    expect(otherRight).toBeLessThan(free - 0.01);
    expect(otherLeft).toBeGreaterThan(free + 0.01);
  });

  it('застревание: стоит на месте — включает задний ход и растёт stuckTime', () => {
    const car = new VehiclePhysics(specById('razor'), track);
    const s0 = 300;
    const smp = track.sampleAt(s0);
    car.reset(smp.position, Math.atan2(smp.tangent.x, smp.tangent.z), s0);
    const bot = new BotDriver(track, BOT_PROFILES[2], 3);
    // разгоняем, чтобы бот «начал движение», затем замораживаем состояние
    for (let k = 0; k < 120 * 3; k++) car.step(DT, bot.update(DT, car.state, car.spec, [car.state]));
    expect(bot.stuckTime).toBe(0);
    car.state.speed = 0;
    car.state.velocity.set(0, 0, 0);
    let reversed = false;
    for (let k = 0; k < 120 * 4; k++) {
      car.state.speed = 0;
      const c = bot.update(DT, car.state, car.spec, [car.state]);
      if (c.brake > 0.9 && c.throttle === 0) reversed = true;
    }
    expect(reversed).toBe(true);
    expect(bot.stuckTime).toBeGreaterThan(3);
  });

  it('после разворота лицом назад бот сам разворачивается и едет по трассе', () => {
    const car = new VehiclePhysics(specById('razor'), track);
    const s0 = 300;
    const smp = track.sampleAt(s0);
    car.reset(smp.position, Math.atan2(smp.tangent.x, smp.tangent.z) + Math.PI, s0);
    const bot = new BotDriver(track, BOT_PROFILES[1], 4);
    let prevS = car.state.trackS;
    let progress = 0;
    for (let k = 0; k < 120 * 25; k++) {
      car.step(DT, bot.update(DT, car.state, car.spec, [car.state]));
      progress += track.deltaS(prevS, car.state.trackS);
      prevS = car.state.trackS;
    }
    expect(progress).toBeGreaterThan(200);
  });
});

describe('BotDriver: гонка шести ботов', () => {
  it('каждый бот проезжает 3 круга быстрее 240 с, без застреваний и с разумным числом ударов', () => {
    const { cars, bots, states } = makeRace();
    const n = cars.length;
    const LAPS = 3;
    const dist = cars.map(() => 0);
    const prevS = cars.map((c) => c.state.trackS);
    const finish = cars.map(() => -1);
    const walls = cars.map(() => 0);
    const maxStuck = cars.map(() => 0);
    const respawns = cars.map(() => 0);
    const minSpeedAfterStart = cars.map(() => Infinity);
    let t = 0;
    for (let k = 0; k < 120 * 240; k++) {
      t += DT;
      for (let i = 0; i < n; i++) {
        const c = bots[i].update(DT, cars[i].state, cars[i].spec, states);
        cars[i].step(DT, c);
        const d = track.deltaS(prevS[i], cars[i].state.trackS);
        prevS[i] = cars[i].state.trackS;
        if (Math.abs(d) < 50) dist[i] += d;
        for (const e of cars[i].events) if (e.type === 'wall') walls[i]++;
        maxStuck[i] = Math.max(maxStuck[i], bots[i].stuckTime);
        if (cars[i].needsRespawn) respawns[i]++;
        if (t > 8) minSpeedAfterStart[i] = Math.min(minSpeedAfterStart[i], Math.abs(cars[i].state.speed));
        if (finish[i] < 0 && dist[i] >= LAPS * track.length) finish[i] = t;
      }
      resolveCarCollisions(cars);
      if (finish.every((f) => f > 0)) break;
    }
    for (let i = 0; i < n; i++) {
      const name = PROFILES[i].name;
      expect(finish[i], `${name}: не финишировал за 240 с (проехал ${dist[i].toFixed(0)} м)`).toBeGreaterThan(0);
      expect(finish[i], name).toBeLessThan(240);
      expect(walls[i], `${name}: удары в стену`).toBeLessThan(40);
      expect(maxStuck[i], `${name}: застревание`).toBeLessThan(6);
      expect(respawns[i], `${name}: needsRespawn`).toBe(0);
    }
    // шестёрка ботов едет не одинаково: разброс времени финиша заметен, но не огромен
    const spread = Math.max(...finish) - Math.min(...finish);
    expect(spread).toBeGreaterThan(3);
    expect(spread).toBeLessThan(80);
  });

  it('быстрейший бот на 3 кругах едет со средней скоростью 30–60 м/с (нет «ползания» и нет полёта)', () => {
    const { cars, bots, states } = makeRace(PROFILES.slice(0, 1));
    let t = 0;
    let dist = 0;
    let prevS = cars[0].state.trackS;
    while (dist < track.length * 3 && t < 240) {
      t += DT;
      cars[0].step(DT, bots[0].update(DT, cars[0].state, cars[0].spec, states));
      dist += track.deltaS(prevS, cars[0].state.trackS);
      prevS = cars[0].state.trackS;
    }
    const avg = dist / t;
    expect(avg).toBeGreaterThan(30);
    expect(avg).toBeLessThan(60);
  });
});
