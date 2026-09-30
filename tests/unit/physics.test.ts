import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Track } from '../../src/world/track';
import { SUNSET_LOOP } from '../../src/world/trackData';
import type { ControlPoint } from '../../src/world/trackData';
import { VehiclePhysics } from '../../src/vehicle/physics';
import { CAR_GEOMETRY, CAR_SPECS } from '../../src/vehicle/specs';
import { getHandling, steerAngleAt } from '../../src/vehicle/handling';
import type { VehicleControls } from '../../src/core/types';

const DT = 1 / 120;
const KMH = 3.6;
const track = new Track(SUNSET_LOOP);

/** Огромное кольцо с широкой дорогой — «бесконечная» ровная площадка для тестов динамики */
const widePts: ControlPoint[] = [];
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * Math.PI * 2;
  widePts.push([Math.cos(a) * 4000, 0, Math.sin(a) * 4000]);
}
const wide = new Track({ name: 'wide', points: widePts, defaultHalfWidth: 1500, checkpointCount: 8 });

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

describe('VehiclePhysics: разгон и скорость', () => {
  it('Razor разгоняется до 100 км/ч за 3.0–3.7 с', () => {
    const car = makeCar(wide, 0, 300);
    let t100 = -1;
    run(car, 8, () => ctl({ throttle: 1 }), (t) => {
      if (t100 < 0 && car.state.speed * KMH >= 100) t100 = t;
    });
    expect(t100).toBeGreaterThan(3.0);
    expect(t100).toBeLessThan(3.7);
  });

  it('все машины разгоняются до 100 км/ч за 3.0–3.7 с', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      const car = makeCar(wide, i, 300);
      let t100 = -1;
      run(car, 8, () => ctl({ throttle: 1 }), (t) => {
        if (t100 < 0 && car.state.speed * KMH >= 100) t100 = t;
      });
      expect(t100, CAR_SPECS[i].id).toBeGreaterThan(3.0);
      expect(t100, CAR_SPECS[i].id).toBeLessThan(3.7);
    }
  });

  it('максимальная скорость в пределах ±10% от maxSpeed (HANDLING) и не превышается', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      const spec = CAR_SPECS[i];
      const vmax = getHandling(spec.id).maxSpeed;
      const car = makeCar(wide, i, 300, vmax * 0.85);
      let peak = 0;
      run(car, 25, () => ctl({ throttle: 1 }), () => {
        peak = Math.max(peak, car.state.speed);
      });
      expect(car.state.speed, spec.id).toBeGreaterThan(vmax * 0.9);
      expect(peak, spec.id).toBeLessThan(vmax * 1.1);
    }
  });

  it('без газа машина медленно замедляется, но не разгоняется', () => {
    const car = makeCar(wide, 0, 300, 40);
    run(car, 2, () => ctl());
    expect(car.state.speed).toBeLessThan(40);
    expect(car.state.speed).toBeGreaterThan(30);
  });
});

describe('VehiclePhysics: торможение и задний ход', () => {
  it('торможение останавливает машину быстрее, чем за v/brakeDecel + 1 с', () => {
    const car = makeCar(wide, 0, 300, 60);
    let tStop = -1;
    run(car, 6, () => ctl({ brake: 1 }), (t) => {
      if (tStop < 0 && car.state.speed < 0.5) tStop = t;
    });
    expect(tStop).toBeGreaterThan(0);
    expect(tStop).toBeLessThan(60 / getHandling(CAR_SPECS[0].id).brakeDecel + 1);
  });

  it('после остановки удержание тормоза включает задний ход (не быстрее 12 м/с)', () => {
    const car = makeCar(wide, 0, 300, 10);
    run(car, 8, () => ctl({ brake: 1 }));
    expect(car.state.speed).toBeLessThan(-5);
    expect(car.state.speed).toBeGreaterThan(-12.5);
  });

  it('газ при движении назад тормозит и разворачивает вперёд', () => {
    const car = makeCar(wide, 0, 300);
    run(car, 3, () => ctl({ brake: 1 }));
    expect(car.state.speed).toBeLessThan(-2);
    run(car, 3, () => ctl({ throttle: 1 }));
    expect(car.state.speed).toBeGreaterThan(2);
  });
});

