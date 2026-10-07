import { afterEach, describe, expect, it } from 'vitest';
import { MathUtils } from 'three';
import { Track, createSample } from '../../src/world/track';
import { SUNSET_LOOP } from '../../src/world/trackData';
import type { ControlPoint } from '../../src/world/trackData';
import { VehiclePhysics } from '../../src/vehicle/physics';
import { CAR_SPECS } from '../../src/vehicle/specs';
import { applyCustomHandling, getHandling, resetHandling, steerAngleAt, steerForCurvature } from '../../src/vehicle/handling';
import type { HandlingConfig } from '../../src/vehicle/handling';
import { CUSTOM_CAR_ID } from '../../src/core/types';
import type { CarSpec, CustomBuild, VehicleControls } from '../../src/core/types';

/**
 * Баланс машин: «умелый водитель» проезжает 2 круга Sunset Loop на каждой машине (заводские Razor / Grizzly /
 * Photon, «своя сборка» по умолчанию и крайние сборки). Времена круга заводских машин и сборки по умолчанию
 * должны отличаться от среднего не более чем на 2.5%, крайних сборок — не более чем на 4%. Таблица печатается
 * в консоль: время круга, макс. скорость, доля времени в заносе, суммарное время буста, круг без заносов.
 *
 * Водитель одинаков для всех машин и «знает» свою машину: предел GRIP берёт из конфига, боковое ускорение
 * заноса измеряет на ровной площадке. Идеальная линия (внутрь поворота), торможение по кривизне впереди,
 * нитро на прямых; в крутых поворотах уходит в занос ручником, если ему это выгодно. Стратегию он подбирает
 * под машину по быстрому лётному кругу: смелость в заносе и список поворотов, где дрифтить (жадный поиск;
 * касание стены штрафуется — чистая езда предпочтительнее).
 */

const DT = 1 / 120;
const G = 9.81;
const track = new Track(SUNSET_LOOP);
const smp = createSample();

const COLORS = { bodyColor: 0, neonColor: 0 };
const mk = (speed: number, handling: number, drift: number): CustomBuild => ({ speed, handling, drift, ...COLORS });
const DEFAULT_BUILD = mk(0.6, 0.6, 0.6);

function ctl(o: Partial<VehicleControls> = {}): VehicleControls {
  return { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, ...o };
}

/** Огромное кольцо с широкой дорогой — «бесконечная» ровная площадка */
const widePts: ControlPoint[] = [];
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * Math.PI * 2;
  widePts.push([Math.cos(a) * 4000, 0, Math.sin(a) * 4000]);
}
const wide = new Track({ name: 'wide', points: widePts, defaultHalfWidth: 1500, checkpointCount: 8 });

// ─── Знание машины: боковое ускорение заноса ───────────────────────────────

/** Боковое ускорение пути в установившемся заносе (Space + полный руль) на скорости v, м/с² */
function measureDriftLat(spec: CarSpec, v: number): number {
  const car = new VehiclePhysics(spec, wide);
  const sm = wide.sampleAt(300);
  const h = Math.atan2(sm.tangent.x, sm.tangent.z);
  car.reset(sm.position, h, 300);
  car.state.velocity.set(Math.sin(h) * v, 0, Math.cos(h) * v);
  car.state.speed = v;
  const st = car.state;
  let psiPrev = h;
  let turned = 0;
  let sumV = 0;
  let n = 0;
  for (let k = 1; k <= 180; k++) {
    car.step(DT, ctl({ throttle: 1, steer: 1, handbrake: true }));
    const psi = Math.atan2(st.velocity.x, st.velocity.z);
    let d = psi - psiPrev;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    psiPrev = psi;
    if (k > 90) {
      turned += Math.abs(d);
      sumV += Math.hypot(st.velocity.x, st.velocity.z);
      n++;
    }
  }
  return (sumV / n) * (turned / (n * DT));
}

type DriftKnowledge = { v: number[]; a: number[] };

function learnDrift(spec: CarSpec): DriftKnowledge {
  const v = [25, 35, 45, 55, 65];
  return { v, a: v.map((x) => measureDriftLat(spec, x)) };
}

function driftLatAt(k: DriftKnowledge, v: number): number {
  const { v: vs, a } = k;
  if (v <= vs[0]) return a[0];
  for (let i = 1; i < vs.length; i++) {
    if (v <= vs[i]) return a[i - 1] + ((a[i] - a[i - 1]) * (v - vs[i - 1])) / (vs[i] - vs[i - 1]);
  }
  return a[a.length - 1];
}

