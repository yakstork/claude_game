import { afterEach, describe, expect, it } from 'vitest';
import { MathUtils } from 'three';
import { Track, createSample } from '../../src/world/track';
import { SUNSET_LOOP } from '../../src/world/trackData';
import type { ControlPoint } from '../../src/world/trackData';
import { VehiclePhysics } from '../../src/vehicle/physics';
import { CAR_SPECS } from '../../src/vehicle/specs';
import {
  HANDLING,
  HANDLING_DEFAULTS,
  HANDLING_PARAMS,
  INPUT_PARAMS,
  INPUT_TUNING,
  INPUT_TUNING_DEFAULTS,
  getHandling,
  resetHandling,
  steerAngleAt,
  steerForCurvature,
  yawRateForSteer,
} from '../../src/vehicle/handling';
import type { HandlingConfig } from '../../src/vehicle/handling';
import type { VehicleControls } from '../../src/core/types';

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

const IDS = CAR_SPECS.map((c) => c.id);

function ctl(o: Partial<VehicleControls> = {}): VehicleControls {
  return { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, ...o };
}

function makeCar(tr: Track, specIndex: number, s: number, speed = 0): VehiclePhysics {
  const car = new VehiclePhysics(CAR_SPECS[specIndex], tr);
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
  Object.assign(INPUT_TUNING, INPUT_TUNING_DEFAULTS);
});

// ─── Конфиг и метаданные ───────────────────────────────────────────────────