describe('VehiclePhysics: поворот', () => {
  it('steer +1 поворачивает вправо, −1 — влево', () => {
    for (const sign of [1, -1]) {
      const car = makeCar(wide, 0, 300, 20);
      const h0 = car.state.heading;
      const p0 = car.state.position.clone();
      const right = new Vector3(-Math.cos(h0), 0, Math.sin(h0));
      run(car, 2, () => ctl({ throttle: 0.5, steer: sign }));
      const dh = car.state.heading - h0;
      // вправо — курс уменьшается
      expect(Math.sign(dh)).toBe(-sign);
      expect(Math.abs(dh)).toBeGreaterThan(0.3);
      const disp = car.state.position.clone().sub(p0);
      expect(Math.sign(disp.dot(right))).toBe(sign);
      expect(car.state.lateral * sign).toBeGreaterThan(0.5);
    }
  });

  it('прямо при нулевом руле: курс не уходит', () => {
    const car = makeCar(wide, 0, 300, 40);
    const h0 = car.state.heading;
    run(car, 3, () => ctl({ throttle: 1 }));
    expect(Math.abs(car.state.heading - h0)).toBeLessThan(0.02);
  });

  it('угол передних колёс на 60 м/с — 30–40% от угла на месте (steerAngleAt)', () => {
    for (const spec of CAR_SPECS) {
      const cfg = getHandling(spec.id);
      const ratio = steerAngleAt(cfg, 60) / steerAngleAt(cfg, 0);
      expect(ratio, spec.id).toBeGreaterThan(0.3);
      expect(ratio, spec.id).toBeLessThan(0.4);
    }
  });

  it('на высокой скорости угол руля уменьшается, но не до нуля', () => {
    const slow = makeCar(wide, 0, 300, 20);
    const fast = makeCar(wide, 0, 300, 60);
    run(slow, 0.6, () => ctl({ steer: 0.3 }));
    run(fast, 0.6, () => ctl({ steer: 0.3 }));
    const ratio = Math.abs(fast.state.wheels[0].steerAngle) / Math.abs(slow.state.wheels[0].steerAngle);
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.75);
  });
});

