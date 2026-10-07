import { describe, expect, it } from 'vitest';
import {
  DAILY_KEY,
  currentStreak,
  dailyChallenge,
  dailySeed,
  emptyDaily,
  evaluateMedal,
  loadDaily,
  previousSeed,
  recordDaily,
  saveDaily,
  todayBest,
  type DailyContext,
} from '../../src/race/daily';

const ctx: DailyContext = {
  trackIds: ['sunset', 'heights', 'coast', 'storm', 'canyon'],
  carIds: ['razor', 'grizzly', 'photon', 'volt', 'nightshade'],
  trackLength: () => 2000,
};

function mem(): { store: Map<string, string>; getItem(k: string): string | null; setItem(k: string, v: string): void } {
  const store = new Map<string, string>();
  return { store, getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) };
}

describe('вызов дня: детерминизм', () => {
  it('seed = YYYYMMDD по UTC', () => {
    expect(dailySeed(new Date(Date.UTC(2026, 9, 7, 23, 59)))).toBe(20261007);
    expect(dailySeed(new Date('2026-01-01T00:00:00Z'))).toBe(20260101);
    expect(previousSeed(20260301)).toBe(20260228);
    expect(previousSeed(20260101)).toBe(20251231);
  });

  it('одна дата — одни и те же условия', () => {
    expect(dailyChallenge(20261007, ctx)).toEqual(dailyChallenge(20261007, ctx));
  });

  it('условия валидны, а за месяц меняются (трасса, режим, модификатор, время суток)', () => {
    const tracks = new Set<string>();
    const modes = new Set<string>();
    const mods = new Set<string>();
    const tods = new Set<string>();
    for (let d = 1; d <= 31; d++) {
      const c = dailyChallenge(20260100 + d, ctx);
      expect(ctx.trackIds).toContain(c.trackId);
      expect(ctx.carIds).toContain(c.carId);
      expect(c.goal.thresholds).toHaveLength(3);
      if (c.mode === 'drift') expect(c.modifier).not.toBe('nitroCans');
      tracks.add(c.trackId);
      modes.add(c.mode);
      mods.add(c.modifier);
      tods.add(c.timeOfDay);
    }
    expect(tracks.size).toBeGreaterThanOrEqual(3);
    expect(modes.size).toBeGreaterThanOrEqual(3);
    expect(mods.size).toBeGreaterThanOrEqual(3);
    expect(tods.size).toBe(3);
  });
});

describe('вызов дня: медали, лучший результат, серия', () => {
  const race = { ...dailyChallenge(20260105, ctx), mode: 'race' as const, modifier: 'none' as const, goal: { kind: 'position' as const, thresholds: [4, 2, 1] as [number, number, number] } };

  it('медали по месту; «чистый заезд» ограничивает золото', () => {
    const o = { position: 1, bestLap: 60, driftScore: 0, wallHits: 3 };
    expect(evaluateMedal(race, o)).toBe(3);
    expect(evaluateMedal({ ...race, modifier: 'cleanRun' }, o)).toBe(2);
    expect(evaluateMedal({ ...race, modifier: 'cleanRun' }, { ...o, wallHits: 0 })).toBe(3);
    expect(evaluateMedal(race, { ...o, position: 3 })).toBe(1);
    expect(evaluateMedal(race, { ...o, position: 6 })).toBe(0);
  });

  it('хранится лучший результат дня, награда — только за новые медали', () => {
    const p = emptyDaily();
    const a = recordDaily(p, race, { position: 3, bestLap: null, driftScore: 0, wallHits: 0 });
    expect(a.medal).toBe(1);
    expect(a.reward).toBe(50);
    const b = recordDaily(p, race, { position: 5, bestLap: null, driftScore: 0, wallHits: 0 });
    expect(b.newBest).toBe(false);
    expect(b.reward).toBe(0);
    const c = recordDaily(p, race, { position: 1, bestLap: null, driftScore: 0, wallHits: 0 });
    expect(c.reward).toBe(100 + 200);
    expect(todayBest(p, race.seed)).toEqual({ medal: 3, score: -1 });
    expect(todayBest(p, race.seed + 1)).toBeNull();
  });

  it('серия: растёт по дням подряд, обрывается при пропуске, дважды в день не считается', () => {
    const p = emptyDaily();
    const win = { position: 1, bestLap: null, driftScore: 0, wallHits: 0 };
    const day = (seed: number) => ({ ...race, seed });
    recordDaily(p, day(20260105), win);
    recordDaily(p, day(20260105), win);
    expect(p.streak).toBe(1);
    recordDaily(p, day(20260106), win);
    expect(recordDaily(p, day(20260107), win).streak).toBe(3);
    expect(currentStreak(p, 20260108)).toBe(3);
    expect(currentStreak(p, 20260109)).toBe(0);
    recordDaily(p, day(20260110), win);
    expect(p.streak).toBe(1);
    expect(p.maxStreak).toBe(3);
    // безмедальный день серию не продлевает
    recordDaily(p, day(20260111), { ...win, position: 6 });
    expect(p.streak).toBe(1);
  });

  it('сохранение в neonrush.daily.v1 и устойчивость к мусору', () => {
    const st = mem();
    const p = emptyDaily();
    recordDaily(p, race, { position: 2, bestLap: null, driftScore: 0, wallHits: 0 });
    saveDaily(p, st);
    expect(st.store.has(DAILY_KEY)).toBe(true);
    expect(DAILY_KEY).toBe('neonrush.daily.v1');
    expect(loadDaily(st)).toEqual(p);
    st.store.set(DAILY_KEY, '{oops');
    expect(loadDaily(st)).toEqual(emptyDaily());
  });
});
