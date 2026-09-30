import { beforeAll, describe, expect, it } from 'vitest';
import { Euler } from 'three';
import { Track } from '../../src/world/track';
import type { ControlPoint } from '../../src/world/trackData';
import { VehiclePhysics } from '../../src/vehicle/physics';
import { CAR_SPECS as ALL_SPECS } from '../../src/vehicle/specs';

/** Только три заводские машины (у «своей сборки» — свой тест customBuild) */
const CAR_SPECS = ALL_SPECS.filter((c) => c.id !== 'custom');
import type { VehicleControls } from '../../src/core/types';

/**
 * «Ощущение» дрифта: одинаковый сценарий для трёх машин с телеметрией каждого шага.
 * Разгон до 35 м/с → W + руль 0.6 вправо 0.3 с → Space 0.4 с (руль полный) → газ и руль в занос
 * 1 с → отпустить руль и газ. Второй сценарий — «время в заносе» после отпускания Space.
 * Скорость в метриках потерь — модуль вектора скорости (state.speed — лишь продольная
 * компонента, в заносе на 50° она по определению ~64% от полной).
 */

const DT = 1 / 120;
const DEG = 180 / Math.PI;
const SPEED0 = 35;
const PRE_STEER = 0.6;
const SPACE_TIME = 0.4;
/** Photon без Space на полном руле держит занос ~1.5 с, поэтому отпускаем раньше, пока все три ещё в заносе */
const HOLD_TIME = 1.0;
const EULER = new Euler();

/** Огромное кольцо с широкой дорогой — «бесконечная» ровная площадка */
const pts: ControlPoint[] = [];
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * Math.PI * 2;
  pts.push([Math.cos(a) * 4000, 0, Math.sin(a) * 4000]);
}
const wide = new Track({ name: 'wide', points: pts, defaultHalfWidth: 1500, checkpointCount: 8 });

const IDS = CAR_SPECS.map((c) => c.id);

function ctl(o: Partial<VehicleControls> = {}): VehicleControls {
  return { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, ...o };
}

type Sample = {
  /** время от нажатия Space, с */
  t: number;
  /** угол заноса, рад (в сторону заноса > 0) */
  angle: number;
  yawRate: number;
  /** модуль вектора скорости, м/с */
  speed: number;
  drifting: boolean;
  roll: number;
  pitch: number;
  skid: number;
};

/** Новая машина на ровной площадке, разогнанная до SPEED0 (газ в пол, без руля) */
function accelerated(specIndex: number, speed = SPEED0): VehiclePhysics {
  const car = new VehiclePhysics(CAR_SPECS[specIndex], wide);
  const smp = wide.sampleAt(300);
  const h = Math.atan2(smp.tangent.x, smp.tangent.z);
  car.reset(smp.position, h, 300);
  let guard = 0;
  while (car.state.speed < speed && guard++ < 120 * 30) car.step(DT, ctl({ throttle: 1 }));
  return car;
}

function sample(car: VehiclePhysics, t: number, dir: number): Sample {
  const st = car.state;
  EULER.setFromQuaternion(st.quaternion, 'YXZ');
  return {
    t,
    angle: st.driftAngle * dir,
    yawRate: st.yawRate,
    speed: Math.hypot(st.velocity.x, st.velocity.z),
    drifting: st.drifting,
    roll: EULER.z,
    pitch: -EULER.x,
    skid: Math.min(st.wheels[2].skid, st.wheels[3].skid),
  };
}

type Scenario = {
  log: Sample[];
  /** индекс первого шага после отпускания руля и газа */
  iRelease: number;
};

