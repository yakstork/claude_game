import { describe, expect, it } from 'vitest';
import { MathUtils } from 'three';
import { Track, createSample } from '../../src/world/track';
import { SUNSET_LOOP } from '../../src/world/trackData';
import type { ControlPoint } from '../../src/world/trackData';
import { VehiclePhysics } from '../../src/vehicle/physics';
import { CAR_SPECS } from '../../src/vehicle/specs';
import { getHandling, steerAngleAt, steerForCurvature } from '../../src/vehicle/handling';
import type { VehicleControls } from '../../src/core/types';

/**
 * Занос зависит от скорости («конвертер скорости в поворот»).
 *
 * 1. Сценарии игрока на РЕАЛЬНОЙ трассе Sunset Loop (восточная шпилька, s ≈ 520–700, R ≈ 35–70 м):
 *    а) с нитро-максимума (maxSpeed · nitroSpeedMul), за 20–40 м до входа Space + руль в поворот, газ в пол;
 *    б) вход дрифтом на 30 м/с без нитро (Space за 15–20 м до входа).
 *    Контроллер руля простой: ПД по боковому смещению и курсу пути относительно осевой (руль в занос
 *    управляет углом заноса, диапазон [0.2, 1]). Photon на максималке может притормозить до 0.6 с перед Space.
 *    До правок скорость почти не гасилась: машина влетала в наружную стену на 55–75 м/с и ехала вдоль неё
 *    (2 жёстких удара, скорость в середине шпильки ≈ 55–60 м/с), а дуга заноса была шире сцепления.
 * 2. Физические свойства заноса на ровной площадке: угол растёт со скоростью, дуга загибается (не хуже, а лучше
 *    сцепления уже на 25–35 м/с), занос тормозит тем сильнее, чем больше скорость и угол.
 *
 * Конвенции: шпилька правая (в физике руль +1 = вправо, yawRate > 0 — влево), lateral > 0 — внутри поворота.
 */

const DT = 1 / 120;
const G = 9.81;
const DEG = 180 / Math.PI;
const track = new Track(SUNSET_LOOP);
const smp = createSample();

/** Вход в шпильку: s, где кривизна начинает расти (R ≈ 354 → 72 м на s = 510–540) */
const HAIRPIN_ENTRY = 520;
/** Выход из шпильки (кривизна кончилась), конец сценария */
const HAIRPIN_END = 720;
/** Момент отпускания Space (конец крутой части) */
const RELEASE_S = 690;
/** Старт машины на осевой при заходе с максималки, м до входа */
const START_BACK = 120;

const IDS = CAR_SPECS.filter((c) => c.id !== 'custom').map((c) => c.id);
const SPEC = Object.fromEntries(CAR_SPECS.map((c) => [c.id, c]));

function ctl(o: Partial<VehicleControls> = {}): VehicleControls {
  return { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, ...o };
}

// ─── Сценарий шпильки ──────────────────────────────────────────────────────

type HairpinResult = {
  reached: boolean;
  time: number;
  minSpeed: number;
  exitSpeed: number;
  /** скорость при s = 600 (середина шпильки), м/с */
  speedMid: number;
  /** скорость в момент первого касания стены, м/с (0 — касаний не было) */
  firstWallSpeed: number;
  /** удары с strength > 0.5 */
  hardHits: number;
  /** все события «стена» (лёгкие касания тоже) */
  wallEvents: number;
  respawn: boolean;
};

/** Pure pursuit по осевой в сцеплении (после заноса) */
function gripSteer(car: VehiclePhysics): number {
  const st = car.state;
  const cfg = getHandling(car.spec.id);
  const v = Math.max(st.speed, 0);
  const t = track.sampleAt(st.trackS + 8 + 0.5 * v, smp);
  const dx = t.position.x - st.position.x;
  const dz = t.position.z - st.position.z;
  const along = dx * Math.sin(st.heading) + dz * Math.cos(st.heading);
  const left = dx * Math.cos(st.heading) - dz * Math.sin(st.heading);
  const kappa = (2 * Math.sin(Math.atan2(left, along))) / Math.max(4, Math.hypot(dx, dz));
  return MathUtils.clamp(-steerForCurvature(cfg, v, kappa) / steerAngleAt(cfg, v), -1, 1);
}

