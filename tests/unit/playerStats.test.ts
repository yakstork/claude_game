import { describe, expect, it } from 'vitest';
import { STATS_KEY, StatsTracker, emptyStats, favorite, formatDuration, loadStats, sanitizeStats, summarize } from '../../src/race/playerStats';

function mem() {
  const store = new Map<string, string>();
  return { store, getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
}

describe('статистика игрока', () => {
  it('пробег копится по скорости, мусорные dt и обратный ход игнорируются', () => {
    const t = new StatsTracker(emptyStats(), mem());
    for (let i = 0; i < 120; i++) t.addDistance(50, 1 / 120);
    expect(t.data.distance).toBeCloseTo(50, 5);
    t.addDistance(-10, 0.01);
    t.addDistance(30, 5);
    t.addDistance(30, 0);
    expect(t.data.distance).toBeCloseTo(50, 5);
  });

  it('гонки, победы, подиумы, любимые и победы по режимам', () => {
    const st = mem();
    const t = new StatsTracker(emptyStats(), st);
    t.addRace({ trackId: 'sunset', carId: 'razor', mode: 'race', position: 1, racers: 6 });
    t.addRace({ trackId: 'sunset', carId: 'razor', mode: 'elimination', position: 1, racers: 6 });
    t.addRace({ trackId: 'coast', carId: 'volt', mode: 'race', position: 3, racers: 6 });
    t.addRace({ trackId: 'coast', carId: 'razor', mode: 'timeAttack', position: 1, racers: 1 });
    const d = t.data;
    expect(d.races).toBe(4);
    expect(d.wins).toBe(2);
    expect(d.podiums).toBe(3);
    expect(d.modeWins).toEqual({ race: 1, elimination: 1 });
    expect(favorite(d.carRaces)).toBe('razor');
    expect(favorite(d.trackRaces)).toBe('sunset');
    expect(JSON.parse(st.store.get(STATS_KEY)!).races).toBe(4);
  });

  it('счётчики, лучшее комбо, сохранение и сброс', () => {
    const st = mem();
    const t = new StatsTracker(emptyStats(), st);
    t.addWall();
    t.addBoost();
    t.addBoost();
    t.noteCombo(1200);
    t.noteCombo(800);
    t.addTime(0.5);
    t.flush();
    expect(loadStats(st)).toMatchObject({ wallHits: 1, boosts: 2, bestCombo: 1200, playTime: 0.5 });
    t.reset();
    expect(loadStats(st)).toEqual(emptyStats());
  });

  it('устойчивость к мусору и форматирование', () => {
    expect(sanitizeStats({ distance: 'x', races: -4, carRaces: { a: 3, b: 'q' } })).toMatchObject({ distance: 0, races: 0, carRaces: { a: 3 } });
    const st = mem();
    st.store.set(STATS_KEY, '{oops');
    expect(loadStats(st)).toEqual(emptyStats());
    expect(formatDuration(3700)).toBe('1 ч 1 мин');
    const p = emptyStats();
    p.distance = 12345;
    const tiles = summarize(p, { track: (s) => s, car: (s) => s });
    expect(tiles.find((x) => x.label === 'ПРОБЕГ')?.value).toBe('12.3 км');
    expect(tiles.find((x) => x.label === 'ЛЮБИМАЯ МАШИНА')?.value).toBe('—');
  });
});
