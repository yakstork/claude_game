import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputManager } from '../../src/input/input';
import { INPUT_TUNING, INPUT_TUNING_DEFAULTS } from '../../src/vehicle/handling';

/** Клавиатурный руль читает INPUT_TUNING каждый кадр (сглаживание: нарастание, возврат, смена направления) */
describe('InputManager: сглаживание клавиатурного руля', () => {
  let now = 0;
  let target: EventTarget;
  let input: InputManager;

  const key = (type: 'keydown' | 'keyup', code: string): void => {
    target.dispatchEvent(Object.assign(new Event(type), { code, repeat: false }));
  };
  /** Прокручиваем кадры по 1/60 с; возвращаем руль на последнем кадре */
  const frames = (seconds: number): number => {
    let steer = 0;
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) {
      now += 1000 / 60;
      steer = input.controls().steer;
    }
    return steer;
  };

  beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    target = new EventTarget();
    input = new InputManager(target as unknown as Window);
    frames(0.1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(INPUT_TUNING, INPUT_TUNING_DEFAULTS);
  });

  it('плавное нарастание: 0 → 1 за ≈ 1/keySteerRise с, не мгновенно', () => {
    key('keydown', 'KeyD');
    const s1 = frames(0.1);
    expect(s1).toBeGreaterThan(0.25);
    expect(s1).toBeLessThan(0.45);
    const full = frames(0.4);
    expect(full).toBe(1);
  });

  it('быстрый возврат к центру после отпускания', () => {
    key('keydown', 'KeyA');
    frames(0.6);
    key('keyup', 'KeyA');
    const s = frames(0.1);
    expect(s).toBeLessThan(0);
    expect(s).toBeGreaterThan(-0.5);
    expect(frames(0.3)).toBe(0);
  });

  it('смена направления быстрее возврата: из +1 через ноль за ≈ 1/keySteerCounter с', () => {
    key('keydown', 'KeyD');
    frames(0.6);
    key('keyup', 'KeyD');
    key('keydown', 'KeyA');
    const t = 1 / INPUT_TUNING.keySteerCounter + 0.03;
    expect(frames(t)).toBeLessThanOrEqual(0.02);
    // при обычном отпускании за то же время руль ещё заметно отклонён
    key('keyup', 'KeyA');
    frames(0.6);
    key('keydown', 'KeyD');
    frames(0.6);
    key('keyup', 'KeyD');
    expect(frames(t)).toBeGreaterThan(0.1);
  });

  it('значения читаются каждый кадр: изменение INPUT_TUNING на лету меняет скорость руля', () => {
    key('keydown', 'KeyD');
    const slow = frames(0.1);
    key('keyup', 'KeyD');
    frames(1);
    INPUT_TUNING.keySteerRise = 8;
    key('keydown', 'KeyD');
    const fast = frames(0.1);
    expect(fast).toBeGreaterThan(slow * 1.8);
  });

  it('газ, тормоз, ручник и нитро с клавиатуры как раньше', () => {
    key('keydown', 'KeyW');
    key('keydown', 'Space');
    key('keydown', 'ShiftLeft');
    const c = input.controls();
    expect(c.throttle).toBe(1);
    expect(c.brake).toBe(0);
    expect(c.handbrake).toBe(true);
    expect(c.nitro).toBe(true);
  });
});
