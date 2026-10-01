import { afterEach, describe, expect, it } from 'vitest';
import { MathUtils } from 'three';
import { Track, createSample } from '../../src/world/track';
import { SUNSET_LOOP } from '../../src/world/trackData';
import type { ControlPoint } from '../../src/world/trackData';
import { VehiclePhysics } from '../../src/vehicle/physics';
import { CAR_SPECS } from '../../src/vehicle/specs';
import {
  CUSTOM_BUDGET,
  HANDLING,
  HANDLING_DEFAULTS,
  HANDLING_PARAMS,
  applyCustomHandling,
  customHandling,
  customStats,
  getHandling,
  normalizeBuild,
  resetHandling,
  steerAngleAt,
  steerForCurvature,
} from '../../src/vehicle/handling';
import type { HandlingConfig } from '../../src/vehicle/handling';
import { CUSTOM_CAR_ID } from '../../src/core/types';
import type { CustomBuild, VehicleControls } from '../../src/core/types';

const DT = 1 / 120;
const G = 9.81;
const DEG = Math.PI / 180;
const track = new Track(SUNSET_LOOP);

/** Огромное кольцо с широкой дорогой — «бесконечная» ровная площадка */
const widePts: ControlPoint[] = [];
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * Math.PI * 2;
  widePts.push([Math.cos(a) * 4000, 0, Math.sin(a) * 4000]);
}
const wide = new Track({ name: 'wide', points: widePts, defaultHalfWidth: 1500, checkpointCount: 8 });

const CUSTOM_SPEC = { ...CAR_SPECS[0], id: CUSTOM_CAR_ID, name: 'Custom' };
const COLORS = { bodyColor: 0x123456, neonColor: 0xabcdef };
const DEFAULT: CustomBuild = { speed: 0.6, handling: 0.6, drift: 0.6, ...COLORS };

function mk(speed: number, handling: number, drift: number): CustomBuild {
  return { speed, handling, drift, ...COLORS };
}

function ctl(o: Partial<VehicleControls> = {}): VehicleControls {
  return { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, ...o };
}

function makeCar(tr: Track, s: number, speed = 0): VehiclePhysics {
  const car = new VehiclePhysics(CUSTOM_SPEC, tr);
  const smp = tr.sampleAt(s);
  const h = Math.atan2(smp.tangent.x, smp.tangent.z);
  car.reset(smp.position, h, s);
  car.state.velocity.x = Math.sin(h) * speed;
  car.state.velocity.z = Math.cos(h) * speed;
  return car;
}

function run(car: VehiclePhysics, seconds: number, fn: (t: number) => VehicleControls, each?: (t: number) => void): void {
  const n = Math.round(seconds / DT);
  for (let k = 0; k < n; k++) {
    const t = k * DT;
    car.step(DT, fn(t));
    if (each) each(t);
  }
}

afterEach(() => {
  resetHandling();
  applyCustomHandling(DEFAULT);
});

// ─── Набор сборок: ~30 случайных (seed) + крайние ──────────────────────────

let seed = 20260930;
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

const BUILDS: CustomBuild[] = [mk(0, 0, 0), mk(1, 1, 0), mk(1, 0, 1), mk(0, 1, 1), mk(1, 1, 1)];
for (let i = 0; i < 30; i++) BUILDS.push(mk(rnd(), rnd(), rnd()));

function label(b: CustomBuild): string {
  return `(${b.speed.toFixed(2)}, ${b.handling.toFixed(2)}, ${b.drift.toFixed(2)})`;
}

// ─── normalizeBuild / customStats ──────────────────────────────────────────

