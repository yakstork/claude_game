import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStepEvents, getTrackConfig, loopSteps, songInfo, stationSongCount, stationVariant, STATION_NAMES } from '../../src/audio/theory';
import { MusicSequencer } from '../../src/audio/music';
import { loadSettings } from '../../src/core/storage';
import { RADIO_ORDER } from '../../src/core/types';

describe('радиостанции: данные', () => {
  it('у каждой станции 3–4 композиции, у новых — разный темп и тональность', () => {
    for (const s of ['neon', 'dark', 'chrome'] as const) expect(stationSongCount(s)).toBeGreaterThanOrEqual(3);
    const dark = Array.from({ length: stationSongCount('dark') }, (_, i) => getTrackConfig('race', stationVariant('dark', i)));
    const chrome = Array.from({ length: stationSongCount('chrome') }, (_, i) => getTrackConfig('race', stationVariant('chrome', i)));
    for (const c of dark) expect(c.bpm).toBeLessThan(100);
    for (const c of chrome) expect(c.bpm).toBeGreaterThan(130);
    expect(new Set(dark.map((c) => c.bassRoots.join())).size).toBe(dark.length);
    expect(new Set(chrome.map((c) => c.bassRoots.join())).size).toBe(chrome.length);
  });
  it('все композиции играют: на каждом шаге события корректны, есть бочка, бас и арпеджио', () => {
    for (const s of ['neon', 'dark', 'chrome'] as const) {
      for (let i = 0; i < stationSongCount(s); i++) {
        const v = stationVariant(s, i);
        const steps = loopSteps('race', v);
        let kick = 0;
        let bass = 0;
        let arp = 0;
        for (let k = 0; k < steps; k++) {
          const e = getStepEvents('race', k, v);
          if (e.kick) kick++;
          if (e.bass) bass++;
          if (e.arp) arp++;
          if (e.bass) expect(Number.isFinite(e.bass.midi)).toBe(true);
          if (e.arp) expect(e.arp.midi).toBeLessThanOrEqual(96);
        }
        expect(kick).toBeGreaterThan(8);
        expect(bass).toBeGreaterThan(8);
        expect(arp).toBeGreaterThan(8);
      }
    }
  });
  it('названия: станции и песни по номеру варианта', () => {
    expect(STATION_NAMES.dark).toBe('DARKWAVE 88');
    expect(STATION_NAMES.chrome).toBe('CHROME BEAT');
    expect(songInfo(stationVariant('dark', 1)).station).toBe('dark');
    expect(songInfo(stationVariant('chrome', 2)).station).toBe('chrome');
    expect(songInfo(0).station).toBe('neon');
    expect(songInfo(stationVariant('neon', 1)).name).toBeTruthy();
    expect(RADIO_ORDER).toEqual(['neon', 'dark', 'chrome', 'off']);
  });
});

/** Минимальный фейковый AudioContext: достаточно для планирования без звука */
function fakeNode(): Record<string, unknown> {
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
  return new Proxy(
    { connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() },
    {
      get(t: Record<string, unknown>, k: string) {
        if (k in t) return t[k];
        return param();
      },
      set(t: Record<string, unknown>, k: string, v: unknown) {
        t[k] = v;
        return true;
      },
    },
  );
}
function fakeCtx(): BaseAudioContext {
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    createBuffer: () => ({ getChannelData: () => new Float32Array(4) }),
  } as unknown as Record<string, unknown>;
  for (const m of ['createGain', 'createBiquadFilter', 'createDelay', 'createConvolver', 'createOscillator', 'createBufferSource', 'createWaveShaper', 'createStereoPanner']) ctx[m] = () => fakeNode();
  return ctx as unknown as BaseAudioContext;
}

describe('MusicSequencer: станции', () => {
  it('станция выбирает композиции своего диапазона; смена на лету; выкл. — тишина; интенсивность сохраняется', () => {
    const seq = new MusicSequencer(fakeCtx(), fakeNode() as unknown as AudioNode, false);
    seq.setTrack('race');
    expect(seq.song?.station).toBe('neon');
    seq.setStation('dark');
    expect(seq.track).toBe('race');
    expect(seq.song?.station).toBe('dark');
    expect(seq.variant).toBeGreaterThanOrEqual(100);
    seq.setStation('chrome');
    expect(seq.song?.station).toBe('chrome');
    seq.setIntensity(1);
    seq.setStation('dark');
    expect(seq.song?.station).toBe('dark');
    seq.setStation('off');
    expect(seq.track).toBeNull();
    expect(seq.song).toBeNull();
    // меню играет при выключенном радио, а гоночный трек — нет
    seq.setTrack('menu');
    expect(seq.track).toBe('menu');
    seq.setTrack('race');
    expect(seq.track).toBeNull();
    seq.setStation('neon');
    expect(seq.song?.station).toBe('neon');
  });
  it('композиции станции чередуются по кругу', () => {
    const seq = new MusicSequencer(fakeCtx(), fakeNode() as unknown as AudioNode, false);
    seq.setStation('chrome');
    seq.setTrack('race');
    const seen = new Set<number>([seq.variant]);
    for (let i = 0; i < stationSongCount('chrome') - 1; i++) {
      seq.setTrack('menu');
      seq.setTrack('race');
      seen.add(seq.variant);
    }
    expect(seen.size).toBe(stationSongCount('chrome'));
  });
});

describe('Settings.radio: валидация', () => {
  const orig = globalThis.localStorage;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (orig) vi.stubGlobal('localStorage', orig);
  });
  function withStored(v: unknown): ReturnType<typeof loadSettings> {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ radio: v }), setItem: () => undefined });
    return loadSettings();
  }
  it('известные значения сохраняются, мусор и отсутствие дают neon', () => {
    expect(withStored('dark').radio).toBe('dark');
    expect(withStored('chrome').radio).toBe('chrome');
    expect(withStored('off').radio).toBe('off');
    expect(withStored('pirate').radio).toBe('neon');
    expect(withStored(5).radio).toBe('neon');
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ masterVolume: 0.5 }), setItem: () => undefined });
    expect(loadSettings().radio).toBe('neon');
  });
});
