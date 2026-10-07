import { describe, expect, it } from 'vitest';
import { DailyController, type DailyHooks } from '../../src/core/dailyController';
import { loadSettings } from '../../src/core/storage';
import type { GarageController } from '../../src/core/garageController';
import type { RaceResult, Settings } from '../../src/core/types';

const ctx = {
  trackIds: ['sunset', 'heights', 'coast', 'storm', 'canyon'],
  carIds: ['razor', 'grizzly'],
  trackLength: () => 2000,
};

describe('DailyController', () => {
  it('временные настройки применяются без сохранения и возвращаются при выходе', () => {
    const base: Settings = { ...loadSettings(), raceMode: 'race', laps: 1, difficulty: 'easy', timeOfDay: 'night' };
    let cur: Settings = { ...base };
    const applied: Settings[] = [];
    const restored: Settings[] = [];
    let tracked = '';
    let started = -2;
    const hooks: DailyHooks = {
      settings: () => cur,
      applyTemp: (s) => {
        cur = s;
        applied.push(s);
      },
      restoreSettings: (s) => restored.push(s),
      setTrack: (id) => void (tracked = id),
      carIndex: (id) => ctx.carIds.indexOf(id),
      selectedCar: () => 0,
      startRace: (i) => void (started = i),
      trackName: (id) => id,
      carName: (id) => id,
      sound: () => undefined,
    };
    const garage = { addCredits: () => undefined, data: { credits: 0 } } as unknown as GarageController;
    const day = new Date(Date.UTC(2026, 9, 7, 12));
    const ctl = new DailyController(hooks, garage, ctx, () => day);
    const ch = ctl.challenge();
    ctl.start();
    expect(applied).toHaveLength(1);
    expect(applied[0].raceMode).toBe(ch.mode);
    expect(applied[0].timeOfDay).toBe(ch.timeOfDay);
    expect(tracked).toBe(ch.trackId);
    expect(started).toBe(ctx.carIds.indexOf(ch.carId));
    expect(ctl.isActive).toBe(true);
    // повторный старт не затирает исходные настройки игрока
    ctl.start();
    ctl.end();
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ raceMode: 'race', laps: 1, difficulty: 'easy', timeOfDay: 'night' });
    expect(ctl.isActive).toBe(false);
    expect(ctl.modifier).toBeNull();
  });

  it('итог: медаль и серия записываются в result.daily', () => {
    const hooks = { settings: () => loadSettings(), applyTemp: () => undefined, restoreSettings: () => undefined, setTrack: () => undefined, carIndex: () => 0, selectedCar: () => 0, startRace: () => undefined, trackName: (s: string) => s, carName: (s: string) => s, sound: () => undefined } as DailyHooks;
    const garage = { addCredits: () => undefined, data: { credits: 0 } } as unknown as GarageController;
    const ctl = new DailyController(hooks, garage, ctx, () => new Date(Date.UTC(2026, 9, 8)));
    ctl.start();
    const result = {} as RaceResult;
    ctl.finish(result, { position: 1, bestLap: 50, driftScore: 99999, wallHits: 0 });
    expect(result.daily?.medalIndex).toBe(3);
    expect(ctl.view().streak).toBe(1);
    expect(ctl.view().best?.medal).toBe(3);
  });
});
