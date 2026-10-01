import { afterEach, describe, expect, it } from 'vitest';
import { Track } from '../../src/world/track';
import { SUNSET_LOOP, TRACKS } from '../../src/world/trackData';
import { VehiclePhysics, createVehicleState } from '../../src/vehicle/physics';
import { resolveCarCollisions } from '../../src/vehicle/collisions';
import { BotDriver } from '../../src/ai/botDriver';
import { BOT_PROFILES, specById } from '../../src/vehicle/specs';
import { getHandling, resetHandling } from '../../src/vehicle/handling';
import type { BotProfile, VehicleControls, VehicleState } from '../../src/core/types';

/**
 * Тактика ботов по отдельности: дрифт ради буста, нитро, учёт буста в скорости, переменный темп,
 * rubber banding по пачке, защита позиции, обгон медленной машины без столкновения.
 */

const DT = 1 / 120;
afterEach(() => resetHandling());
const tracks = TRACKS.map((d) => new Track(d));
const sunset = new Track(SUNSET_LOOP);

interface SoloStats {
  lapTimes: number[];
  boostTime: number;
  driftShare: number;
  nitroShare: number;
  hardWalls: number;
  respawns: number;
  nitroBad: number;
  paceMin: number;
  paceMax: number;
}

/** Одиночный бот: стартует с решётки, едет laps кругов */
function solo(trk: Track, profile: BotProfile, seed: number, laps: number): SoloStats {
  const car = new VehiclePhysics(specById(profile.carId), trk);
  const g = trk.gridPose(0);
  car.reset(g.position, g.heading, g.s);
  const bot = new BotDriver(trk, profile, seed);
  const st = car.state;
  const res: SoloStats = {
    lapTimes: [],
    boostTime: 0,
    driftShare: 0,
    nitroShare: 0,
    hardWalls: 0,
    respawns: 0,
    nitroBad: 0,
    paceMin: Infinity,
    paceMax: 0,
  };
  let t = 0;
  let dist = 0;
  let prevS = st.trackS;
  let lapStart = 0;
  let steps = 0;
  let drift = 0;
  let nitro = 0;
  while (res.lapTimes.length < laps && t < 400) {
    const c = bot.update(DT, st, car.spec, [st]);
    car.step(DT, c);
    t += DT;
    steps++;
    const d = trk.deltaS(prevS, st.trackS);
    prevS = st.trackS;
    if (Math.abs(d) < 50) dist += d;
    if (st.boostTime > 0) res.boostTime += DT;
    if (st.drifting) drift++;
    if (st.nitroActive) {
      nitro++;
      // нитро — только на прямых и на ходу
      if (Math.abs(trk.curvatureAt(st.trackS)) > 0.012 || st.speed < 20) res.nitroBad++;
    }
    if (t > 10) {
      res.paceMin = Math.min(res.paceMin, bot.pace);
      res.paceMax = Math.max(res.paceMax, bot.pace);
    }
    for (const e of car.events) if (e.type === 'wall' && e.strength > 0.3) res.hardWalls++;
    if (car.needsRespawn) res.respawns++;
    if (dist >= (res.lapTimes.length + 1) * trk.length) {
      res.lapTimes.push(t - lapStart);
      lapStart = t;
    }
  }
  res.driftShare = drift / steps;
  res.nitroShare = nitro / steps;
  return res;
}

function makeState(trk: Track, s: number, lateral: number, speed: number): VehicleState {
  const st = createVehicleState();
  const p = trk.sampleAt(s);
  const heading = Math.atan2(p.tangent.x, p.tangent.z);
  st.position.copy(p.position).addScaledVector(p.right, lateral);
  st.position.y = 0.36;
  st.heading = heading;
  st.trackS = s;
  st.lateral = lateral;
  st.speed = speed;
  st.velocity.set(Math.sin(heading) * speed, 0, Math.cos(heading) * speed);
  return st;
}

