/** Настройки и рекорды в localStorage. Все обращения защищены try/catch. */
import type { CustomBuild, Records, Settings } from './types';
import { isTouchDevice } from './device';
import { PALETTE } from '../world/palette';

const SETTINGS_KEY = 'neonrush.settings.v1';
const RECORDS_KEY = 'neonrush.records.v1';
const CUSTOM_KEY = 'neonrush.custom.v1';
const TRACK_KEY = 'neonrush.track.v1';

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.8,
  quality: 'high',
  showFps: false,
  controlMode: 'auto',
  touchSize: 1,
  touchOpacity: 0.7,
};

export const DEFAULT_CUSTOM_BUILD: CustomBuild = {
  speed: 0.65,
  handling: 0.65,
  drift: 0.65,
  bodyColor: PALETTE.cyan,
  neonColor: PALETTE.magenta,
};

export function emptyRecords(): Records {
  return { bestLap: {}, bestRace: {}, bestDrift: 0, wins: 0, races: 0 };
}

function read<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* приватный режим / переполнение — игра работает без сохранения */
  }
}

export function loadSettings(): Settings {
  const saved = read<Settings>(SETTINGS_KEY);
  const s = saved ?? {};
  // на телефонах/планшетах по умолчанию — низкое качество
  const defQuality = saved ? DEFAULT_SETTINGS.quality : isTouchDevice() ? 'low' : DEFAULT_SETTINGS.quality;
  const range = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : d);
  const clamp01 = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);
  return {
    masterVolume: clamp01(s.masterVolume, DEFAULT_SETTINGS.masterVolume),
    musicVolume: clamp01(s.musicVolume, DEFAULT_SETTINGS.musicVolume),
    sfxVolume: clamp01(s.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
    quality: s.quality === 'low' || s.quality === 'high' ? s.quality : defQuality,
    showFps: typeof s.showFps === 'boolean' ? s.showFps : DEFAULT_SETTINGS.showFps,
    controlMode: s.controlMode === 'keyboard' || s.controlMode === 'touch' || s.controlMode === 'auto' ? s.controlMode : 'auto',
    touchSize: range(s.touchSize, 0.7, 1.5, DEFAULT_SETTINGS.touchSize),
    touchOpacity: range(s.touchOpacity, 0.2, 1, DEFAULT_SETTINGS.touchOpacity),
  };
}

export function saveSettings(s: Settings): void {
  write(SETTINGS_KEY, s);
}

export function loadRecords(): Records {
  const r = read<Records>(RECORDS_KEY);
  const base = emptyRecords();
  if (!r) return base;
  return {
    bestLap: typeof r.bestLap === 'object' && r.bestLap ? { ...r.bestLap } : base.bestLap,
    bestRace: typeof r.bestRace === 'object' && r.bestRace ? { ...r.bestRace } : base.bestRace,
    bestDrift: typeof r.bestDrift === 'number' ? r.bestDrift : 0,
    wins: typeof r.wins === 'number' ? r.wins : 0,
    races: typeof r.races === 'number' ? r.races : 0,
  };
}

export function saveRecords(r: Records): void {
  write(RECORDS_KEY, r);
}

export function loadCustomBuild(): CustomBuild {
  const b = read<CustomBuild>(CUSTOM_KEY) ?? {};
  const u = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
  const c = (v: unknown, d: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff ? v : d);
  const d = DEFAULT_CUSTOM_BUILD;
  return {
    speed: u(b.speed, d.speed),
    handling: u(b.handling, d.handling),
    drift: u(b.drift, d.drift),
    bodyColor: c(b.bodyColor, d.bodyColor),
    neonColor: c(b.neonColor, d.neonColor),
  };
}

export function saveCustomBuild(b: CustomBuild): void {
  write(CUSTOM_KEY, b);
}

/** Последняя выбранная трасса (индекс в TRACKS) */
export function loadTrackIndex(count: number): number {
  const v = read<{ index: number }>(TRACK_KEY);
  const i = v && typeof v.index === 'number' && Number.isInteger(v.index) ? v.index : 0;
  return i >= 0 && i < count ? i : 0;
}

export function saveTrackIndex(index: number): void {
  write(TRACK_KEY, { index });
}
