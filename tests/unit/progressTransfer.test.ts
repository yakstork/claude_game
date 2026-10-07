import { describe, expect, it } from 'vitest';
import { applyProgress, exportProgress, parseProgress, type KeyValueStore } from '../../src/core/progressTransfer';

class MockStore implements KeyValueStore {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  keys(): string[] {
    return [...this.m.keys()].sort();
  }
}

function filled(): MockStore {
  const s = new MockStore();
  s.setItem('neonrush.settings.v1', JSON.stringify({ masterVolume: 0.5, name: 'Тест «кириллица»' }));
  s.setItem('neonrush.records.v1', JSON.stringify({ bestLap: { 'sunset/razor': 61.234 } }));
  s.setItem('neonrush.ghost.v1.sunset/razor', 'x'.repeat(5000));
  s.setItem('other.key', 'не наш');
  return s;
}

describe('перенос прогресса', () => {
  it('экспорт -> импорт на другом хранилище воспроизводит все neonrush.* и не трогает чужие ключи', async () => {
    const a = filled();
    const text = await exportProgress(a);
    expect(text.startsWith('NR')).toBe(true);
    expect(text).not.toContain('other.key');
    const chk = await parseProgress(text);
    expect(chk.ok).toBe(true);
    if (!chk.ok) return;
    expect(chk.count).toBe(3);
    const b = new MockStore();
    b.setItem('neonrush.old.v1', 'удалится');
    b.setItem('other.key', 'остаётся');
    applyProgress(b, chk.dump);
    expect(b.keys()).toEqual(['neonrush.ghost.v1.sunset/razor', 'neonrush.records.v1', 'neonrush.settings.v1', 'other.key']);
    expect(b.getItem('neonrush.settings.v1')).toBe(a.getItem('neonrush.settings.v1'));
    expect(b.getItem('other.key')).toBe('остаётся');
  });

  it('сжатие работает: повторяющиеся данные короче исходных', async () => {
    const text = await exportProgress(filled());
    expect(text.length).toBeLessThan(2500);
  });

  it('мусор, чужой формат и подделка ключей отклоняются', async () => {
    for (const bad of ['', 'hello', 'NR1.!!!', 'NR0.' + btoa('not json'), 'NR0.' + btoa('{"v":2,"data":{}}'), 'NR0.' + btoa('{"v":1,"data":{"evil.key":"1"}}'), 'NR0.' + btoa('{"v":1,"data":{}}'), 'NR0.' + btoa('{"v":1,"data":{"neonrush.a":5}}')]) {
      const r = await parseProgress(bad);
      expect(r.ok, bad).toBe(false);
    }
  });

  it('пробелы и переносы строк внутри вставленной строки допустимы', async () => {
    const text = await exportProgress(filled());
    const wrapped = text.replace(/(.{60})/g, '$1\n ');
    expect((await parseProgress(wrapped)).ok).toBe(true);
  });
});
