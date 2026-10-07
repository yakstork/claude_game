import { describe, expect, it } from 'vitest';
import { Track } from '../../src/world/track';
import type { ControlPoint } from '../../src/world/trackData';
import { VehiclePhysics } from '../../src/vehicle/physics';
import { CAR_SPECS } from '../../src/vehicle/specs';
import { inSlipstreamCone, parkEliminated, updateSlipstream } from '../../src/vehicle/slipstream';
import type { VehicleControls } from '../../src/core/types';

const DT = 1 / 120;
const pts: ControlPoint[] = [];
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * Math.PI * 2;
  pts.push([Math.cos(a) * 4000, 0, Math.sin(a) * 4000]);
}
const wide = new Track({ name: 'wide', points: pts, defaultHalfWidth: 1500, checkpointCount: 8 });

function ctl(o: Partial<VehicleControls> = {}): VehicleControls {
  return { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false, ...o };
}

function makeCar(speed: number, s: number, lateral = 0): VehiclePhysics {
  const car = new VehiclePhysics(CAR_SPECS[0], wide);
  const p = wide.sampleAt(s);
  const pos = p.position.clone().addScaledVector(p.right, lateral);
  const h = Math.atan2(p.tangent.x, p.tangent.z);
  car.reset(pos, h, s);
  car.state.velocity.set(Math.sin(h) * speed, 0, Math.cos(h) * speed);
  car.state.speed = speed;
  return car;
}

describe('слипстрим: конус', () => {
  it('в конусе позади лидера', () => {
    const a = makeCar(50, 300);
    const b = makeCar(50, 315);
    expect(inSlipstreamCone(a.state, b.state)).toBe(true);
    expect(inSlipstreamCone(b.state, a.state)).toBe(false);
  });
  it('слишком далеко, сбоку, медленно', () => {
    const a = makeCar(50, 300);
    expect(inSlipstreamCone(a.state, makeCar(50, 340).state)).toBe(false);
    expect(inSlipstreamCone(a.state, makeCar(50, 315, 8).state)).toBe(false);
    expect(inSlipstreamCone(a.state, makeCar(15, 315).state)).toBe(false);
    expect(inSlipstreamCone(makeCar(15, 300).state, makeCar(50, 315).state)).toBe(false);
  });
});

describe('слипстрим: нарастание и спад', () => {
  it('~1 с до максимума, быстрый спад', () => {
    const a = makeCar(50, 300);
    const b = makeCar(50, 315);
    const states = [a.state, b.state];
    for (let i = 0; i < 60; i++) updateSlipstream(states, DT);
    expect(a.state.slipstream).toBeGreaterThan(0.4);
    expect(a.state.slipstream).toBeLessThan(0.6);
    for (let i = 0; i < 80; i++) updateSlipstream(states, DT);
    expect(a.state.slipstream).toBe(1);
    expect(b.state.slipstream).toBe(0);
    b.state.position.x += 100;
    for (let i = 0; i < 60; i++) updateSlipstream(states, DT);
    expect(a.state.slipstream).toBe(0);
  });
});

describe('слипстрим: эффект', () => {
  function run(slip: boolean): { v: number; nitro: number } {
    const car = makeCar(60, 300);
    car.state.nitro = 0.1;
    for (let i = 0; i < 120 * 14; i++) {
      car.state.slipstream = slip ? 1 : 0;
      car.step(DT, ctl());
    }
    return { v: car.state.speed, nitro: car.state.nitro };
  }
  it('повышает предел скорости на 3-8% и заряжает нитро', () => {
    const base = run(false);
    const sl = run(true);
    const gain = sl.v / base.v - 1;
    expect(gain).toBeGreaterThan(0.03);
    expect(gain).toBeLessThan(0.08);
    expect(sl.nitro).toBeGreaterThan(base.nitro + 0.1);
  });
});

describe('выбывшая машина', () => {
  it('припаркованная не даёт слипстрим машине позади', () => {
    const leader = makeCar(60, 300);
    const follower = makeCar(60, 280);
    expect(inSlipstreamCone(follower.state, leader.state)).toBe(true);
    parkEliminated(leader.state);
    expect(inSlipstreamCone(follower.state, leader.state)).toBe(false);
    for (let i = 0; i < 400; i++) updateSlipstream([follower.state, leader.state], DT);
    expect(follower.state.slipstream).toBe(0);
    expect(leader.state.position.y).toBeLessThan(-100);
  });
});