/** Коэффициенты ПД-контроллера руля в заносе */
const PD = { base: 0.3, kLat: 0.1, kRate: 0.03, kHead: 1.5, min: 0.2 };

/** Руль в занос (вправо = +1): база − ПД по смещению от осевой, его скорости и по курсу пути относительно трассы */
function driftSteer(car: VehiclePhysics, latRate: number): number {
  const st = car.state;
  const tp = track.sampleAt(st.trackS, smp);
  let eh = Math.atan2(tp.tangent.x, tp.tangent.z) - Math.atan2(st.velocity.x, st.velocity.z);
  while (eh > Math.PI) eh -= 2 * Math.PI;
  while (eh < -Math.PI) eh += 2 * Math.PI;
  // eh > 0: путь повёрнут в сторону поворота дальше трассы (перекрутили) — руль убавляем
  return MathUtils.clamp(PD.base - PD.kLat * st.lateral - PD.kRate * latRate - PD.kHead * eh, PD.min, 1);
}

/**
 * startSpeed = 0: старт с нитро-максимума за START_BACK м до входа. Иначе — заданная скорость,
 * старт за spaceBack + 25 м (газ в пол, без нитро). Space + руль — за spaceBack м до входа.
 */
function hairpin(carId: string, spaceBack: number, nitro: boolean, brakeTime: number, startSpeed = 0): HairpinResult {
  const cfg = getHandling(carId);
  const car = new VehiclePhysics(SPEC[carId], track);
  const s0 = HAIRPIN_ENTRY - (startSpeed > 0 ? spaceBack + 25 : START_BACK);
  const p = track.sampleAt(s0);
  const h = Math.atan2(p.tangent.x, p.tangent.z);
  car.reset(p.position, h, s0);
  const v0 = startSpeed > 0 ? startSpeed : cfg.maxSpeed * cfg.nitroSpeedMul;
  car.state.velocity.set(Math.sin(h) * v0, 0, Math.cos(h) * v0);
  car.state.speed = v0;

  const spaceS = HAIRPIN_ENTRY - spaceBack;
  const c = ctl();
  const st = car.state;
  const r: HairpinResult = {
    reached: false,
    time: 0,
    minSpeed: Infinity,
    exitSpeed: 0,
    speedMid: 0,
    firstWallSpeed: 0,
    hardHits: 0,
    wallEvents: 0,
    respawn: false,
  };
  let t = 0;
  let prevLat = st.lateral;
  while (t < 14) {
    const V = Math.hypot(st.velocity.x, st.velocity.z);
    const latRate = (st.lateral - prevLat) / DT;
    prevLat = st.lateral;
    c.throttle = 1;
    c.nitro = nitro;
    c.brake = brakeTime > 0 && st.trackS < spaceS && st.trackS >= spaceS - brakeTime * V ? 1 : 0;
    if (st.trackS < spaceS) {
      c.handbrake = false;
      c.steer = 0;
    } else if (st.trackS < RELEASE_S) {
      c.handbrake = true;
      c.steer = driftSteer(car, latRate);
    } else {
      c.handbrake = false;
      c.steer = gripSteer(car);
    }
    car.step(DT, c);
    t += DT;
    const V1 = Math.hypot(st.velocity.x, st.velocity.z);
    r.minSpeed = Math.min(r.minSpeed, V1);
    if (r.speedMid === 0 && st.trackS >= 600) r.speedMid = V1;
    for (const e of car.events) {
      if (e.type !== 'wall') continue;
      r.wallEvents++;
      if (e.strength > 0.5) r.hardHits++;
      if (r.firstWallSpeed === 0) r.firstWallSpeed = V1;
    }
    if (car.needsRespawn) {
      r.respawn = true;
      break;
    }
    if (st.trackS >= HAIRPIN_END && st.trackS < HAIRPIN_END + 80) {
      r.reached = true;
      r.exitSpeed = V1;
      break;
    }
  }
  r.time = t;
  return r;
}