// ─── Умелый водитель ───────────────────────────────────────────────────────

/** Доля предела сцепления, которую водитель использует в поворотах на GRIP */
const GRIP_USE = 0.96;
/** Варианты «смелости» в заносе: во сколько раз водитель доверяет измеренному боковому ускорению заноса */
const DRIFT_USES = [1.0, 1.2, 1.4, 1.6];
/** Поворот — участок с кривизной > этого значения (R < 91 м) */
const CORNER_K = 0.011;
/** Занос включается за столько метров до начала поворота */
const DRIFT_LEAD = 12;
/** Занос отпускается за столько метров до конца поворота (машина успевает выровняться) */
const DRIFT_EXIT = 20;
/** Штраф за касание стены при выборе стратегии, с */
const WALL_PENALTY = 0.3;

/** Знак кривизны правого поворота (в physics руль +1 = вправо) */
const RIGHT_SIGN = Math.sign(track.curvatureAt(600));

type Corner = { s0: number; s1: number; peak: number; dir: number };

/** Повороты трассы (по кривизне), которые водитель может проходить заносом */
function findCorners(): Corner[] {
  const out: Corner[] = [];
  let cur: Corner | null = null;
  let gap = 0;
  for (let s = 0; s < track.length; s += 2) {
    const k = track.curvatureAt(s);
    if (Math.abs(k) > CORNER_K) {
      if (!cur) cur = { s0: s, s1: s, peak: 0, dir: Math.sign(k) * RIGHT_SIGN };
      cur.s1 = s;
      gap = 0;
      if (Math.abs(k) > cur.peak) cur.peak = Math.abs(k);
    } else if (cur) {
      gap += 2;
      if (gap > 20) {
        out.push(cur);
        cur = null;
      }
    }
  }
  if (cur) out.push(cur);
  // только достаточно длинные повороты: короткие изгибы занос не окупает
  return out.filter((c) => c.s1 - c.s0 >= 40);
}

const CORNERS = findCorners();

class SkilledDriver {
  inDrift = false;
  nitroLatch = false;
  private readonly c: VehicleControls = ctl();

  /** plan[i] — дрифтить ли в i-м повороте */
  constructor(
    private readonly car: VehiclePhysics,
    private readonly cfg: HandlingConfig,
    private readonly know: DriftKnowledge,
    private readonly plan: boolean[],
    private readonly driftUse: number,
  ) {}

  /** Номер планового поворота, в зоне заноса которого лежит s (−1 — нет) */
  private zoneAt(sx: number): number {
    const w = track.wrapS(sx);
    for (let i = 0; i < CORNERS.length; i++) {
      if (this.plan[i] && w >= CORNERS[i].s0 - DRIFT_LEAD && w <= CORNERS[i].s1 - DRIFT_EXIT) return i;
    }
    return -1;
  }

  /** Смещение линии (м, + вправо): внутрь поворота, снаружи на входе */
  private lineOffset(sp: number, hw: number): number {
    const k0 = track.curvatureAt(sp);
    const k1 = track.curvatureAt(sp + 25);
    const k2 = track.curvatureAt(sp + 60);
    const kIn = Math.abs(k0) > Math.abs(k1) ? k0 : k1;
    const insideFrac = MathUtils.clamp(Math.abs(kIn) * 55, 0, 1);
    const inside = Math.sign(kIn) * insideFrac * 0.72;
    const kOut = Math.abs(k2) > Math.abs(kIn) * 1.3 ? k2 : 0;
    const outFrac = MathUtils.clamp(Math.abs(kOut) * 55, 0, 1) * (1 - insideFrac);
    const outside = -Math.sign(kOut) * outFrac * 0.6;
    const usable = hw - 3.2;
    return MathUtils.clamp((inside + outside) * usable, -usable, usable);
  }

