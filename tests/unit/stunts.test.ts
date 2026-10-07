import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { Track } from '../../src/world/track';
import { SUNSET_LOOP } from '../../src/world/trackData';
import { VehiclePhysics } from '../../src/vehicle/physics';
import { CAR_SPECS } from '../../src/vehicle/specs';
import { StuntScorer } from '../../src/race/stunts';
import type { StuntEvent } from '../../src/race/stunts';
import type { VehicleControls, VehicleState } from '../../src/core/types';

const DT = 1 / 120;

function fake(): VehicleState {
  return {
    position: new Vector3(),
    quaternion: new Quaternion(),
    velocity: new Vector3(0, 0, 50),
    heading: 0,
    onGround: true,
  } as unknown as VehicleState;
}

/** Синтетический прыжок: air секунд в воздухе, пик height, затем посадка с заданным наклоном/скольжением */
function jump(sc: StuntScorer, air: number, height: number, tilt = 0, slipAng = 0): StuntEvent[] {
  const st = fake();
  const out: StuntEvent[] = [];
  sc.update(DT, st);
  st.onGround = false;
  const n = Math.round(air / DT);
  for (let i = 0; i < n; i++) {
    st.position.y = height * Math.sin((i / n) * Math.PI);
    sc.update(DT, st);
  }
  st.onGround = true;
  st.position.y = 0;
  st.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), tilt);
  st.velocity.set(Math.sin(slipAng) * 50, 0, Math.cos(slipAng) * 50);
  for (const e of sc.update(DT, st)) out.push({ ...e });
  return out;
}

describe('трюки: синтетика', () => {
  it('короткий полёт (кочка) — без события', () => {
    expect(jump(new StuntScorer(), 0.2, 0.1)).toHaveLength(0);
  });
  it('метки по времени в воздухе', () => {
    const sc = new StuntScorer();
    expect(jump(sc, 0.6, 2)[0].label).toBe('AIR');
    expect(jump(sc, 1.1, 5)[0].label).toBe('BIG AIR');
    expect(jump(sc, 1.8, 10)[0].label).toBe('HUGE AIR!');
  });
  it('награда растёт с размером прыжка', () => {
    const sc = new StuntScorer();
    const a = jump(sc, 0.6, 2)[0];
    const b = jump(sc, 1.8, 10)[0];
    expect(b.points).toBeGreaterThan(a.points);
    expect(b.nitro).toBeGreaterThan(a.nitro);
    expect(a.points).toBeGreaterThan(0);
  });
  it('идеальная посадка: PERFECT и бонус', () => {
    const sc = new StuntScorer();
    const e = jump(sc, 1.1, 5, 0.03, 0.02)[0];
    expect(e.perfect).toBe(true);
    const ok = jump(sc, 1.1, 5, 0.25, 0.3)[0];
    expect(ok.perfect).toBe(false);
    expect(ok.hard).toBe(false);
    expect(e.points).toBeGreaterThan(ok.points);
    expect(e.nitro).toBeGreaterThan(ok.nitro);
  });
  it('жёсткая посадка (кувырок или боком) — без награды', () => {
    const sc = new StuntScorer();
    for (const e of [jump(sc, 1.2, 5, 1.0, 0)[0], jump(sc, 1.2, 5, 0, 1.2)[0]]) {
      expect(e.hard).toBe(true);
      expect(e.points).toBe(0);
      expect(e.nitro).toBe(0);
      expect(e.perfect).toBe(false);
    }
  });
  it('массив событий переиспользуется, reset сбрасывает полёт', () => {
    const sc = new StuntScorer();
    const st = fake();
    const a = sc.update(DT, st);
    expect(sc.update(DT, st)).toBe(a);
    st.onGround = false;
    sc.update(1, st);
    sc.reset();
    st.onGround = true;
    expect(sc.update(DT, st)).toHaveLength(0);
  });
});

describe('трюки: реальный прыжок', () => {
  it('трамплин Sunset Loop на скорости даёт событие с наградой', () => {
    const track = new Track(SUNSET_LOOP);
    const car = new VehiclePhysics(CAR_SPECS[0], track);
    const smp = track.sampleAt(50);
    const h = Math.atan2(smp.tangent.x, smp.tangent.z);
    car.reset(smp.position, h, 50);
    car.state.velocity.set(Math.sin(h) * 55, 0, Math.cos(h) * 55);
    const sc = new StuntScorer();
    const ctl: VehicleControls = { throttle: 0.3, brake: 0, steer: 0, handbrake: false, nitro: false };
    const got: StuntEvent[] = [];
    for (let k = 0; k < 7 * 120; k++) {
      car.step(DT, ctl);
      for (const e of sc.update(DT, car.state)) got.push({ ...e });
    }
    expect(got.length).toBe(1);
    expect(got[0].airTime).toBeGreaterThan(0.4);
    expect(got[0].height).toBeGreaterThan(0.5);
    expect(got[0].hard).toBe(false);
    expect(got[0].points).toBeGreaterThan(0);
  });
});
