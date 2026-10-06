import { describe, expect, it } from 'vitest';
import { Track } from '../../src/world/track';
import type { ControlPoint } from '../../src/world/trackData';
import { VehiclePhysics } from '../../src/vehicle/physics';
import { updateSlipstream } from '../../src/vehicle/slipstream';
import { BotDriver } from '../../src/ai/botDriver';
import { BOT_PROFILES, specById } from '../../src/vehicle/specs';

/** Боты и слипстрим: на прямой бот садится в мешок за лидером, а при полном мешке уходит на обгон. */

const DT = 1 / 120;
const pts: ControlPoint[] = [];
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * Math.PI * 2;
  pts.push([Math.cos(a) * 4000, 0, Math.sin(a) * 4000]);
}
const ring = new Track({ name: 'ring', points: pts, defaultHalfWidth: 14, checkpointCount: 8 });

function place(car: VehiclePhysics, s: number, lateral: number, speed: number): void {
  const p = ring.sampleAt(s);
  const pos = p.position.clone().addScaledVector(p.right, lateral);
  const h = Math.atan2(p.tangent.x, p.tangent.z);
  car.reset(pos, h, s);
  car.state.velocity.set(Math.sin(h) * speed, 0, Math.cos(h) * speed);
  car.state.speed = speed;
}

interface DraftRun {
  coneShare: number;
  full: number;
  passed: boolean;
}

function chase(draft: boolean, seed: number): DraftRun {
  const leader = new VehiclePhysics(specById(BOT_PROFILES[4].carId), ring);
  const chaser = new VehiclePhysics(specById(BOT_PROFILES[0].carId), ring);
  place(leader, 300, 0, 50);
  place(chaser, 250, 0, 50);
  const bl = new BotDriver(ring, BOT_PROFILES[4], seed);
  const bc = new BotDriver(ring, BOT_PROFILES[0], seed + 1);
  bc.draftEnabled = draft;
  bl.draftEnabled = false;
  const states = [leader.state, chaser.state];
  let cone = 0;
  let full = 0;
  let n = 0;
  let passed = false;
  for (let k = 0; k < 20 * 120; k++) {
    leader.step(DT, bl.update(DT, leader.state, leader.spec, states));
    chaser.step(DT, bc.update(DT, chaser.state, chaser.spec, states));
    updateSlipstream(states, DT);
    if (k < 12 * 120) {
      n++;
      if (chaser.state.slipstream > 0) cone++;
      if (chaser.state.slipstream >= 0.95) full++;
    }
    if (ring.deltaS(leader.state.trackS, chaser.state.trackS) > 5) passed = true;
  }
  return { coneShare: cone / n, full, passed };
}

describe('боты: слипстрим', () => {
  it('бот за лидером на прямой чаще оказывается в конусе, чем без логики; полный мешок достигается', () => {
    let withSum = 0;
    let withoutSum = 0;
    let fullWith = 0;
    let fullWithout = 0;
    for (const seed of [1, 2, 3]) {
      const a = chase(true, seed);
      const b = chase(false, seed);
      withSum += a.coneShare;
      withoutSum += b.coneShare;
      fullWith += a.full;
      fullWithout += b.full;
    }
    expect(withSum).toBeGreaterThan(withoutSum + 0.05);
    expect(fullWith).toBeGreaterThan(fullWithout);
  });

  it('использует мешок для обгона: догоняющий в итоге обходит лидера', () => {
    expect(chase(true, 4).passed).toBe(true);
  });
});