  update(): VehicleControls {
    const car = this.car;
    const cfg = this.cfg;
    const st = car.state;
    const c = this.c;
    const V = Math.hypot(st.velocity.x, st.velocity.z);
    const v = Math.max(st.speed, 0);
    const s = st.trackS;
    const hw = track.sampleAt(s, smp).halfWidth;

    let kFar = 0;
    for (let d = 0; d <= 150; d += 10) kFar = Math.max(kFar, Math.abs(track.curvatureAt(s + d)));

    // занос: только в плановых поворотах и если хватает скорости
    const z = this.zoneAt(s);
    this.inDrift = z >= 0 && V > cfg.driftMinSpeed + 4;
    const dir = z >= 0 ? CORNERS[z].dir : 0;

    // руль
    if (this.inDrift) {
      const L = 10 + 0.35 * V;
      const tp = track.sampleAt(s + L, smp);
      const dx = tp.position.x - st.position.x;
      const dz = tp.position.z - st.position.z;
      let err = Math.atan2(st.velocity.x, st.velocity.z) - Math.atan2(dx, dz);
      while (err > Math.PI) err -= 2 * Math.PI;
      while (err < -Math.PI) err += 2 * Math.PI;
      c.steer = dir * MathUtils.clamp(0.45 + 2 * dir * err - 0.05 * dir * st.lateral, 0.2, 1);
    } else {
      const sp = s + 8 + 0.5 * v;
      const t = track.sampleAt(sp, smp);
      const off = this.lineOffset(sp, t.halfWidth);
      const tx = t.position.x + t.right.x * off;
      const tz = t.position.z + t.right.z * off;
      const dx = tx - st.position.x;
      const dz = tz - st.position.z;
      const along = dx * Math.sin(st.heading) + dz * Math.cos(st.heading);
      const left = dx * Math.cos(st.heading) - dz * Math.sin(st.heading);
      const kappa = (2 * Math.sin(Math.atan2(left, along))) / Math.max(4, Math.hypot(dx, dz));
      c.steer = MathUtils.clamp(-steerForCurvature(cfg, v, kappa) / steerAngleAt(cfg, v), -1, 1);
    }
    c.handbrake = this.inDrift;
    // выход из заноса: нейтральный руль и сброс газа, пока кузов не выровняется (иначе занос держится рулём)
    const exiting = !this.inDrift && Math.abs(st.driftAngle) > 0.1 && v > 5 && car.driftMode;
    if (exiting) c.steer = -Math.sign(st.driftAngle) * 0.1;

    // скорость: предел по кривизне вперёд (в плановых заносах — по боковому ускорению заноса)
    const aGrip = cfg.grip * G * GRIP_USE * 1.08;
    let vT = cfg.maxSpeed * 1.01;
    for (let d = 0; d <= 150; d += 6) {
      const k = Math.abs(track.curvatureAt(s + d));
      const o = this.lineOffset(s + d, hw);
      const kEff = k / Math.max(0.5, 1 - track.curvatureAt(s + d) * o);
      let vLim = Math.sqrt(aGrip / Math.max(kEff, 1e-4));
      if (this.zoneAt(s + d) >= 0) {
        // боковое ускорение заноса зависит от скорости: ищем скорость, при которой оно держит поворот
        vLim = 30;
        for (let it = 0; it < 4; it++) vLim = Math.sqrt((driftLatAt(this.know, vLim) * this.driftUse) / Math.max(kEff, 1e-4));
      }
      vT = Math.min(vT, Math.sqrt(vLim * vLim + 2 * cfg.brakeDecel * 0.62 * d));
    }
    // в заносе продольная скорость сильно меньше модуля скорости: сравниваем модуль
    const excess = (car.driftMode ? V : v) - vT;
    c.brake = excess > 0.6 ? MathUtils.clamp(excess / 3, 0, 1) : 0;
    c.throttle = excess > 0.6 ? 0 : MathUtils.clamp(0.5 - excess * 0.5, 0, 1);
    if (exiting) {
      c.throttle = Math.min(c.throttle, 0.1);
      c.brake = 0;
    }
    // в заносе угол держится газом: газ не бросаем, если не тормозим
    if (this.inDrift && c.brake === 0) c.throttle = Math.max(c.throttle, 0.45);

    // нитро на прямых
    if (!this.nitroLatch) {
      if (st.nitro > 0.25 && kFar < 0.004 && v > 25 && c.throttle > 0.9 && !this.inDrift) this.nitroLatch = true;
    } else if (st.nitro < 0.03 || kFar > 0.006 || c.throttle < 0.5) {
      this.nitroLatch = false;
    }
    c.nitro = this.nitroLatch;
    return c;
  }
}

// ─── Симуляция гонки ───────────────────────────────────────────────────────

type LapResult = {
  label: string;
  laps: number[];
  /** время последнего (лётного) круга, с */
  lap: number;
  maxSpeed: number;
  driftShare: number;
  boostTime: number;
  boostPeak: number;
  walls: number;
  respawns: number;
  plan: boolean[];
  driftUse: number;
  /** время последнего круга, если не дрифтить вообще (только GRIP) */
  gripLap?: number;
};

