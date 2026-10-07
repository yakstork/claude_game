import { describe, expect, it } from 'vitest';
import { SplitInput } from '../../src/input/splitInput';

describe('SplitInput', () => {
  it('игроки управляются независимо', () => {
    const inp = new SplitInput(null);
    inp.setKey('KeyW', true);
    inp.setKey('ArrowLeft', true);
    inp.setKey('ShiftRight', true);
    const p1 = inp.controls(0, 0.1, null);
    expect(p1.throttle).toBe(1);
    expect(p1.nitro).toBe(false);
    expect(p1.steer).toBe(0);
    const p2 = inp.controls(1, 0.1, null);
    expect(p2.throttle).toBe(0);
    expect(p2.nitro).toBe(true);
    expect(p2.steer).toBeLessThan(0);
  });

  it('ручник: Space — игрок 1, Enter / правый Ctrl — игрок 2', () => {
    const inp = new SplitInput(null);
    inp.setKey('Space', true);
    expect(inp.controls(0, 0.016, null).handbrake).toBe(true);
    expect(inp.controls(1, 0.016, null).handbrake).toBe(false);
    inp.setKey('Space', false);
    inp.setKey('ControlRight', true);
    expect(inp.controls(1, 0.016, null).handbrake).toBe(true);
  });

  it('геймпад добавляется к клавиатуре', () => {
    const inp = new SplitInput(null);
    const pad = { axes: [0.8], buttons: [{ pressed: true, value: 1 }, { pressed: false, value: 0 }, { pressed: false, value: 0 }, { pressed: false, value: 0 }, { pressed: false, value: 0 }, { pressed: false, value: 0 }, { pressed: false, value: 0 }, { pressed: false, value: 0.7 }] } as unknown as Gamepad;
    const c = inp.controls(1, 0.016, pad);
    expect(c.steer).toBeGreaterThan(0.4);
    expect(c.throttle).toBeCloseTo(0.7);
    expect(c.handbrake).toBe(true);
  });
});
