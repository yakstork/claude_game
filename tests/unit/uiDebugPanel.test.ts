import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectTuningOverrides, loadTuningOverrides, TUNING_STORAGE_KEY } from '../../src/ui/debugPanel';

function fakeStorage(initial?: string): Storage {
  const m = new Map<string, string>();
  if (initial !== undefined) m.set(TUNING_STORAGE_KEY, initial);
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('collectTuningOverrides', () => {
  const defaults = { a: { grip: 1, steer: 5 }, b: { grip: 2, steer: 6 } };

  it('возвращает null, если ничего не менялось', () => {
    expect(collectTuningOverrides({ a: { grip: 1, steer: 5 }, b: { grip: 2, steer: 6 } }, defaults)).toBeNull();
  });

  it('сохраняет только изменённые ключи, включая extra', () => {
    const r = collectTuningOverrides(
      { a: { grip: 1.5, steer: 5 }, b: { grip: 2, steer: 6 } },
      defaults,
      { config: { smooth: 0.3 }, defaults: { smooth: 0.1 } },
    );
    expect(r).toEqual({ cars: { a: { grip: 1.5 } }, extra: { smooth: 0.3 } });
  });
});

describe('loadTuningOverrides', () => {
  it('применяет сохранённые значения к существующим ключам', () => {
    vi.stubGlobal('localStorage', fakeStorage(JSON.stringify({ cars: { a: { grip: 3 } }, extra: { smooth: 0.9 } })));
    const configs = { a: { grip: 1, steer: 5 } };
    const extra = { smooth: 0.1 };
    loadTuningOverrides(configs, extra);
    expect(configs.a).toEqual({ grip: 3, steer: 5 });
    expect(extra.smooth).toBe(0.9);
  });

  it('игнорирует несуществующие ключи, машины и нечисловые значения', () => {
    vi.stubGlobal(
      'localStorage',
      fakeStorage(JSON.stringify({ cars: { a: { nope: 1, grip: 'x', steer: null }, zzz: { grip: 9 } }, extra: { q: 1 } })),
    );
    const configs = { a: { grip: 1, steer: 5 } };
    loadTuningOverrides(configs, { smooth: 0.1 });
    expect(configs).toEqual({ a: { grip: 1, steer: 5 } });
  });

  it('молча переживает мусор и отсутствие localStorage', () => {
    const configs = { a: { grip: 1 } };
    vi.stubGlobal('localStorage', fakeStorage('{битый json'));
    expect(() => loadTuningOverrides(configs)).not.toThrow();
    vi.stubGlobal('localStorage', fakeStorage('42'));
    expect(() => loadTuningOverrides(configs)).not.toThrow();
    vi.unstubAllGlobals();
    expect(() => loadTuningOverrides(configs)).not.toThrow();
    expect(configs.a.grip).toBe(1);
  });
});
