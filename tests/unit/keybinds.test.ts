import { describe, it, expect } from 'vitest';
import {
  BIND_ACTIONS,
  DEFAULT_KEYS,
  KEYS_KEY,
  KeyBinds,
  assignKey,
  codesFor,
  defaultLayout,
  isBindable,
  loadKeys,
  sanitizeLayout,
  saveKeys,
  type StorageLike,
} from '../../src/input/keybinds';
import { buildKeyActions } from '../../src/input/input';

function memStorage(init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('keybinds: хранение', () => {
  it('пустое хранилище и мусор дают умолчания', () => {
    expect(loadKeys(memStorage())).toEqual(DEFAULT_KEYS);
    expect(loadKeys(memStorage({ [KEYS_KEY]: '{oops' }))).toEqual(DEFAULT_KEYS);
    expect(loadKeys(memStorage({ [KEYS_KEY]: '42' }))).toEqual(DEFAULT_KEYS);
    expect(loadKeys(null)).toEqual(DEFAULT_KEYS);
  });

  it('сохранение и загрузка (ключ neonrush.keys.v1)', () => {
    expect(KEYS_KEY).toBe('neonrush.keys.v1');
    const st = memStorage();
    const l = { ...defaultLayout(), throttle: 'KeyI', nitro: 'KeyN' };
    saveKeys(l, st);
    expect(JSON.parse(st.data[KEYS_KEY]).throttle).toBe('KeyI');
    expect(loadKeys(st)).toEqual(l);
  });

  it('невалидные коды заменяются умолчаниями, дубли сбрасывают всё', () => {
    const bad = sanitizeLayout({ ...DEFAULT_KEYS, throttle: 'Enter', brake: 42, left: '<script>' });
    expect(bad.throttle).toBe(DEFAULT_KEYS.throttle);
    expect(bad.brake).toBe(DEFAULT_KEYS.brake);
    expect(bad.left).toBe(DEFAULT_KEYS.left);
    const dup = sanitizeLayout({ ...DEFAULT_KEYS, throttle: 'KeyX', brake: 'KeyX' });
    expect(dup).toEqual(DEFAULT_KEYS);
  });

  it('служебные клавиши нельзя назначить, Escape — только на паузу', () => {
    for (const c of ['Enter', 'NumpadEnter', 'Backspace', 'Tab']) expect(isBindable('nitro', c)).toBe(false);
    expect(isBindable('nitro', 'Escape')).toBe(false);
    expect(isBindable('pause', 'Escape')).toBe(true);
    expect(isBindable('pause', 'KeyP')).toBe(true);
  });
});

describe('keybinds: переназначение', () => {
  it('свободная клавиша просто назначается', () => {
    const r = assignKey(defaultLayout(), 'nitro', 'KeyN');
    expect(r.ok).toBe(true);
    expect(r.swapped).toBeUndefined();
    expect(r.layout.nitro).toBe('KeyN');
    expect(new Set(Object.values(r.layout)).size).toBe(BIND_ACTIONS.length);
  });

  it('конфликт: действия меняются клавишами', () => {
    const r = assignKey(defaultLayout(), 'throttle', 'KeyS');
    expect(r.ok).toBe(true);
    expect(r.swapped).toBe('brake');
    expect(r.layout.throttle).toBe('KeyS');
    expect(r.layout.brake).toBe('KeyW');
    expect(new Set(Object.values(r.layout)).size).toBe(BIND_ACTIONS.length);
  });

  it('паузу нельзя поменять местами с действием, которому Escape не подходит', () => {
    expect(assignKey(defaultLayout(), 'nitro', 'Escape').ok).toBe(false);
    const r = assignKey(defaultLayout(), 'pause', 'KeyC');
    expect(r.ok).toBe(false);
    expect(r.layout).toEqual(DEFAULT_KEYS);
  });

  it('KeyBinds: сохраняет, уведомляет и сбрасывает', () => {
    const st = memStorage();
    const kb = new KeyBinds(st);
    let calls = 0;
    kb.onChange = () => calls++;
    expect(kb.assign('handbrake', 'KeyX').ok).toBe(true);
    expect(calls).toBe(1);
    expect(loadKeys(st).handbrake).toBe('KeyX');
    expect(kb.assign('handbrake', 'Enter').ok).toBe(false);
    expect(calls).toBe(1);
    kb.reset();
    expect(calls).toBe(2);
    expect(kb.layout).toEqual(DEFAULT_KEYS);
    expect(loadKeys(st)).toEqual(DEFAULT_KEYS);
    expect(new KeyBinds(st).layout).toEqual(DEFAULT_KEYS);
  });
});

describe('keybinds: ввод', () => {
  it('по умолчанию работают WASD и стрелки', () => {
    const m = buildKeyActions(defaultLayout());
    expect(m.KeyW).toBe('up');
    expect(m.ArrowUp).toBe('up');
    expect(m.KeyM).toBe('radio');
    expect(m.Escape).toBe('pause');
    expect(m.Enter).toBe('confirm');
  });

  it('после переназначения старые клавиши не действуют, стрелки остаются', () => {
    const l = assignKey(defaultLayout(), 'throttle', 'KeyI').layout;
    const m = buildKeyActions(l);
    expect(m.KeyI).toBe('up');
    expect(m.KeyW).toBeUndefined();
    expect(m.ArrowUp).toBe('up');
    expect(codesFor(l, 'throttle')).toEqual(['KeyI', 'ArrowUp']);
  });

  it('запасная клавиша исчезает, если занята другим действием', () => {
    const l = assignKey(defaultLayout(), 'camera', 'ArrowUp').layout;
    expect(codesFor(l, 'throttle')).toEqual(['KeyW']);
    expect(buildKeyActions(l).ArrowUp).toBe('camera');
  });
});
