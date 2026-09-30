import { describe, expect, it } from 'vitest';
import type { TouchState } from '../../src/core/types';
import { InputManager, resolveTouchMode } from '../../src/input/input';
import { INPUT_TUNING } from '../../src/vehicle/handling';

const DT = 1 / 120;

function mkTouch(p: Partial<TouchState> = {}): TouchState {
  return { left: false, right: false, throttle: false, brake: false, drift: false, nitro: false, ...p };
}

/** Фейковый EventTarget: клавиатура без DOM */
function mkKeyboard(): { target: EventTarget; key: (type: 'keydown' | 'keyup', code: string) => void } {
  const target = new EventTarget();
  return {
    target,
    key: (type, code) => {
      target.dispatchEvent(Object.assign(new Event(type), { code, repeat: false }));
    },
  };
}

function mk(): { input: InputManager; touch: TouchState } {
  const input = new InputManager(null);
  const touch = mkTouch();
  input.setTouchSource(touch);
  return { input, touch };
}

/** Прокрутка n шагов симуляции; возвращает руль на последнем */
function run(input: InputManager, seconds: number): number {
  let steer = 0;
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) steer = input.controls(DT).steer;
  return steer;
}

describe('resolveTouchMode', () => {
  it('touch → true, keyboard → false, auto → по устройству', () => {
    expect(resolveTouchMode('touch', false)).toBe(true);
    expect(resolveTouchMode('touch', true)).toBe(true);
    expect(resolveTouchMode('keyboard', true)).toBe(false);
    expect(resolveTouchMode('keyboard', false)).toBe(false);
    expect(resolveTouchMode('auto', true)).toBe(true);
    expect(resolveTouchMode('auto', false)).toBe(false);
  });
});

describe('InputManager: сенсорные кнопки', () => {
  it('создаётся без DOM', () => {
    expect(() => new InputManager()).not.toThrow();
    expect(() => new InputManager(null)).not.toThrow();
  });

  it('▶ — руль плавно растёт до 1 за ~0.25-0.3 с и возвращается', () => {
    const { input, touch } = mk();
    touch.right = true;
    const half = run(input, 0.1);
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(0.5);
    expect(run(input, 0.15)).toBeLessThan(1);
    const full = run(input, 0.05);
    expect(full).toBe(1);
    // время набора по тюнингу
    const expected = 1 / INPUT_TUNING.keySteerRise;
    expect(expected).toBeGreaterThan(0.24);
    expect(expected).toBeLessThan(0.32);

    touch.right = false;
    const back = run(input, 0.05);
    expect(back).toBeGreaterThan(0);
    expect(back).toBeLessThan(1);
    expect(run(input, 0.2)).toBe(0);
  });

  it('◀ даёт отрицательный руль', () => {
    const { input, touch } = mk();
    touch.left = true;
    expect(run(input, 0.5)).toBe(-1);
  });

  it('газ + руль + дрифт + нитро одновременно', () => {
    const { input, touch } = mk();
    Object.assign(touch, { throttle: true, right: true, drift: true, nitro: true });
    run(input, 0.2);
    const c = input.controls(DT);
    expect(c.throttle).toBe(1);
    expect(c.brake).toBe(0);
    expect(c.steer).toBeGreaterThan(0.9);
    expect(c.handbrake).toBe(true);
    expect(c.nitro).toBe(true);
    expect(input.lastDevice).toBe('touch');
  });

  it('тормоз из кнопок', () => {
    const { input, touch } = mk();
    touch.brake = true;
    const c = input.controls(DT);
    expect(c.brake).toBe(1);
    expect(c.throttle).toBe(0);
  });

  it('◀+▶ одновременно → 0', () => {
    const { input, touch } = mk();
    touch.left = true;
    touch.right = true;
    expect(run(input, 0.5)).toBe(0);
  });

  it('при зажатом дрифте руль набирается быстрее', () => {
    const a = mk();
    a.touch.right = true;
    const b = mk();
    b.touch.right = true;
    b.touch.drift = true;
    expect(run(b.input, 0.05)).toBeGreaterThan(run(a.input, 0.05) + 0.1);
  });

  it('сглаживание идёт по simDt, а не по реальному времени', () => {
    const a = mk();
    const b = mk();
    a.touch.right = true;
    b.touch.right = true;
    // один и тот же набор симуляционного времени: 12 шагов 1/120 против 1 шага 0.1
    let sa = 0;
    for (let i = 0; i < 12; i++) sa = a.input.controls(DT).steer;
    const sb = b.input.controls(12 * DT).steer;
    expect(sa).toBeCloseTo(sb, 6);
    expect(sa).toBeCloseTo(INPUT_TUNING.keySteerRise * 0.1, 6);
  });

  it('смена направления быстрая (через ноль)', () => {
    const { input, touch } = mk();
    touch.right = true;
    run(input, 0.4);
    touch.right = false;
    touch.left = true;
    const s = run(input, 0.1);
    expect(s).toBeLessThan(0);
  });

  it('источник null → руль плавно в 0, кнопки игнорируются', () => {
    const { input, touch } = mk();
    Object.assign(touch, { right: true, throttle: true });
    run(input, 0.5);
    input.setTouchSource(null);
    const c = input.controls(DT);
    expect(c.steer).toBeLessThan(1);
    expect(c.steer).toBeGreaterThan(0.5);
    expect(c.throttle).toBe(0);
    expect(run(input, 0.3)).toBe(0);
  });

  it('clear() сбрасывает сглаживание', () => {
    const { input, touch } = mk();
    touch.right = true;
    run(input, 0.5);
    input.clear();
    touch.right = false;
    expect(input.controls(DT).steer).toBe(0);
  });
});

describe('InputManager: клавиатура и кнопки вместе', () => {
  it('источники объединяются (OR)', () => {
    const kb = mkKeyboard();
    const input = new InputManager(kb.target as unknown as Window);
    const touch = mkTouch({ right: true, nitro: true });
    input.setTouchSource(touch);
    kb.key('keydown', 'KeyW');
    kb.key('keydown', 'Space');
    const c = input.controls(DT);
    expect(c.throttle).toBe(1);
    expect(c.handbrake).toBe(true);
    expect(c.nitro).toBe(true);
    expect(c.steer).toBeGreaterThan(0);
  });

  it('клавиша ← и кнопка ▶ взаимно гасят руль', () => {
    const kb = mkKeyboard();
    const input = new InputManager(kb.target as unknown as Window);
    const touch = mkTouch({ right: true });
    input.setTouchSource(touch);
    kb.key('keydown', 'ArrowLeft');
    expect(run(input, 0.5)).toBe(0);
    kb.key('keyup', 'ArrowLeft');
    expect(run(input, 0.5)).toBe(1);
  });

  it('lastDevice переключается между клавиатурой и сенсором', () => {
    const kb = mkKeyboard();
    const input = new InputManager(kb.target as unknown as Window);
    const touch = mkTouch();
    input.setTouchSource(touch);
    touch.throttle = true;
    input.controls(DT);
    expect(input.lastDevice).toBe('touch');
    kb.key('keydown', 'KeyA');
    expect(input.lastDevice).toBe('keyboard');
    touch.throttle = false;
    input.controls(DT);
    expect(input.lastDevice).toBe('keyboard');
  });
});