function scenarioMain(specIndex: number, speed = SPEED0): Scenario {
  const car = accelerated(specIndex, speed);
  const log: Sample[] = [];
  const steps = (s: number): number => Math.round(s / DT);
  // W + руль 0.6 вправо (вперёд по ходу — driftAngle > 0 при руле вправо)
  for (let k = 0; k < steps(0.3); k++) {
    car.step(DT, ctl({ throttle: 1, steer: PRE_STEER }));
  }
  for (let k = 0; k < steps(SPACE_TIME); k++) {
    car.step(DT, ctl({ throttle: 1, steer: 1, handbrake: true }));
    log.push(sample(car, (k + 1) * DT, 1));
  }
  for (let k = 0; k < steps(HOLD_TIME); k++) {
    car.step(DT, ctl({ throttle: 1, steer: 1 }));
    log.push(sample(car, SPACE_TIME + (k + 1) * DT, 1));
  }
  const iRelease = log.length;
  for (let k = 0; k < steps(1.2); k++) {
    car.step(DT, ctl());
    log.push(sample(car, SPACE_TIME + HOLD_TIME + (k + 1) * DT, 1));
  }
  return { log, iRelease };
}

/** Второй сценарий: после входа Space отпущен, удерживается только руль (steer) + газ. Время в заносе, с. */
function holdTime(specIndex: number, steer: number): number {
  const car = accelerated(specIndex);
  for (let k = 0; k < Math.round(0.3 / DT); k++) car.step(DT, ctl({ throttle: 1, steer: PRE_STEER }));
  for (let k = 0; k < Math.round(SPACE_TIME / DT); k++) car.step(DT, ctl({ throttle: 1, steer: 1, handbrake: true }));
  expect(car.state.drifting, CAR_SPECS[specIndex].id + ': вход в занос').toBe(true);
  const limit = 12;
  let t = 0;
  while (car.state.drifting && t < limit) {
    car.step(DT, ctl({ throttle: 1, steer }));
    t += DT;
  }
  return t;
}

type Metrics = {
  maxAngle: number;
  t90: number;
  lossHalf: number;
  nodRoll: number;
  nodPitch: number;
  /** добавка крена наружу над установившимся, рад */
  kickRoll: number;
  /** клевок носом относительно установившегося тангажа, рад */
  kickDive: number;
  peakYaw: number;
  skidMin: number;
  alignTime: number;
  wrongSide: number;
  holdTime: number;
  holdTimeFull: number;
};

function measure(specIndex: number): Metrics {
  const { log, iRelease } = scenarioMain(specIndex);
  const hold = log.slice(0, iRelease);
  const maxAngle = Math.max(...hold.map((s) => s.angle));
  const t90 = (hold.find((s) => s.angle >= 0.9 * maxAngle) as Sample).t;
  const v0 = log[0].speed;
  const half = log.find((s) => s.t >= 0.5) as Sample;
  const entry = log.filter((s) => s.t <= 0.5);
  const settled = log.filter((s) => s.t >= 0.8 && s.t <= 1.0);
  const settledRoll = settled.reduce((a, s) => a + Math.abs(s.roll), 0) / settled.length;
  const settledPitch = settled.reduce((a, s) => a + s.pitch, 0) / settled.length;
  const after = log.slice(iRelease);
  const aligned = after.find((s) => Math.abs(s.angle) < 5 / DEG);
  return {
    maxAngle,
    t90,
    lossHalf: 1 - half.speed / v0,
    nodRoll: Math.max(...entry.map((s) => Math.abs(s.roll))),
    nodPitch: Math.max(...entry.map((s) => Math.abs(s.pitch))),
    kickRoll: Math.max(...entry.map((s) => Math.abs(s.roll))) - settledRoll,
    kickDive: settledPitch - Math.min(...entry.map((s) => s.pitch)),
    peakYaw: Math.max(...entry.map((s) => Math.abs(s.yawRate))),
    skidMin: Math.min(...log.filter((s) => s.t <= 0.2).map((s) => s.skid)),
    alignTime: aligned ? aligned.t - after[0].t + DT : Infinity,
    wrongSide: Math.max(...after.map((s) => -s.angle)),
    holdTime: holdTime(specIndex, 0.35),
    holdTimeFull: holdTime(specIndex, 1),
  };
}

const SPEEDS = [25, 35, 45, 55, 60];
const angleCache = new Map<string, number>();

