import { describe, expect, it } from 'vitest';
import { MathUtils, Vector3 } from 'three';
import { Track, createProjection, createSample } from '../../src/world/track';
import { SUNSET_LOOP } from '../../src/world/trackData';
import { BARRIER_OFFSET, GROUND_Y, ROAD_CLEARANCE } from '../../src/world/constants';
import { BODY_FLOOR, VehiclePhysics } from '../../src/vehicle/physics';
import { resolveCarCollisions } from '../../src/vehicle/collisions';
import { CAR_GEOMETRY, BOT_PROFILES, CAR_SPECS, specById } from '../../src/vehicle/specs';
import { getHandling, steerAngleAt, steerForCurvature } from '../../src/vehicle/handling';
import { BotDriver } from '../../src/ai/botDriver';
import type { BotProfile, VehicleControls } from '../../src/core/types';

const DT = 1 / 120;
const track = new Track(SUNSET_LOOP);
const R = CAR_GEOMETRY.wheelRadius;

describe('геометрия трассы: полотно выше земли', () => {
  it('вся поверхность полотна (осевая и края до halfWidth + BARRIER_OFFSET, с виражом) ≥ GROUND_Y + ROAD_CLEARANCE', () => {
    const smp = createSample();
    const minY = GROUND_Y + ROAD_CLEARANCE;
    let worst = Infinity;
    let worstS = 0;
    for (let s = 0; s < track.length; s += 0.25) {
      track.sampleAt(s, smp);
      const half = smp.halfWidth + BARRIER_OFFSET;
      // поверхность — плоскость через осевую с наклоном виража: проверяем осевую, края и промежуточные точки
      for (const f of [-1, -0.5, 0, 0.5, 1]) {
        const y = smp.position.y + smp.right.y * half * f;
        if (y < worst) {
          worst = y;
          worstS = s;
        }
      }
    }
    expect(worst, `минимум высоты полотна ${worst.toFixed(3)} м на s=${worstS.toFixed(1)}`).toBeGreaterThanOrEqual(minY - 1e-3);
  });
});

// ─── Инварианты подвески на каждом шаге ────────────────────────────────────

interface Worst {
  /** min(низ колеса − высота дороги под ним) */
  wheelBottom: number;
  /** max |contact.y − поверхность| для колёс на земле */
  contactErr: number;
  /** min(днище − поверхность под центром) */
  floor: number;
  /** min (точка крепления + ход − R − поверхность): предел сжатия подвески */
  attach: number;
  /** сколько шагов колёса были в воздухе */
  airSteps: number;
  steps: number;
  badCompression: number;
}

function newWorst(): Worst {
  return { wheelBottom: Infinity, contactErr: 0, floor: Infinity, attach: Infinity, airSteps: 0, steps: 0, badCompression: 0 };
}

const _proj = createProjection();
const _p = new Vector3();
const _c = new Vector3();

/** Независимая проверка состояния машины после step() (по state, без внутренностей физики) */
function checkCar(car: VehiclePhysics, w: Worst): void {
  const st = car.state;
  const T = getHandling(car.spec.id).suspTravel;
  w.steps++;
  if (!st.onGround) w.airSteps++;
  // днище: под центром
  const hc = track.project(st.position, st.trackS, _proj, 6).height;
  w.floor = Math.min(w.floor, st.position.y - BODY_FLOOR - hc);
  for (let i = 0; i < 4; i++) {
    const wh = st.wheels[i];
    if (wh.compression < 0 || wh.compression > 1 || !Number.isFinite(wh.compression)) w.badCompression++;
    // точка крепления по позе кузова: колесо не может сжаться сильнее полного хода
    const o = CAR_GEOMETRY.wheelOffsets[i];
    _p.set(o[0], o[1], o[2]).applyQuaternion(st.quaternion).add(st.position);
    const hm = track.project(_p, st.trackS, _proj, 6).height;
    w.attach = Math.min(w.attach, _p.y + T * 0.5 - R - hm);
    // низ колеса и контакт
    const h = track.project(wh.contact, st.trackS, _proj, 6).height;
    car.wheelCenter(i, _c);
    w.wheelBottom = Math.min(w.wheelBottom, _c.y - R - h);
    if (wh.onGround) w.contactErr = Math.max(w.contactErr, Math.abs(wh.contact.y - h));
  }
}

function expectClean(w: Worst, label: string): void {
  expect(w.badCompression, `${label}: compression вне 0..1`).toBe(0);
  expect(w.wheelBottom, `${label}: низ колеса ниже дороги`).toBeGreaterThanOrEqual(-0.02);
  expect(w.contactErr, `${label}: contact не на поверхности`).toBeLessThan(0.03);
  expect(w.floor, `${label}: днище ниже дороги`).toBeGreaterThanOrEqual(0);
  expect(w.attach, `${label}: подвеска сжата сильнее хода`).toBeGreaterThanOrEqual(-0.02);
}

function makeBots(profiles: BotProfile[]) {
  const cars = profiles.map((p, i) => {
    const car = new VehiclePhysics(specById(p.carId), track);
    const g = track.gridPose(i);
    car.reset(g.position, g.heading, g.s);
    return car;
  });
  const bots = profiles.map((p, i) => new BotDriver(track, p, 200 + i));
  return { cars, bots, states: cars.map((c) => c.state) };
}