describe('HandlingConfig: единый конфиг и метаданные для панели тюнинга', () => {
  it('есть конфиг для каждой машины, все значения — конечные числа', () => {
    for (const id of IDS) {
      const cfg = getHandling(id);
      expect(cfg).toBe(HANDLING[id]);
      for (const [k, v] of Object.entries(cfg)) {
        expect(typeof v, `${id}.${k}`).toBe('number');
        expect(Number.isFinite(v), `${id}.${k}`).toBe(true);
      }
    }
  });

  it('HANDLING_PARAMS покрывает все ключи HandlingConfig, без лишних и повторов', () => {
    const keys = Object.keys(HANDLING.razor).sort();
    const paramKeys = HANDLING_PARAMS.map((p) => p.key).sort();
    expect(paramKeys).toEqual(keys);
    for (const id of IDS) expect(Object.keys(HANDLING[id]).sort(), id).toEqual(keys);
  });

  it('min ≤ значение по умолчанию ≤ max, step > 0, подписи и группы заданы', () => {
    const groups = new Set(['Двигатель', 'Руль', 'Сцепление', 'Дрифт', 'Стены', 'Нитро', 'Подвеска']);
    for (const p of HANDLING_PARAMS) {
      expect(p.min, p.key).toBeLessThan(p.max);
      expect(p.step, p.key).toBeGreaterThan(0);
      expect(p.step, p.key).toBeLessThanOrEqual((p.max - p.min) / 4);
      expect(p.label.length, p.key).toBeGreaterThan(0);
      expect(groups.has(p.group), `${p.key}: группа ${p.group}`).toBe(true);
      for (const id of IDS) {
        const v = HANDLING_DEFAULTS[id][p.key as keyof HandlingConfig];
        expect(v, `${id}.${p.key}`).toBeGreaterThanOrEqual(p.min);
        expect(v, `${id}.${p.key}`).toBeLessThanOrEqual(p.max);
      }
    }
  });

  it('INPUT_PARAMS покрывает INPUT_TUNING (группа «Клавиатура»), значения в диапазоне', () => {
    expect(INPUT_PARAMS.map((p) => p.key).sort()).toEqual(Object.keys(INPUT_TUNING).sort());
    for (const p of INPUT_PARAMS) {
      expect(p.group).toBe('Клавиатура');
      const v = INPUT_TUNING_DEFAULTS[p.key as keyof typeof INPUT_TUNING_DEFAULTS];
      expect(v).toBeGreaterThanOrEqual(p.min);
      expect(v).toBeLessThanOrEqual(p.max);
    }
    // плавное нарастание ≈ 3–4/с, быстрый возврат ≈ 6–8/с, ещё быстрее при смене направления
    expect(INPUT_TUNING_DEFAULTS.keySteerRise).toBeGreaterThanOrEqual(3);
    expect(INPUT_TUNING_DEFAULTS.keySteerRise).toBeLessThanOrEqual(4);
    expect(INPUT_TUNING_DEFAULTS.keySteerReturn).toBeGreaterThanOrEqual(6);
    expect(INPUT_TUNING_DEFAULTS.keySteerReturn).toBeLessThanOrEqual(8);
    expect(INPUT_TUNING_DEFAULTS.keySteerCounter).toBeGreaterThan(INPUT_TUNING_DEFAULTS.keySteerReturn);
  });

  it('HANDLING_DEFAULTS — глубокая копия; resetHandling возвращает значения В ТЕ ЖЕ живые объекты', () => {
    for (const id of IDS) expect(HANDLING_DEFAULTS[id]).not.toBe(HANDLING[id]);
    const live = HANDLING.razor;
    const other = HANDLING.grizzly;
    live.grip = 0.5;
    live.driftMaxAngle = 0.3;
    other.grip = 0.6;
    resetHandling('razor');
    expect(HANDLING.razor).toBe(live);
    expect(live.grip).toBe(HANDLING_DEFAULTS.razor.grip);
    expect(live.driftMaxAngle).toBe(HANDLING_DEFAULTS.razor.driftMaxAngle);
    expect(other.grip).toBe(0.6); // другая машина не тронута
    resetHandling();
    expect(other.grip).toBe(HANDLING_DEFAULTS.grizzly.grip);
  });

  it('физика читает конфиг «вживую»: изменение grip на лету меняет предел бокового ускорения', () => {
    const lat = (): number => {
      const car = makeCar(wide, 0, 300, 45);
      let peak = 0;
      run(car, 2, () => ctl({ throttle: 0.6, steer: 1 }), () => {
        peak = Math.max(peak, Math.abs(car.state.yawRate * car.state.speed));
      });
      return peak;
    };
    const base = lat();
    HANDLING.razor.grip *= 0.5;
    const low = lat();
    expect(low).toBeLessThan(base * 0.65);
    expect(low).toBeGreaterThan(base * 0.3);
  });

  it('характер машин: Photon быстрее и цепче, Grizzly тяжелее и с самым лёгким занос, Razor отзывчивее', () => {
    const [razor, grizzly, photon] = IDS.map(getHandling);
    expect(photon.maxSpeed).toBeGreaterThan(grizzly.maxSpeed);
    expect(grizzly.maxSpeed).toBeGreaterThan(razor.maxSpeed);
    expect(photon.grip).toBeGreaterThan(razor.grip);
    expect(razor.grip).toBeGreaterThan(grizzly.grip);
    expect(grizzly.mass).toBeGreaterThan(razor.mass);
    // тяжёлый руль Grizzly: медленнее поворот колёс и отклик рыскания
    expect(grizzly.steerRate).toBeLessThan(razor.steerRate);
    expect(grizzly.yawResponse).toBeLessThan(razor.yawResponse);
    // занос: Grizzly — самый большой угол, ниже порог скорости и быстрый заряд; Photon — наоборот
    expect(grizzly.driftMaxAngle).toBeGreaterThan(razor.driftMaxAngle);
    expect(razor.driftMaxAngle).toBeGreaterThan(photon.driftMaxAngle);
    expect(photon.driftMinSpeed).toBeGreaterThan(razor.driftMinSpeed);
    expect(razor.driftMinSpeed).toBeGreaterThan(grizzly.driftMinSpeed);
    expect(grizzly.driftChargeRate).toBeGreaterThan(razor.driftChargeRate);
    expect(razor.driftChargeRate).toBeGreaterThan(photon.driftChargeRate);
    // максимумы скоростей из прошлой версии: 230 / 245 / 274 км/ч
    expect(razor.maxSpeed * 3.6).toBeCloseTo(230, -1);
    expect(grizzly.maxSpeed * 3.6).toBeCloseTo(245, -1);
    expect(photon.maxSpeed * 3.6).toBeCloseTo(274, -1);
  });
});

