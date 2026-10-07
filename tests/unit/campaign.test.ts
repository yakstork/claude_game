import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_KEY,
  CHAPTERS,
  EVENTS,
  STAR_REWARD,
  emptyProgress,
  evaluateStars,
  goalText,
  isChapterUnlocked,
  isEventUnlocked,
  loadCampaign,
  recordResult,
  sanitizeProgress,
  saveCampaign,
  totalStars,
  type StarGoal,
} from '../../src/race/campaign';
import { TRACKS } from '../../src/world/trackData';
import { CAR_SPECS } from '../../src/vehicle/specs';

describe('данные кампании', () => {
  it('12 событий в 3 главах, id уникальны, трассы и машины существуют, пороги упорядочены', () => {
    expect(EVENTS).toHaveLength(12);
    expect(new Set(EVENTS.map((e) => e.id)).size).toBe(12);
    for (const ch of CHAPTERS) expect(EVENTS.filter((e) => e.chapter === ch.id)).toHaveLength(4);
    for (const e of EVENTS) {
      expect(TRACKS.some((t) => t.id === e.trackId)).toBe(true);
      if (e.carId) expect(CAR_SPECS.some((c) => c.id === e.carId)).toBe(true);
      const [a, b, c] = e.goal.stars;
      if (e.goal.kind === 'drift') expect(a < b && b < c).toBe(true);
      else expect(a > b && b > c).toBe(true);
    }
  });
});

describe('звёзды', () => {
  it('место', () => {
    const g: StarGoal = { kind: 'position', stars: [4, 2, 1] };
    const o = { bestLap: null, driftScore: 0 };
    expect(evaluateStars(g, { ...o, position: 6 })).toBe(0);
    expect(evaluateStars(g, { ...o, position: 4 })).toBe(1);
    expect(evaluateStars(g, { ...o, position: 2 })).toBe(2);
    expect(evaluateStars(g, { ...o, position: 1 })).toBe(3);
  });
  it('время круга и дрифт', () => {
    const lap: StarGoal = { kind: 'lap', stars: [64, 59, 55] };
    expect(evaluateStars(lap, { position: 1, bestLap: null, driftScore: 0 })).toBe(0);
    expect(evaluateStars(lap, { position: 1, bestLap: 60, driftScore: 0 })).toBe(1);
    expect(evaluateStars(lap, { position: 1, bestLap: 54.9, driftScore: 0 })).toBe(3);
    const dr: StarGoal = { kind: 'drift', stars: [1000, 2000, 3000] };
    expect(evaluateStars(dr, { position: 1, bestLap: 50, driftScore: 2500 })).toBe(2);
  });
  it('текст цели', () => {
    expect(goalText({ kind: 'position', stars: [4, 2, 1] }, 3)).toBe('Победа');
    expect(goalText({ kind: 'lap', stars: [64, 59, 55] }, 1)).toContain('1:04.0');
  });
});

describe('прогресс и разблокировки', () => {
  it('открыто только первое событие; следующее — после звезды', () => {
    const p = emptyProgress();
    expect(isEventUnlocked(p, EVENTS[0].id)).toBe(true);
    expect(isEventUnlocked(p, EVENTS[1].id)).toBe(false);
    recordResult(p, EVENTS[0].id, 1);
    expect(isEventUnlocked(p, EVENTS[1].id)).toBe(true);
    expect(isEventUnlocked(p, EVENTS[2].id)).toBe(false);
  });
  it('главы открываются по сумме звёзд', () => {
    const p = emptyProgress();
    expect(isChapterUnlocked(p, 1)).toBe(true);
    expect(isChapterUnlocked(p, 2)).toBe(false);
    for (const e of EVENTS.slice(0, 2)) recordResult(p, e.id, 3);
    expect(totalStars(p)).toBe(6);
    expect(isChapterUnlocked(p, 2)).toBe(true);
    expect(isEventUnlocked(p, EVENTS[4].id)).toBe(true);
    expect(isChapterUnlocked(p, 3)).toBe(false);
  });
  it('награда только за новые звёзды, хранится лучшее', () => {
    const p = emptyProgress();
    const id = EVENTS[0].id;
    expect(recordResult(p, id, 2)).toEqual({ newStars: 2, reward: 2 * STAR_REWARD });
    expect(recordResult(p, id, 1)).toEqual({ newStars: 0, reward: 0 });
    expect(recordResult(p, id, 3)).toEqual({ newStars: 1, reward: STAR_REWARD });
    expect(p.stars[id]).toBe(3);
    expect(recordResult(p, 'nope', 3).reward).toBe(0);
  });
});

describe('сохранение', () => {
  it('круговой обмен и валидация', () => {
    const data = new Map<string, string>();
    const st = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    const p = emptyProgress();
    recordResult(p, EVENTS[0].id, 3);
    saveCampaign(p, st);
    expect(data.has(CAMPAIGN_KEY)).toBe(true);
    expect(loadCampaign(st)).toEqual(p);
    expect(sanitizeProgress({ stars: { [EVENTS[0].id]: 99, [EVENTS[1].id]: -1, x: 3, [EVENTS[2].id]: 'a' } }).stars).toEqual({ [EVENTS[0].id]: 3 });
    data.set(CAMPAIGN_KEY, '{bad');
    expect(loadCampaign(st)).toEqual(emptyProgress());
    expect(loadCampaign(null)).toEqual(emptyProgress());
  });
});