/** Максимальный угол заноса (°) в основном сценарии при скорости входа v */
function angleAt(specIndex: number, v: number): number {
  const key = specIndex + ':' + v;
  let a = angleCache.get(key);
  if (a === undefined) {
    const { log, iRelease } = scenarioMain(specIndex, v);
    a = Math.max(...log.slice(0, iRelease).map((s) => s.angle)) * DEG;
    angleCache.set(key, a);
  }
  return a;
}

const M: Metrics[] = [];
const ROWS: string[] = [];

describe('ощущение дрифта: одинаковый сценарий для Razor / Grizzly / Photon', () => {
  beforeAll(() => {
    for (let i = 0; i < CAR_SPECS.length; i++) M.push(measure(i));
  });

  it('телеметрия: сводная таблица', () => {
    const fmt = (x: number, d = 2): string => x.toFixed(d);
    ROWS.push('машина   | maxУгол° | t90,с | потеря V за 0.5с | пик крен°/тангаж° | кивок: крен+°/клевок° | пик yaw,рад/с | skid мин (0.2с) | выход <5°,с | в заносе без Space: руль 0.35,с | руль 1.0,с');
    for (let i = 0; i < M.length; i++) {
      const m = M[i];
      ROWS.push(
        [
          IDS[i].padEnd(8),
          fmt(m.maxAngle * DEG, 1).padStart(8),
          fmt(m.t90).padStart(5),
          (fmt(m.lossHalf * 100, 1) + '%').padStart(16),
          `${fmt(m.nodRoll * DEG, 1)} / ${fmt(m.nodPitch * DEG, 1)}`.padStart(17),
          `${fmt(m.kickRoll * DEG, 1)} / ${fmt(m.kickDive * DEG, 1)}`.padStart(21),
          fmt(m.peakYaw).padStart(13),
          fmt(m.skidMin).padStart(15),
          fmt(m.alignTime).padStart(11),
          fmt(m.holdTime).padStart(30),
          fmt(m.holdTimeFull).padStart(11),
        ].join(' | '),
      );
    }
    // угол от скорости входа (тот же сценарий, разгон до v)
    ROWS.push('', 'Макс. угол заноса, ° — от скорости входа, м/с:', 'машина   |    25 |    35 |    45 |    55 |    60');
    for (let i = 0; i < CAR_SPECS.length; i++) {
      const row = SPEEDS.map((v) => fmt(angleAt(i, v), 1).padStart(5));
      ROWS.push(IDS[i].padEnd(8) + ' | ' + row.join(' | '));
    }
    console.log('\nТЕЛЕМЕТРИЯ ДРИФТА (35 м/с, руль вправо, газ в пол)\n' + ROWS.join('\n'));
    expect(M.length).toBe(3);
  });

  it('быстрый срыв: 90% угла за 0.12–0.28 с после Space', () => {
    for (let i = 0; i < M.length; i++) {
      expect(M[i].t90, IDS[i]).toBeGreaterThanOrEqual(0.12);
      expect(M[i].t90, IDS[i]).toBeLessThanOrEqual(0.28);
    }
  });

  it('углы: Grizzly 45–55°, Razor 35–40°, Photon 22–28°; порядок Grizzly > Razor > Photon', () => {
    const [razor, grizzly, photon] = M.map((m) => m.maxAngle * DEG);
    expect(grizzly).toBeGreaterThanOrEqual(45);
    expect(grizzly).toBeLessThanOrEqual(55);
    expect(razor).toBeGreaterThanOrEqual(35);
    expect(razor).toBeLessThanOrEqual(40);
    expect(photon).toBeGreaterThanOrEqual(22);
    expect(photon).toBeLessThanOrEqual(28);
    expect(grizzly).toBeGreaterThan(razor);
    expect(razor).toBeGreaterThan(photon);
  });

  it('углы держатся на 25–45 м/с и не проваливаются на 55–60 м/с (падение ≤ ~20%)', () => {
    // Razor, Grizzly, Photon (порядок CAR_SPECS)
    const ranges = [
      [35, 40],
      [45, 55],
      [22, 28],
    ];
    for (let i = 0; i < CAR_SPECS.length; i++) {
      for (const v of [25, 35, 45]) {
        const a = angleAt(i, v);
        expect(a, `${IDS[i]} ${v} м/с`).toBeGreaterThanOrEqual(ranges[i][0] - 1);
        expect(a, `${IDS[i]} ${v} м/с`).toBeLessThanOrEqual(ranges[i][1] + 1);
      }
      const ref = angleAt(i, 35);
      for (const v of [55, 60]) expect(angleAt(i, v), `${IDS[i]} ${v} м/с`).toBeGreaterThanOrEqual(ref * 0.8);
    }
  });

  it('«кивок»: пик |крен| или |тангаж| на входе ≥ 2.5° (крен наружу +2…5°, клевок ≥ 1°), визг задних шин ≥ 0.9 с первого шага', () => {
    for (let i = 0; i < M.length; i++) {
      expect(Math.max(M[i].nodRoll, M[i].nodPitch) * DEG, IDS[i]).toBeGreaterThanOrEqual(2.5);
      // импульс над установившимся положением кузова — именно он читается как «кивок»
      expect(M[i].kickRoll * DEG, IDS[i] + ' крен').toBeGreaterThanOrEqual(2);
      expect(M[i].kickRoll * DEG, IDS[i] + ' крен').toBeLessThanOrEqual(5);
      expect(M[i].kickDive * DEG, IDS[i] + ' клевок').toBeGreaterThanOrEqual(1);
      expect(M[i].kickDive * DEG, IDS[i] + ' клевок').toBeLessThanOrEqual(3);
      expect(M[i].skidMin, IDS[i]).toBeGreaterThanOrEqual(0.9);
    }
    // крен наружу: занос вправо → кузов наклонён влево (roll < 0 в конвенции physics)
    const { log } = scenarioMain(0);
    const early = log.filter((s) => s.t < 0.25);
    expect(Math.min(...early.map((s) => s.roll)) * DEG).toBeLessThan(-2);
  });

  it('потеря скорости на входе умеренна: ≤ 12% за 0.5 с', () => {
    for (let i = 0; i < M.length; i++) expect(M[i].lossHalf, IDS[i]).toBeLessThanOrEqual(0.12);
  });

  it('выход: после отпускания руля и газа |угол| < 5° за ≤ 0.5 с, без «маятника»', () => {
    for (let i = 0; i < M.length; i++) {
      expect(M[i].alignTime, IDS[i]).toBeLessThanOrEqual(0.5);
      expect(M[i].wrongSide * DEG, IDS[i]).toBeLessThan(2);
    }
  });

  it('время в заносе на руле 0.35 без Space: Grizzly ≥ 2.5 с, Photon ≤ 1.2 с, Razor между', () => {
    const [razor, grizzly, photon] = M.map((m) => m.holdTime);
    expect(grizzly).toBeGreaterThanOrEqual(2.5);
    expect(photon).toBeLessThanOrEqual(1.2);
    expect(razor).toBeGreaterThan(photon);
    expect(razor).toBeLessThan(grizzly);
  });

  it('клавиатура: на полном руле 1.0 + газ без Space Photon ≈ 1.2–1.8 с, Razor ≈ 3–4.5 с, Grizzly ≥ 8 с', () => {
    const [razor, grizzly, photon] = M.map((m) => m.holdTimeFull);
    expect(photon).toBeGreaterThanOrEqual(1.2);
    expect(photon).toBeLessThanOrEqual(1.8);
    expect(razor).toBeGreaterThanOrEqual(3);
    expect(razor).toBeLessThanOrEqual(4.5);
    expect(grizzly).toBeGreaterThanOrEqual(8);
  });

  it('со Space занос держится независимо от машины (самовыравнивание не действует)', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      const car = accelerated(i);
      for (let k = 0; k < Math.round(0.3 / DT); k++) car.step(DT, ctl({ throttle: 1, steer: PRE_STEER }));
      for (let k = 0; k < Math.round(5 / DT); k++) car.step(DT, ctl({ throttle: 1, steer: 1, handbrake: true }));
      expect(car.state.drifting, IDS[i]).toBe(true);
    }
  });
});
