import { describe, expect, it } from 'vitest';
import type { DriftEvent } from '../../src/core/types';
import { DriftScorer, driftLabel } from '../../src/race/drift';
import { createVehicleState } from '../../src/vehicle/physics';

const DT = 1 / 60;

function drifting(speed = 30, angle = 0.6) {
  const s = createVehicleState();
  s.speed = speed;
  s.drifting = true;
  s.driftAngle = angle;
  s.onGround = true;
  return s;
}

function idle(speed = 30) {
  const s = createVehicleState();
  s.speed = speed;
  return s;
}

/** Прогоняет секунды, собирая события */
function run(sc: DriftScorer, state: ReturnType<typeof drifting>, seconds: number, log: DriftEvent[] = []): DriftEvent[] {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) log.push(...sc.update(DT, state, false));
  return log;
}

describe('DriftScorer', () => {
  it('начисляет очки за занос: angleFactor × speed × dt × 10', () => {
    const sc = new DriftScorer();
    run(sc, drifting(30, 0.6), 1);
    expect(sc.combo.active).toBe(true);
    expect(sc.combo.points).toBeCloseTo(1 * 30 * 1 * 10, 0);
    expect(sc.combo.time).toBeCloseTo(1, 1);
    expect(sc.total).toBe(0); // пока комбо не завершено
  });

  it('angleFactor ограничен снизу 0.2 и сверху 1.2', () => {
    const lo = new DriftScorer();
    run(lo, drifting(30, 0.01), 1);
    expect(lo.combo.points).toBeCloseTo(0.2 * 30 * 10, 0);
    const hi = new DriftScorer();
    run(hi, drifting(30, 1.5), 1);
    expect(hi.combo.points).toBeCloseTo(1.2 * 30 * 10, 0);
    const neg = new DriftScorer();
    run(neg, drifting(30, -0.3), 1);
    expect(neg.combo.points).toBeCloseTo(0.5 * 30 * 10, 0);
  });

  it('нет очков без заноса, на малой скорости и в воздухе', () => {
    const sc = new DriftScorer();
    run(sc, idle(), 1);
    expect(sc.combo.active).toBe(false);
    run(sc, drifting(10), 1);
    expect(sc.combo.active).toBe(false);
    const air = drifting(30);
    air.onGround = false;
    run(sc, air, 1);
    expect(sc.combo.points).toBe(0);
  });

  it('множитель растёт на +1 каждые 1.5 с до x5 и даёт события', () => {
    const sc = new DriftScorer();
    const log = run(sc, drifting(), 1.4);
    expect(sc.combo.multiplier).toBe(1);
    run(sc, drifting(), 0.2, log);
    expect(sc.combo.multiplier).toBe(2);
    run(sc, drifting(), 1.5, log);
    expect(sc.combo.multiplier).toBe(3);
    run(sc, drifting(), 10, log);
    expect(sc.combo.multiplier).toBe(5);
    const mults = log.filter((e) => e.type === 'multiplier').map((e) => (e as { multiplier: number }).multiplier);
    expect(mults).toEqual([2, 3, 4, 5]);
  });

  it('комбо завершается через 1.0 с без заноса: итог = points × multiplier', () => {
    const sc = new DriftScorer();
    run(sc, drifting(30, 0.6), 2); // x2
    const pts = sc.combo.points;
    expect(sc.combo.multiplier).toBe(2);
    const log = run(sc, idle(), 0.9);
    expect(sc.combo.active).toBe(true);
    expect(log).toHaveLength(0);
    run(sc, idle(), 0.2, log);
    expect(sc.combo.active).toBe(false);
    const end = log.filter((e) => e.type === 'comboEnd');
    expect(end).toHaveLength(1);
    const e = end[0] as Extract<DriftEvent, { type: 'comboEnd' }>;
    expect(e.multiplier).toBe(2);
    expect(e.points).toBe(Math.round(pts * 2));
    expect(sc.total).toBe(e.points);
    expect(sc.combo.points).toBe(0);
    expect(sc.combo.multiplier).toBe(1);
  });

  it('связка заносов: пауза < 1.0 с сохраняет комбо и множитель', () => {
    const sc = new DriftScorer();
    const log = run(sc, drifting(), 1.6); // x2
    expect(sc.combo.multiplier).toBe(2);
    const before = sc.combo.points;
    run(sc, idle(), 0.6, log);
    expect(sc.combo.active).toBe(true);
    run(sc, drifting(), 0.5, log);
    expect(sc.combo.multiplier).toBe(2);
    expect(sc.combo.points).toBeGreaterThan(before);
    expect(log.some((e) => e.type === 'comboEnd')).toBe(false);
    // множитель растёт по непрерывному времени нового заноса
    run(sc, drifting(), 1.2, log);
    expect(sc.combo.multiplier).toBe(3);
  });

  it('пауза >= 1.0 с завершает комбо, следующий занос начинает новое', () => {
    const sc = new DriftScorer();
    const log = run(sc, drifting(), 2);
    run(sc, idle(), 1.2, log);
    expect(log.filter((e) => e.type === 'comboEnd')).toHaveLength(1);
    run(sc, drifting(), 0.5, log);
    expect(sc.combo.active).toBe(true);
    expect(sc.combo.multiplier).toBe(1);
    expect(sc.combo.time).toBeCloseTo(0.5, 1);
  });

  it('в воздухе очки не идут, но комбо не рвётся до 1.0 с', () => {
    const sc = new DriftScorer();
    run(sc, drifting(), 1);
    const pts = sc.combo.points;
    const air = idle();
    air.onGround = false;
    const log = run(sc, air, 0.8);
    expect(sc.combo.active).toBe(true);
    expect(sc.combo.points).toBe(pts);
    run(sc, drifting(), 0.3, log);
    expect(sc.combo.points).toBeGreaterThan(pts);
    expect(log.some((e) => e.type === 'comboEnd')).toBe(false);
    // занос в воздухе тоже держит комбо
    const airDrift = drifting();
    airDrift.onGround = false;
    const p2 = sc.combo.points;
    run(sc, airDrift, 2);
    expect(sc.combo.active).toBe(true);
    expect(sc.combo.points).toBe(p2);
  });

  it('label по размеру итога', () => {
    expect(driftLabel(0)).toBe('DRIFT');
    expect(driftLabel(499)).toBe('DRIFT');
    expect(driftLabel(500)).toBe('NICE DRIFT');
    expect(driftLabel(1499)).toBe('NICE DRIFT');
    expect(driftLabel(1500)).toBe('GREAT DRIFT');
    expect(driftLabel(3999)).toBe('GREAT DRIFT');
    expect(driftLabel(4000)).toBe('INSANE DRIFT!');
    expect(driftLabel(8999)).toBe('INSANE DRIFT!');
    expect(driftLabel(9000)).toBe('NEON GOD!!');
  });

  it('comboEnd приходит с правильным label для разных размеров', () => {
    const cases: [number, number, string][] = [
      [0.5, 20, 'DRIFT'], // 100
      [1, 40, 'DRIFT'], // 400
      [1.4, 50, 'NICE DRIFT'], // 700 x1
      [2, 50, 'GREAT DRIFT'], // 1000 x2
      [3.5, 60, 'INSANE DRIFT!'], // 2100 x3
      [8, 60, 'NEON GOD!!'], // 4800 x5
    ];
    for (const [sec, speed, label] of cases) {
      const sc = new DriftScorer();
      const log = run(sc, drifting(speed, 0.6), sec);
      run(sc, idle(), 1.1, log);
      const end = log.find((e) => e.type === 'comboEnd') as Extract<DriftEvent, { type: 'comboEnd' }>;
      expect(end, `${sec}s`).toBeDefined();
      expect(end.label, `${sec}s -> ${end.points}`).toBe(label);
      expect(end.label).toBe(driftLabel(end.points));
    }
  });

  it('удар в стену сжигает очки: comboLost с учётом множителя', () => {
    const sc = new DriftScorer();
    run(sc, drifting(), 2);
    const burned = Math.round(sc.combo.points * sc.combo.multiplier);
    expect(burned).toBeGreaterThan(100);
    const ev = sc.update(DT, drifting(), true);
    expect(ev).toEqual([{ type: 'comboLost', points: burned }]);
    expect(sc.combo.active).toBe(false);
    expect(sc.combo.points).toBe(0);
    expect(sc.combo.multiplier).toBe(1);
    expect(sc.total).toBe(0);
    // после потери комбо больше не завершается
    const log = run(sc, idle(), 1.5);
    expect(log).toHaveLength(0);
    expect(sc.total).toBe(0);
  });

  it('удар в стену без активного комбо ничего не делает', () => {
    const sc = new DriftScorer();
    expect(sc.update(DT, idle(), true)).toHaveLength(0);
    expect(sc.combo.active).toBe(false);
  });

  it('очень короткий занос: без события, но очки в total', () => {
    const sc = new DriftScorer();
    // ~0.1 с: 0.2..1 × 15 м/с × 0.1 × 10 ≈ 15 очков
    const log = run(sc, drifting(15, 0.6), 0.1);
    run(sc, idle(), 1.2, log);
    expect(log.filter((e) => e.type === 'comboEnd')).toHaveLength(0);
    expect(sc.total).toBeGreaterThan(0);
    expect(sc.total).toBeLessThan(50);
    expect(sc.combo.active).toBe(false);
  });

  it('total накапливается по нескольким комбо', () => {
    const sc = new DriftScorer();
    const log = run(sc, drifting(), 2);
    run(sc, idle(), 1.1, log);
    const first = sc.total;
    expect(first).toBeGreaterThan(0);
    run(sc, drifting(), 2, log);
    run(sc, idle(), 1.1, log);
    expect(sc.total).toBeGreaterThan(first);
    const ends = log.filter((e) => e.type === 'comboEnd') as Extract<DriftEvent, { type: 'comboEnd' }>[];
    expect(ends).toHaveLength(2);
    expect(sc.total).toBe(ends[0].points + ends[1].points);
  });

  it('reset() обнуляет всё', () => {
    const sc = new DriftScorer();
    const log = run(sc, drifting(), 2);
    run(sc, idle(), 1.1, log);
    run(sc, drifting(), 1, log);
    expect(sc.total).toBeGreaterThan(0);
    expect(sc.combo.active).toBe(true);
    sc.reset();
    expect(sc.total).toBe(0);
    expect(sc.combo).toEqual({ active: false, points: 0, multiplier: 1, time: 0 });
    expect(sc.update(DT, idle(), false)).toHaveLength(0);
    // после reset занос начинает с нуля
    run(sc, drifting(), 0.5);
    expect(sc.combo.multiplier).toBe(1);
  });

  it('массив событий переиспользуется и очищается в начале вызова', () => {
    const sc = new DriftScorer();
    const a = sc.update(DT, idle(), false);
    const b = sc.update(DT, idle(), false);
    expect(a).toBe(b);
    run(sc, drifting(), 1.6);
    const ev = sc.update(DT, drifting(), false);
    expect(ev).toHaveLength(0);
  });
});

describe('DriftScorer.flush', () => {
  it('банкует активное комбо (например, на финише)', () => {
    const sc = new DriftScorer();
    const st = createVehicleState();
    st.drifting = true;
    st.speed = 30;
    st.driftAngle = 0.6;
    st.onGround = true;
    for (let i = 0; i < 240; i++) sc.update(1 / 120, st, false);
    expect(sc.combo.active).toBe(true);
    const ev = sc.flush();
    expect(sc.combo.active).toBe(false);
    expect(sc.total).toBeGreaterThan(0);
    expect(ev.some((e) => e.type === 'comboEnd')).toBe(true);
    expect(sc.flush()).toEqual([]);
  });
});