describe('подвеска по реальной поверхности: колёса и днище не проходят сквозь покрытие', () => {
  it('круг шести ботов: на каждом шаге для каждого колеса', () => {
    const profiles: BotProfile[] = [
      ...BOT_PROFILES,
      { ...BOT_PROFILES[2], name: 'SIX', skill: 0.78, carId: 'photon', lineBias: 0.15 },
    ];
    const { cars, bots, states } = makeBots(profiles);
    const worst = cars.map(() => newWorst());
    const dist = cars.map(() => 0);
    const prevS = cars.map((c) => c.state.trackS);
    const maxY = cars.map(() => 0);
    for (let k = 0; k < 120 * 120; k++) {
      let done = true;
      for (let i = 0; i < cars.length; i++) {
        cars[i].step(DT, bots[i].update(DT, cars[i].state, cars[i].spec, states));
        checkCar(cars[i], worst[i]);
        const d = track.deltaS(prevS[i], cars[i].state.trackS);
        prevS[i] = cars[i].state.trackS;
        if (Math.abs(d) < 50) dist[i] += d;
        maxY[i] = Math.max(maxY[i], cars[i].state.position.y);
        if (dist[i] < track.length) done = false;
      }
      resolveCarCollisions(cars);
      if (done) break;
    }
    for (let i = 0; i < cars.length; i++) {
      expect(dist[i], `${profiles[i].name}: круг не проехан`).toBeGreaterThanOrEqual(track.length);
      // круг включает эстакаду (≈11 м) и трамплин
      expect(maxY[i], `${profiles[i].name}: не был на эстакаде`).toBeGreaterThan(8);
      expectClean(worst[i], profiles[i].name);
    }
  });

  /** Заезд «газ в пол + нитро»: руль по центральной линии (pure pursuit), без торможения */
  function fullSend(carIndex: number, s0: number, speed0: number, seconds: number, maxDist: number): { worst: Worst; airSteps: number; peak: number; maxY: number } {
    const spec = CAR_SPECS[carIndex];
    const cfg = getHandling(spec.id);
    const car = new VehiclePhysics(spec, track);
    const smp = track.sampleAt(s0);
    const heading = Math.atan2(smp.tangent.x, smp.tangent.z);
    car.reset(smp.position, heading, s0);
    car.state.velocity.set(Math.sin(heading) * speed0, 0, Math.cos(heading) * speed0);
    const c: VehicleControls = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: true };
    const worst = newWorst();
    const t = createSample();
    let peak = 0;
    let maxY = 0;
    let dist = 0;
    let prevS = car.state.trackS;
    for (let k = 0; k < seconds * 120; k++) {
      const st = car.state;
      st.nitro = 1;
      const v = Math.max(st.speed, 0);
      track.sampleAt(st.trackS + 8 + 0.5 * v, t);
      const dx = t.position.x - st.position.x;
      const dz = t.position.z - st.position.z;
      const alpha = Math.atan2(dx * Math.cos(st.heading) - dz * Math.sin(st.heading), dx * Math.sin(st.heading) + dz * Math.cos(st.heading));
      const kappa = (2 * Math.sin(alpha)) / Math.max(4, Math.hypot(dx, dz));
      c.steer = MathUtils.clamp(-steerForCurvature(cfg, v, kappa) / steerAngleAt(cfg, v), -1, 1);
      car.step(DT, c);
      checkCar(car, worst);
      peak = Math.max(peak, st.speed);
      maxY = Math.max(maxY, st.position.y);
      dist += track.deltaS(prevS, st.trackS);
      prevS = st.trackS;
      if (car.needsRespawn || dist > maxDist) break;
    }
    expect(car.needsRespawn).toBe(false);
    return { worst, airSteps: worst.airSteps, peak, maxY };
  }

  it('максимальная скорость с нитро через трамплин: колёса и днище не ниже дороги, есть отрыв', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      // стартовая прямая: разгон с нитро до трамплина (гребень на s ≈ 90) и дальше
      const r = fullSend(i, track.length - 60, getHandling(CAR_SPECS[i].id).maxSpeed * 0.95, 8, 360);
      expect(r.airSteps, CAR_SPECS[i].id + ': нет отрыва на трамплине').toBeGreaterThan(20);
      expect(r.peak, CAR_SPECS[i].id).toBeGreaterThan(getHandling(CAR_SPECS[i].id).maxSpeed);
      expectClean(r.worst, `${CAR_SPECS[i].id} трамплин`);
    }
  });

  it('по эстакаде на максимальной скорости с нитро: подъём, пролёт, спуск', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      // от крутого левого перед подъёмом (s ≈ 1050) — ~450 м почти прямой эстакады
      const r = fullSend(i, 1050, 20, 22, 450);
      expect(r.maxY, CAR_SPECS[i].id + ': не взобралась на эстакаду').toBeGreaterThan(8);
      expectClean(r.worst, `${CAR_SPECS[i].id} эстакада`);
    }
  });

  it('случайное управление 40 с со стенами, заносами и падениями: инварианты сохраняются', () => {
    let seed = 987654;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < CAR_SPECS.length; i++) {
      const car = new VehiclePhysics(CAR_SPECS[i], track);
      const g = track.gridPose(0);
      car.reset(g.position, g.heading, g.s);
      const worst = newWorst();
      let steer = 0;
      let hold = 0;
      let cur: VehicleControls = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false };
      for (let k = 0; k < 120 * 40; k++) {
        if (hold-- <= 0) {
          hold = 20 + Math.floor(rnd() * 60);
          steer = rnd() < 0.3 ? 0 : rnd() * 2 - 1;
          cur = { throttle: rnd() < 0.8 ? 1 : 0, brake: rnd() < 0.1 ? 1 : 0, steer, handbrake: rnd() < 0.15, nitro: rnd() < 0.4 };
        }
        car.step(DT, cur);
        if (car.needsRespawn) {
          car.reset(g.position, g.heading, g.s);
          continue;
        }
        checkCar(car, worst);
      }
      expectClean(worst, `${CAR_SPECS[i].id} случайный заезд`);
    }
  });
});