describe('normalizeBuild: бюджет и границы', () => {
  it('сумма ≤ CUSTOM_BUDGET, слайдеры в [0,1], пропорции сохраняются, цвета не трогаются', () => {
    expect(CUSTOM_BUDGET).toBe(2);
    const n = normalizeBuild(mk(1, 1, 1));
    expect(n.speed + n.handling + n.drift).toBeCloseTo(CUSTOM_BUDGET, 9);
    expect(n.speed).toBeCloseTo(2 / 3, 9);
    expect(n.bodyColor).toBe(COLORS.bodyColor);
    expect(n.neonColor).toBe(COLORS.neonColor);
    const m = normalizeBuild(mk(1, 0.5, 1));
    expect(m.speed + m.handling + m.drift).toBeCloseTo(CUSTOM_BUDGET, 9);
    expect(m.speed / m.handling).toBeCloseTo(2, 9);
    // в пределах бюджета — без изменений
    const k = normalizeBuild(mk(0.6, 0.6, 0.6));
    expect([k.speed, k.handling, k.drift]).toEqual([0.6, 0.6, 0.6]);
    const z = normalizeBuild(mk(1, 1, 0));
    expect([z.speed, z.handling, z.drift]).toEqual([1, 1, 0]);
  });

  it('NaN → 0.5, выход за границы зажимается, Infinity тоже', () => {
    const a = normalizeBuild(mk(NaN, NaN, NaN));
    expect([a.speed, a.handling, a.drift]).toEqual([0.5, 0.5, 0.5]);
    const b = normalizeBuild(mk(-3, 0.3, 0));
    expect([b.speed, b.handling, b.drift]).toEqual([0, 0.3, 0]);
    const c = normalizeBuild(mk(5, -Infinity, 0.5));
    expect(c.speed).toBeCloseTo(1, 9);
    expect(c.handling).toBe(0);
    expect(c.drift).toBeCloseTo(0.5, 9);
    // 5 → 1, +0.5 = 1.5 ≤ бюджета
    const d = normalizeBuild(mk(Infinity, Infinity, Infinity));
    expect(d.speed + d.handling + d.drift).toBeCloseTo(CUSTOM_BUDGET, 9);
  });

  it('не мутирует вход; результат идемпотентен', () => {
    const src = mk(1, 1, 1);
    const n = normalizeBuild(src);
    expect(src.speed).toBe(1);
    const n2 = normalizeBuild(n);
    expect(n2.speed).toBeCloseTo(n.speed, 12);
    expect(n2.handling).toBeCloseTo(n.handling, 12);
  });

  it('customStats: 0..1, монотонно растёт со своим слайдером, масштаб как у заводских stats', () => {
    for (const b of BUILDS) {
      const st = customStats(b);
      for (const v of [st.speed, st.handling, st.drift]) {
        expect(v, label(b)).toBeGreaterThanOrEqual(0);
        expect(v, label(b)).toBeLessThanOrEqual(1);
      }
    }
    let prev = customStats(mk(0, 0.5, 0.5));
    for (let x = 0.1; x <= 1.0001; x += 0.1) {
      const a = customStats(mk(x, 0.2, 0.2));
      const b = customStats(mk(0.2, x, 0.2));
      const c = customStats(mk(0.2, 0.2, x));
      expect(a.speed).toBeGreaterThan(prev.speed - 1e-9);
      prev = a;
      expect(b.handling).toBeGreaterThan(customStats(mk(0.2, x - 0.1, 0.2)).handling);
      expect(c.drift).toBeGreaterThan(customStats(mk(0.2, 0.2, x - 0.1)).drift);
    }
    // всё на максимум не выше самых сильных заводских полосок
    const top = customStats(mk(1, 0, 0));
    expect(top.speed).toBeCloseTo(0.95, 9);
    expect(customStats(mk(0, 1, 0)).handling).toBeCloseTo(0.85, 9);
    expect(customStats(mk(0, 0, 1)).drift).toBeCloseTo(0.95, 9);
    // дрифт: 0 ≈ Photon, 0.5 ≈ Razor, 1 ≈ Grizzly
    expect(customStats(mk(0, 0, 0)).drift).toBeCloseTo(CAR_SPECS[2].stats.drift, 9);
    expect(customStats(mk(0, 0, 0.5)).drift).toBeCloseTo(CAR_SPECS[0].stats.drift, 9);
    // без нормализации «всё на максимум» даёт 2/3, а не 1
    const all = customStats(mk(1, 1, 1));
    expect(all.speed).toBeCloseTo(0.5 + 0.45 * (2 / 3), 9);
  });
});

