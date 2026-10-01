import { describe, expect, it } from 'vitest';
import { AudioManager } from '../../src/audio/audioManager';
import { applyBoost, computeEngineTargets, makeEngineTargets } from '../../src/audio/theory';
import { recordKey } from '../../src/core/types';
import type { EngineAudioParams, Records } from '../../src/core/types';
import {
  clampIndex,
  formatLength,
  lookupBest,
  lookupRecord,
  quantize01,
  trackLabel,
  wrapIndex,
} from '../../src/ui/trackLogic';

describe('рекорды по трассам', () => {
  it('ключ «трасса/машина» имеет приоритет', () => {
    const m = { [recordKey('sunset', 'razor')]: 70.5, razor: 99 };
    expect(lookupRecord(m, 'sunset', 'razor')).toBe(70.5);
  });
  it("для 'sunset' — запасной старый ключ (только id машины)", () => {
    expect(lookupRecord({ razor: 81.2 }, 'sunset', 'razor')).toBe(81.2);
  });
  it('для других трасс старый ключ не используется', () => {
    expect(lookupRecord({ razor: 81.2 }, 'harbor', 'razor')).toBeUndefined();
    expect(lookupRecord({ [recordKey('harbor', 'razor')]: 55 }, 'harbor', 'razor')).toBe(55);
  });
  it('нет значения → undefined; нечисло игнорируется', () => {
    expect(lookupRecord({}, 'sunset', 'razor')).toBeUndefined();
    expect(lookupRecord({ razor: Number.NaN }, 'sunset', 'razor')).toBeUndefined();
  });
  it('lookupBest: круг и гонка независимо', () => {
    const r: Records = {
      bestLap: { [recordKey('harbor', 'grizzly')]: 60 },
      bestRace: { grizzly: 190 },
      bestDrift: 0,
      wins: 0,
      races: 0,
    };
    expect(lookupBest(r, 'harbor', 'grizzly')).toEqual({ lap: 60, race: undefined });
    expect(lookupBest(r, 'sunset', 'grizzly')).toEqual({ lap: undefined, race: 190 });
  });
});

describe('выбор трассы', () => {
  it('wrapIndex: цикл в обе стороны', () => {
    expect(wrapIndex(0, 1, 2)).toBe(1);
    expect(wrapIndex(1, 1, 2)).toBe(0);
    expect(wrapIndex(0, -1, 3)).toBe(2);
    expect(wrapIndex(0, 1, 0)).toBe(0);
  });
  it('clampIndex: границы и нечисло', () => {
    expect(clampIndex(5, 2)).toBe(1);
    expect(clampIndex(-1, 2)).toBe(0);
    expect(clampIndex(undefined, 2)).toBe(0);
    expect(clampIndex(Number.NaN, 2)).toBe(0);
    expect(clampIndex(1, 0)).toBe(0);
  });
  it('formatLength: «2.2 КМ»', () => {
    expect(formatLength(2.2)).toBe('2.2 КМ');
    expect(formatLength(2.449)).toBe('2.4 КМ');
    expect(formatLength(Number.NaN)).toBe('0.0 КМ');
  });
  it('trackLabel: имя заглавными, по умолчанию SUNSET LOOP', () => {
    expect(trackLabel('Neon Harbor')).toBe('NEON HARBOR');
    expect(trackLabel(undefined)).toBe('SUNSET LOOP');
    expect(trackLabel('  ')).toBe('SUNSET LOOP');
  });
});

describe('индикатор буста: квантование', () => {
  it('quantize01: шаг, зажим, нечисло', () => {
    expect(quantize01(0.5, 20)).toBe(0.5);
    expect(quantize01(0.123, 20)).toBe(0.1);
    expect(quantize01(7, 200)).toBe(1);
    expect(quantize01(-1, 200)).toBe(0);
    expect(quantize01(Number.NaN, 200)).toBe(0);
  });
});

describe('звук буста', () => {
  const base: EngineAudioParams = { rpm: 0.5, throttle: 1, speed: 30, skid: 0, nitro: false, onGround: true };

  it('applyBoost: 0 — без изменений; >0 — тон выше и шипение', () => {
    const a = { ...computeEngineTargets(base, makeEngineTargets()) };
    const same = applyBoost({ ...a }, 0);
    expect(same).toEqual(a);
    const b = applyBoost({ ...a }, 1);
    expect(b.freq).toBeGreaterThan(a.freq);
    expect(b.freq).toBeLessThan(a.freq * 1.1);
    expect(b.nitroGain).toBeGreaterThan(0);
    expect(b.cutoff).toBeLessThanOrEqual(9000);
  });
  it('applyBoost меняет объект на месте и не создаёт нового', () => {
    const t = makeEngineTargets();
    expect(applyBoost(t, 0.5)).toBe(t);
  });
  it('applyBoost: нечисло и выход за 0..1 безопасны', () => {
    const t = computeEngineTargets(base, makeEngineTargets());
    const f0 = t.freq;
    applyBoost(t, Number.NaN);
    expect(t.freq).toBe(f0);
    applyBoost(t, 50);
    expect(t.freq).toBeLessThanOrEqual(f0 * 1.06 + 1e-9);
  });
  it('AudioManager.playBoost / setBoostLevel до unlock — безопасный no-op', () => {
    const a = new AudioManager();
    expect(() => a.playBoost(0.8)).not.toThrow();
    expect(() => a.setBoostLevel(1)).not.toThrow();
    expect(() => a.playBoost(Number.NaN)).not.toThrow();
  });
});
