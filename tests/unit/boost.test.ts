import { afterEach, describe, expect, it } from 'vitest';
import { Track } from '../../src/world/track';
import { SUNSET_LOOP } from '../../src/world/trackData';
import type { ControlPoint } from '../../src/world/trackData';
import { VehiclePhysics } from '../../src/vehicle/physics';
import { CAR_SPECS } from '../../src/vehicle/specs';
import {
  HANDLING,
  HANDLING_DEFAULTS,
  HANDLING_PARAMS,
  applyCustomHandling,
  customHandling,
  getHandling,
  resetHandling,
} from '../../src/vehicle/handling';
import type { HandlingConfig } from '../../src/vehicle/handling';
import { CUSTOM_CAR_ID } from '../../src/core/types';
import type { CarSpec, CustomBuild, VehicleControls } from '../../src/core/types';

/**
 * Буст (временное ускорение): механика applyBoost и бонус за дрифт.
 *  - applyBoost(seconds, power): доп. тяга и +% к максималке, плавное затухание, не суммируется (новый замещает
 *    старый, только если он «сильнее»), на старте с места (frozen) не тратится.
 *  - За занос: пока занос идёт — буста нет; при чистом выходе качество (угол × скорость × время, с насыщением)
 *    переводится в буст; удар о стену сжигает качество; случайный (очень короткий) занос ничего не даёт.
 */

const DT = 1 / 120;
const G = 9.81;
const IDS = ['razor', 'grizzly', 'photon'];
const SPEC = Object.fromEntries(CAR_SPECS.map((c) => [c.id, c])) as Record<string, CarSpec>;

/** Огромное кольцо с широкой дорогой — «бесконечная» ровная площадка */
const widePts: ControlPoint[] = [];
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * Math.PI * 2;
  widePts.push([Math.cos(a) * 4000, 0, Math.sin(a) * 4000]);
}
const wide = new Track({ name: 'wide', points: widePts, defaultHalfWidth: 1500, checkpointCount: 8 });
const sunset = new Track(SUNSET_LOOP);

function ctl(o: Partial<VehicleControls> = {}): VehicleControls {
  return { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, ...o };
}

/** Машина на трассе: s, смещение от осевой, скорость вдоль трассы */
function makeCar(id: string, speed = 0, tr: Track = wide, s = 300, lateral = 0): VehiclePhysics {
  const car = new VehiclePhysics(id === CUSTOM_CAR_ID ? { ...SPEC[id] } : SPEC[id], tr);
  const p = tr.sampleAt(s);
  const pos = p.position.clone().addScaledVector(p.right, lateral);
  const h = Math.atan2(p.tangent.x, p.tangent.z);
  car.reset(pos, h, s);
  car.state.velocity.set(Math.sin(h) * speed, 0, Math.cos(h) * speed);
  car.state.speed = speed;
  return car;
}

function drive(car: VehiclePhysics, seconds: number, c: Partial<VehicleControls>, each?: () => void): void {
  const n = Math.round(seconds / DT);
  const controls = ctl(c);
  for (let k = 0; k < n; k++) {
    car.step(DT, controls);
    if (each) each();
  }
}

afterEach(() => {
  resetHandling();
  applyCustomHandling({ speed: 0.6, handling: 0.6, drift: 0.6, bodyColor: 0, neonColor: 0 });
});

// ─── Механика applyBoost ───────────────────────────────────────────────────

