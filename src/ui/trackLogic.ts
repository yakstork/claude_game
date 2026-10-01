/** Чистые функции выбора трассы, рекордов и индикатора буста (без DOM — тестируются в Node). */
import type { Records } from '../core/types';
import { recordKey } from '../core/types';
import { clamp } from './format';

/** Исходная трасса: её рекорды могли быть сохранены по старому ключу (только id машины). */
export const LEGACY_TRACK_ID = 'sunset';

/** Значение из Records.bestLap/bestRace: по ключу «трасса/машина», для 'sunset' — запасной старый ключ. */
export function lookupRecord(
  map: Record<string, number>,
  trackId: string,
  carId: string,
): number | undefined {
  const v = map[recordKey(trackId, carId)];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (trackId === LEGACY_TRACK_ID) {
    const old = map[carId];
    if (typeof old === 'number' && Number.isFinite(old)) return old;
  }
  return undefined;
}

/** Лучший круг и лучшая гонка для пары трасса+машина. */
export function lookupBest(
  r: Records,
  trackId: string,
  carId: string,
): { lap: number | undefined; race: number | undefined } {
  return { lap: lookupRecord(r.bestLap, trackId, carId), race: lookupRecord(r.bestRace, trackId, carId) };
}

/** Длина круга: «2.2 КМ». */
export function formatLength(km: number): string {
  return `${(Number.isFinite(km) ? Math.max(0, km) : 0).toFixed(1)} КМ`;
}

/** Циклический шаг индекса по списку длины n (n ≤ 0 → 0). */
export function wrapIndex(i: number, dir: -1 | 1, n: number): number {
  return n <= 0 ? 0 : (((i + dir) % n) + n) % n;
}

/** Индекс в допустимых границах (нечисло → 0). */
export function clampIndex(i: number | undefined, n: number): number {
  if (i === undefined || !Number.isFinite(i) || n <= 0) return 0;
  return clamp(Math.round(i), 0, n - 1);
}

/** Округление доли 0..1 до шага 1/steps — чтобы DOM трогать только при заметном изменении. */
export function quantize01(v: number, steps: number): number {
  return Math.round(clamp(Number.isFinite(v) ? v : 0, 0, 1) * steps) / steps;
}

/** Подпись под логотипом: имя трассы заглавными (без трасс — прежний «SUNSET LOOP»). */
export function trackLabel(name: string | undefined): string {
  return (name && name.trim() ? name : 'Sunset Loop').toUpperCase();
}