describe('панель тюнинга: крайние значения параметров не ломают физику', () => {
  it('каждый параметр на min и на max: состояние остаётся конечным', () => {
    let seed = 4242;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (const p of HANDLING_PARAMS) {
      for (const value of [p.min, p.max]) {
        resetHandling();
        (HANDLING.grizzly as Record<string, number>)[p.key] = value;
        const car = makeCar(track, 1, 300, 30);
        let cur = ctl();
        for (let k = 0; k < 120 * 6; k++) {
          if (k % 40 === 0) {
            cur = ctl({ throttle: rnd() < 0.8 ? 1 : 0, steer: rnd() * 2 - 1, handbrake: rnd() < 0.3, nitro: rnd() < 0.3 });
          }
          car.step(DT, cur);
          if (car.needsRespawn) {
            const g = track.gridPose(0);
            car.reset(g.position, g.heading, g.s);
          }
          const st = car.state;
          const sum = st.position.x + st.position.y + st.position.z + st.speed + st.yawRate + st.driftAngle + st.nitro;
          if (!Number.isFinite(sum)) throw new Error(`NaN: ${p.key}=${value} шаг ${k}`);
        }
      }
    }
    resetHandling();
  });
});

describe('руль: функции угла и рыскания', () => {
  it('угол колёс монотонно падает со скоростью; на 60 м/с — 30–40% от угла на месте', () => {
    for (const id of IDS) {
      const cfg = getHandling(id);
      let prev = Infinity;
      for (let v = 0; v <= 90; v += 5) {
        const a = steerAngleAt(cfg, v);
        expect(a, `${id} v=${v}`).toBeLessThan(prev);
        prev = a;
      }
      expect(steerAngleAt(cfg, 0)).toBeCloseTo(cfg.steerAngleLow, 6);
      const r = steerAngleAt(cfg, 60) / steerAngleAt(cfg, 0);
      expect(r, id).toBeGreaterThanOrEqual(0.3);
      expect(r, id).toBeLessThanOrEqual(0.4);
    }
  });

  it('yawRateForSteer ≈ v·tan(δ)/L на малой скорости; steerForCurvature — обратная функция', () => {
    const cfg = getHandling('razor');
    const v = 5;
    const w = yawRateForSteer(cfg, v, 0.3);
    expect(w).toBeGreaterThan((v * Math.tan(0.3)) / 2.6 / 1.1);
    expect(w).toBeLessThanOrEqual((v * Math.tan(0.3)) / 2.6);
    for (const speed of [8, 25, 60]) {
      const d = steerForCurvature(cfg, speed, 0.02);
      expect(yawRateForSteer(cfg, speed, d) / speed).toBeCloseTo(0.02, 6);
    }
  });
});

// ─── Режим GRIP ────────────────────────────────────────────────────────────

