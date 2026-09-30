import { describe, expect, it } from 'vitest';
import type { RaceEvent, VehicleState } from '../../src/core/types';
import { RaceManager } from '../../src/race/raceManager';
import { createVehicleState } from '../../src/vehicle/physics';
import { Track } from '../../src/world/track';
import { SUNSET_LOOP } from '../../src/world/trackData';

const track = new Track(SUNSET_LOOP);
const L = track.length;
const DT = 1 / 60;

interface Sim {
  rm: RaceManager;
  cars: VehicleState[];
  log: RaceEvent[];
}

/** Гонка на n машинах; машина i стоит на решётке позади линии */
function makeSim(n: number, laps = 3, started = true): Sim {
  const racers = Array.from({ length: n }, (_, i) => ({ name: `R${i}`, isPlayer: i === 0 }));
  const rm = new RaceManager(track, racers, laps);
  const cars = racers.map((_, i) => {
    const c = createVehicleState();
    c.trackS = track.wrapS(-10 - i * 8);
    align(c);
    return c;
  });
  if (started) rm.start();
  return { rm, cars, log: [] };
}

/** Курс по касательной трассы (как у нормально едущей машины) */
function align(c: VehicleState, reverse = false): void {
  const t = track.sampleAt(c.trackS).tangent;
  c.heading = Math.atan2(t.x, t.z) + (reverse ? Math.PI : 0);
}

/** Один апдейт: машина i едет вдоль трассы со скоростью speeds[i] (м/с, отрицательная — назад) */
function tick(sim: Sim, speeds: number[], dt = DT): void {
  for (let i = 0; i < sim.cars.length; i++) {
    const c = sim.cars[i];
    c.trackS = track.wrapS(c.trackS + speeds[i] * dt);
    c.speed = Math.abs(speeds[i]);
    align(c, speeds[i] < 0);
  }
  sim.rm.update(dt, sim.cars);
  for (const e of sim.rm.events) sim.log.push({ ...e });
}

function run(sim: Sim, speeds: number[], seconds: number): void {
  const steps = Math.round(seconds / DT);
  for (let k = 0; k < steps; k++) tick(sim, speeds);
}

/** Едем, пока предикат не выполнится (или не кончится лимит шагов) */
function runUntil(sim: Sim, speeds: number[], pred: () => boolean, maxSteps = 200000): void {
  for (let k = 0; k < maxSteps && !pred(); k++) tick(sim, speeds);
}

const ofType = <T extends RaceEvent['type']>(sim: Sim, type: T) =>
  sim.log.filter((e): e is Extract<RaceEvent, { type: T }> => e.type === type);