describe('тактика: дрифт ради буста и нитро', () => {
  for (const trk of tracks) {
    it(`${trk.name}: одиночный бот на Grizzly и Razor дрифтит в поворотах, получает буст и не бьётся о стены`, () => {
      for (const profile of [BOT_PROFILES[1], BOT_PROFILES[2]]) {
        const r = solo(trk, profile, 21, 2);
        const tag = `${profile.name}/${profile.carId}`;
        expect(r.lapTimes.length, tag).toBe(2);
        expect(r.respawns, tag).toBe(0);
        expect(r.hardWalls, `${tag}: сильные удары`).toBeLessThanOrEqual(3);
        expect(r.driftShare, `${tag}: доля заноса`).toBeGreaterThan(0.04);
        expect(r.driftShare, `${tag}: доля заноса`).toBeLessThan(0.4);
        expect(r.boostTime, `${tag}: суммарный буст, с`).toBeGreaterThan(3);
      }
    }, 60000);

    it(`${trk.name}: нитро — не постоянно (1–25% времени) и только на прямых`, () => {
      for (const profile of BOT_PROFILES.slice(0, 3)) {
        const r = solo(trk, profile, 8, 2);
        expect(r.nitroShare, profile.name).toBeGreaterThan(0.01);
        expect(r.nitroShare, profile.name).toBeLessThan(0.25);
        expect(r.nitroBad, `${profile.name}: нитро в повороте или на малой скорости`).toBeLessThan(120);
      }
    }, 60000);
  }

  it('Photon (слабый буст, цепкие шины) дрифтит реже и получает меньше буста, чем Grizzly', () => {
    const photon = { ...BOT_PROFILES[1], carId: 'photon' };
    const grizzly = BOT_PROFILES[1];
    let boostP = 0;
    let boostG = 0;
    for (const seed of [3, 4, 5]) {
      boostP += solo(sunset, photon, seed, 2).boostTime;
      boostG += solo(sunset, grizzly, seed, 2).boostTime;
    }
    expect(boostP).toBeLessThan(boostG);
  }, 60000);

  it('буст не вызывает торможения «из-за превышения maxSpeed»: на свободной прямой с бустом бот не тормозит', () => {
    const car = new VehiclePhysics(specById('razor'), sunset);
    const s0 = 40;
    const p = sunset.sampleAt(s0);
    car.reset(p.position, Math.atan2(p.tangent.x, p.tangent.z), s0);
    const cfg = getHandling('razor');
    const v0 = cfg.maxSpeed * 1.05;
    const h = car.state.heading;
    car.state.velocity.set(Math.sin(h) * v0, 0, Math.cos(h) * v0);
    car.state.speed = v0;
    car.applyBoost(3, 1);
    const bot = new BotDriver(sunset, BOT_PROFILES[2], 4);
    let braked = 0;
    for (let k = 0; k < 120 * 1.5; k++) {
      const c = bot.update(DT, car.state, car.spec, [car.state]);
      if (c.brake > 0.05) braked++;
      car.step(DT, c);
    }
    expect(braked).toBe(0);
    expect(car.state.speed).toBeGreaterThan(cfg.maxSpeed);
  });

  it('при заряженной шкале нитро и догоне машины впереди бот жмёт нитро на прямой', () => {
    const self = makeState(sunset, 60, 0, 40);
    self.nitro = 0.5;
    const other = makeState(sunset, 100, 0, 38);
    let used = 0;
    const bot = new BotDriver(sunset, { ...BOT_PROFILES[0], aggression: 0.9 }, 2);
    for (let k = 0; k < 240; k++) if (bot.update(DT, self, specById('photon'), [self, other]).nitro) used++;
    expect(used).toBeGreaterThan(100);
  });
});

describe('характер и переменный темп', () => {
  it('темп «плавает» по ходу гонки (разброс > 3%) и повторяется при том же seed', () => {
    const a = solo(sunset, BOT_PROFILES[2], 31, 3);
    const b = solo(sunset, BOT_PROFILES[2], 31, 3);
    expect(a.paceMax - a.paceMin).toBeGreaterThan(0.03);
    expect(b.paceMin).toBe(a.paceMin);
    expect(b.paceMax).toBe(a.paceMax);
    expect(b.lapTimes).toEqual(a.lapTimes);
  }, 60000);

  it('разные seed одного профиля едут по-разному: разброс времени круга заметен, но все ≤ 90 с', () => {
    const laps: number[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = solo(sunset, BOT_PROFILES[3], seed, 2);
      expect(r.respawns).toBe(0);
      laps.push(r.lapTimes[1]);
    }
    expect(Math.max(...laps) - Math.min(...laps)).toBeGreaterThan(0.3);
    expect(Math.max(...laps)).toBeLessThan(90);
  }, 60000);

  it('профили различаются: у каждого бота своё время круга (разные скилл, машина, склонность к заносу)', () => {
    const times = BOT_PROFILES.map((p) => solo(sunset, p, 9, 2).lapTimes[1]);
    expect(new Set(times.map((x) => x.toFixed(2))).size).toBe(times.length);
    expect(Math.max(...times) / Math.min(...times)).toBeLessThan(1.1);
  }, 60000);
});