describe('VehiclePhysics: занос и нитро', () => {
  it('ручник + руль на скорости включает drifting, даёт угол заноса и заряжает нитро', () => {
    const car = makeCar(wide, 0, 300, 30);
    let maxAngle = 0;
    let wasDrifting = false;
    run(car, 4, (t) => ctl({ throttle: 1, steer: 0.8, handbrake: t < 0.5 }), () => {
      maxAngle = Math.max(maxAngle, Math.abs(car.state.driftAngle));
      if (car.state.drifting) wasDrifting = true;
    });
    expect(wasDrifting).toBe(true);
    expect(car.state.drifting).toBe(true);
    expect(maxAngle).toBeGreaterThan(0.26); // > 15°
    expect(maxAngle).toBeLessThan(0.95); // < 55°
    expect(car.state.driftIntensity).toBeGreaterThan(0.3);
    expect(car.state.nitro).toBeGreaterThan(0.4);
  });

  it('угол заноса держится в разумных пределах при удержании газа и руля (все машины)', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      const car = makeCar(wide, i, 300, 32);
      const cfg = getHandling(CAR_SPECS[i].id);
      let minA = Infinity;
      let maxA = 0;
      run(car, 5, (t) => ctl({ throttle: 1, steer: 0.7, handbrake: t < 0.5 }), (t) => {
        if (t > 2.5) {
          const a = Math.abs(car.state.driftAngle);
          minA = Math.min(minA, a);
          maxA = Math.max(maxA, a);
        }
      });
      expect(car.state.drifting, CAR_SPECS[i].id).toBe(true);
      expect(minA, CAR_SPECS[i].id).toBeGreaterThan(0.2);
      expect(maxA, CAR_SPECS[i].id).toBeLessThan(cfg.driftMaxAngle + 0.05);
    }
  });

  it('резкий полный руль с газом на высокой скорости (без ручника) НЕ срывает в занос', () => {
    for (let i = 0; i < CAR_SPECS.length; i++) {
      const car = makeCar(wide, i, 300, 40);
      let drifted = false;
      run(car, 2.5, () => ctl({ throttle: 1, steer: 1 }), () => {
        if (car.state.drifting) drifted = true;
      });
      expect(drifted, CAR_SPECS[i].id).toBe(false);
    }
  });

  it('на малой скорости ручник + руль не вызывает занос', () => {
    const car = makeCar(wide, 0, 300, 8);
    run(car, 1.5, () => ctl({ throttle: 0.5, steer: 1, handbrake: true }));
    expect(car.state.drifting).toBe(false);
  });

  it('после отпускания газа и руля занос заканчивается', () => {
    const car = makeCar(wide, 0, 300, 30);
    run(car, 2, (t) => ctl({ throttle: 1, steer: 0.5, handbrake: t < 0.5 }));
    expect(car.state.drifting).toBe(true);
    run(car, 2, () => ctl({ throttle: 0, steer: 0 }));
    expect(car.state.drifting).toBe(false);
    expect(Math.abs(car.state.driftAngle)).toBeLessThan(0.05);
  });

  it('нитро ускоряет сильнее обычного газа и расходует шкалу ~0.3/с', () => {
    const a = makeCar(wide, 0, 300, 20);
    const b = makeCar(wide, 0, 300, 20);
    b.state.nitro = 1;
    run(a, 3, () => ctl({ throttle: 1 }));
    run(b, 3, () => ctl({ throttle: 1, nitro: true }));
    expect(b.state.speed).toBeGreaterThan(a.state.speed + 5);
    expect(b.state.nitro).toBeCloseTo(1 - 0.9, 1);
    expect(b.state.nitroActive).toBe(true);
    expect(a.state.nitroActive).toBe(false);
  });

  it('нитро поднимает максимальную скорость примерно на 15%', () => {
    const car = makeCar(wide, 0, 300, 60);
    car.state.nitro = 1;
    let peak = 0;
    run(car, 3, () => ctl({ throttle: 1, nitro: true }), () => {
      peak = Math.max(peak, car.state.speed);
    });
    const vmax = getHandling(CAR_SPECS[0].id).maxSpeed;
    expect(peak).toBeGreaterThan(vmax * 1.05);
    expect(peak).toBeLessThan(vmax * 1.2);
  });

  it('пустая шкала нитро не даёт ускорения', () => {
    const car = makeCar(wide, 0, 300, 20);
    car.state.nitro = 0;
    run(car, 1, () => ctl({ throttle: 1, nitro: true }));
    expect(car.state.nitroActive).toBe(false);
    expect(car.state.nitro).toBe(0);
  });

  it('стартовое нитро 0.25 после reset()', () => {
    const car = makeCar(wide, 0, 300);
    car.state.nitro = 0.9;
    car.reset(new Vector3(0, 0, 0), 0, 300);
    expect(car.state.nitro).toBe(0.25);
  });
});

