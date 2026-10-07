import { describe, expect, it } from 'vitest';
import { emptyProgress, evaluate, type RaceStats } from '../../src/race/achievements';

const base: RaceStats = {
  mode: 'elimination',
  difficulty: 'normal',
  trackId: 'sunset',
  position: 1,
  racers: 6,
  driftScore: 0,
  bestCombo: 0,
  perfectStart: false,
  wallHits: 3,
  newBestLap: false,
  cupWon: false,
};

describe('награды в новых режимах', () => {
  it('победа в выбывании считается победой', () => {
    const r = evaluate(base, emptyProgress());
    expect(r.unlocked).toContain('first_win');
    expect(r.progress.winStreak).toBe(1);
  });
  it('дрифт-вызов (один гонщик) не даёт победу и не ломает evaluate', () => {
    const r = evaluate({ ...base, mode: 'drift', racers: 1, driftScore: 9000 }, emptyProgress());
    expect(r.unlocked).not.toContain('first_win');
    expect(r.progress.races).toBe(1);
  });
});
