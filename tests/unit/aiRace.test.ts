import { afterEach, describe, expect, it } from 'vitest';
import { Track } from '../../src/world/track';
import { TRACKS } from '../../src/world/trackData';
import type { TrackDefinition } from '../../src/world/trackData';
import { VehiclePhysics } from '../../src/vehicle/physics';
import { resolveCarCollisions } from '../../src/vehicle/collisions';
import { BotDriver } from '../../src/ai/botDriver';
import { rubberBandFactor } from '../../src/ai/rubberBand';
import { BOT_PROFILES, specById } from '../../src/vehicle/specs';
import { resetHandling } from '../../src/vehicle/handling';
import type { BotProfile } from '../../src/core/types';

/**
 * Гонки ботов целиком (как в игре): решётка 2×3, пять ботов из BOT_PROFILES и «игрок» на слоте 3 — автопилот
 * на машине, которая меняется от сида (Razor / Grizzly / Photon). Боты получают тот же rubber banding по
 * прогрессу «игрока» (powerScale), что и в game.ts. 3 круга на обеих трассах, несколько сидов.
 *
 * Проверяется: все финишируют без застреваний; на трассе идут обгоны (смены позиций между машинами);
 * победитель не один и тот же бот/машина; пачка не растягивается (разрыв лидер–последний на финише).
 */

const DT = 1 / 120;
const LAPS = 3;
const PLAYER_SLOT = 3;
const PLAYER_CARS = ['razor', 'grizzly', 'photon'];
const SEEDS = [1, 2, 3, 4, 5, 6];
/** Позиция меняется «по-настоящему», если разница прогресса больше этого, м (гистерезис против дребезга бок о бок) */
const PASS_HYSTERESIS = 4;

afterEach(() => resetHandling());

interface RaceResult {
  track: string;
  seed: number;
  names: string[];
  carIds: string[];
  finish: number[];
  winner: number;
  /** Смены порядка между парами машин (обгоны) */
  overtakes: number;
  /** Смены лидера гонки */
  leadChanges: number;
  /** Разрыв лидер–последний на финише, с */
  gap: number;
  hardWalls: number[];
  maxStuck: number[];
  respawns: number[];
  nitroShare: number;
  driftShare: number;
  boostShare: number;
}

function simulateRace(def: TrackDefinition, seed: number): RaceResult {
  const track = new Track(def);
  const playerCar = PLAYER_CARS[seed % PLAYER_CARS.length];
  const player: BotProfile = { ...BOT_PROFILES[2], name: 'YOU', carId: playerCar, skill: 0.8, aggression: 0.5 };
  const profiles: BotProfile[] = [BOT_PROFILES[0], BOT_PROFILES[1], BOT_PROFILES[2], player, BOT_PROFILES[3], BOT_PROFILES[4]];
  const n = profiles.length;
  const cars = profiles.map((p, i) => {
    const c = new VehiclePhysics(specById(p.carId), track);
    const g = track.gridPose(i);
    c.reset(g.position, g.heading, g.s);
    return c;
  });
  const drivers = profiles.map((p, i) => new BotDriver(track, p, seed * 1000 + i * 77));
  const states = cars.map((c) => c.state);
  const dist = cars.map((c) => (c.state.trackS > track.length / 2 ? c.state.trackS - track.length : c.state.trackS));
  const prevS = cars.map((c) => c.state.trackS);
  const finish = cars.map(() => -1);
  const hardWalls = cars.map(() => 0);
  const maxStuck = cars.map(() => 0);
  const respawns = cars.map(() => 0);
  const sign = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  let overtakes = 0;
  let leadChanges = 0;
  let leader = 0;
  let nitroSteps = 0;
  let driftSteps = 0;
  let boostSteps = 0;
  let steps = 0;
  let t = 0;
  for (let k = 0; k < 120 * 320; k++) {
    t += DT;
    for (let i = 0; i < n; i++) {
      const c = drivers[i].update(DT, cars[i].state, cars[i].spec, states);
      if (i !== PLAYER_SLOT) cars[i].powerScale = rubberBandFactor(dist[i], dist[PLAYER_SLOT], track.length);
      cars[i].step(DT, c);
      const d = track.deltaS(prevS[i], cars[i].state.trackS);
      prevS[i] = cars[i].state.trackS;
      if (Math.abs(d) < 50) dist[i] += d;
      for (const e of cars[i].events) if (e.type === 'wall' && e.strength > 0.3) hardWalls[i]++;
      maxStuck[i] = Math.max(maxStuck[i], drivers[i].stuckTime);
      if (cars[i].needsRespawn) respawns[i]++;
      if (finish[i] < 0 && dist[i] >= LAPS * track.length) finish[i] = t;
      if (finish[i] < 0) {
        steps++;
        if (cars[i].state.nitroActive) nitroSteps++;
        if (cars[i].state.drifting) driftSteps++;
        if (cars[i].state.boostTime > 0) boostSteps++;
      }
    }
    resolveCarCollisions(cars);
    if (k % 30 === 0 && t > 5) {
      let lead = 0;
      for (let i = 0; i < n; i++) {
        if (dist[i] > dist[lead]) lead = i;
        for (let j = i + 1; j < n; j++) {
          if (finish[i] > 0 || finish[j] > 0) continue;
          const g = dist[i] - dist[j];
          if (Math.abs(g) < PASS_HYSTERESIS) continue;
          const sg = Math.sign(g);
          if (sign[i][j] !== 0 && sg !== sign[i][j]) overtakes++;
          sign[i][j] = sg;
        }
      }
      if (finish.every((f) => f < 0) && lead !== leader && dist[lead] - dist[leader] > PASS_HYSTERESIS) {
        leadChanges++;
        leader = lead;
      }
    }
    if (finish.every((f) => f > 0)) break;
  }
  let winner = 0;
  for (let i = 1; i < n; i++) if (finish[i] > 0 && (finish[winner] < 0 || finish[i] < finish[winner])) winner = i;
  const fin = finish.filter((f) => f > 0);
  return {
    track: def.name,
    seed,
    names: profiles.map((p) => p.name),
    carIds: profiles.map((p) => p.carId),
    finish,
    winner,
    overtakes,
    leadChanges,
    gap: Math.max(...fin) - Math.min(...fin),
    hardWalls,
    maxStuck,
    respawns,
    nitroShare: nitroSteps / steps,
    driftShare: driftSteps / steps,
    boostShare: boostSteps / steps,
  };
}

