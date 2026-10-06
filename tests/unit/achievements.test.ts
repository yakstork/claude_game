import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  STORAGE_KEY,
  emptyProgress,
  evaluate,
  loadProgress,
  sanitize,
  saveProgress,
} from '../../src/race/achievements';
import type { RaceStats } from '../../src/race/achievements';

const base: RaceStats = {
  mode: 'race',
  difficulty: 'normal',
  trackId: 'sunset',
  position: 4,
  racers: 6,
  driftScore: 100,
  bestCombo: 100,
  perfectStart: false,
  wallHits: 3,
  newBestLap: false,
  cupWon: false,
};
const st = (o: Partial<RaceStats> = {}): RaceStats => ({ ...base, ...o });

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
}

describe('achievements', () => {
  it('ровно 12 уникальных достижений', () => {
    expect(ACHIEVEMENTS.length).toBe(12);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(12);
  });

  it('слабая гонка ничего не открывает, кроме счётчика', () => {
    const r = evaluate(st(), emptyProgress());
    expect(r.unlocked).toEqual([]);
    expect(r.progress.races).toBe(1);
  });

  it('первая победа и хард', () => {
    expect(evaluate(st({ position: 1 }), emptyProgress()).unlocked).toEqual(['first_win']);
    const r = evaluate(st({ position: 1, difficulty: 'hard' }), emptyProgress());
    expect(r.unlocked).toEqual(['first_win', 'hard_win']);
  });

  it('заезд на время не даёт победу, но даёт рекорд круга', () => {
    const r = evaluate(st({ mode: 'timeAttack', racers: 1, position: 1, newBestLap: true }), emptyProgress());
    expect(r.unlocked).toContain('record_lap');
    expect(r.unlocked).not.toContain('first_win');
  });

  it('дрифт, старт, чистая гонка, кубок', () => {
    const r = evaluate(st({ bestCombo: 4000, driftScore: 20000, perfectStart: true, wallHits: 0, cupWon: true }), emptyProgress());
    expect(r.unlocked.slice().sort()).toEqual(['clean_race', 'combo_4000', 'cup_win', 'drift_20k', 'perfect_start']);
  });

  it('победы на трёх трассах', () => {
    let p = emptyProgress();
    for (const t of ['sunset', 'heights', 'coast']) p = evaluate(st({ position: 1, trackId: t }), p).progress;
    expect(p.unlocked).toContain('all_tracks');
    expect(p.wonTracks.length).toBe(3);
  });

  it('10 гонок, серия 3, подиумы 5; повторно не открываются', () => {
    let p = emptyProgress();
    let got: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = evaluate(st({ position: 2 }), p);
      p = r.progress;
      got = got.concat(r.unlocked);
    }
    expect(got.filter((x) => x === 'races_10').length).toBe(1);
    expect(p.unlocked).toContain('podium_5');
    p = evaluate(st({ position: 1 }), p).progress;
    p = evaluate(st({ position: 1 }), p).progress;
    expect(p.unlocked).not.toContain('streak_3');
    const r = evaluate(st({ position: 1 }), p);
    expect(r.unlocked).toContain('streak_3');
    expect(evaluate(st({ position: 1 }), r.progress).unlocked).not.toContain('streak_3');
  });

  it('поражение сбрасывает серию; вход не мутируется', () => {
    const p0 = { ...emptyProgress(), winStreak: 2 };
    const r = evaluate(st({ position: 5 }), p0);
    expect(r.progress.winStreak).toBe(0);
    expect(p0.winStreak).toBe(2);
    expect(p0.races).toBe(0);
  });

  it('load/save и валидация', () => {
    const ls = new MemStorage();
    (globalThis as unknown as { localStorage: MemStorage }).localStorage = ls;
    expect(loadProgress()).toEqual(emptyProgress());
    const p = evaluate(st({ position: 1 }), emptyProgress()).progress;
    saveProgress(p);
    expect(loadProgress()).toEqual(p);
    ls.setItem(STORAGE_KEY, '{bad json');
    expect(loadProgress()).toEqual(emptyProgress());
  });

  it('sanitize отбрасывает мусор', () => {
    const p = sanitize({ unlocked: ['first_win', 'first_win', 'nope', 5], races: -3, winStreak: 'x', podiums: 2.7, wonTracks: ['a', 1] });
    expect(p).toEqual({ unlocked: ['first_win'], races: 0, winStreak: 0, podiums: 2, wonTracks: ['a'] });
    expect(sanitize(null)).toEqual(emptyProgress());
  });
});
