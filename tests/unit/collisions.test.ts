import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Track } from '../../src/world/track';
import { SUNSET_LOOP } from '../../src/world/trackData';
import { VehiclePhysics } from '../../src/vehicle/physics';
import { resolveCarCollisions } from '../../src/vehicle/collisions';
import { CAR_GEOMETRY, CAR_SPECS } from '../../src/vehicle/specs';

const track = new Track(SUNSET_LOOP);
const CIRCLE_R = 1.05;
const OFFSET = CAR_GEOMETRY.length / 2 - CIRCLE_R;

function place(specIndex: number, x: number, z: number, heading: number, speed = 0): VehiclePhysics {
  const car = new VehiclePhysics(CAR_SPECS[specIndex], track);
  const base = track.sampleAt(300).position;
  car.reset(new Vector3(base.x + x, 0, base.z + z), heading, 300);
  car.state.velocity.x = Math.sin(heading) * speed;
  car.state.velocity.z = Math.cos(heading) * speed;
  return car;
}

/** Минимальная глубина проникновения между кругами двух машин (>0 — пересекаются) */
function penetration(a: VehiclePhysics, b: VehiclePhysics): number {
  let worst = -Infinity;
  for (const oa of [OFFSET, -OFFSET]) {
    for (const ob of [OFFSET, -OFFSET]) {
      const ax = a.state.position.x + Math.sin(a.state.heading) * oa;
      const az = a.state.position.z + Math.cos(a.state.heading) * oa;
      const bx = b.state.position.x + Math.sin(b.state.heading) * ob;
      const bz = b.state.position.z + Math.cos(b.state.heading) * ob;
      worst = Math.max(worst, CIRCLE_R * 2 - Math.hypot(bx - ax, bz - az));
    }
  }
  return worst;
}