describe('rubber banding по пачке', () => {
  /** Темп бота после того, как «форма» и rubber банд устоялись: others — статичные машины */
  function paceWith(otherS: number[], seed = 3): number {
    const self = makeState(sunset, 200, 0, 40);
    const others: VehicleState[] = [self, ...otherS.map((s) => makeState(sunset, s, 0, 40))];
    const bot = new BotDriver(sunset, BOT_PROFILES[2], seed);
    // «форма» плавает по времени: сравниваем на одном и том же моменте — берём темп на 8-й секунде
    for (let k = 0; k < 120 * 8; k++) bot.update(DT, self, specById('razor'), others);
    return bot.pace;
  }

  it('лидер с большим отрывом осторожнее, чем лидер без отрыва; отстающий смелее обоих', () => {
    const free = paceWith([]);
    const farLeader = paceWith([200 - 150, 200 - 180, 200 - 210]);
    const closeLeader = paceWith([200 - 6, 200 - 20, 200 - 40]);
    const trailing = paceWith([200 + 150, 200 + 180, 200 + 210]);
    expect(farLeader).toBeLessThan(closeLeader - 0.03);
    expect(closeLeader).toBeLessThan(free + 0.02);
    expect(trailing).toBeGreaterThan(free + 0.015);
    // «мягко»: в пределах нескольких процентов, без читерства (не выше 1.04 предела машины)
    expect(farLeader).toBeGreaterThan(0.8);
    expect(trailing).toBeLessThanOrEqual(1.04 + 1e-9);
  });

  it('далёкий отстающий (игрок в хвосте на 2 км) не тянет лидера-бота назад сильнее, чем на PACK_CLAMP', () => {
    const self = makeState(sunset, 600, 0, 40);
    const bot = new BotDriver(sunset, BOT_PROFILES[2], 3);
    const near = [self, makeState(sunset, 560, 0, 40)];
    const far = [self, makeState(sunset, 560, 0, 40), makeState(sunset, 600 - 900, 0, 40)];
    for (let k = 0; k < 120 * 6; k++) bot.update(DT, self, specById('razor'), near);
    const pNear = bot.pace;
    const bot2 = new BotDriver(sunset, BOT_PROFILES[2], 3);
    for (let k = 0; k < 120 * 6; k++) bot2.update(DT, self, specById('razor'), far);
    expect(Math.abs(bot2.pace - pNear)).toBeLessThan(0.06);
  });
});

describe('взаимодействие: защита позиции и обгон', () => {
  const run = (attackerLat: number | null, profile: BotProfile, seed: number): number => {
    const self = makeState(sunset, 430, 0, 45);
    const others = [self];
    if (attackerLat !== null) others.push(makeState(sunset, 430 - 14, attackerLat, 47));
    const bot = new BotDriver(sunset, profile, seed);
    let steer = 0;
    for (let k = 0; k < 120; k++) steer = bot.update(DT, self, specById('razor'), others).steer;
    return steer;
  };
  const aggressive: BotProfile = { ...BOT_PROFILES[1], aggression: 1, lineBias: 0 };

  it('перед торможением бот иногда перекрывает линию в сторону атакующего сзади, но никогда не уходит от него', () => {
    let toward = 0;
    let away = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const free = run(null, aggressive, seed);
      const right = run(2, aggressive, seed) - free; // атакующий справа → руль вправо (+)
      const left = run(-2, aggressive, seed) - free;
      if (right > 0.01) toward++;
      if (right < -0.01) away++;
      if (left < -0.01) toward++;
      if (left > 0.01) away++;
    }
    expect(toward).toBeGreaterThan(6);
    expect(away).toBe(0);
  });

  it('атакующий далеко (60 м) или на другой высоте — защиты нет', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const free = run(null, aggressive, seed);
      const self = makeState(sunset, 430, 0, 45);
      const far = makeState(sunset, 430 - 60, 2, 47);
      const bot = new BotDriver(sunset, aggressive, seed);
      let steer = 0;
      for (let k = 0; k < 120; k++) steer = bot.update(DT, self, specById('razor'), [self, far]).steer;
      expect(Math.abs(steer - free), `сид ${seed}`).toBeLessThan(0.01);
    }
  });

  it('быстрый бот обгоняет медленную машину на прямой без сильных столкновений и ударов о стену', () => {
    const slowCar = new VehiclePhysics(specById('razor'), sunset);
    const fastCar = new VehiclePhysics(specById('photon'), sunset);
    const s0 = 2075;
    for (const [car, s] of [
      [slowCar, s0 + 45],
      [fastCar, s0],
    ] as const) {
      const p = sunset.sampleAt(s);
      const h = Math.atan2(p.tangent.x, p.tangent.z);
      car.reset(p.position, h, s);
      car.state.velocity.set(Math.sin(h) * 30, 0, Math.cos(h) * 30);
      car.state.speed = 30;
    }
    const botSlow = new BotDriver(sunset, BOT_PROFILES[4], 1);
    const botFast = new BotDriver(sunset, BOT_PROFILES[0], 2);
    const cars = [slowCar, fastCar];
    const states = cars.map((c) => c.state);
    const lim: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
    let worst = 0;
    let passedAt = -1;
    for (let k = 0; k < 120 * 14; k++) {
      const a = botSlow.update(DT, slowCar.state, slowCar.spec, states);
      lim.throttle = Math.min(a.throttle, 0.55);
      lim.brake = a.brake;
      lim.steer = a.steer;
      lim.handbrake = false;
      lim.nitro = false;
      slowCar.step(DT, lim);
      fastCar.step(DT, botFast.update(DT, fastCar.state, fastCar.spec, states));
      resolveCarCollisions(cars);
      for (const car of cars) for (const e of car.events) if (e.type === 'car' || e.type === 'wall') worst = Math.max(worst, e.strength);
      if (passedAt < 0 && sunset.deltaS(slowCar.state.trackS, fastCar.state.trackS) > 6) passedAt = k * DT;
      if (sunset.wrapS(fastCar.state.trackS) > 480 && sunset.wrapS(fastCar.state.trackS) < 1000) break;
    }
    expect(passedAt, 'обгон не состоялся до поворота').toBeGreaterThan(0);
    expect(worst, 'сильный удар при обгоне').toBeLessThan(0.5);
  });
});