describe('GRIP: газ + руль на любой скорости — чистый поворот, без заноса', () => {
  it('полный руль + газ на 20/40/60 м/с на ровной прямой 2 с: drifting = false, |угол| < 8°, поворот в нужную сторону', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      for (const v of [20, 40, 60]) {
        for (const sign of [1, -1]) {
          const car = makeCar(wide, i, 300, v);
          const h0 = car.state.heading;
          let maxAngle = 0;
          let everDrifting = false;
          run(car, 2, () => ctl({ throttle: 1, steer: sign }), () => {
            maxAngle = Math.max(maxAngle, Math.abs(car.state.driftAngle));
            if (car.state.drifting) everDrifting = true;
          });
          const label = `${IDS[i]} v=${v} steer=${sign}`;
          expect(everDrifting, label).toBe(false);
          expect(car.state.drifting, label).toBe(false);
          expect(maxAngle, label).toBeLessThan(8 * DEG);
          // вправо (steer +1) — курс уменьшается
          expect(Math.sign(car.state.heading - h0), label).toBe(-sign);
          expect(Math.abs(car.state.heading - h0), label).toBeGreaterThan(0.15);
          expect(car.state.lateral * sign, label).toBeGreaterThan(1);
        }
      }
    }
  });

  it('клавиатурный руль (нарастание 3.5/с до 1) на 60 м/с: тоже без заноса', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      const car = makeCar(wide, i, 300, 55);
      let maxAngle = 0;
      run(car, 3, (t) => ctl({ throttle: 1, steer: Math.min(1, t * INPUT_TUNING.keySteerRise) }), () => {
        maxAngle = Math.max(maxAngle, Math.abs(car.state.driftAngle));
        expect(car.state.drifting).toBe(false);
      });
      expect(maxAngle, IDS[i]).toBeLessThan(8 * DEG);
    }
  });

  it('боковое ускорение ограничено сцеплением (с прижимом): a_lat ≤ grip·g·(1+downforce) + 5%', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      const cfg = getHandling(IDS[i]);
      for (const v of [15, 30, 50]) {
        const car = makeCar(wide, i, 300, v);
        let peak = 0;
        run(car, 2, () => ctl({ throttle: 0.6, steer: 1 }), () => {
          if (car.state.onGround) peak = Math.max(peak, Math.abs(car.state.yawRate * car.state.speed));
        });
        expect(peak, `${IDS[i]} v=${v}`).toBeLessThanOrEqual(cfg.grip * G * (1 + cfg.downforce) * 1.05);
        // и на пределе машина реально поворачивает почти с полным сцеплением
        expect(peak, `${IDS[i]} v=${v}`).toBeGreaterThan(cfg.grip * G * 0.7);
      }
    }
  });

  it('недостаточная поворачиваемость: на пределе радиус растёт, но угол заноса остаётся малым', () => {
    const car = makeCar(wide, 2, 300, 60);
    let maxAngle = 0;
    run(car, 3, () => ctl({ throttle: 1, steer: 1 }), () => {
      maxAngle = Math.max(maxAngle, Math.abs(car.state.driftAngle));
    });
    // радиус на пределе: v²/(grip·g·k) ≈ 200 м, а не радиус по геометрии руля (≈ 10 м)
    const radius = Math.abs(car.state.speed / car.state.yawRate);
    expect(radius).toBeGreaterThan(120);
    expect(maxAngle).toBeLessThan(8 * DEG);
  });

  it('руль: колёса поворачиваются с ограниченной скоростью, без осцилляций', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      const cfg = getHandling(IDS[i]);
      const car = makeCar(wide, i, 300, 30);
      let prev = 0;
      let maxRate = 0;
      let maxAbs = 0;
      let crossings = 0;
      run(car, 2, (t) => ctl({ throttle: 0.6, steer: t < 0.05 ? 0 : 1 }), (t) => {
        const a = car.state.wheels[0].steerAngle;
        maxRate = Math.max(maxRate, Math.abs(a - prev) / DT);
        maxAbs = Math.max(maxAbs, Math.abs(a));
        if (t > 0.3 && a >= 0) crossings++; // руль вправо: угол колёс (влево > 0) остаётся отрицательным
        prev = a;
      });
      expect(maxRate, IDS[i]).toBeLessThanOrEqual(cfg.steerRate * 1.05);
      // без перерегулирования: угол не превышает то, что положено на начальной скорости
      expect(maxAbs, IDS[i]).toBeLessThanOrEqual(steerAngleAt(cfg, 30) * 1.01);
      expect(crossings, IDS[i]).toBe(0);
    }
  });

  it('нитро заряжается только в DRIFT: езда на сцеплении не повышает шкалу', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      const car = makeCar(wide, i, 300, 40);
      run(car, 5, (t) => ctl({ throttle: 1, steer: Math.sin(t * 1.5) }));
      expect(car.state.nitro, IDS[i]).toBeCloseTo(0.25, 6);
    }
  });
});

// ─── Режим DRIFT ───────────────────────────────────────────────────────────