describe('VehiclePhysics: стены', () => {
  it('не пропускает сквозь стену под 40° на 70 и 80 м/с', () => {
    for (const speed of [70, 80]) {
      for (const side of [1, -1]) {
        const s0 = 300;
        const car = makeCar(track, 2, s0, 0);
        const smp = track.sampleAt(s0);
        const h = Math.atan2(smp.tangent.x, smp.tangent.z) - (side * (40 * Math.PI)) / 180;
        car.state.heading = h;
        car.state.velocity.x = Math.sin(h) * speed;
        car.state.velocity.z = Math.cos(h) * speed;
        let maxLat = 0;
        let wallEvents = 0;
        let maxStrength = 0;
        run(car, 3, () => ctl({ throttle: 1 }), () => {
          maxLat = Math.max(maxLat, Math.abs(car.state.lateral));
          for (const e of car.events) {
            if (e.type === 'wall') {
              wallEvents++;
              maxStrength = Math.max(maxStrength, e.strength);
            }
          }
        });
        expect(maxLat, `v=${speed} side=${side}`).toBeLessThan(smp.halfWidth);
        expect(wallEvents).toBeGreaterThan(0);
        expect(maxStrength).toBeGreaterThan(0.5);
      }
    }
  });

  it('удар о стену уменьшает скорость и слегка доворачивает вдоль стены', () => {
    const s0 = 300;
    const car = makeCar(track, 0, s0, 0);
    const smp = track.sampleAt(s0);
    const along = Math.atan2(smp.tangent.x, smp.tangent.z);
    const h = along + (30 * Math.PI) / 180; // влево (lateral < 0)
    car.state.heading = h;
    car.state.velocity.x = Math.sin(h) * 50;
    car.state.velocity.z = Math.cos(h) * 50;
    let hit = false;
    let vHit = 50;
    let headingAtHit = h;
    for (let k = 0; k < 120 * 3 && !hit; k++) {
      car.step(DT, ctl({ throttle: 0.5 }));
      if (car.events.some((e) => e.type === 'wall')) {
        hit = true;
        vHit = Math.hypot(car.state.velocity.x, car.state.velocity.z);
        headingAtHit = car.state.heading;
      }
    }
    expect(hit).toBe(true);
    // курс довернулся к оси дороги
    expect(Math.abs(headingAtHit - along)).toBeLessThan(Math.abs(h - along));
    expect(vHit).toBeLessThan(50);
    expect(vHit).toBeGreaterThan(20);
  });

  it('скольжение вдоль стены не даёт частых сильных событий', () => {
    const car = makeCar(track, 0, 300, 30);
    const smp = track.sampleAt(300);
    // прижимаем к стене и едем вдоль
    car.state.position.addScaledVector(smp.right, smp.halfWidth - 1.5);
    let strong = 0;
    run(car, 2, () => ctl({ throttle: 1, steer: 0.3 }), () => {
      for (const e of car.events) if (e.type === 'wall' && e.strength > 0.3) strong++;
    });
    expect(strong).toBeLessThan(6);
  });
});

