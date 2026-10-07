import { describe, expect, it } from 'vitest';
import { CUP_POINTS, Cup } from '../../src/race/cup';

const entrants = ['A', 'B', 'ВЫ'].map((name) => ({ name, isPlayer: name === 'ВЫ', color: '#fff' }));

describe('cup', () => {
  it('начисляет очки и сортирует', () => {
    const c = new Cup(entrants, 2, 1, 3);
    expect(c.nextTrack).toBe(1);
    let s = c.addRace(['ВЫ', 'A', 'B']);
    expect(s.rows[0]).toMatchObject({ name: 'ВЫ', points: CUP_POINTS[0], position: 1 });
    expect(s.finished).toBe(false);
    expect(c.nextTrack).toBe(2);
    s = c.addRace(['B', 'A', 'ВЫ']);
    expect(s.finished).toBe(true);
    const pts = Object.fromEntries(s.rows.map((r) => [r.name, r.points]));
    expect(pts).toEqual({ 'ВЫ': 16, A: 16, B: 16 });
    // равенство — по последней гонке
    expect(s.rows.map((r) => r.name)).toEqual(['B', 'A', 'ВЫ']);
  });

  it('трассы идут по кругу', () => {
    const c = new Cup(entrants, 3, 2, 3);
    expect([c.trackFor(0), c.trackFor(1), c.trackFor(2)]).toEqual([2, 0, 1]);
  });
});