describe('DRIFT: вход, удержание и выход — только осознанно', () => {
  it('Space + руль на 25+ м/с: drifting = true в сторону руля, нитро растёт', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      for (const sign of [1, -1]) {
        for (const v of [25, 32, 40]) {
          const car = makeCar(wide, i, 300, v);
          const nitro0 = car.state.nitro;
          let enteredAt = -1;
          run(car, 2.5, (t) => ctl({ throttle: 1, steer: sign, handbrake: t < 0.4 }), (t) => {
            if (enteredAt < 0 && car.state.drifting) enteredAt = t;
          });
          const label = `${IDS[i]} v=${v} steer=${sign}`;
          expect(enteredAt, label).toBeGreaterThanOrEqual(0);
          expect(enteredAt, label).toBeLessThan(0.3);
          expect(car.state.drifting, label).toBe(true);
          // руль вправо (+1) → нос правее вектора скорости → driftAngle > 0
          expect(Math.sign(car.state.driftAngle), label).toBe(sign);
          expect(Math.abs(car.state.driftAngle), label).toBeGreaterThan(15 * DEG);
          expect(car.state.nitro, label).toBeGreaterThan(nitro0 + 0.1);
        }
      }
    }
  });

  it('Space без руля и слабый руль не дают заноса; на малой скорости ручник + руль — тоже', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      const cfg = getHandling(IDS[i]);
      const weak = makeCar(wide, i, 300, 35);
      run(weak, 1.5, () => ctl({ throttle: 1, steer: cfg.driftEntrySteer * 0.5, handbrake: true }), () => {
        expect(weak.state.drifting).toBe(false);
      });
      const slow = makeCar(wide, i, 300, cfg.driftMinSpeed * 0.6);
      run(slow, 1.5, () => ctl({ throttle: 0.5, steer: 1, handbrake: true }), () => {
        expect(slow.state.drifting).toBe(false);
      });
    }
  });

  it('ручник без руля на 30 м/с — просто торможение задними колёсами: курс не уходит (< 20°)', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      const car = makeCar(wide, i, 300, 30);
      const h0 = car.state.heading;
      let maxAngle = 0;
      run(car, 2, () => ctl({ handbrake: true }), () => {
        maxAngle = Math.max(maxAngle, Math.abs(car.state.driftAngle));
        expect(car.state.drifting).toBe(false);
      });
      expect(Math.abs(car.state.heading - h0), IDS[i]).toBeLessThan(20 * DEG);
      expect(maxAngle, IDS[i]).toBeLessThan(5 * DEG);
      // и это именно торможение
      expect(car.state.speed, IDS[i]).toBeLessThan(22);
    }
  });

  it('занос удерживается газом + рулём в сторону заноса (без Space) и одним Space', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      const a = makeCar(wide, i, 300, 32);
      run(a, 4, (t) => ctl({ throttle: 1, steer: 0.8, handbrake: t < 0.4 }));
      expect(a.state.drifting, IDS[i] + ' руль+газ').toBe(true);
      const b = makeCar(wide, i, 300, 32);
      run(b, 4, (t) => ctl({ handbrake: true, steer: t < 0.5 ? 0.8 : 0 }));
      expect(b.state.drifting, IDS[i] + ' Space').toBe(true);
    }
  });

  it('выход: после отпускания руля/газа/Space за ≤ 0.6 с |угол| < 5° и drifting = false, без «маятника»', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      for (const sign of [1, -1]) {
        const car = makeCar(wide, i, 300, 32);
        run(car, 2.5, (t) => ctl({ throttle: 1, steer: sign, handbrake: t < 0.4 }));
        expect(car.state.drifting, IDS[i]).toBe(true);
        let wrongSide = 0;
        let stillDrifting = false;
        let prevAbs = Math.abs(car.state.driftAngle);
        let nonMonotone = 0;
        run(car, 0.6, () => ctl(), () => {
          // маятник: угол уходит на другую сторону от заноса
          wrongSide = Math.max(wrongSide, -sign * car.state.driftAngle);
          if (car.state.drifting) stillDrifting = true;
          const abs = Math.abs(car.state.driftAngle);
          if (abs > prevAbs + 1e-3) nonMonotone++;
          prevAbs = abs;
        });
        const label = `${IDS[i]} steer=${sign}`;
        expect(Math.abs(car.state.driftAngle), label).toBeLessThan(5 * DEG);
        expect(car.state.drifting, label).toBe(false);
        expect(stillDrifting, label).toBe(false);
        expect(wrongSide, label + ': маятник').toBeLessThan(2 * DEG);
        expect(nonMonotone, label + ': угол растёт при выходе').toBe(0);
        // выравнивание плавное: угловая скорость рыскания не «рывком»
        expect(Math.abs(car.state.yawRate), label).toBeLessThan(0.3);
      }
    }
  });

  it('выход по контррулю и по сбросу газа (руль удержан) тоже завершает занос', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      const counter = makeCar(wide, i, 300, 32);
      run(counter, 2.5, (t) => ctl({ throttle: 1, steer: 1, handbrake: t < 0.4 }));
      run(counter, 1, () => ctl({ throttle: 1, steer: -0.8 }));
      expect(counter.state.drifting, IDS[i] + ' контрруль').toBe(false);
      expect(Math.abs(counter.state.driftAngle), IDS[i] + ' контрруль').toBeLessThan(5 * DEG);
      const lift = makeCar(wide, i, 300, 32);
      run(lift, 2.5, (t) => ctl({ throttle: 1, steer: 1, handbrake: t < 0.4 }));
      run(lift, 1, () => ctl({ throttle: 0, steer: 1 }));
      expect(lift.state.drifting, IDS[i] + ' сброс газа').toBe(false);
    }
  });

  it('угол заноса управляется рулём и газом: больше руля → больше угол; контрруль убавляет; ≤ максимума', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      const cfg = getHandling(IDS[i]);
      const steady = (steer: number, throttle: number): number => {
        const car = makeCar(wide, i, 300, 34);
        run(car, 3, (t) => ctl({ throttle, steer, handbrake: t < 0.4 }));
        return Math.abs(car.state.driftAngle);
      };
      const light = steady(0.5, 1);
      const full = steady(1, 1);
      const lowGas = steady(1, 0.4);
      expect(full, IDS[i]).toBeGreaterThan(light + 0.05);
      expect(full, IDS[i]).toBeGreaterThan(lowGas + 0.02);
      expect(full, IDS[i]).toBeLessThanOrEqual(cfg.driftMaxAngle + 0.03);
      expect(light, IDS[i]).toBeGreaterThan(0.12);
      // контрруль в процессе заноса убавляет угол
      const car = makeCar(wide, i, 300, 34);
      run(car, 2.5, (t) => ctl({ throttle: 1, steer: 1, handbrake: t < 0.4 }));
      const before = Math.abs(car.state.driftAngle);
      run(car, 0.15, () => ctl({ throttle: 1, steer: -0.6 }));
      expect(Math.abs(car.state.driftAngle), IDS[i]).toBeLessThan(before - 0.05);
    }
  });

  it('скорость в заносе теряется умеренно (не быстрее ~25% за 2 с при сброшенном газе)', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      const car = makeCar(wide, i, 300, 34);
      run(car, 1, (t) => ctl({ throttle: 1, steer: 1, handbrake: t < 0.4 }));
      const v0 = Math.hypot(car.state.velocity.x, car.state.velocity.z);
      run(car, 2, () => ctl({ throttle: 0.15, steer: 1, handbrake: true }));
      expect(car.state.drifting, IDS[i]).toBe(true);
      const v1 = Math.hypot(car.state.velocity.x, car.state.velocity.z);
      expect(v1, IDS[i]).toBeGreaterThan(v0 * 0.65);
    }
  });

  it('переброс: Space + руль в другую сторону разворачивает занос', () => {
    const car = makeCar(wide, 0, 300, 34);
    run(car, 2, (t) => ctl({ throttle: 1, steer: 1, handbrake: t < 0.4 }));
    expect(car.state.driftAngle).toBeGreaterThan(0.2);
    run(car, 1.2, () => ctl({ throttle: 1, steer: -1, handbrake: true }));
    expect(car.state.drifting).toBe(true);
    expect(car.state.driftAngle).toBeLessThan(-0.2);
  });

  it('занос в воздухе не залипает: после отрыва от земли режим сбрасывается, на земле — обычный GRIP', () => {
    const car = makeCar(wide, 0, 300, 34);
    run(car, 2, (t) => ctl({ throttle: 1, steer: 1, handbrake: t < 0.4 }));
    expect(car.state.drifting).toBe(true);
    car.state.position.y += 6; // «подбросило»: падение ≈ 0.9 с
    run(car, 0.7, () => ctl({ throttle: 1, steer: 1 }));
    expect(car.state.onGround).toBe(false);
    expect(car.state.drifting).toBe(false);
    run(car, 3, () => ctl({ throttle: 1, steer: 0 }));
    expect(car.state.onGround).toBe(true);
    expect(car.state.drifting).toBe(false);
    expect(Math.abs(car.state.driftAngle)).toBeLessThan(5 * DEG);
  });
});