describe('resolveCarCollisions', () => {
  it('раздвигает пересекающиеся машины так, что они не пересекаются', () => {
    const a = place(0, 0, 0, 0);
    const b = place(1, 0.4, 1.2, 0.3);
    expect(penetration(a, b)).toBeGreaterThan(0.5);
    for (let i = 0; i < 3; i++) resolveCarCollisions([a, b]);
    expect(penetration(a, b)).toBeLessThan(0.05);
  });

  it('лобовое столкновение: машины отталкиваются, суммарный импульс сохраняется', () => {
    const a = place(0, 0, 0, 0, 20);
    const b = place(0, 0, 4.3, Math.PI, 20); // навстречу, перекрытие ≈ 0.1 м
    const p0 = a.spec.mass * a.state.velocity.z + b.spec.mass * b.state.velocity.z;
    resolveCarCollisions([a, b]);
    const p1 = a.spec.mass * a.state.velocity.z + b.spec.mass * b.state.velocity.z;
    expect(Math.abs(p1 - p0)).toBeLessThan(1e-6 * a.spec.mass * 40);
    // после удара расходятся: A едет назад, B — вперёд
    expect(a.state.velocity.z).toBeLessThan(0);
    expect(b.state.velocity.z).toBeGreaterThan(0);
    // скорость отскока ≈ e · v (0.3 · 20)
    expect(Math.abs(a.state.velocity.z)).toBeGreaterThan(2);
    expect(Math.abs(a.state.velocity.z)).toBeLessThan(12);
  });

  it('добавляет событие car обеим машинам с силой 0..1; расходящиеся машины событий не дают', () => {
    const a = place(0, 0, 0, 0, 20);
    const b = place(0, 0, 4.0, Math.PI, 20);
    resolveCarCollisions([a, b]);
    for (const c of [a, b]) {
      const ev = c.events.filter((e) => e.type === 'car');
      expect(ev.length).toBe(1);
      expect(ev[0].strength).toBeGreaterThan(0.1);
      expect(ev[0].strength).toBeLessThanOrEqual(1);
    }
    // теперь они расходятся и не пересекаются — нового события нет
    a.events.length = 0;
    resolveCarCollisions([a, b]);
    expect(a.events.length).toBe(0);
  });

  it('тяжёлая машина сдвигается меньше лёгкой', () => {
    const light = place(0, 0, 0, 0); // Razor 1150 кг
    const heavy = place(1, 0, 3.0, 0); // Grizzly 1550 кг
    const l0 = light.state.position.clone();
    const h0 = heavy.state.position.clone();
    resolveCarCollisions([light, heavy]);
    const dl = light.state.position.distanceTo(l0);
    const dh = heavy.state.position.distanceTo(h0);
    expect(dl).toBeGreaterThan(dh);
    expect(dl + dh).toBeGreaterThan(0.5);
  });

  it('догоняющая машина передаёт импульс: быстрая замедляется, медленная ускоряется', () => {
    const slow = place(0, 0, 4.3, 0, 10);
    const fast = place(0, 0, 0, 0, 30);
    resolveCarCollisions([fast, slow]);
    expect(fast.state.velocity.z).toBeLessThan(30);
    expect(slow.state.velocity.z).toBeGreaterThan(10);
  });

  it('боковой удар вызывает лёгкое вращение рыскания', () => {
    const a = place(0, 0, 0, 0, 20);
    const b = place(0, 1.6, 2.4, 0, 20); // сбоку-спереди, чуть выше по Z
    b.state.velocity.x = -6;
    resolveCarCollisions([a, b]);
    expect(Math.abs(a.state.yawRate) + Math.abs(b.state.yawRate)).toBeGreaterThan(0.01);
    expect(Math.abs(a.state.yawRate)).toBeLessThan(3);
  });

  it('машины на разных уровнях (эстакада) не сталкиваются', () => {
    const a = place(0, 0, 0, 0, 10);
    const b = place(0, 0, 0.5, 0, 10);
    b.state.position.y = a.state.position.y + 11;
    const pa = a.state.position.clone();
    const pb = b.state.position.clone();
    const va = a.state.velocity.clone();
    resolveCarCollisions([a, b]);
    expect(a.state.position.equals(pa)).toBe(true);
    expect(b.state.position.equals(pb)).toBe(true);
    expect(a.state.velocity.equals(va)).toBe(true);
    expect(a.events.length).toBe(0);
    expect(b.events.length).toBe(0);
  });

  it('далёкие машины не затрагиваются', () => {
    const a = place(0, 0, 0, 0, 10);
    const b = place(0, 30, 0, 0, 10);
    const pa = a.state.position.clone();
    resolveCarCollisions([a, b]);
    expect(a.state.position.equals(pa)).toBe(true);
    expect(a.events.length).toBe(0);
  });

  it('стая из шести машин в куче распутывается без пересечений', () => {
    const cars = [
      place(0, 0, 0, 0.1),
      place(1, 1.0, 0.8, -0.2),
      place(2, -0.8, 1.6, 0.4),
      place(0, 0.5, -1.2, 1.2),
      place(1, -1.5, -0.3, 2.0),
      place(2, 1.4, 2.0, -0.9),
    ];
    for (let i = 0; i < 40; i++) resolveCarCollisions(cars);
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        expect(penetration(cars[i], cars[j]), `${i}-${j}`).toBeLessThan(0.1);
      }
    }
  });

  it('в движении: две машины, идущие в одну точку, не проходят друг сквозь друга', () => {
    const a = place(0, -6, 0, Math.PI / 2, 20); // едет к +X
    const b = place(0, 6, 0.5, -Math.PI / 2, 20); // едет к −X
    let minSep = Infinity;
    for (let k = 0; k < 120 * 2; k++) {
      // без step физики — простое интегрирование, чтобы проверить только контакт
      for (const c of [a, b]) {
        c.state.position.x += c.state.velocity.x / 120;
        c.state.position.z += c.state.velocity.z / 120;
      }
      resolveCarCollisions([a, b]);
      minSep = Math.min(minSep, -penetration(a, b));
    }
    expect(minSep).toBeGreaterThan(-0.3);
  });
});