/** Лётный старт (за 100 м до линии на 35 м/с — для быстрого поиска стратегии) или стоячий старт с решётки */
function simulate(
  label: string,
  spec: CarSpec,
  cfg: HandlingConfig,
  know: DriftKnowledge,
  plan: boolean[],
  driftUse: number,
  laps: number,
  flying: boolean,
): LapResult {
  const car = new VehiclePhysics(spec, track);
  if (flying) {
    const s0 = track.length - 100;
    const p = track.sampleAt(s0);
    const h = Math.atan2(p.tangent.x, p.tangent.z);
    car.reset(p.position, h, s0);
    car.state.velocity.set(Math.sin(h) * 35, 0, Math.cos(h) * 35);
    car.state.speed = 35;
  } else {
    const g = track.gridPose(0);
    car.reset(g.position, g.heading, g.s);
  }
  const driver = new SkilledDriver(car, cfg, know, plan, driftUse);
  const st = car.state;
  const res: LapResult = {
    label,
    laps: [],
    lap: 0,
    maxSpeed: 0,
    driftShare: 0,
    boostTime: 0,
    boostPeak: 0,
    walls: 0,
    respawns: 0,
    plan,
    driftUse,
  };
  let t = 0;
  let dist = 0;
  let prevS = st.trackS;
  let driftSteps = 0;
  let boostSteps = 0;
  let lapStart = 0;
  const total = laps * track.length;
  while (dist < total && t < 400) {
    car.step(DT, driver.update());
    t += DT;
    const d = track.deltaS(prevS, st.trackS);
    prevS = st.trackS;
    if (Math.abs(d) < 50) dist += d;
    const Vv = Math.hypot(st.velocity.x, st.velocity.z);
    if (Vv > res.maxSpeed) res.maxSpeed = Vv;
    if (st.drifting) driftSteps++;
    if (st.boostTime > 0) {
      boostSteps++;
      if (st.boostPower > res.boostPeak) res.boostPeak = st.boostPower;
    }
    for (const e of car.events) if (e.type === 'wall') res.walls++;
    if (car.needsRespawn) {
      res.respawns++;
      const q = track.sampleAt(st.trackS);
      const hh = Math.atan2(q.tangent.x, q.tangent.z);
      car.reset(q.position, hh, st.trackS);
      st.velocity.set(Math.sin(hh) * 25, 0, Math.cos(hh) * 25);
      st.speed = 25;
      car.needsRespawn = false;
    }
    if (dist >= (res.laps.length + 1) * track.length) {
      res.laps.push(t - lapStart);
      lapStart = t;
    }
  }
  res.lap = res.laps.length === laps ? res.laps[laps - 1] : Infinity;
  res.driftShare = driftSteps / Math.max(1, Math.round(t / DT));
  res.boostTime = boostSteps * DT;
  return res;
}

