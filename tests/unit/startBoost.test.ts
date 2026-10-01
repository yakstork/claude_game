import { describe, expect, it } from 'vitest';
import { StartBoostJudge, START_BOOST } from '../../src/core/startBoost';
import type { StartGrade } from '../../src/core/startBoost';
import { Track } from '../../src/world/track';
import { SUNSET_LOOP } from '../../src/world/trackData';
import { VehiclePhysics } from '../../src/vehicle/physics';
import { CAR_SPECS } from '../../src/vehicle/specs';

const DT = 1 / 120;

/** Отсчёт с −3 с до +0.5 с; газ нажимается в pressAt (или держится всё время / не нажимается) */
function judge(pressAt: number | 'hold' | 'never', releaseAt = Infinity): StartGrade[] {
  const j = new StartBoostJudge();
  const out: StartGrade[] = [];
  for (let t = -3; t < 0.5; t += DT) {
    const down = pressAt === 'hold' ? true : pressAt === 'never' ? false : t >= pressAt && t < releaseAt;
    const g = j.update(down, t);
    if (g) out.push(g);
  }
  return out;
}

describe('стартовый буст: судья', () => {
  it('нажатие точно на GO — идеальный старт, один раз', () => {
    expect(judge(-0.05)).toEqual(['perfect']);
    expect(judge(0.05)).toEqual(['perfect']);
  });
  it('чуть мимо — хороший', () => {
    expect(judge(-0.2)).toEqual(['good']);
    expect(judge(0.2)).toEqual(['good']);
  });
  it('раньше окна или зажатый с начала — рано', () => {
    expect(judge(-1)).toEqual(['early']);
    expect(judge('hold')).toEqual(['early']);
  });
  it('нажал рано, отпустил и нажал вовремя — идеальный', () => {
    const j = new StartBoostJudge();
    const res: StartGrade[] = [];
    for (let t = -3; t < 0.5; t += DT) {
      const down = (t > -2 && t < -1.5) || t >= -0.03;
      const g = j.update(down, t);
      if (g) res.push(g);
    }
    expect(res).toEqual(['perfect']);
  });
  it('не нажал или поздно — без рывка', () => {
    expect(judge('never')).toEqual(['late']);
    expect(judge(0.4)).toEqual(['late']);
  });
  it('reset — заново на следующую гонку', () => {
    const j = new StartBoostJudge();
    for (let t = -1; t < 0.5; t += DT) j.update(t >= -0.02, t);
    j.reset();
    let g: StartGrade | null = null;
    for (let t = -1; t < 0.5 && !g; t += DT) g = j.update(t >= 0.15, t);
    expect(g).toBe('good');
  });
});

describe('стартовый буст: рывок с места', () => {
  const track = new Track(SUNSET_LOOP);
  function launch(boost: readonly [number, number] | null): number {
    const car = new VehiclePhysics(CAR_SPECS[0], track);
    const p = track.sampleAt(20);
    car.reset(p.position.clone(), Math.atan2(p.tangent.x, p.tangent.z), 20);
    for (let i = 0; i < 60; i++) car.step(DT, { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false });
    if (boost) car.applyBoost(boost[0], boost[1]);
    let dist = 0;
    for (let i = 0; i < 360; i++) {
      car.step(DT, { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false });
      dist += car.state.speed * DT;
    }
    return dist;
  }
  it('идеальный старт заметно, но умеренно выигрывает за 3 с', () => {
    const base = launch(null);
    const perfect = launch(START_BOOST.perfect);
    const good = launch(START_BOOST.good);
    // выигрыш в метрах за 3 с: ощутимый рывок, но не решающий гонку
    expect(perfect - base).toBeGreaterThan(4);
    expect(perfect - base).toBeLessThan(20);
    expect(good - base).toBeGreaterThan(1);
    expect(good).toBeLessThan(perfect);
  });
});