describe('шпилька Sunset Loop: занос поворачивает и гасит скорость', () => {
  it('геометрия: шпилька начинается на s ≈ 520 и закручивается вправо (R ≈ 25–45 м в самой крутой точке)', () => {
    expect(Math.abs(track.curvatureAt(HAIRPIN_ENTRY - 20))).toBeLessThan(0.004);
    let kMax = 0;
    for (let s = 560; s < 690; s += 2) kMax = Math.max(kMax, Math.abs(track.curvatureAt(s)));
    expect(1 / kMax).toBeLessThan(45);
    expect(1 / kMax).toBeGreaterThan(25);
    // за шпилькой направление обратное (идём на запад), а трасса ушла в сторону +Z — вправо при движении на восток
    const a = track.sampleAt(HAIRPIN_ENTRY, smp).tangent.clone();
    const zStart = track.sampleAt(HAIRPIN_ENTRY, smp).position.z;
    const b = track.sampleAt(RELEASE_S, smp);
    expect(a.x * b.tangent.x + a.z * b.tangent.z).toBeLessThan(-0.9);
    expect(b.position.z - zStart).toBeGreaterThan(80);
  });

  // maxHard — допустимое число жёстких ударов (strength > 0.5); vMid — предел скорости на s = 600,
  // vWall — предел скорости первого касания стены; minExit — минимальная скорость на выходе
  const cases: { id: string; brake: number; maxHard: number; vMid: number; vWall: number; minExit: number }[] = [
    { id: 'grizzly', brake: 0, maxHard: 0, vMid: 55, vWall: 52, minExit: 25 },
    { id: 'razor', brake: 0, maxHard: 0, vMid: 55, vWall: 52, minExit: 25 },
    // Photon на нитро-максимуме (≈ 87 м/с) с коротким заносом: ему разрешено притормозить до 0.6 с перед Space
    { id: 'photon', brake: 0.6, maxHard: 1, vMid: 60, vWall: 56, minExit: 25 },
  ];

  for (const { id, brake, maxHard, vMid, vWall, minExit } of cases) {
    it(`${id}: с нитро-максимума Space + руль за 20/30/40 м до входа (газ в пол${brake ? ', тормоз ≤ ' + brake + ' с до Space' : ''}, нитро вкл/выкл): проходит шпильку, ударов > 0.5 не больше ${maxHard}`, () => {
      for (const nitro of [false, true]) {
        for (const spaceBack of [20, 30, 40]) {
          const r = hairpin(id, spaceBack, nitro, brake);
          const label = `${id} Space за ${spaceBack} м, нитро ${nitro ? 'вкл' : 'выкл'}`;
          expect(r.respawn, label + ': респаун').toBe(false);
          expect(r.reached, label + ': дошла до s = 720').toBe(true);
          expect(r.time, label + ': время').toBeLessThan(12);
          expect(r.hardHits, label + ': жёсткие удары (strength > 0.5)').toBeLessThanOrEqual(maxHard);
          expect(r.minSpeed, label + ': не останавливается').toBeGreaterThanOrEqual(12);
          expect(r.exitSpeed, label + ': выход из шпильки').toBeGreaterThanOrEqual(minExit);
          // занос успел сбросить скорость до крутой части: в середине шпильки уже не 55–75 м/с
          expect(r.speedMid, label + ': скорость на s = 600').toBeLessThanOrEqual(vMid);
          // и в стену (если вообще касается) не влетает на скорости
          if (r.firstWallSpeed > 0) expect(r.firstWallSpeed, label + ': скорость первого касания стены').toBeLessThanOrEqual(vWall);
        }
      }
    });
  }

  it('вход в шпильку дрифтом на 30 м/с без нитро (Space за 15/20 м до входа): все три машины без ударов > 0.5', () => {
    for (const id of IDS) {
      for (const spaceBack of [15, 20]) {
        const r = hairpin(id, spaceBack, false, 0, 30);
        const label = `${id} Space за ${spaceBack} м`;
        expect(r.respawn, label + ': респаун').toBe(false);
        expect(r.reached, label + ': дошла до s = 720').toBe(true);
        expect(r.hardHits, label + ': жёсткие удары (strength > 0.5)').toBe(0);
        expect(r.minSpeed, label + ': не останавливается').toBeGreaterThanOrEqual(25);
        expect(r.exitSpeed, label + ': выход из шпильки').toBeGreaterThanOrEqual(25);
      }
    }
  });

  it('сценарий детерминирован: два прогона дают одинаковый результат', () => {
    const a = hairpin('grizzly', 30, false, 0);
    const b = hairpin('grizzly', 30, false, 0);
    expect(b).toEqual(a);
  });
});