/** Стратегия под машину: смелость в заносе, затем в каких поворотах дрифтить (жадно по лётному кругу) */
function chooseStrategy(spec: CarSpec, cfg: HandlingConfig, know: DriftKnowledge): { plan: boolean[]; driftUse: number } {
  const score = (plan: boolean[], du: number): number => {
    const r = simulate('plan', spec, cfg, know, plan, du, 1, true);
    return r.lap + WALL_PENALTY * r.walls + 20 * r.respawns;
  };
  let plan = CORNERS.map(() => true);
  let driftUse = DRIFT_USES[0];
  let best = Infinity;
  for (const du of DRIFT_USES) {
    const sc = score(plan, du);
    if (sc < best) {
      best = sc;
      driftUse = du;
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    for (let i = 0; i < CORNERS.length; i++) {
      const trial = plan.slice();
      trial[i] = !trial[i];
      const sc = score(trial, driftUse);
      if (sc < best - 0.05) {
        best = sc;
        plan = trial;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { plan, driftUse };
}

const customSpec: CarSpec = { ...(CAR_SPECS.find((c) => c.id === CUSTOM_CAR_ID) as CarSpec), id: CUSTOM_CAR_ID };

function run(label: string, spec: CarSpec, cfg: HandlingConfig, withGrip: boolean): LapResult {
  const know = learnDrift(spec);
  const { plan, driftUse } = chooseStrategy(spec, cfg, know);
  const r = simulate(label, spec, cfg, know, plan, driftUse, 2, false);
  if (withGrip) r.gripLap = simulate(label, spec, cfg, know, CORNERS.map(() => false), 1, 2, false).lap;
  return r;
}

function runCar(id: string): LapResult {
  return run(id, CAR_SPECS.find((c) => c.id === id) as CarSpec, getHandling(id), true);
}

function runBuild(name: string, b: CustomBuild, withGrip = false): LapResult {
  applyCustomHandling(b);
  return run(name, customSpec, getHandling(CUSTOM_CAR_ID), withGrip);
}

afterEach(() => {
  resetHandling();
  applyCustomHandling(DEFAULT_BUILD);
});

function table(rows: LapResult[], mean: number): string {
  const head =
    'машина             | круг 1, с | круг 2, с | Δ от среднего | Vmax, м/с | в заносе | буст, с | пик буста | удары | занос в поворотах | смелость | без заносов, с';
  const lines = rows.map((r) =>
    [
      r.label.padEnd(18),
      r.laps[0].toFixed(2).padStart(9),
      r.lap.toFixed(2).padStart(9),
      (((r.lap / mean - 1) * 100).toFixed(2) + '%').padStart(13),
      r.maxSpeed.toFixed(1).padStart(9),
      ((r.driftShare * 100).toFixed(1) + '%').padStart(8),
      r.boostTime.toFixed(1).padStart(7),
      r.boostPeak.toFixed(2).padStart(9),
      String(r.walls).padStart(5),
      r.plan.map((x) => (x ? 'D' : '-')).join('').padEnd(17),
      r.driftUse.toFixed(1).padStart(8),
      r.gripLap === undefined ? '-'.padStart(14) : r.gripLap.toFixed(2).padStart(14),
    ].join(' | '),
  );
  return [head, ...lines].join('\n');
}

describe('баланс: умелый водитель на Sunset Loop', () => {
  // таблица считается один раз на весь файл (тесты ниже используют её результаты)
  const factory = new Map<string, LapResult>();
  let def: LapResult;
  let extremes: LapResult[] = [];
  let mean = 0;
  const main = (): LapResult[] => [...factory.values(), def];
  const dev = (r: LapResult): number => Math.abs(r.lap / mean - 1);

  it('таблица времён круга: заводские машины, сборка по умолчанию, крайние сборки', () => {
    for (const id of ['razor', 'grizzly', 'photon', 'volt', 'nightshade']) factory.set(id, runCar(id));
    def = runBuild('custom 0.6/0.6/0.6', DEFAULT_BUILD, true);
    extremes = [
      runBuild('custom 1/1/0', mk(1, 1, 0)),
      runBuild('custom 1/0/1', mk(1, 0, 1)),
      runBuild('custom 0/1/1', mk(0, 1, 1)),
      runBuild('custom .5/1/.5', mk(0.5, 1, 0.5)),
      runBuild('custom .67 x3', mk(2 / 3, 2 / 3, 2 / 3)),
    ];
    mean = main().reduce((a, r) => a + r.lap, 0) / main().length;
    console.log(
      `\nБАЛАНС (круг 2 — лётный; среднее заводских + сборки по умолчанию = ${mean.toFixed(2)} с)\n` + table([...main(), ...extremes], mean),
    );
    for (const r of [...main(), ...extremes]) {
      expect(r.laps.length, `${r.label}: 2 круга`).toBe(2);
      expect(r.respawns, `${r.label}: респауны`).toBe(0);
      expect(Number.isFinite(r.lap), r.label).toBe(true);
    }
  }, 120000);

  it('заводские машины и сборка по умолчанию: время круга в пределах 2.5% от среднего', () => {
    for (const r of main()) expect(dev(r), `${r.label}: ${r.lap.toFixed(2)} с при среднем ${mean.toFixed(2)} с`).toBeLessThanOrEqual(0.025);
  });

  it('крайние сборки (два слайдера на максимум / всё поровну): время круга в пределах 4% от среднего', () => {
    for (const r of extremes) expect(dev(r), `${r.label}: ${r.lap.toFixed(2)} с при среднем ${mean.toFixed(2)} с`).toBeLessThanOrEqual(0.04);
  });

  it('выиграть можно на любой машине: разброс между самой быстрой и самой медленной ≤ 4.5%, самая цепкая сборка не обгоняет всех', () => {
    const laps = main().map((r) => r.lap);
    expect(Math.max(...laps) / Math.min(...laps) - 1).toBeLessThanOrEqual(0.045);
    // Управляемость = 1 + скорость = 1 (клон Photon) не быстрее Photon больше чем на 1%: цена за сцепление работает
    const photon = factory.get('photon') as LapResult;
    const clone = extremes.find((e) => e.label === 'custom 1/1/0') as LapResult;
    expect(clone.lap).toBeGreaterThanOrEqual(photon.lap * 0.99);
  });

  it('характер: Photon быстрее на максималке, Grizzly получает самый большой буст, Photon — самый слабый; занос везде окупается', () => {
    const razor = factory.get('razor') as LapResult;
    const grizzly = factory.get('grizzly') as LapResult;
    const photon = factory.get('photon') as LapResult;
    expect(photon.maxSpeed).toBeGreaterThan(grizzly.maxSpeed);
    expect(grizzly.maxSpeed).toBeGreaterThan(razor.maxSpeed);
    // буст: Grizzly > Razor > Photon и по суммарному времени, и по пику
    expect(grizzly.boostTime).toBeGreaterThan(razor.boostTime);
    expect(razor.boostTime).toBeGreaterThan(photon.boostTime);
    expect(grizzly.boostPeak).toBeGreaterThan(razor.boostPeak);
    expect(razor.boostPeak).toBeGreaterThan(photon.boostPeak);
    // занос (с бустом) быстрее езды только на сцеплении, и сильнее всего выигрывает Grizzly
    const gain = (r: LapResult): number => (r.gripLap as number) / r.lap - 1;
    for (const r of [razor, grizzly, photon]) expect(gain(r), r.label).toBeGreaterThan(0.03);
    expect(gain(grizzly)).toBeGreaterThan(gain(razor));
    expect(gain(razor)).toBeGreaterThan(gain(photon));
  });

  it('новые машины: Volt — лучший разгон/руль и быстрый заряд нитро с коротким мощным бустом, Nightshade — высочайшая максималка, самая тяжёлая и инертная; круг в пределах ±4% от среднего', () => {
    const volt = factory.get('volt') as LapResult;
    const night = factory.get('nightshade') as LapResult;
    expect(dev(volt)).toBeLessThanOrEqual(0.04);
    expect(dev(night)).toBeLessThanOrEqual(0.04);
    const others = ['razor', 'grizzly', 'photon'].map((id) => getHandling(id));
    const hv = getHandling('volt');
    const hn = getHandling('nightshade');
    for (const o of others) {
      expect(hv.acceleration).toBeGreaterThan(o.acceleration);
      expect(hv.steerRate).toBeGreaterThan(o.steerRate);
      expect(hv.yawResponse).toBeGreaterThan(o.yawResponse);
      expect(hv.driftChargeRate).toBeGreaterThanOrEqual(o.driftChargeRate);
      expect(hv.mass).toBeLessThan(o.mass);
      expect(hn.maxSpeed).toBeGreaterThan(o.maxSpeed);
      expect(hn.acceleration).toBeLessThan(o.acceleration);
      expect(hn.mass).toBeGreaterThan(o.mass);
      expect(hn.steerRate).toBeLessThan(o.steerRate);
      expect(hn.driftAngleRate).toBeLessThan(o.driftAngleRate);
    }
    // средняя максималка Volt; буст короче, чем у Razor и Grizzly, но мощнее, чем у Nightshade
    expect(hv.maxSpeed).toBeGreaterThan(getHandling('razor').maxSpeed - 2);
    expect(hv.maxSpeed).toBeLessThan(getHandling('grizzly').maxSpeed);
    expect(hv.boostDuration).toBeLessThan(getHandling('razor').boostDuration);
    expect(hv.boostPower).toBeGreaterThan(hn.boostPower);
    expect(volt.maxSpeed).toBeLessThan(night.maxSpeed);
  });

  it('детерминизм: два одинаковых прогона дают одно и то же время круга', () => {
    const spec = CAR_SPECS.find((c) => c.id === 'razor') as CarSpec;
    const cfg = getHandling('razor');
    const plan = CORNERS.map(() => true);
    const know = learnDrift(spec);
    const a = simulate('a', spec, cfg, know, plan, 1.2, 1, true);
    const b = simulate('b', spec, cfg, know, plan, 1.2, 1, true);
    expect(b.lap).toBe(a.lap);
    expect(b.boostTime).toBe(a.boostTime);
  });
});