describe('VehiclePhysics: подвеска, трамплин, посадка', () => {
  it('в покое стоит на дороге на высоте радиуса колеса, подвеска сжата на ~50%', () => {
    for (const s of [300, 1200]) {
      const car = makeCar(track, 0, s);
      run(car, 2, () => ctl());
      const pr = track.project(car.state.position, s);
      expect(car.state.position.y - pr.height).toBeCloseTo(CAR_GEOMETRY.wheelRadius, 1);
      expect(car.state.onGround).toBe(true);
      for (const w of car.state.wheels) {
        expect(w.onGround).toBe(true);
        expect(w.compression).toBeGreaterThan(0.35);
        expect(w.compression).toBeLessThan(0.65);
      }
    }
  });

  it('на эстакаде машина остаётся на верхнем уровне', () => {
    const car = makeCar(track, 0, 1150, 25);
    run(car, 2, () => ctl({ throttle: 0.6 }));
    expect(car.state.position.y).toBeGreaterThan(6);
    expect(car.state.onGround).toBe(true);
  });

  it('на высокой скорости на гребне трамплина отрывается, затем приземляется с событием land', () => {
    for (const speed of [42, 55]) {
      const car = makeCar(track, 0, 50, speed);
      let leftGround = false;
      let landStrength = 0;
      let maxAir = 0;
      let landedAfterAir = false;
      run(car, 6, () => ctl({ throttle: 1 }), () => {
        if (!car.state.onGround) {
          leftGround = true;
          maxAir = Math.max(maxAir, car.state.airTime);
        }
        for (const e of car.events) {
          if (e.type === 'land') landStrength = Math.max(landStrength, e.strength);
        }
        if (leftGround && car.state.onGround) landedAfterAir = true;
      });
      expect(leftGround, `v=${speed}`).toBe(true);
      expect(landedAfterAir, `v=${speed}`).toBe(true);
      expect(landStrength, `v=${speed}`).toBeGreaterThan(0.15);
      expect(maxAir, `v=${speed}`).toBeGreaterThan(0.3);
      // не улетает с дороги
      expect(Math.abs(car.state.lateral)).toBeLessThan(track.halfWidth);
    }
  });

  it('на малой скорости трамплин не отрывает от земли', () => {
    const car = makeCar(track, 0, 50, 18);
    let air = false;
    run(car, 8, () => ctl({ throttle: 0.2 }), () => {
      if (!car.state.onGround) air = true;
    });
    expect(air).toBe(false);
  });

  it('после посадки колёса на земле, airTime сброшен', () => {
    const car = makeCar(track, 0, 50, 55);
    run(car, 7, () => ctl({ throttle: 0.3 }));
    expect(car.state.onGround).toBe(true);
    for (const w of car.state.wheels) expect(w.onGround).toBe(true);
    expect(car.state.airTime).toBe(0);
  });

  it('кузов повторяет рельеф: на въезде на гребень нос вверх, на эстакаде — по уклону', () => {
    const fwd = new Vector3();
    const pitchOf = (car: VehiclePhysics): number => {
      fwd.set(0, 0, 1).applyQuaternion(car.state.quaternion);
      return Math.asin(fwd.y);
    };
    // подъём на трамплин (без отрыва: малая скорость): нос заметно выше горизонта
    const ramp = makeCar(track, 0, 20, 22);
    let maxPitch = 0;
    run(ramp, 3, () => ctl({ throttle: 0.3 }), () => {
      maxPitch = Math.max(maxPitch, pitchOf(ramp));
    });
    expect(maxPitch).toBeGreaterThan(0.05);
    // подъём на эстакаду
    const bridge = makeCar(track, 0, 1100, 22);
    let bridgePitch = 0;
    run(bridge, 3, () => ctl({ throttle: 0.5 }), () => {
      bridgePitch = Math.max(bridgePitch, pitchOf(bridge));
    });
    expect(bridgePitch).toBeGreaterThan(0.05);
    expect(bridge.state.position.y).toBeGreaterThan(3);
  });

  it('у каждого колеса своя высота: на уклоне точки контакта лежат на разной высоте', () => {
    const car = makeCar(track, 0, 1100, 15);
    run(car, 0.6, () => ctl({ throttle: 0.4 }));
    const w = car.state.wheels;
    const frontY = (w[0].contact.y + w[1].contact.y) / 2;
    const rearY = (w[2].contact.y + w[3].contact.y) / 2;
    expect(frontY - rearY).toBeGreaterThan(0.1);
  });

  it('в воздухе колёса на полном отбое: compression 0, onGround false', () => {
    const car = makeCar(track, 0, 50, 60);
    let checked = false;
    run(car, 3, () => ctl({ throttle: 1 }), () => {
      if (!car.state.onGround && car.state.airTime > 0.3) {
        checked = true;
        for (const w of car.state.wheels) {
          expect(w.compression).toBe(0);
          expect(w.onGround).toBe(false);
        }
      }
    });
    expect(checked).toBe(true);
  });

  it('wheels[].contact лежит на дороге', () => {
    const car = makeCar(track, 0, 300);
    run(car, 1, () => ctl());
    for (const w of car.state.wheels) {
      expect(Math.abs(w.contact.y)).toBeLessThan(0.15);
    }
  });
});