// ─── customHandling / applyCustomHandling ──────────────────────────────────

describe('customHandling: безопасные диапазоны', () => {
  it('чистая функция: одинаковый вход — одинаковый результат, новые объекты', () => {
    const a = customHandling(DEFAULT);
    const b = customHandling({ ...DEFAULT });
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('все ключи есть (как у Razor), значения конечны и в пределах min..max панели тюнинга, для всех сборок', () => {
    const keys = Object.keys(HANDLING.razor).sort();
    for (const b of [...BUILDS, mk(NaN, -1, 9), mk(9, 9, 9)]) {
      const cfg = customHandling(b);
      expect(Object.keys(cfg).sort(), label(b)).toEqual(keys);
      for (const p of HANDLING_PARAMS) {
        const v = cfg[p.key as keyof HandlingConfig];
        expect(Number.isFinite(v), `${label(b)} ${p.key}`).toBe(true);
        expect(v, `${label(b)} ${p.key}`).toBeGreaterThanOrEqual(p.min);
        expect(v, `${label(b)} ${p.key}`).toBeLessThanOrEqual(p.max);
      }
    }
  });

  it('основные числа не выходят за заводской разброс (± небольшой запас)', () => {
    const f = [HANDLING_DEFAULTS.razor, HANDLING_DEFAULTS.grizzly, HANDLING_DEFAULTS.photon];
    const margin: Partial<Record<keyof HandlingConfig, number>> = {
      maxSpeed: 7, // медленнее Razor не более чем на 6 м/с
      acceleration: 0.8,
      grip: 0.15,
      steerRate: 0.5,
      yawResponse: 1.5,
      driftMaxAngle: 0,
      driftMinSpeed: 0,
      driftChargeRate: 0,
      driftGrip: 0,
    };
    for (const b of BUILDS) {
      const cfg = customHandling(b);
      for (const [k, m] of Object.entries(margin) as [keyof HandlingConfig, number][]) {
        const vals = f.map((x) => x[k]);
        expect(cfg[k], `${label(b)} ${k}`).toBeGreaterThanOrEqual(Math.min(...vals) - m - 1e-9);
        expect(cfg[k], `${label(b)} ${k}`).toBeLessThanOrEqual(Math.max(...vals) + m + 1e-9);
      }
      // «всё на максимум» не даёт машину сильнее Photon по скорости и сцеплению
      expect(cfg.maxSpeed).toBeLessThanOrEqual(HANDLING_DEFAULTS.photon.maxSpeed);
      expect(cfg.grip).toBeLessThanOrEqual(HANDLING_DEFAULTS.photon.grip);
    }
  });

  it('слайдеры действуют в нужную сторону', () => {
    const base = customHandling(mk(0.4, 0.4, 0.4));
    const fast = customHandling(mk(0.8, 0.4, 0.4));
    expect(fast.maxSpeed).toBeGreaterThan(base.maxSpeed);
    expect(fast.acceleration).toBeGreaterThan(base.acceleration);
    expect(fast.nitroBoost).toBeGreaterThan(base.nitroBoost);
    expect(fast.mass).toBeGreaterThan(base.mass);
    expect(fast.steerRate).toBeLessThan(base.steerRate); // цена скорости
    expect(fast.yawResponse).toBeLessThan(base.yawResponse);
    const agile = customHandling(mk(0.4, 0.8, 0.4));
    expect(agile.grip).toBeGreaterThan(base.grip);
    expect(agile.steerRate).toBeGreaterThan(base.steerRate);
    expect(agile.yawResponse).toBeGreaterThan(base.yawResponse);
    expect(agile.slipDamping).toBeGreaterThan(base.slipDamping);
    expect(agile.understeer).toBeLessThan(base.understeer);
    const dr = customHandling(mk(0.4, 0.4, 0.8));
    expect(dr.driftMinSpeed).toBeLessThan(base.driftMinSpeed);
    expect(dr.driftBaseAngle).toBeGreaterThan(base.driftBaseAngle);
    expect(dr.driftMaxAngle).toBeGreaterThan(base.driftMaxAngle);
    expect(dr.driftSelfAlign).toBeLessThan(base.driftSelfAlign);
    expect(dr.driftSelfAlignFull).toBeLessThan(base.driftSelfAlignFull);
    expect(dr.driftChargeRate).toBeGreaterThan(base.driftChargeRate);
    expect(dr.driftGrip).toBeLessThan(base.driftGrip);
    // занос на скорости: больше «Дрифт» — сильнее дуга и торможение заносом на скорости
    expect(dr.driftTurnBoost).toBeGreaterThan(base.driftTurnBoost);
    expect(dr.driftSpeedAngleGain).toBeGreaterThanOrEqual(base.driftSpeedAngleGain);
    expect(dr.grip).toBeLessThan(base.grip); // цена дрифта в GRIP
  });

  it('при «Дрифт» = 0 / 0.5 / 1 набор заноса совпадает с Photon / Razor / Grizzly', () => {
    const keys: (keyof HandlingConfig)[] = [
      'driftMinSpeed',
      'driftGrip',
      'driftBaseAngle',
      'driftMaxAngle',
      'driftSelfAlign',
      'driftChargeRate',
      'driftSpeedStart',
      'driftBoostStart',
      'driftBoostFull',
      'driftSpeedAngleGain',
      'driftTurnBoost',
      'driftSpeedScrub',
    ];
    const pairs: [number, HandlingConfig][] = [
      [0, HANDLING_DEFAULTS.photon],
      [0.5, HANDLING_DEFAULTS.razor],
      [1, HANDLING_DEFAULTS.grizzly],
    ];
    for (const [d, anchor] of pairs) {
      const cfg = customHandling(mk(0.5, 0.5, d));
      for (const k of keys) expect(cfg[k], `d=${d} ${k}`).toBeCloseTo(anchor[k], 9);
    }
  });
});

describe('applyCustomHandling: запись в живые объекты', () => {
  it('при импорте HANDLING и HANDLING_DEFAULTS уже содержат custom (дефолтная сборка 0.6/0.6/0.6)', () => {
    expect(HANDLING[CUSTOM_CAR_ID]).toBeDefined();
    expect(HANDLING_DEFAULTS[CUSTOM_CAR_ID]).toBeDefined();
    expect(HANDLING[CUSTOM_CAR_ID]).not.toBe(HANDLING_DEFAULTS[CUSTOM_CAR_ID]);
    expect(HANDLING[CUSTOM_CAR_ID]).toEqual(customHandling(DEFAULT));
    expect(getHandling(CUSTOM_CAR_ID)).toBe(HANDLING[CUSTOM_CAR_ID]);
  });

  it('обновляет объекты на месте (ссылки живы), defaults тоже; resetHandling возвращает текущую сборку', () => {
    const live = HANDLING[CUSTOM_CAR_ID];
    const def = HANDLING_DEFAULTS[CUSTOM_CAR_ID];
    const car = new VehiclePhysics(CUSTOM_SPEC, wide);
    applyCustomHandling(mk(1, 0.2, 0.2));
    expect(HANDLING[CUSTOM_CAR_ID]).toBe(live);
    expect(HANDLING_DEFAULTS[CUSTOM_CAR_ID]).toBe(def);
    expect(live).toEqual(customHandling(mk(1, 0.2, 0.2)));
    expect(def).toEqual(live);
    expect((car as unknown as { cfg: HandlingConfig }).cfg).toBe(live);
    expect(live.maxSpeed).toBeCloseTo(75, 9);
    // правка панелью и сброс
    live.grip = 0.6;
    resetHandling(CUSTOM_CAR_ID);
    expect(live.grip).toBe(def.grip);
    // заводские машины не затронуты
    expect(HANDLING.razor.maxSpeed).toBe(64);
  });
});

// ─── Физика на сборках ─────────────────────────────────────────────────────

describe('сборки в физике: разгон, GRIP без заноса, вход/выход заноса', () => {
  it('разгон до 100 км/ч за 2.5–5 с, для всех сборок', () => {
    for (const b of BUILDS) {
      applyCustomHandling(b);
      const car = makeCar(wide, 300, 0);
      let t = 0;
      while (car.state.speed < 100 / 3.6 && t < 10) {
        car.step(DT, ctl({ throttle: 1 }));
        t += DT;
      }
      expect(t, label(b)).toBeGreaterThanOrEqual(2.5);
      expect(t, label(b)).toBeLessThanOrEqual(5);
    }
  });

  it('GRIP: W + A/D на 20/40/60 м/с без Space — drifting = false, угол мал', () => {
    for (const b of BUILDS) {
      applyCustomHandling(b);
      for (const v of [20, 40, 60]) {
        for (const sign of [1, -1]) {
          const car = makeCar(wide, 300, v);
          let maxAngle = 0;
          let ever = false;
          run(car, 2, () => ctl({ throttle: 1, steer: sign }), () => {
            maxAngle = Math.max(maxAngle, Math.abs(car.state.driftAngle));
            if (car.state.drifting) ever = true;
          });
          const l = `${label(b)} v=${v} steer=${sign}`;
          expect(ever, l).toBe(false);
          expect(maxAngle, l).toBeLessThan(8 * DEG);
        }
      }
    }
  });

  it('Space + руль на 30 м/с — занос есть; после отпускания руля/газа/Space выход < 0.6 с', () => {
    for (const b of BUILDS) {
      applyCustomHandling(b);
      for (const sign of [1, -1]) {
        const car = makeCar(wide, 300, 30);
        run(car, 1.2, (t) => ctl({ throttle: 1, steer: sign, handbrake: t < 0.4 }));
        const l = `${label(b)} steer=${sign}`;
        expect(car.state.drifting, l + ' вход').toBe(true);
        expect(Math.sign(car.state.driftAngle), l).toBe(sign);
        let stillDrifting = false;
        run(car, 0.6, () => ctl(), () => {
          if (car.state.drifting) stillDrifting = true;
        });
        expect(stillDrifting, l + ' выход').toBe(false);
        expect(Math.abs(car.state.driftAngle), l).toBeLessThan(5 * DEG);
      }
    }
  });

  it('заряд нитро в заносе идёт только в DRIFT, и тем быстрее, чем больше «Дрифт»', () => {
    const charge = (b: CustomBuild): number => {
      applyCustomHandling(b);
      const car = makeCar(wide, 300, 32);
      const n0 = car.state.nitro;
      run(car, 1.5, (t) => ctl({ throttle: 1, steer: 1, handbrake: t < 0.4 }));
      return car.state.nitro - n0;
    };
    const lo = charge(mk(0.5, 0.5, 0));
    const hi = charge(mk(0.5, 0.5, 1));
    expect(lo).toBeGreaterThan(0.05);
    expect(hi).toBeGreaterThan(lo);
  });
});

// ─── Круг Sunset Loop простым водителем ────────────────────────────────────

const _smp = createSample();

/** Простой водитель: pure pursuit по осевой + торможение по кривизне впереди (как в handling.test) */
function simpleDriver(car: VehiclePhysics, out: VehicleControls, gripUse: number): void {
  const st = car.state;
  const cfg = getHandling(car.spec.id);
  const v = Math.max(st.speed, 0);
  const t = track.sampleAt(st.trackS + 8 + 0.5 * v, _smp);
  const dx = t.position.x - st.position.x;
  const dz = t.position.z - st.position.z;
  const along = dx * Math.sin(st.heading) + dz * Math.cos(st.heading);
  const left = dx * Math.cos(st.heading) - dz * Math.sin(st.heading);
  const alpha = Math.atan2(left, along);
  const kappa = (2 * Math.sin(alpha)) / Math.max(4, Math.hypot(dx, dz));
  out.steer = MathUtils.clamp(-steerForCurvature(cfg, v, kappa) / steerAngleAt(cfg, v), -1, 1);
  let vT = cfg.maxSpeed;
  for (let d = 0; d < 140; d += 6) {
    const k = Math.abs(track.curvatureAt(st.trackS + d));
    const vLim = Math.sqrt((cfg.grip * G * gripUse) / Math.max(k, 1e-4));
    vT = Math.min(vT, Math.sqrt(vLim * vLim + 2 * cfg.brakeDecel * 0.6 * d));
  }
  const excess = v - vT;
  out.brake = excess > 0.5 ? MathUtils.clamp(excess / 3, 0, 1) : 0;
  out.throttle = excess > 0.5 ? 0 : MathUtils.clamp(0.5 + (vT - v) * 0.5, 0, 1);
  out.handbrake = false;
  out.nitro = false;
}

describe('Sunset Loop: круг простым водителем на любой сборке', () => {
  it('круг проезжается без NaN, без needsRespawn, без застревания и без заноса', () => {
    for (const b of BUILDS) {
      applyCustomHandling(b);
      const car = makeCar(track, 300, 0);
      const c = ctl();
      let dist = 0;
      let prevS = car.state.trackS;
      let t = 0;
      let slow = 0;
      let maxSlow = 0;
      let drifts = 0;
      let walls = 0;
      while (dist < track.length && t < 240) {
        simpleDriver(car, c, 0.9);
        car.step(DT, c);
        t += DT;
        dist += track.deltaS(prevS, car.state.trackS);
        prevS = car.state.trackS;
        const st = car.state;
        if (!Number.isFinite(st.position.x + st.position.y + st.position.z + st.speed + st.yawRate)) {
          throw new Error(`NaN: ${label(b)} t=${t.toFixed(2)}`);
        }
        if (car.needsRespawn) throw new Error(`needsRespawn: ${label(b)} t=${t.toFixed(2)} s=${st.trackS.toFixed(0)}`);
        if (st.drifting) drifts++;
        for (const e of car.events) if (e.type === 'wall') walls++;
        // застревание: скорость < 2 м/с дольше 3 с подряд (кроме старта)
        if (t > 4 && st.speed < 2) slow += DT;
        else slow = 0;
        maxSlow = Math.max(maxSlow, slow);
      }
      expect(dist, `${label(b)}: круг не проехан за ${t.toFixed(0)} с`).toBeGreaterThanOrEqual(track.length);
      expect(maxSlow, `${label(b)}: застревание`).toBeLessThan(3);
      expect(drifts, `${label(b)}: drifting`).toBe(0);
      expect(walls, `${label(b)}: удары`).toBeLessThan(5);
    }
  });
});

// ─── Сравнения слайдеров ───────────────────────────────────────────────────

describe('слайдеры меняют характер', () => {
  /** Время в заносе, с, после входа по Space; далее только руль + газ (без Space) */
  function holdTime(b: CustomBuild, steer: number): number {
    applyCustomHandling(b);
    const car = makeCar(wide, 300, 35);
    run(car, 0.3, () => ctl({ throttle: 1, steer: 0.6 }));
    run(car, 0.4, () => ctl({ throttle: 1, steer: 1, handbrake: true }));
    expect(car.state.drifting, label(b) + ' вход').toBe(true);
    let t = 0;
    while (car.state.drifting && t < 12) {
      car.step(DT, ctl({ throttle: 1, steer }));
      t += DT;
    }
    return t;
  }

  it('«Дрифт» = 1 держит занос дольше, чем «Дрифт» = 0 (одинаковый бюджет 2.0)', () => {
    const hi = mk(0.5, 0.5, 1);
    const lo = mk(1, 1, 0);
    for (const steer of [1, 0.35]) {
      const a = holdTime(hi, steer);
      const b = holdTime(lo, steer);
      expect(a, `steer=${steer}: ${a.toFixed(2)} vs ${b.toFixed(2)}`).toBeGreaterThan(b * 2);
    }
    // на полном руле: длинный занос ≥ 5 с, короткий ≤ 2 с
    expect(holdTime(hi, 1)).toBeGreaterThanOrEqual(5);
    expect(holdTime(lo, 1)).toBeLessThanOrEqual(2);
  });

  /** Space + руль на скорости v (скорость задана сразу): угол, торможение (м/с²) и радиус дуги (м) за 0.5–1.0 с */
  function driftAt(b: CustomBuild, v: number): { angle: number; decel: number; radius: number } {
    applyCustomHandling(b);
    const car = makeCar(wide, 300, v);
    const st = car.state;
    let psiPrev = Math.atan2(st.velocity.x, st.velocity.z);
    let turned = 0;
    let angle = 0;
    let n = 0;
    let v1 = 0;
    let v2 = 0;
    run(car, 1, () => ctl({ throttle: 1, steer: 1, handbrake: true }), (t) => {
      const psi = Math.atan2(st.velocity.x, st.velocity.z);
      let d = psi - psiPrev;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      psiPrev = psi;
      const V = Math.hypot(st.velocity.x, st.velocity.z);
      if (t >= 0.5) {
        turned += Math.abs(d);
        angle += st.driftAngle;
        n++;
      }
      if (Math.abs(t - 0.5) < DT / 2) v1 = V;
      v2 = V;
    });
    return { angle: angle / n, decel: (v1 - v2) / 0.5, radius: ((v1 + v2) / 2) / (turned / 0.5) };
  }

  it('занос зависит от скорости: на 70 м/с «Дрифт» = 1 даёт больший угол, тугую дугу и сильное торможение, «Дрифт» = 0 — короче и мягче', () => {
    const hi = driftAt(mk(0.5, 0.5, 1), 70);
    const lo = driftAt(mk(1, 1, 0), 70);
    expect(hi.angle, 'угол').toBeGreaterThan(lo.angle + 15 * DEG);
    expect(hi.radius, 'радиус дуги').toBeLessThan(lo.radius);
    expect(hi.radius, 'радиус дуги hi').toBeLessThan(110);
    expect(hi.decel, 'торможение').toBeGreaterThan(lo.decel);
    expect(hi.decel, 'торможение hi').toBeGreaterThanOrEqual(15);
    expect(lo.decel, 'торможение lo').toBeGreaterThanOrEqual(8);
    // угол растёт со скоростью (раньше падал)
    const slow = driftAt(mk(0.5, 0.5, 1), 35);
    expect(hi.angle, 'угол hi: 70 vs 35 м/с').toBeGreaterThanOrEqual(slow.angle - 1 * DEG);
  });

  it('«Скорость» = 1 быстрее на прямой, чем «Скорость» = 0', () => {
    const straight = (b: CustomBuild): { v: number; dist: number } => {
      applyCustomHandling(b);
      const car = makeCar(wide, 300, 0);
      let dist = 0;
      run(car, 20, () => ctl({ throttle: 1 }), () => {
        dist += Math.hypot(car.state.velocity.x, car.state.velocity.z) * DT;
      });
      return { v: car.state.speed, dist };
    };
    const fast = straight(mk(1, 0.5, 0.5));
    const fastMax = HANDLING[CUSTOM_CAR_ID].maxSpeed;
    const slow = straight(mk(0, 0.5, 0.5));
    expect(fast.v).toBeGreaterThan(slow.v + 8);
    expect(fast.dist).toBeGreaterThan(slow.dist * 1.1);
    // и макс. скорость соответствует конфигу
    expect(fast.v).toBeLessThanOrEqual(fastMax + 0.5);
  });

  it('«Управляемость» = 1 поворачивает резче на пределе, чем «Управляемость» = 0', () => {
    const peakLat = (b: CustomBuild): number => {
      applyCustomHandling(b);
      const car = makeCar(wide, 300, 40);
      let peak = 0;
      run(car, 2, () => ctl({ throttle: 0.6, steer: 1 }), () => {
        if (car.state.onGround) peak = Math.max(peak, Math.abs(car.state.yawRate * car.state.speed));
      });
      return peak;
    };
    expect(peakLat(mk(0.5, 1, 0.5))).toBeGreaterThan(peakLat(mk(0.5, 0, 0.5)) * 1.15);
  });
});