// ─── Стены ─────────────────────────────────────────────────────────────────

describe('стены: скольжение вдоль отбойника и лобовой удар', () => {
  function hitWall(carIndex: number, speed: number, angleDeg: number, seconds: number, throttle = 1) {
    const s0 = 300;
    const car = makeCar(track, carIndex, s0, 0);
    const smp = track.sampleAt(s0);
    const along = Math.atan2(smp.tangent.x, smp.tangent.z);
    const h = along + angleDeg * DEG; // влево (lateral < 0)
    car.state.heading = h;
    car.state.velocity.set(Math.sin(h) * speed, 0, Math.cos(h) * speed);
    let hitStep = -1;
    let vAfter = 0;
    let vBefore = speed;
    let maxStrength = 0;
    let vnAfter = 0;
    const n = Math.round(seconds / DT);
    for (let k = 0; k < n; k++) {
      if (hitStep < 0) vBefore = Math.hypot(car.state.velocity.x, car.state.velocity.z);
      car.step(DT, ctl({ throttle }));
      for (const e of car.events) {
        if (e.type === 'wall') {
          maxStrength = Math.max(maxStrength, e.strength);
          if (hitStep < 0) {
            hitStep = k;
            const vx = car.state.velocity.x;
            const vz = car.state.velocity.z;
            const r = smp.right;
            const rl = Math.hypot(r.x, r.z);
            // нормаль внутрь дороги для левой стены — по вправо
            vnAfter = (vx * (r.x / rl) + vz * (r.z / rl));
          }
        }
      }
      if (hitStep >= 0 && k === hitStep + 30) vAfter = Math.hypot(car.state.velocity.x, car.state.velocity.z);
    }
    return { car, along, hitStep, vAfter, vBefore, maxStrength, vnAfter, smp };
  }

  it('скользящее касание под 15° на 50 м/с: скорость ≥ 85% исходной, едет вдоль стены без остановки и отскока', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      for (const throttle of [0, 1]) {
        const r = hitWall(i, 50, 15, 3, throttle);
        const label = `${IDS[i]} throttle=${throttle}`;
        expect(r.hitStep, label).toBeGreaterThan(0);
        // 0.25 с после касания скорость не упала ниже 85% от исходной
        expect(r.vAfter, label).toBeGreaterThanOrEqual(50 * 0.85);
        // машина продолжает ехать вдоль стены: курс параллелен дороге, скорость вперёд, не отскочила
        expect(Math.abs(r.car.state.heading - r.along), label).toBeLessThan(3 * DEG);
        expect(r.car.state.speed, label).toBeGreaterThan(35);
        expect(Math.abs(r.car.state.lateral), label).toBeGreaterThan(track.halfWidth - 3.5);
        expect(Math.abs(r.car.state.lateral), label).toBeLessThan(track.halfWidth);
        // событие 'wall' есть, его сила — от нормальной скорости (≈ 50·sin15° ≈ 13 м/с → ~0.6)
        expect(r.maxStrength, label).toBeGreaterThan(0.3);
        expect(r.maxStrength, label).toBeLessThan(0.9);
      }
    }
  });

  it('касательная теряет немного: 3–8% на 15° и не остановка на 25°', () => {
    // сравниваем скорости сразу до и после касания (без газа — вычитаем сопротивление за 0.25 с)
    const r15 = hitWall(2, 50, 15, 1.5, 1);
    expect(r15.vAfter / r15.vBefore).toBeGreaterThan(0.93);
    const r25 = hitWall(2, 50, 25, 1.5, 1);
    expect(r25.vAfter / r25.vBefore).toBeGreaterThan(0.8);
    expect(r25.car.state.speed).toBeGreaterThan(30);
  });

  it('лобовой удар (75°): ощутимая потеря скорости и лёгкий отскок, событие сильное', () => {
    const r = hitWall(2, 50, 75, 1, 0);
    expect(r.hitStep).toBeGreaterThan(0);
    expect(r.vAfter).toBeLessThan(50 * 0.45);
    expect(r.maxStrength).toBeGreaterThan(0.8);
    // отскок: нормальная скорость от стены мала (< 30% от подхода ≈ 48 м/с)
    expect(Math.abs(r.vnAfter)).toBeLessThan(48 * 0.35);
    expect(Math.abs(r.vnAfter)).toBeGreaterThan(1);
    // не пролетает сквозь стену
    expect(Math.abs(r.car.state.lateral)).toBeLessThan(track.halfWidth);
  });
});