describe('RaceManager', () => {
  it('до start() ничего не происходит', () => {
    const sim = makeSim(2, 3, false);
    run(sim, [50, 50], 5);
    expect(sim.rm.raceTime).toBe(0);
    expect(sim.log).toHaveLength(0);
    expect(sim.rm.standing(0).progress).toBe(0);
    expect(sim.rm.standing(0).lap).toBe(0);
    expect(sim.rm.isFinished(0)).toBe(false);
  });

  it('raceTime идёт с start()', () => {
    const sim = makeSim(1);
    run(sim, [10], 2);
    expect(sim.rm.raceTime).toBeCloseTo(2, 1);
  });

  it('старт с решётки не даёт круг; прогресс начинается с отрицательного', () => {
    const sim = makeSim(1);
    tick(sim, [0]);
    expect(sim.rm.progress(0)).toBeCloseTo(-10, 0);
    // пересекаем стартовую линию
    run(sim, [40], 1);
    expect(sim.rm.progress(0)).toBeGreaterThan(20);
    expect(sim.rm.standing(0).lap).toBe(0);
    expect(ofType(sim, 'lap')).toHaveLength(0);
    expect(ofType(sim, 'checkpoint')).toHaveLength(0);
  });

  it('полный круг с чекпоинтами по порядку даёт lap с временем', () => {
    const sim = makeSim(1);
    const v = 50;
    runUntil(sim, [v], () => sim.rm.standing(0).lap >= 1);
    const cps = ofType(sim, 'checkpoint').map((e) => e.index);
    expect(cps).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const laps = ofType(sim, 'lap');
    expect(laps).toHaveLength(1);
    expect(laps[0].car).toBe(0);
    expect(laps[0].lap).toBe(1);
    expect(laps[0].isBest).toBe(true);
    // 10 м до линии + круг
    expect(laps[0].lapTime).toBeCloseTo((L + 10) / v, 1);
    expect(sim.rm.standing(0).lapTimes).toEqual([laps[0].lapTime]);
    expect(sim.rm.standing(0).bestLap).toBe(laps[0].lapTime);
    expect(sim.rm.standing(0).nextCheckpoint).toBe(1);
  });

  it('events очищается в начале каждого update', () => {
    const sim = makeSim(1);
    runUntil(sim, [50], () => sim.rm.events.length > 0);
    expect(sim.rm.events.length).toBeGreaterThan(0);
    sim.rm.update(DT, sim.cars);
    expect(sim.rm.events).toHaveLength(0);
  });

  it('телепорт мимо чекпоинтов не засчитывает круг', () => {
    const sim = makeSim(1);
    run(sim, [50], 1); // за линией, чекпоинт 1 впереди
    // «срезка»: прыжок сразу к последнему чекпоинту
    sim.cars[0].trackS = track.checkpoints[7] + 5;
    run(sim, [50], (L * 0.3) / 50);
    expect(sim.rm.standing(0).lap).toBe(0);
    expect(ofType(sim, 'lap')).toHaveLength(0);
    expect(ofType(sim, 'checkpoint').filter((e) => e.index >= 2)).toHaveLength(0);
  });

  it('пропуск чекпоинта не даёт круг, даже если линию пересекли', () => {
    const sim = makeSim(1);
    run(sim, [50], 1);
    // проезжаем cp1, прыгаем через cp2, едем дальше по кругу
    runUntil(sim, [50], () => sim.rm.standing(0).nextCheckpoint === 2);
    sim.cars[0].trackS = track.checkpoints[2] + 5;
    runUntil(sim, [50], () => sim.rm.progress(0) > L * 1.3);
    expect(sim.rm.standing(0).lap).toBe(0);
  });

  it('3 круга -> finish и isFinished', () => {
    const sim = makeSim(1);
    runUntil(sim, [60], () => sim.rm.isFinished(0));
    const row = sim.rm.standing(0);
    expect(row.lap).toBe(3);
    expect(row.finished).toBe(true);
    expect(row.finishTime).toBeCloseTo(sim.rm.raceTime, 5);
    expect(row.finishTime).toBeCloseTo((3 * L + 10) / 60, 1);
    expect(row.lapTimes).toHaveLength(3);
    expect(ofType(sim, 'lap').map((e) => e.lap)).toEqual([1, 2, 3]);
    const fin = ofType(sim, 'finish');
    expect(fin).toHaveLength(1);
    expect(fin[0]).toMatchObject({ car: 0, position: 1 });
    expect(fin[0].time).toBeCloseTo(row.finishTime as number, 5);
    expect(sim.rm.allFinished()).toBe(true);
  });

  it('финишировавшая машина едет дальше, но прогресс и круги не меняются', () => {
    const sim = makeSim(1, 1);
    runUntil(sim, [60], () => sim.rm.isFinished(0));
    const p = sim.rm.progress(0);
    const t = sim.rm.standing(0).finishTime;
    run(sim, [60], 30);
    expect(sim.rm.progress(0)).toBe(p);
    expect(sim.rm.standing(0).lap).toBe(1);
    expect(sim.rm.standing(0).finishTime).toBe(t);
    expect(ofType(sim, 'finish')).toHaveLength(1);
  });

  it('позиции по прогрессу', () => {
    const sim = makeSim(3);
    run(sim, [30, 50, 40], 10);
    const st = sim.rm.standings();
    expect(st.map((r) => r.car)).toEqual([1, 2, 0]);
    expect(st.map((r) => r.position)).toEqual([1, 2, 3]);
    expect(sim.rm.standing(1).position).toBe(1);
    expect(sim.rm.standing(0).position).toBe(3);
  });

  it('позиции на решётке соответствуют расстановке', () => {
    const sim = makeSim(3);
    tick(sim, [0, 0, 0]);
    // car 0 ближе всех к линии
    expect(sim.rm.standings().map((r) => r.car)).toEqual([0, 1, 2]);
  });

  it('обгон меняет позиции', () => {
    const sim = makeSim(2);
    run(sim, [30, 32], 1);
    expect(sim.rm.standing(0).position).toBe(1);
    run(sim, [30, 60], 10);
    expect(sim.rm.standing(1).position).toBe(1);
    expect(sim.rm.standing(0).position).toBe(2);
  });

  it('финишировавшие — по порядку финиша, затем по прогрессу', () => {
    const sim = makeSim(3, 1);
    // car 2 быстрее всех, car 0 вторая, car 1 стоит
    runUntil(sim, [45, 0, 60], () => sim.rm.isFinished(2));
    expect(sim.rm.standing(2).position).toBe(1);
    runUntil(sim, [45, 0, 60], () => sim.rm.isFinished(0));
    const st = sim.rm.standings();
    expect(st.map((r) => r.car)).toEqual([2, 0, 1]);
    const fin = ofType(sim, 'finish');
    expect(fin.map((e) => [e.car, e.position])).toEqual([
      [2, 1],
      [0, 2],
    ]);
    expect(sim.rm.allFinished()).toBe(false);
    expect(sim.rm.standing(1).finished).toBe(false);
  });

  it('езда назад: wrongWay и никаких кругов', () => {
    const sim = makeSim(1);
    run(sim, [50], 1); // за линией
    run(sim, [-15], 0.8);
    expect(sim.rm.standing(0).wrongWay).toBe(false); // ещё не 1.2 с
    run(sim, [-15], 1);
    expect(sim.rm.standing(0).wrongWay).toBe(true);
    expect(ofType(sim, 'wrongWay')).toEqual([{ type: 'wrongWay', car: 0, value: true }]);
    // едем назад целый круг (быстро, чтобы тест был коротким)
    runUntil(sim, [-80], () => sim.rm.progress(0) < -L * 1.2);
    expect(sim.rm.standing(0).lap).toBe(0);
    expect(ofType(sim, 'lap')).toHaveLength(0);
    expect(sim.rm.progress(0)).toBeLessThan(0);
  });

  it('wrongWay сбрасывается после 0.5 с правильной езды', () => {
    const sim = makeSim(1);
    run(sim, [50], 1);
    run(sim, [-15], 2);
    expect(sim.rm.standing(0).wrongWay).toBe(true);
    run(sim, [30], 0.3);
    expect(sim.rm.standing(0).wrongWay).toBe(true);
    run(sim, [30], 0.4);
    expect(sim.rm.standing(0).wrongWay).toBe(false);
    const ev = ofType(sim, 'wrongWay').map((e) => e.value);
    expect(ev).toEqual([true, false]);
  });

  it('wrongWay по курсу против касательной на скорости', () => {
    const sim = makeSim(1);
    run(sim, [50], 1);
    const c = sim.cars[0];
    // едем вперёд по трассе, но смотрим назад (speed > 5)
    for (let k = 0; k < 120; k++) {
      c.trackS = track.wrapS(c.trackS + 20 * DT);
      c.speed = 20;
      align(c, true);
      sim.rm.update(DT, sim.cars);
    }
    expect(sim.rm.standing(0).wrongWay).toBe(true);
  });

  it('стоящая машина не получает wrongWay', () => {
    const sim = makeSim(1);
    run(sim, [0], 5);
    expect(sim.rm.standing(0).wrongWay).toBe(false);
  });

  it('bestLap и isBest на каждом круге', () => {
    const sim = makeSim(1);
    // круг 1 — 40 м/с, круг 2 — быстрее, круг 3 — медленнее
    const speedFor = () => {
      const lap = sim.rm.standing(0).lap;
      return lap === 1 ? 70 : lap === 2 ? 45 : 40;
    };
    for (let k = 0; k < 400000 && !sim.rm.isFinished(0); k++) tick(sim, [speedFor()]);
    const laps = ofType(sim, 'lap');
    expect(laps).toHaveLength(3);
    expect(laps.map((e) => e.isBest)).toEqual([true, true, false]);
    const row = sim.rm.standing(0);
    expect(row.bestLap).toBeCloseTo(Math.min(...row.lapTimes), 8);
    expect(row.bestLap).toBe(laps[1].lapTime);
    expect(laps[2].lapTime).toBeGreaterThan(laps[1].lapTime);
  });

  it('currentLapTime отсчитывается от старта и обнуляется после круга', () => {
    const sim = makeSim(1);
    run(sim, [50], 3);
    expect(sim.rm.standing(0).currentLapTime).toBeCloseTo(3, 1);
    runUntil(sim, [50], () => sim.rm.standing(0).lap >= 1);
    expect(sim.rm.standing(0).currentLapTime).toBeLessThan(0.1);
  });

  it('projectedFinishTime: по средней скорости и для финишировавших', () => {
    const sim = makeSim(2, 1);
    run(sim, [50, 25], 20);
    const rm = sim.rm;
    for (const i of [0, 1]) {
      const avg = Math.max(rm.progress(i) / rm.raceTime, 20);
      expect(rm.projectedFinishTime(i)).toBeCloseTo(rm.raceTime + (L - rm.progress(i)) / avg, 6);
    }
    expect(rm.projectedFinishTime(0)).toBeLessThan(rm.projectedFinishTime(1));
    // после финиша — реальное время
    runUntil(sim, [50, 25], () => rm.isFinished(0));
    expect(rm.projectedFinishTime(0)).toBe(rm.standing(0).finishTime);
  });

  it('projectedFinishTime: минимум средней скорости 20 м/с', () => {
    const sim = makeSim(1);
    run(sim, [5], 10);
    const rm = sim.rm;
    expect(rm.projectedFinishTime(0)).toBeCloseTo(rm.raceTime + (3 * L - rm.progress(0)) / 20, 6);
  });

  it('start() сбрасывает состояние гонки', () => {
    const sim = makeSim(1, 1);
    runUntil(sim, [60], () => sim.rm.isFinished(0));
    sim.cars[0].trackS = track.wrapS(-10);
    sim.rm.start();
    tick(sim, [0]);
    expect(sim.rm.isFinished(0)).toBe(false);
    expect(sim.rm.standing(0).lap).toBe(0);
    expect(sim.rm.raceTime).toBeCloseTo(DT, 6);
    expect(sim.rm.progress(0)).toBeCloseTo(-10, 0);
  });

  it('lastCheckpointS: старт/финиш (0) до первого чекпоинта, затем s последнего пройденного', () => {
    const sim = makeSim(2);
    // до старта решётка позади линии: последний «пройденный» — линия старта
    expect(sim.rm.lastCheckpointS(0)).toBe(0);
    const cps = track.checkpoints;
    const seen: number[] = [];
    let last = 0;
    for (let k = 0; k < 200000 && sim.rm.standing(0).lap < 1; k++) {
      tick(sim, [40, 40]);
      const v = sim.rm.lastCheckpointS(0);
      if (v !== last) {
        seen.push(v);
        last = v;
      }
      // всегда — s одного из чекпоинтов и не дальше текущей позиции по кругу
      expect(cps).toContain(v);
    }
    // проходим чекпоинты 1..7 по порядку, затем линию (0)
    expect(seen).toEqual([...cps.slice(1), 0]);
  });

  it('lastCheckpointS не меняется при езде между чекпоинтами и не зависит от других машин', () => {
    const sim = makeSim(2);
    // машина 1 стоит, машина 0 едет
    runUntil(sim, [40, 0], () => sim.rm.standing(0).nextCheckpoint === 3);
    expect(sim.rm.lastCheckpointS(0)).toBe(track.checkpoints[2]);
    expect(sim.rm.lastCheckpointS(1)).toBe(0);
    const before = sim.rm.lastCheckpointS(0);
    run(sim, [10, 0], 1);
    expect(sim.rm.lastCheckpointS(0)).toBe(before);
  });
});