describe('applyBoost: временное ускорение', () => {
  it('в начале буста нет; applyBoost(2, 0.8) выставляет boostTime и boostPower сразу, по окончании всё обнуляется', () => {
    const car = makeCar('razor', 30);
    expect(car.state.boostTime).toBe(0);
    expect(car.state.boostPower).toBe(0);
    expect(car.boostDuration).toBe(0);
    car.applyBoost(2, 0.8);
    expect(car.state.boostTime).toBeCloseTo(2, 9);
    expect(car.state.boostPower).toBeCloseTo(0.8, 9);
    expect(car.boostDuration).toBeCloseTo(2, 9);
    drive(car, 1, { throttle: 1 });
    expect(car.state.boostTime).toBeCloseTo(1, 1);
    drive(car, 1.1, { throttle: 1 });
    expect(car.state.boostTime).toBe(0);
    expect(car.state.boostPower).toBe(0);
    expect(car.boostDuration).toBe(0);
  });

  it('на максимальной скорости буст даёт +8…+16% к максималке (при мощности 1), у каждой машины; без буста — не выше maxSpeed', () => {
    for (const id of IDS) {
      const cfg = getHandling(id);
      const peak = (boost: boolean): number => {
        const car = makeCar(id, cfg.maxSpeed * 0.98);
        drive(car, 3, { throttle: 1 });
        if (boost) car.applyBoost(2.5, 1);
        let p = 0;
        drive(car, 5, { throttle: 1 }, () => (p = Math.max(p, car.state.speed)));
        return p;
      };
      const plain = peak(false);
      const boosted = peak(true);
      expect(plain, `${id}: без буста`).toBeLessThanOrEqual(cfg.maxSpeed * 1.002);
      expect(boosted / cfg.maxSpeed, `${id}: пик с бустом / maxSpeed`).toBeGreaterThanOrEqual(1.08);
      expect(boosted / cfg.maxSpeed, `${id}: пик с бустом / maxSpeed`).toBeLessThanOrEqual(1 + cfg.boostSpeedPct + 0.01);
    }
  });

  it('буст — ощутимое ускорение: с места за 2 с — на 40%+ быстрее, на 30 м/с разгон в 1.8+ раза сильнее', () => {
    for (const id of IDS) {
      const start = (boost: boolean): number => {
        const car = makeCar(id, 0);
        if (boost) car.applyBoost(2, 1);
        drive(car, 2, { throttle: 1 });
        return car.state.speed;
      };
      expect(start(true), `${id}: старт`).toBeGreaterThan(start(false) * 1.4);
      const accel = (boost: boolean): number => {
        const car = makeCar(id, 30);
        if (boost) car.applyBoost(2, 1);
        drive(car, 0.5, { throttle: 1 });
        return car.state.speed - 30;
      };
      expect(accel(true), `${id}: разгон на ходу`).toBeGreaterThan(accel(false) * 1.8);
    }
  });

  it('плавность: ускорение не «щёлкает» ни при нарастании, ни при затухании (скачок ax между шагами < 3 м/с²), мощность затухает монотонно', () => {
    const car = makeCar('razor', 40);
    drive(car, 1, { throttle: 1 });
    let prevV = car.state.speed;
    let prevAx = 0;
    let maxJump = 0;
    let first = true;
    car.applyBoost(2, 1);
    let prevP = car.state.boostPower;
    let fadeStart = -1;
    let t = 0;
    drive(car, 2.5, { throttle: 1 }, () => {
      const ax = (car.state.speed - prevV) / DT;
      if (!first) maxJump = Math.max(maxJump, Math.abs(ax - prevAx));
      first = false;
      prevAx = ax;
      prevV = car.state.speed;
      t += DT;
      // мощность (для HUD) не растёт после старта и убывает к нулю
      expect(car.state.boostPower).toBeLessThanOrEqual(prevP + 1e-9);
      if (fadeStart < 0 && car.state.boostPower < 0.999) fadeStart = t;
      prevP = car.state.boostPower;
    });
    expect(maxJump).toBeLessThan(3);
    expect(fadeStart, 'затухание началось в последние ~0.6 с').toBeGreaterThan(2 - 0.7);
    expect(fadeStart).toBeLessThanOrEqual(2);
  });

  it('после буста скорость выше максималки быстро сходит к ней (за ~4 с — в пределах 3%), прибавка не «висит» десятки секунд', () => {
    for (const id of IDS) {
      const cfg = getHandling(id);
      const car = makeCar(id, cfg.maxSpeed * 0.98);
      drive(car, 3, { throttle: 1 });
      car.applyBoost(2.5, 1);
      drive(car, 2.5 + 4, { throttle: 1 });
      expect(car.state.boostTime).toBe(0);
      expect(car.state.speed, id).toBeLessThanOrEqual(cfg.maxSpeed * 1.03);
    }
  });

  it('без газа буст не тянет: накат с бустом и без совпадает', () => {
    const coast = (boost: boolean): number => {
      const car = makeCar('razor', 40);
      if (boost) car.applyBoost(2, 1);
      drive(car, 1.5, {});
      return car.state.speed;
    };
    expect(coast(true)).toBeCloseTo(coast(false), 1);
  });

  it('не суммируется: слабее (power × seconds) — не замещает; сильнее — замещает; равный не меняет; мусор игнорируется', () => {
    const car = makeCar('razor', 30);
    car.applyBoost(2, 0.8);
    car.applyBoost(1, 0.5);
    expect(car.state.boostTime).toBeCloseTo(2, 9);
    expect(car.state.boostPower).toBeCloseTo(0.8, 9);
    car.applyBoost(2, 0.8);
    expect(car.state.boostTime).toBeCloseTo(2, 9);
    car.applyBoost(0, 1);
    car.applyBoost(-1, 1);
    car.applyBoost(1, 0);
    car.applyBoost(NaN, 1);
    car.applyBoost(1, NaN);
    expect(car.state.boostTime).toBeCloseTo(2, 9);
    expect(car.state.boostPower).toBeCloseTo(0.8, 9);
    // сильнее — замещает (длительность не складывается со старой)
    car.applyBoost(3, 1);
    expect(car.state.boostTime).toBeCloseTo(3, 9);
    expect(car.state.boostPower).toBeCloseTo(1, 9);
    // мощность зажимается в 0..1
    const car2 = makeCar('razor', 30);
    car2.applyBoost(1, 5);
    expect(car2.state.boostPower).toBe(1);
    // после того как старый буст почти кончился, даже слабый новый его замещает
    const car3 = makeCar('razor', 30);
    car3.applyBoost(1, 1);
    drive(car3, 0.9, { throttle: 1 });
    car3.applyBoost(1, 0.3);
    expect(car3.state.boostTime).toBeGreaterThan(0.9);
  });

  it('на старте с места (frozen) буст не тратится; reset обнуляет буст', () => {
    const car = makeCar('razor', 0);
    car.frozen = true;
    car.applyBoost(2, 1);
    drive(car, 1, { throttle: 1 });
    expect(car.state.boostTime).toBeCloseTo(2, 9);
    expect(car.state.speed).toBe(0);
    car.frozen = false;
    drive(car, 0.5, { throttle: 1 });
    expect(car.state.boostTime).toBeCloseTo(1.5, 1);
    const p = wide.sampleAt(300);
    car.reset(p.position, 0, 300);
    expect(car.state.boostTime).toBe(0);
    expect(car.state.boostPower).toBe(0);
    expect(car.boostDuration).toBe(0);
  });

  it('детерминированность: два одинаковых прогона с бустом дают одинаковое состояние', () => {
    const go = (): number => {
      const car = makeCar('grizzly', 20);
      car.applyBoost(2, 0.7);
      drive(car, 3, { throttle: 1, steer: 0.1 });
      return car.state.position.x * 1000 + car.state.speed;
    };
    expect(go()).toBe(go());
  });
});