// ─── Физика заноса на ровной площадке ──────────────────────────────────────

/** Огромное кольцо с широкой дорогой — «бесконечная» ровная площадка */
const widePts: ControlPoint[] = [];
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * Math.PI * 2;
  widePts.push([Math.cos(a) * 4000, 0, Math.sin(a) * 4000]);
}
const wide = new Track({ name: 'wide', points: widePts, defaultHalfWidth: 1500, checkpointCount: 8 });

type DriftMeasure = {
  /** средний угол заноса за 0.5–1.0 с, рад */
  angle: number;
  /** радиус дуги пути за 0.5–1.0 с, м */
  radius: number;
  /** боковое ускорение пути, м/с² */
  aLat: number;
  /** суммарное торможение (модуль скорости) за 0.5–1.0 с при газе throttle, м/с² */
  decel: number;
  /** потеря скорости за первые 0.5 с, доля */
  loss05: number;
};

/** Space + руль вправо на скорости v (скорость задана сразу) */
function measureDrift(carId: string, v: number, throttle = 1): DriftMeasure {
  const car = new VehiclePhysics(SPEC[carId], wide);
  const sm = wide.sampleAt(300);
  const h = Math.atan2(sm.tangent.x, sm.tangent.z);
  car.reset(sm.position, h, 300);
  car.state.velocity.set(Math.sin(h) * v, 0, Math.cos(h) * v);
  car.state.speed = v;
  const st = car.state;
  let psiPrev = h;
  let turned = 0;
  let angle = 0;
  let n = 0;
  let v05 = 0;
  let v10 = 0;
  const steps = Math.round(1 / DT);
  for (let k = 1; k <= steps; k++) {
    car.step(DT, ctl({ throttle, steer: 1, handbrake: true }));
    const t = k * DT;
    const psi = Math.atan2(st.velocity.x, st.velocity.z);
    let d = psi - psiPrev;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    psiPrev = psi;
    const V = Math.hypot(st.velocity.x, st.velocity.z);
    if (t > 0.5) {
      turned += Math.abs(d);
      angle += st.driftAngle;
      n++;
    }
    if (k === steps / 2) v05 = V;
    v10 = V;
  }
  expect(car.state.drifting, `${carId} ${v} м/с: занос держится`).toBe(true);
  const rate = turned / 0.5;
  const vm = (v05 + v10) / 2;
  return { angle: angle / n, radius: vm / rate, aLat: vm * rate, decel: (v05 - v10) / 0.5, loss05: 1 - v05 / v };
}

