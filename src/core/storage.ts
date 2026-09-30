/** Настройки и рекорды в localStorage. Все обращения защищены try/catch. */
import type { Records, Settings } from './types';

const SETTINGS_KEY = 'neonrush.settings.v1';
const RECORDS_KEY = 'neonrush.records.v1';

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.8,
  quality: 'high',
  showFps: false,
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
  const s = read<Settings>(SETTINGS_KEY) ?? {};
  const clamp01 = (v: unknown, d: number) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);
  return {
    masterVolume: clamp01(s.masterVolume, DEFAULT_SETTINGS.masterVolume),
    musicVolume: clamp01(s.musicVolume, DEFAULT_SETTINGS.musicVolume),
    sfxVolume: clamp01(s.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
    quality: s.quality === 'low' || s.quality === 'high' ? s.quality : DEFAULT_SETTINGS.quality,
    showFps: typeof s.showFps === 'boolean' ? s.showFps : DEFAULT_SETTINGS.showFps,
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
