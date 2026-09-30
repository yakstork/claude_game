import { describe, expect, it } from 'vitest';
import {
  computeEngineTargets,
  getStepEvents,
  impulseEnvelope,
  loopSteps,
  makeEngineTargets,
  makeSoftClipCurve,
  midiToFreq,
  STEPS_PER_BAR,
  stepDuration,
  TRACKS,
} from '../../src/audio/theory';
import { SFX_MIN_INTERVAL_MS } from '../../src/audio/sfx';
import { AudioManager } from '../../src/audio/audioManager';
import type { EngineAudioParams, MusicTrack, SfxName } from '../../src/core/types';

const base: EngineAudioParams = { rpm: 0.5, throttle: 1, speed: 30, skid: 0, nitro: false, onGround: true };

describe('theory: ноты и мотор', () => {
  it('midiToFreq', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(57)).toBeCloseTo(220, 6);
    expect(midiToFreq(33)).toBeCloseTo(55, 6);
  });

  it('частота мотора ≈ 55 + rpm·190', () => {
    const t = makeEngineTargets();
    expect(computeEngineTargets({ ...base, rpm: 0 }, t).freq).toBeCloseTo(55, 6);
    expect(computeEngineTargets({ ...base, rpm: 1 }, t).freq).toBeCloseTo(245, 6);
  });

  it('срез фильтра растёт с газом, громкость ~0.18 + thr·0.2', () => {
    const t = makeEngineTargets();
    const lo = computeEngineTargets({ ...base, rpm: 0, throttle: 0 }, t);
    expect(lo.cutoff).toBeCloseTo(400, 6);
    expect(lo.gain).toBeCloseTo(0.18, 6);
    const hi = computeEngineTargets({ ...base, rpm: 0, throttle: 1 }, t);
    expect(hi.cutoff).toBeCloseTo(3500, 6);
    expect(hi.gain).toBeCloseTo(0.38, 6);
  });

  it('в воздухе обороты выше, фильтр шире; нитро — шипение и выше тон', () => {
    const t = makeEngineTargets();
    const ground = { ...computeEngineTargets(base, t) };
    const air = { ...computeEngineTargets({ ...base, onGround: false }, t) };
    expect(air.freq).toBeGreaterThan(ground.freq);
    expect(air.cutoff).toBeGreaterThan(ground.cutoff);
    const nitro = { ...computeEngineTargets({ ...base, nitro: true }, t) };
    expect(nitro.freq).toBeGreaterThan(ground.freq);
    expect(nitro.nitroGain).toBeGreaterThan(0);
    expect(ground.nitroGain).toBe(0);
    expect(nitro.nitroFreq).toBeGreaterThanOrEqual(2000);
    expect(nitro.nitroFreq).toBeLessThanOrEqual(4000);
  });

  it('визг: порог 0.15, только на земле и при speed > 5', () => {
    const t = makeEngineTargets();
    expect(computeEngineTargets({ ...base, skid: 0.1 }, t).skidGain).toBe(0);
    expect(computeEngineTargets({ ...base, skid: 0.6 }, t).skidGain).toBeGreaterThan(0);
    expect(computeEngineTargets({ ...base, skid: 1 }, t).skidGain).toBeGreaterThan(
      computeEngineTargets({ ...base, skid: 0.5 }, t).skidGain,
    );
    expect(computeEngineTargets({ ...base, skid: 0.6, onGround: false }, t).skidGain).toBe(0);
    expect(computeEngineTargets({ ...base, skid: 0.6, speed: 3 }, t).skidGain).toBe(0);
    const f = computeEngineTargets({ ...base, skid: 1 }, t).skidFreq;
    expect(f).toBeGreaterThanOrEqual(1200);
    expect(f).toBeLessThanOrEqual(2500);
  });

  it('NaN/выход за диапазон не ломают цели', () => {
    const t = computeEngineTargets({ rpm: NaN, throttle: 5, speed: NaN, skid: -1, nitro: false, onGround: true }, makeEngineTargets());
    for (const v of Object.values(t)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('theory: кривые и импульсы', () => {
  it('soft-clip кривая нечётна, монотонна и в [-1, 1]', () => {
    const c = makeSoftClipCurve(2, 257);
    expect(c[0]).toBeCloseTo(-1, 6);
    expect(c[256]).toBeCloseTo(1, 6);
    expect(c[128]).toBeCloseTo(0, 6);
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThanOrEqual(c[i - 1]!);
  });

  it('огибающая реверба: спад и гейт-обрыв', () => {
    expect(impulseEnvelope(0, 1, 4)).toBeCloseTo(1, 6);
    expect(impulseEnvelope(0.5, 1, 4)).toBeLessThan(impulseEnvelope(0.1, 1, 4));
    expect(impulseEnvelope(1.1, 1, 4)).toBe(0);
    expect(impulseEnvelope(0.9, 1, 3, 0.7)).toBe(0);
    expect(impulseEnvelope(0.3, 1, 3, 0.7)).toBeGreaterThan(0);
  });
});

describe('секвенсор: паттерны', () => {
  const tracks: MusicTrack[] = ['menu', 'race'];

  it('темп и длина лупа', () => {
    expect(TRACKS.menu.bpm).toBe(96);
    expect(TRACKS.race.bpm).toBe(118);
    for (const tr of tracks) {
      expect(TRACKS[tr].bars).toBeGreaterThanOrEqual(4);
      expect(TRACKS[tr].bars).toBeLessThanOrEqual(8);
      expect(loopSteps(tr)).toBe(TRACKS[tr].bars * STEPS_PER_BAR);
    }
    expect(stepDuration(120)).toBeCloseTo(0.125, 6);
  });

  it('индекс шага берётся по модулю лупа', () => {
    for (const tr of tracks) {
      const n = loopSteps(tr);
      expect(getStepEvents(tr, n + 5)).toEqual(getStepEvents(tr, 5));
      expect(getStepEvents(tr, -1)).toEqual(getStepEvents(tr, n - 1));
    }
  });

  it('menu: бочка на 1 и 3, пэд раз в такт, бас на восьмых', () => {
    for (let bar = 0; bar < TRACKS.menu.bars; bar++) {
      const b = bar * STEPS_PER_BAR;
      expect(getStepEvents('menu', b).kick).toBeDefined();
      expect(getStepEvents('menu', b + 8).kick).toBeDefined();
      expect(getStepEvents('menu', b + 4).kick).toBeUndefined();
      expect(getStepEvents('menu', b).pad).toBeDefined();
      expect(getStepEvents('menu', b + 1).pad).toBeUndefined();
      for (let s = 0; s < 16; s += 2) expect(getStepEvents('menu', b + s).bass).toBeDefined();
      for (let s = 1; s < 16; s += 2) expect(getStepEvents('menu', b + s).bass).toBeUndefined();
    }
  });

  it('menu: прогрессия Am–F–C–G (корни баса A F C G)', () => {
    const pc = (bar: number): number => (getStepEvents('menu', bar * STEPS_PER_BAR).bass?.midi ?? 0) % 12;
    expect([pc(0), pc(1), pc(2), pc(3)]).toEqual([9, 5, 0, 7]);
    expect(pc(4)).toBe(pc(0));
  });

  it('race: бочка на каждую долю, снэр на 2 и 4, бас и арпеджио', () => {
    const last = TRACKS.race.bars - 1;
    for (let bar = 0; bar < last; bar++) {
      const b = bar * STEPS_PER_BAR;
      for (const s of [0, 4, 8, 12]) expect(getStepEvents('race', b + s).kick).toBeDefined();
      expect(getStepEvents('race', b + 4).snare).toBeDefined();
      expect(getStepEvents('race', b + 12).snare).toBeDefined();
      expect(getStepEvents('race', b + 8).snare).toBeUndefined();
      for (let s = 0; s < 16; s += 2) expect(getStepEvents('race', b + s).bass).toBeDefined();
      for (let s = 0; s < 16; s++) expect(getStepEvents('race', b + s).arp).toBeDefined();
    }
  });

  it('race: филл в последнем такте отличается от обычного', () => {
    const b = (TRACKS.race.bars - 1) * STEPS_PER_BAR;
    expect(getStepEvents('race', b + 15).snare).toBeGreaterThan(getStepEvents('race', b + 12).snare ?? 0);
    expect(getStepEvents('race', b + 12).kick).toBeUndefined();
    expect(getStepEvents('race', 12).kick).toBeDefined();
  });

  it('все ноты в разумном диапазоне', () => {
    for (const tr of tracks) {
      for (let s = 0; s < loopSteps(tr); s++) {
        const ev = getStepEvents(tr, s);
        if (ev.bass) {
          expect(ev.bass.midi).toBeGreaterThanOrEqual(24);
          expect(ev.bass.midi).toBeLessThanOrEqual(60);
        }
        if (ev.arp) {
          expect(ev.arp.midi).toBeGreaterThanOrEqual(60);
          expect(ev.arp.midi).toBeLessThanOrEqual(90);
        }
      }
    }
  });
});

describe('sfx и AudioManager без AudioContext', () => {
  const names: SfxName[] = [
    'countdown', 'go', 'lap', 'finish', 'hit', 'combo', 'comboLost',
    'nitroStart', 'land', 'uiMove', 'uiSelect', 'uiBack',
  ];

  it('таблица ограничения частоты покрывает все эффекты', () => {
    for (const n of names) expect(SFX_MIN_INTERVAL_MS[n]).toBeGreaterThan(0);
    expect(SFX_MIN_INTERVAL_MS.hit).toBeGreaterThanOrEqual(80);
  });

  it('до unlock все методы — безопасные no-op', async () => {
    const a = new AudioManager();
    expect(() => {
      a.setVolumes(1, 0.5, 0.5);
      a.playMusic('menu');
      a.playMusic('race');
      a.playMusic(null);
      a.updateEngine(base);
      a.updateEngine(null);
      for (const n of names) a.play(n);
      a.setPaused(true);
      a.setPaused(false);
    }).not.toThrow();
    // в Node нет AudioContext — unlock тихо ничего не делает
    await expect(a.unlock()).resolves.toBeUndefined();
    expect(() => a.play('hit')).not.toThrow();
  });
});