// ─── Прохождение трассы на сцеплении ───────────────────────────────────────

const _smp = createSample();

/** Простой водитель: pure pursuit по осевой + торможение по кривизне впереди */
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

describe('трасса Sunset Loop проходится на сцеплении', () => {
  it('все машины проезжают круг простым водителем (осевая + торможение по кривизне) без drifting и без ударов', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      const car = makeCar(track, i, 300, 0);
      const c = ctl();
      let dist = 0;
      let prevS = car.state.trackS;
      let t = 0;
      let driftSteps = 0;
      let walls = 0;
      let maxAngle = 0;
      while (dist < track.length && t < 200) {
        simpleDriver(car, c, 0.9);
        car.step(DT, c);
        t += DT;
        dist += track.deltaS(prevS, car.state.trackS);
        prevS = car.state.trackS;
        if (car.state.drifting) driftSteps++;
        for (const e of car.events) if (e.type === 'wall') walls++;
        maxAngle = Math.max(maxAngle, Math.abs(car.state.driftAngle));
        expect(car.needsRespawn, `${IDS[i]}: needsRespawn`).toBe(false);
      }
      expect(dist, `${IDS[i]}: круг не проехан`).toBeGreaterThanOrEqual(track.length);
      expect(driftSteps, `${IDS[i]}: drifting`).toBe(0);
      expect(walls, `${IDS[i]}: удары в стену`).toBeLessThan(5);
      expect(maxAngle, `${IDS[i]}: угол скольжения`).toBeLessThan(10 * DEG);
    }
  });

  it('шпильки (R ≈ 20–55 м) проходятся с торможением: скорость в самой крутой точке ниже предела сцепления', () => {
    // самая крутая точка трассы
    let sMax = 0;
    let kMax = 0;
    for (let s = 0; s < track.length; s += 2) {
      const k = Math.abs(track.curvatureAt(s));
      if (k > kMax) {
        kMax = k;
        sMax = s;
      }
    }
    expect(1 / kMax).toBeLessThan(60);
    for (let i = 0; i < CAR_SPECS.length; i++) {
      const cfg = getHandling(IDS[i]);
      const car = makeCar(track, i, track.wrapS(sMax - 250), 25);
      const c = ctl();
      let vAtApex = 0;
      let drifting = false;
      let walls = 0;
      for (let k = 0; k < 120 * 30; k++) {
        simpleDriver(car, c, 0.9);
        car.step(DT, c);
        if (car.state.drifting) drifting = true;
        for (const e of car.events) if (e.type === 'wall') walls++;
        if (Math.abs(track.deltaS(car.state.trackS, sMax)) < 1.5) vAtApex = car.state.speed;
        if (track.deltaS(sMax, car.state.trackS) > 60) break;
      }
      expect(drifting, IDS[i]).toBe(false);
      expect(walls, IDS[i]).toBeLessThan(3);
      expect(vAtApex, IDS[i]).toBeGreaterThan(8);
      expect(vAtApex, IDS[i]).toBeLessThan(Math.sqrt(cfg.grip * G * 1.3 * (1 / kMax)) * 1.1);
    }
  });
});