const cache = new Map<string, DriftMeasure>();
function drift(carId: string, v: number): DriftMeasure {
  const key = carId + ':' + v;
  let m = cache.get(key);
  if (!m) {
    m = measureDrift(carId, v);
    cache.set(key, m);
  }
  return m;
}

describe('занос зависит от скорости (ровная площадка, Space + руль, газ в пол)', () => {
  it('угол заноса растёт со скоростью к максимуму машины (раньше на 70–80 м/с сужался вдвое)', () => {
    for (const id of IDS) {
      const cfg = getHandling(id);
      const a35 = drift(id, 35).angle;
      for (const v of [50, 60, 70, 80]) expect(drift(id, v).angle, `${id} ${v} м/с`).toBeGreaterThanOrEqual(a35 - 0.5 / DEG);
      for (const v of [70, 80]) {
        expect(drift(id, v).angle, `${id} ${v} м/с`).toBeGreaterThanOrEqual(cfg.driftMaxAngle * 0.9);
        expect(drift(id, v).angle, `${id} ${v} м/с`).toBeLessThanOrEqual(cfg.driftMaxAngle + 1 / DEG);
      }
    }
  });

  it('дуга загибается: на 70–80 м/с радиус ≤ ~125 м (раньше 250–500 м), боковое ускорение не падает со скоростью', () => {
    for (const id of IDS) {
      for (const v of [70, 80]) expect(drift(id, v).radius, `${id} ${v} м/с`).toBeLessThanOrEqual(125);
      expect(drift(id, 70).aLat, `${id}: a(70) ≥ a(30)`).toBeGreaterThanOrEqual(drift(id, 30).aLat);
      expect(drift(id, 50).aLat, `${id}: a(50) ≥ a(30)`).toBeGreaterThanOrEqual(drift(id, 30).aLat);
    }
  });

  /** Предел бокового ускорения в режиме GRIP на скорости v (как в physics: grip·g·(1 + downforce·sp²)) */
  const gripLimit = (id: string, v: number): number => {
    const cfg = getHandling(id);
    const sp = Math.min(1.3, v / cfg.maxSpeed);
    return cfg.grip * G * (1 + cfg.downforce * sp * sp);
  };

  it('занос поворачивает лучше сцепления уже на средних скоростях: на 25–35 м/с боковое ускорение ≥ 1.25× GRIP, радиус дуги меньше радиуса на сцеплении', () => {
    for (const id of IDS) {
      for (const v of [25, 30, 35]) {
        const m = drift(id, v);
        expect(m.aLat / gripLimit(id, v), `${id} ${v} м/с: a(занос) / a(GRIP)`).toBeGreaterThanOrEqual(1.25);
        expect(m.radius, `${id} ${v} м/с: радиус заноса < радиуса на сцеплении`).toBeLessThan((v * v) / gripLimit(id, v));
      }
    }
    // характер: Grizzly поворачивает в заносе лучше всех, Photon — меньше всех (но всё равно ≥ 1.25× GRIP)
    const ratio = (id: string, v: number): number => drift(id, v).aLat / gripLimit(id, v);
    for (const v of [25, 30, 35]) {
      expect(ratio('grizzly', v), `${v} м/с: Grizzly > Razor`).toBeGreaterThan(ratio('razor', v));
      expect(ratio('razor', v), `${v} м/с: Razor > Photon`).toBeGreaterThan(ratio('photon', v));
    }
  });

  it('занос гасит скорость: на 70–80 м/с торможение 15–35 м/с², на 30 м/с газ держит скорость', () => {
    for (const id of IDS) {
      for (const v of [70, 80]) {
        const m = drift(id, v);
        expect(m.decel, `${id} ${v} м/с`).toBeGreaterThanOrEqual(15);
        expect(m.decel, `${id} ${v} м/с`).toBeLessThanOrEqual(35);
      }
      // на 30 м/с с газом скорость почти не падает (как раньше), без газа — умеренное торможение
      expect(drift(id, 30).decel, `${id} 30 м/с`).toBeLessThan(1.5);
      expect(drift(id, 80).decel, `${id}: торможение растёт со скоростью`).toBeGreaterThan(drift(id, 50).decel * 1.5);
      expect(drift(id, 50).decel, `${id} 50 м/с`).toBeLessThan(drift(id, 70).decel);
      // потеря за первые 0.5 с на входе: ≤ 6% на 30–35 м/с (как раньше), на 80 м/с — заметно больше
      expect(drift(id, 35).loss05, `${id} 35 м/с`).toBeLessThanOrEqual(0.06);
      expect(drift(id, 80).loss05, `${id} 80 м/с`).toBeGreaterThanOrEqual(0.1);
    }
  });

  it('характер: Grizzly на скорости поворачивает лучше всех (угол, дуга, торможение), Photon — короче и мягче', () => {
    const [razor, grizzly, photon] = IDS.map((id) => drift(id, 75));
    expect(grizzly.angle).toBeGreaterThan(razor.angle);
    expect(razor.angle).toBeGreaterThan(photon.angle);
    expect(grizzly.radius).toBeLessThan(razor.radius);
    expect(razor.radius).toBeLessThan(photon.radius);
    expect(grizzly.decel).toBeGreaterThan(photon.decel);
    expect(razor.decel).toBeGreaterThan(photon.decel);
  });

  it('торможение заносом зависит от угла: при слабом контрруле (малый угол) на 75 м/с занос тормозит заметно слабее', () => {
    for (const id of IDS) {
      const car = new VehiclePhysics(SPEC[id], wide);
      const sm = wide.sampleAt(300);
      const h = Math.atan2(sm.tangent.x, sm.tangent.z);
      car.reset(sm.position, h, 300);
      const v = 75;
      car.state.velocity.set(Math.sin(h) * v, 0, Math.cos(h) * v);
      car.state.speed = v;
      // вход со Space, затем слабый контрруль (Space держится; угол сжимается, но переброса нет)
      for (let k = 0; k < Math.round(0.3 / DT); k++) car.step(DT, ctl({ throttle: 1, steer: 1, handbrake: true }));
      const full = Math.abs(car.state.driftAngle);
      let v1 = 0;
      for (let k = 0; k < Math.round(0.8 / DT); k++) {
        car.step(DT, ctl({ throttle: 1, steer: -0.3, handbrake: true }));
        if (k === Math.round(0.3 / DT)) v1 = Math.hypot(car.state.velocity.x, car.state.velocity.z);
      }
      const v2 = Math.hypot(car.state.velocity.x, car.state.velocity.z);
      const counterDecel = (v1 - v2) / 0.5;
      expect(Math.abs(car.state.driftAngle), `${id}: угол сжат контррулём`).toBeLessThan(full * 0.6);
      expect(counterDecel, `${id}: торможение при малом угле`).toBeLessThan(drift(id, 75).decel * 0.75);
    }
  });

  it('без Space на полном руле занос на скорости не включается (W + A/D остаётся в сцеплении)', () => {
    for (const id of IDS) {
      for (const v of [60, 75]) {
        const car = new VehiclePhysics(SPEC[id], wide);
        const sm = wide.sampleAt(300);
        const h = Math.atan2(sm.tangent.x, sm.tangent.z);
        car.reset(sm.position, h, 300);
        car.state.velocity.set(Math.sin(h) * v, 0, Math.cos(h) * v);
        car.state.speed = v;
        let ever = false;
        for (let k = 0; k < 2 * 120; k++) {
          car.step(DT, ctl({ throttle: 1, steer: 1 }));
          if (car.state.drifting) ever = true;
        }
        expect(ever, `${id} ${v} м/с`).toBe(false);
        expect(Math.abs(car.state.driftAngle), `${id} ${v} м/с`).toBeLessThan(8 / DEG);
      }
    }
  });
});