describe('VehiclePhysics: frozen, reset, служебное', () => {
  it('frozen: машина стоит на месте, мотор реагирует на газ', () => {
    const car = makeCar(track, 0, 300);
    car.frozen = true;
    const p0 = car.state.position.clone();
    run(car, 1.5, () => ctl({ throttle: 1 }));
    expect(car.state.position.distanceTo(p0)).toBeLessThan(0.05);
    expect(Math.abs(car.state.speed)).toBeLessThan(0.01);
    expect(car.state.rpm).toBeGreaterThan(0.7);
    run(car, 1.5, () => ctl({ throttle: 0 }));
    expect(car.state.rpm).toBeLessThan(0.3);
    // разморозка — едет
    car.frozen = false;
    run(car, 2, () => ctl({ throttle: 1 }));
    expect(car.state.speed).toBeGreaterThan(10);
  });

  it('reset() обнуляет скорости, занос и выставляет trackS', () => {
    const car = makeCar(track, 0, 300, 40);
    run(car, 1, () => ctl({ throttle: 1, steer: 1, handbrake: true }));
    const smp = track.sampleAt(700);
    car.reset(smp.position, 1.234, 700);
    expect(car.state.velocity.length()).toBe(0);
    expect(car.state.speed).toBe(0);
    expect(car.state.yawRate).toBe(0);
    expect(car.state.drifting).toBe(false);
    expect(car.state.driftAngle).toBe(0);
    expect(car.state.heading).toBe(1.234);
    expect(Math.abs(car.state.trackS - 700)).toBeLessThan(1);
    expect(car.state.nitro).toBe(0.25);
    expect(car.needsRespawn).toBe(false);
  });

  it('обороты в диапазоне 0..1, передачи переключаются с просадкой rpm', () => {
    const car = makeCar(wide, 0, 300);
    let prev = 0;
    let drops = 0;
    const gears = new Set<number>();
    run(car, 14, () => ctl({ throttle: 1 }), () => {
      if (car.state.rpm < prev - 0.03) drops++;
      prev = car.state.rpm;
      gears.add(car.state.gear);
      expect(car.state.rpm).toBeGreaterThanOrEqual(0);
      expect(car.state.rpm).toBeLessThanOrEqual(1);
    });
    expect(gears.size).toBeGreaterThanOrEqual(5);
    expect(drops).toBeGreaterThan(0);
  });

  it('провал под дорогу выставляет needsRespawn', () => {
    const car = makeCar(track, 0, 300, 20);
    run(car, 0.5, () => ctl());
    expect(car.needsRespawn).toBe(false);
    car.state.position.y -= 8;
    run(car, 0.2, () => ctl());
    expect(car.needsRespawn).toBe(true);
  });

  it('события очищаются в начале каждого step()', () => {
    const car = makeCar(track, 0, 300, 60);
    const smp = track.sampleAt(300);
    const h = Math.atan2(smp.tangent.x, smp.tangent.z) + 0.7;
    car.state.heading = h;
    car.state.velocity.x = Math.sin(h) * 60;
    car.state.velocity.z = Math.cos(h) * 60;
    let sawEvent = false;
    for (let k = 0; k < 120 * 2; k++) {
      car.step(DT, ctl({ throttle: 1 }));
      if (car.events.length > 0) sawEvent = true;
    }
    expect(sawEvent).toBe(true);
    car.state.velocity.set(0, 0, 0);
    car.step(DT, ctl());
    expect(car.events.length).toBe(0);
  });

  it('powerScale масштабирует тягу', () => {
    const a = makeCar(wide, 0, 300);
    const b = makeCar(wide, 0, 300);
    b.powerScale = 1.1;
    run(a, 3, () => ctl({ throttle: 1 }));
    run(b, 3, () => ctl({ throttle: 1 }));
    expect(b.state.speed).toBeGreaterThan(a.state.speed);
  });

  it('состояние всегда конечное при случайном управлении, quaternion нормализован', () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const car = makeCar(track, 1, 300, 20);
    for (let k = 0; k < 120 * 60; k++) {
      if (k % 30 === 0 && car.needsRespawn) {
        const g = track.gridPose(0);
        car.reset(g.position, g.heading, g.s);
      }
      car.step(
        DT,
        ctl({
          throttle: rnd(),
          brake: rnd() < 0.2 ? rnd() : 0,
          steer: rnd() * 2 - 1,
          handbrake: rnd() < 0.1,
          nitro: rnd() < 0.3,
        }),
      );
      const st = car.state;
      if (!Number.isFinite(st.position.x + st.position.y + st.position.z + st.speed + st.yawRate)) {
        throw new Error(`NaN at step ${k}`);
      }
    }
    const q = car.state.quaternion;
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 3);
  });
});
