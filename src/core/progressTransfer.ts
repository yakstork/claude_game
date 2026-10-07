/**
 * Перенос прогресса между устройствами: все ключи `neonrush.*` из localStorage -> JSON -> (deflate) -> base64.
 * Без внешних библиотек; хранилище передаётся параметром (в тестах — mock). Без DOM.
 */

export const PROGRESS_PREFIX = 'neonrush.';
/** Префиксы формата: NR1 — deflate-raw + base64, NR0 — просто base64 (если CompressionStream недоступен) */
const TAG_Z = 'NR1.';
const TAG_RAW = 'NR0.';
const MAX_CHARS = 8_000_000;

/** Минимальный интерфейс хранилища (подходит localStorage и mock) */
export interface KeyValueStore {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ProgressDump {
  v: 1;
  data: Record<string, string>;
}

export type ImportCheck = { ok: true; dump: ProgressDump; count: number } | { ok: false; error: string };

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const w = stream.writable.getWriter();
  void w.write(bytes as Uint8Array<ArrayBuffer>).then(() => w.close());
  const buf = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(buf);
}

/** Собрать все ключи neonrush.* */
export function collectProgress(store: KeyValueStore): ProgressDump {
  const data: Record<string, string> = {};
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && k.startsWith(PROGRESS_PREFIX)) {
      const v = store.getItem(k);
      if (v !== null) data[k] = v;
    }
  }
  return { v: 1, data };
}

/** Экспорт: строка для копирования */
export async function exportProgress(store: KeyValueStore): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(collectProgress(store)));
  if (typeof CompressionStream === 'function') {
    try {
      return TAG_Z + toBase64(await pipe(json, new CompressionStream('deflate-raw')));
    } catch {
      /* падаем на несжатый вариант */
    }
  }
  return TAG_RAW + toBase64(json);
}

/** Разобрать и проверить строку импорта (ничего не записывает) */
export async function parseProgress(text: string): Promise<ImportCheck> {
  const t = text.trim().replace(/\s+/g, '');
  if (!t) return { ok: false, error: 'Пустая строка' };
  if (t.length > MAX_CHARS) return { ok: false, error: 'Строка слишком длинная' };
  const tag = t.slice(0, 4);
  if (tag !== TAG_Z && tag !== TAG_RAW) return { ok: false, error: 'Неизвестный формат' };
  let json: string;
  try {
    let bytes = fromBase64(t.slice(4));
    if (tag === TAG_Z) {
      if (typeof DecompressionStream !== 'function') return { ok: false, error: 'Распаковка не поддерживается браузером' };
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    }
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: 'Строка повреждена' };
  }
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Строка повреждена' };
  }
  if (typeof obj !== 'object' || obj === null || (obj as { v?: unknown }).v !== 1) return { ok: false, error: 'Неподдерживаемая версия' };
  const data = (obj as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, error: 'Нет данных' };
  const clean: Record<string, string> = {};
  let count = 0;
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (!k.startsWith(PROGRESS_PREFIX) || typeof v !== 'string') return { ok: false, error: 'Недопустимые данные' };
    clean[k] = v;
    count++;
  }
  if (count === 0) return { ok: false, error: 'Нет данных' };
  return { ok: true, dump: { v: 1, data: clean }, count };
}

/** Применить: заменить все ключи neonrush.* данными из дампа */
export function applyProgress(store: KeyValueStore, dump: ProgressDump): void {
  const old: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k && k.startsWith(PROGRESS_PREFIX)) old.push(k);
  }
  for (const k of old) store.removeItem(k);
  for (const [k, v] of Object.entries(dump.data)) store.setItem(k, v);
}