// ─── Бонус за дрифт ────────────────────────────────────────────────────────

type DriftOut = { time: number; power: number; during: number };

/**
 * Занос на ровной площадке: разгон до speed, 0.3 с руль 0.6, затем Space + руль на T с, затем всё отпущено.
 * Возвращает максимальный буст за 2.5 с после отпускания и буст, который был в конце удержания (должен быть 0).
 */
function driftBoost(id: string, T: number, opts: { speed?: number; steer?: number; tr?: Track; s?: number; lateral?: number } = {}): DriftOut {
  const car = makeCar(id, opts.speed ?? 35, opts.tr ?? wide, opts.s ?? 300, opts.lateral ?? 0);
  drive(car, 0.3, { throttle: 1, steer: 0.6 });
  drive(car, T, { throttle: 1, steer: opts.steer ?? 1, handbrake: true });
  const out: DriftOut = { time: 0, power: 0, during: car.state.boostTime };
  drive(car, 2.5, {}, () => {
    if (car.state.boostTime > out.time) {
      out.time = car.state.boostTime;
      out.power = car.state.boostPower;
    }
  });
  return out;
}

describe('бонус за дрифт: качество заноса → буст', () => {
  it('пока занос идёт, буста нет; он выдаётся при выходе (после отпускания руля и Space)', () => {
    for (const id of IDS) {
      const car = makeCar(id, 35);
      drive(car, 0.3, { throttle: 1, steer: 0.6 });
      let during = 0;
      drive(car, 2, { throttle: 1, steer: 1, handbrake: true }, () => (during = Math.max(during, car.state.boostTime)));
      expect(car.state.drifting, id).toBe(true);
      expect(during, id + ': буст во время заноса').toBe(0);
      let got = 0;
      drive(car, 2, {}, () => (got = Math.max(got, car.state.boostTime)));
      expect(got, id + ': буст после выхода').toBeGreaterThan(0.5);
    }
  });

  it('случайный касательный занос (0.2 с) награды не даёт; без Space (W + A/D на сцеплении) буста нет', () => {
    for (const id of IDS) {
      expect(driftBoost(id, 0.2).time, `${id}: 0.2 с`).toBe(0);
      const car = makeCar(id, 40);
      let maxB = 0;
      drive(car, 5, { throttle: 1, steer: 1 }, () => (maxB = Math.max(maxB, car.state.boostTime)));
      expect(maxB, `${id}: GRIP`).toBe(0);
    }
  });

  it('короткий занос 0.6 с → ~0.5 с слабого буста; хороший длинный (2.5 с) → 1.5–3 с и сильнее (Razor ≥ 1.5 с, Grizzly ≥ 2 с)', () => {
    const razorS = driftBoost('razor', 0.6);
    expect(razorS.time).toBeGreaterThanOrEqual(0.3);
    expect(razorS.time).toBeLessThanOrEqual(0.8);
    expect(razorS.power).toBeLessThanOrEqual(0.45);
    const grizzlyS = driftBoost('grizzly', 0.6);
    expect(grizzlyS.time).toBeGreaterThanOrEqual(0.3);
    expect(grizzlyS.time).toBeLessThanOrEqual(1.0);
    expect(grizzlyS.power).toBeLessThanOrEqual(0.55);
    const razorL = driftBoost('razor', 2.5);
    expect(razorL.time).toBeGreaterThanOrEqual(1.5);
    expect(razorL.time).toBeLessThanOrEqual(3);
    expect(razorL.power).toBeGreaterThanOrEqual(0.55);
    const grizzlyL = driftBoost('grizzly', 2.5);
    expect(grizzlyL.time).toBeGreaterThanOrEqual(2);
    expect(grizzlyL.time).toBeLessThanOrEqual(3.2);
    expect(grizzlyL.power).toBeGreaterThanOrEqual(0.75);
    // сильный буст — это +10…15% к максималке: мощность × boostSpeedPct
    expect(grizzlyL.power * getHandling('grizzly').boostSpeedPct).toBeGreaterThanOrEqual(0.1);
    expect(grizzlyL.power * getHandling('grizzly').boostSpeedPct).toBeLessThanOrEqual(0.15);
  });

  it('чем дольше занос, тем больше буст, но с насыщением: прирост 2→3 с меньше прироста 1→2 с; потолок — boostDuration / boostPower машины', () => {
    for (const id of IDS) {
      const cfg = getHandling(id);
      const r = [0.4, 1, 2, 3, 5].map((T) => driftBoost(id, T));
      for (let i = 1; i < r.length; i++) {
        expect(r[i].time, `${id}: время буста, T${i}`).toBeGreaterThan(r[i - 1].time);
        expect(r[i].power, `${id}: мощность буста, T${i}`).toBeGreaterThanOrEqual(r[i - 1].power - 1e-9);
      }
      expect(r[3].time - r[2].time, id + ': насыщение').toBeLessThan(r[2].time - r[1].time);
      for (const x of r) {
        expect(x.time, id).toBeLessThanOrEqual(cfg.boostDuration + 1e-9);
        expect(x.power, id).toBeLessThanOrEqual(cfg.boostPower + 1e-9);
      }
    }
  });

  it('характер: при том же заносе Grizzly получает самый большой буст, Photon — самый слабый', () => {
    for (const T of [0.6, 1.5, 3]) {
      const [razor, grizzly, photon] = IDS.map((id) => driftBoost(id, T));
      expect(grizzly.time * grizzly.power, `T=${T}: Grizzly > Razor`).toBeGreaterThan(razor.time * razor.power);
      expect(razor.time * razor.power, `T=${T}: Razor > Photon`).toBeGreaterThan(photon.time * photon.power);
      expect(grizzly.time, `T=${T}`).toBeGreaterThan(photon.time * 1.5);
    }
  });

  it('качество растёт со скоростью и углом: занос на 45 м/с даёт больше, чем на 22 м/с; полный руль больше, чем слабый', () => {
    for (const id of IDS) {
      const slow = driftBoost(id, 2, { speed: 22 });
      const fast = driftBoost(id, 2, { speed: 45 });
      expect(fast.time, `${id}: 45 vs 22 м/с`).toBeGreaterThan(slow.time);
      const weak = driftBoost(id, 2, { steer: 0.35 });
      const full = driftBoost(id, 2, { steer: 1 });
      expect(full.time, `${id}: руль 1 vs 0.35`).toBeGreaterThan(weak.time);
    }
  });

  it('удар о стену в заносе сжигает качество: тот же длинный занос рядом со стеной буста не даёт', () => {
    for (const id of IDS) {
      // Sunset Loop, прямая: машина у правой стены, занос вправо — упирается в стену
      let wallHits = 0;
      const car = makeCar(id, 35, sunset, 100, 3);
      drive(car, 0.3, { throttle: 1, steer: 0.6 });
      drive(car, 2, { throttle: 1, steer: 1, handbrake: true }, () => {
        for (const e of car.events) if (e.type === 'wall' && e.strength > 0.15) wallHits++;
      });
      let got = 0;
      drive(car, 2.5, {}, () => (got = Math.max(got, car.state.boostTime)));
      expect(wallHits, `${id}: удар о стену`).toBeGreaterThan(0);
      expect(got, `${id}: буст после удара`).toBe(0);
      // то же на открытой площадке даёт буст
      expect(driftBoost(id, 2).time, `${id}: без стены`).toBeGreaterThan(0.5);
    }
  });

  it('несколько заносов подряд не суммируют буст сверх потолка машины', () => {
    for (const id of IDS) {
      const cfg = getHandling(id);
      const car = makeCar(id, 35);
      drive(car, 0.3, { throttle: 1, steer: 0.6 });
      let maxB = 0;
      for (let rep = 0; rep < 3; rep++) {
        drive(car, 2, { throttle: 1, steer: 1, handbrake: true });
        drive(car, 0.8, { throttle: 1 }, () => (maxB = Math.max(maxB, car.state.boostTime)));
      }
      expect(maxB, id).toBeGreaterThan(0);
      expect(maxB, id + ': не выше потолка').toBeLessThanOrEqual(cfg.boostDuration + 1e-9);
    }
  });

  it('слабый буст за короткий занос не перебивает остаток сильного: boostTime после выдачи сильного только убывает со временем (без скачков)', () => {
    const car = makeCar('grizzly', 40);
    drive(car, 0.3, { throttle: 1, steer: 0.6 });
    // длинный занос → сильный буст (~2.8 с), ждём его выдачи
    drive(car, 3, { throttle: 1, steer: 1, handbrake: true });
    let granted = 0;
    for (let k = 0; k < 2 * 120 && granted === 0; k++) {
      car.step(DT, ctl({ throttle: 1 }));
      granted = car.state.boostTime;
    }
    expect(granted, 'сильный буст выдан').toBeGreaterThan(2);
    // пока он действует — короткий слабый занос (его буст ~0.4 с × 0.4 мощности слабее остатка)
    let prev = car.state.boostTime;
    let jumped = false;
    let drifted = false;
    const track = (): void => {
      if (car.state.drifting) drifted = true;
      // остаток убывает ровно на шаг: ни роста, ни падения скачком (замещения слабым не было)
      if (Math.abs(prev - car.state.boostTime - DT) > 1e-6) jumped = true;
      prev = car.state.boostTime;
    };
    drive(car, 0.3, { throttle: 1, steer: 0.6 }, track);
    drive(car, 0.5, { throttle: 1, steer: 1, handbrake: true }, track);
    drive(car, 0.8, { throttle: 1 }, track);
    expect(drifted, 'второй занос состоялся').toBe(true);
    expect(jumped, 'слабый буст не перезаписал сильный').toBe(false);
    expect(car.state.boostTime, 'сильный буст ещё действует').toBeGreaterThan(0);
  });

  it('работает на любой машине, включая «свою сборку»: время и мощность буста конечны и в пределах параметров', () => {
    let seed = 777;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 10; i++) {
      const b: CustomBuild = { speed: rnd(), handling: rnd(), drift: rnd(), bodyColor: 0, neonColor: 0 };
      applyCustomHandling(b);
      const cfg = getHandling(CUSTOM_CAR_ID);
      const r = driftBoost(CUSTOM_CAR_ID, 2);
      const l = `(${b.speed.toFixed(2)}, ${b.handling.toFixed(2)}, ${b.drift.toFixed(2)})`;
      expect(Number.isFinite(r.time + r.power), l).toBe(true);
      expect(r.time, l).toBeGreaterThan(0.3);
      expect(r.time, l).toBeLessThanOrEqual(cfg.boostDuration + 1e-9);
      expect(r.power, l).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Параметры буста и «своя сборка» ───────────────────────────────────────

describe('параметры буста: HandlingConfig, панель тюнинга, «своя сборка»', () => {
  const KEYS: (keyof HandlingConfig)[] = [
    'boostDuration',
    'boostPower',
    'boostSpeedPct',
    'boostThrust',
    'boostMinQuality',
    'boostQualityRef',
  ];
  const mk = (speed: number, handling: number, drift: number): CustomBuild => ({ speed, handling, drift, bodyColor: 0, neonColor: 0 });

  it('все параметры буста есть у каждой машины, в панели тюнинга (группа «Буст») и в допустимых пределах', () => {
    for (const k of KEYS) {
      const p = HANDLING_PARAMS.find((x) => x.key === k);
      expect(p, k).toBeDefined();
      expect(p?.group, k).toBe('Буст');
      for (const id of [...IDS, CUSTOM_CAR_ID]) {
        const v = HANDLING_DEFAULTS[id][k];
        expect(v, `${id}.${k}`).toBeGreaterThanOrEqual((p as { min: number }).min);
        expect(v, `${id}.${k}`).toBeLessThanOrEqual((p as { max: number }).max);
      }
    }
  });

  it('характер заводских машин: Grizzly — самый большой и длинный буст и самый низкий порог, Photon — самый слабый', () => {
    const [razor, grizzly, photon] = IDS.map((id) => HANDLING_DEFAULTS[id]);
    expect(grizzly.boostPower).toBeGreaterThan(razor.boostPower);
    expect(razor.boostPower).toBeGreaterThan(photon.boostPower);
    expect(grizzly.boostDuration).toBeGreaterThan(razor.boostDuration);
    expect(razor.boostDuration).toBeGreaterThan(photon.boostDuration);
    expect(grizzly.boostMinQuality).toBeLessThan(razor.boostMinQuality);
    expect(razor.boostMinQuality).toBeLessThan(photon.boostMinQuality);
    expect(grizzly.boostQualityRef).toBeLessThan(razor.boostQualityRef);
    expect(razor.boostQualityRef).toBeLessThan(photon.boostQualityRef);
    // эффект единицы мощности одинаков у всех: стартовый буст (applyBoost) даёт всем машинам одно и то же
    expect(grizzly.boostSpeedPct).toBe(razor.boostSpeedPct);
    expect(razor.boostSpeedPct).toBe(photon.boostSpeedPct);
    expect(grizzly.boostThrust).toBe(razor.boostThrust);
    expect(razor.boostThrust).toBe(photon.boostThrust);
  });

  it('«своя сборка»: при «Управляемость» = 0.5 и «Дрифт» = 0 / 0.5 / 1 параметры буста совпадают с Photon / Razor / Grizzly', () => {
    const pairs: [number, HandlingConfig][] = [
      [0, HANDLING_DEFAULTS.photon],
      [0.5, HANDLING_DEFAULTS.razor],
      [1, HANDLING_DEFAULTS.grizzly],
    ];
    for (const [d, anchor] of pairs) {
      const cfg = customHandling(mk(0.5, 0.5, d));
      for (const k of KEYS) expect(cfg[k], `drift=${d} ${k}`).toBeCloseTo(anchor[k], 9);
    }
  });

  it('«своя сборка»: больше «Дрифт» — больше буст; больше «Управляемость» — меньше буст (цена сцепления)', () => {
    let prev = customHandling(mk(0.4, 0.4, 0));
    for (let d = 0.1; d <= 1.0001; d += 0.1) {
      const cur = customHandling(mk(0.4, 0.4, d));
      expect(cur.boostPower).toBeGreaterThanOrEqual(prev.boostPower - 1e-9);
      expect(cur.boostDuration).toBeGreaterThanOrEqual(prev.boostDuration - 1e-9);
      expect(cur.boostMinQuality).toBeLessThanOrEqual(prev.boostMinQuality + 1e-9);
      prev = cur;
    }
    for (const d of [0.2, 0.5, 0.9]) {
      const low = customHandling(mk(0.4, 0, d));
      const high = customHandling(mk(0.4, 1, d));
      expect(high.boostDuration, `drift=${d}`).toBeLessThan(low.boostDuration);
      if (low.boostPower < 1) expect(high.boostPower, `drift=${d}`).toBeLessThan(low.boostPower + 1e-9);
    }
  });

  it('цена сцепления у «своей сборки»: чем выше «Управляемость», тем медленнее разгон с места и сильнее потеря при лобовом ударе о стену', () => {
    const low = customHandling(mk(0.5, 0, 0.5));
    const high = customHandling(mk(0.5, 1, 0.5));
    expect(high.acceleration).toBeLessThan(low.acceleration);
    expect(high.wallHeadOnLoss).toBeGreaterThan(low.wallHeadOnLoss);
    expect(high.grip).toBeGreaterThan(low.grip);
    // самая цепкая сборка не цепче Photon, и «цена» не больше, чем у Photon
    expect(high.grip).toBeLessThanOrEqual(HANDLING_DEFAULTS.photon.grip + 1e-9);
    expect(high.wallHeadOnLoss).toBeLessThanOrEqual(HANDLING_DEFAULTS.photon.wallHeadOnLoss + 1e-9);
  });

  it('панель тюнинга: boostPower = 0 отключает награду за дрифт (буста нет), максимальные значения не ломают физику', () => {
    HANDLING.razor.boostPower = 0;
    expect(driftBoost('razor', 2).time).toBe(0);
    resetHandling();
    for (const k of KEYS) {
      const p = HANDLING_PARAMS.find((x) => x.key === k) as { min: number; max: number };
      for (const v of [p.min, p.max]) {
        (HANDLING.grizzly as Record<string, number>)[k] = v;
        const r = driftBoost('grizzly', 2);
        expect(Number.isFinite(r.time + r.power), `${k}=${v}`).toBe(true);
        const car = makeCar('grizzly', 40);
        car.applyBoost(2, 1);
        drive(car, 3, { throttle: 1 });
        expect(Number.isFinite(car.state.speed), `${k}=${v}`).toBe(true);
        expect(car.needsRespawn, `${k}=${v}`).toBe(false);
        resetHandling();
      }
    }
  });

  it('G для справки: тяга буста в пределах разумного (≤ 3 g)', () => {
    for (const id of IDS) expect(HANDLING_DEFAULTS[id].boostThrust).toBeLessThanOrEqual(3 * G);
  });
});