const results = new Map<string, RaceResult[]>();

describe('гонки ботов: обе трассы, 3 круга, несколько сидов', () => {
  for (const def of TRACKS) {
    it(`${def.name}: все финишируют без застреваний, ${SEEDS.length} сидов`, () => {
      const list = SEEDS.map((seed) => simulateRace(def, seed));
      results.set(def.name, list);
      for (const r of list) {
        r.finish.forEach((f, i) => {
          expect(f, `${r.track} сид ${r.seed}: ${r.names[i]} не финишировал`).toBeGreaterThan(0);
          expect(f, `${r.track} сид ${r.seed}: ${r.names[i]}`).toBeLessThan(300);
          expect(r.maxStuck[i], `${r.track} сид ${r.seed}: ${r.names[i]} застревание`).toBeLessThan(6);
          expect(r.respawns[i], `${r.track} сид ${r.seed}: ${r.names[i]} needsRespawn`).toBe(0);
          expect(r.hardWalls[i], `${r.track} сид ${r.seed}: ${r.names[i]} сильные удары в стену`).toBeLessThan(15);
        });
      }
    }, 180000);
  }

  it('обгоны: в каждой гонке меняются позиции между машинами, в среднем не меньше 12 за гонку', () => {
    const all = [...results.values()].flat();
    expect(all.length).toBe(TRACKS.length * SEEDS.length);
    for (const r of all) expect(r.overtakes, `${r.track} сид ${r.seed}`).toBeGreaterThanOrEqual(4);
    const mean = all.reduce((a, r) => a + r.overtakes, 0) / all.length;
    expect(mean).toBeGreaterThanOrEqual(12);
  });

  it('победитель не всегда один: ≥ 3 разных гонщика и ≥ 3 разные машины-победителя, ни один не берёт > 70% гонок', () => {
    const all = [...results.values()].flat();
    const byName = new Map<string, number>();
    const byCar = new Set<string>();
    for (const r of all) {
      byName.set(r.names[r.winner], (byName.get(r.names[r.winner]) ?? 0) + 1);
      byCar.add(r.carIds[r.winner]);
    }
    expect(byName.size).toBeGreaterThanOrEqual(3);
    expect(byCar.size).toBeGreaterThanOrEqual(3);
    for (const [name, wins] of byName) expect(wins / all.length, `${name} выигрывает слишком часто`).toBeLessThanOrEqual(0.7);
    // на каждой трассе победители тоже разные
    for (const [track, list] of results) expect(new Set(list.map((r) => r.names[r.winner])).size, track).toBeGreaterThanOrEqual(2);
  });

  it('пачка не растягивается: разрыв лидер–последний на финише 1–15 с, в среднем до 9 с', () => {
    const all = [...results.values()].flat();
    for (const r of all) {
      expect(r.gap, `${r.track} сид ${r.seed}`).toBeGreaterThan(1);
      expect(r.gap, `${r.track} сид ${r.seed}`).toBeLessThan(15);
    }
    expect(all.reduce((a, r) => a + r.gap, 0) / all.length).toBeLessThan(9);
  });

  it('тактика: нитро и занос не постоянно (нитро 2–25%, занос 3–40%, буст 3–50% времени гонки)', () => {
    const all = [...results.values()].flat();
    const mean = (f: (r: RaceResult) => number): number => all.reduce((a, r) => a + f(r), 0) / all.length;
    expect(mean((r) => r.nitroShare)).toBeGreaterThan(0.02);
    expect(mean((r) => r.nitroShare)).toBeLessThan(0.25);
    expect(mean((r) => r.driftShare)).toBeGreaterThan(0.03);
    expect(mean((r) => r.driftShare)).toBeLessThan(0.4);
    expect(mean((r) => r.boostShare)).toBeGreaterThan(0.03);
    expect(mean((r) => r.boostShare)).toBeLessThan(0.5);
  });

  it('сводка гонок (в консоль)', () => {
    const lines: string[] = ['\nГОНКИ БОТОВ (3 круга, 5 ботов + «игрок»-автопилот):'];
    for (const [track, list] of results) {
      for (const r of list) {
        const w = r.winner;
        lines.push(
          `${track.padEnd(13)} сид ${r.seed} игрок=${r.carIds[3].padEnd(7)} победил ${r.names[w]}(${r.carIds[w]}) обгонов ${String(r.overtakes).padStart(2)} смен лидера ${r.leadChanges} разрыв ${r.gap.toFixed(1)} с` +
            ` | нитро ${(r.nitroShare * 100).toFixed(0)}% занос ${(r.driftShare * 100).toFixed(0)}% буст ${(r.boostShare * 100).toFixed(0)}%`,
        );
      }
    }
    console.log(lines.join('\n'));
    expect(results.size).toBe(TRACKS.length);
  });
});
