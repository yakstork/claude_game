import { describe, expect, it } from 'vitest';
import { Elimination, EVERY, FIRST_AT } from '../../src/race/elimination';

describe('elimination', () => {
  it('выбывает последний по прогрессу в 30 с, затем каждые 25 с', () => {
    const e = new Elimination(4, 0);
    const p = [100, 50, 80, 10];
    expect(e.update(FIRST_AT - 1, p)).toBe(-1);
    expect(e.update(1, p)).toBe(3);
    expect(e.timeToNext).toBeCloseTo(EVERY);
    expect(e.update(EVERY, p)).toBe(1);
    expect(e.aliveCount).toBe(2);
  });
  it('игрок выбыл: гонка окончена, место = оставшиеся+1', () => {
    const e = new Elimination(6, 3);
    e.update(FIRST_AT, [9, 9, 9, 1, 9, 9]);
    expect(e.over).toBe(true);
    expect(e.playerWon).toBe(false);
    expect(e.playerPlace).toBe(6);
  });
  it('победа: остаться последним', () => {
    const e = new Elimination(3, 0);
    const p = [100, 5, 6];
    e.update(FIRST_AT, p);
    e.update(EVERY, p);
    expect(e.over).toBe(true);
    expect(e.playerWon).toBe(true);
    expect(e.playerPlace).toBe(1);
    expect(e.finalOrder()).toEqual([0, 2, 1]);
  });
  it('после конца ничего не происходит', () => {
    const e = new Elimination(2, 0);
    e.update(FIRST_AT, [1, 0]);
    expect(e.update(100, [1, 0])).toBe(-1);
  });
});
