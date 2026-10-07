import { describe, expect, it } from 'vitest';
import { CHALLENGE_DURATION, DriftChallenge, medalFor, medalThresholds, nextGoal } from '../../src/race/driftChallenge';

describe('driftChallenge', () => {
  it('таймер идёт и заканчивается', () => {
    const c = new DriftChallenge();
    expect(c.remaining).toBe(CHALLENGE_DURATION);
    expect(c.update(89)).toBe(false);
    expect(c.remaining).toBeCloseTo(1);
    expect(c.update(5)).toBe(true);
    expect(c.remaining).toBe(0);
  });
  it('медали по порогам', () => {
    const [b, s, g] = medalThresholds('sunset');
    expect(medalFor(b - 1, 'sunset')).toBe('none');
    expect(medalFor(b, 'sunset')).toBe('bronze');
    expect(medalFor(s, 'sunset')).toBe('silver');
    expect(medalFor(g + 1, 'sunset')).toBe('gold');
    expect(b < s && s < g).toBe(true);
  });
  it('следующая цель', () => {
    expect(nextGoal(0, 'coast')?.medal).toBe('bronze');
    expect(nextGoal(1e6, 'coast')).toBeNull();
  });
  it('неизвестная трасса — базовые пороги', () => {
    expect(medalThresholds('zzz')[0]).toBeGreaterThan(0);
  });
});
