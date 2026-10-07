/**
 * Ввод для двух игроков на одном экране.
 * Игрок 1: WASD + Space (ручник) + левый Shift (нитро).
 * Игрок 2: стрелки + правый Ctrl / Enter (ручник) + правый Shift / «/» (нитро).
 * Геймпады: первый подключённый — игроку 1, второй — игроку 2 (плюс клавиатура).
 */
import type { VehicleControls } from '../core/types';
import { INPUT_TUNING } from '../vehicle/handling';

interface KeyMap {
  left: string[];
  right: string[];
  gas: string[];
  brake: string[];
  hand: string[];
  nitro: string[];
}

export const SPLIT_KEYS: [KeyMap, KeyMap] = [
  { left: ['KeyA'], right: ['KeyD'], gas: ['KeyW'], brake: ['KeyS'], hand: ['Space'], nitro: ['ShiftLeft'] },
  {
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    gas: ['ArrowUp'],
    brake: ['ArrowDown'],
    hand: ['ControlRight', 'Enter', 'NumpadEnter'],
    nitro: ['ShiftRight', 'Slash', 'NumpadDivide'],
  },
];

const DEADZONE = 0.15;
const DRIFT_STEER_RISE = 10;

function approach(v: number, target: number, delta: number): number {
  if (v < target) return Math.min(target, v + delta);
  return Math.max(target, v - delta);
}

export class SplitInput {
  private readonly keys = new Set<string>();
  private readonly steer = [0, 0];
  private readonly outs: [VehicleControls, VehicleControls] = [
    { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false },
    { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false },
  ];

  constructor(target: Pick<Window, 'addEventListener'> | null = typeof window === 'undefined' ? null : window) {
    if (!target) return;
    target.addEventListener('keydown', (e) => this.keys.add(e.code));
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());
  }

  /** Для тестов: нажать/отпустить клавишу */
  setKey(code: string, down: boolean): void {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  clear(): void {
    this.keys.clear();
    this.steer[0] = this.steer[1] = 0;
  }

  private any(codes: string[]): boolean {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  /** Геймпады в порядке подключения (первый — игроку 1, второй — игроку 2) */
  private pads(): Gamepad[] {
    const out: Gamepad[] = [];
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return out;
    for (const p of navigator.getGamepads()) if (p && p.connected) out.push(p);
    return out;
  }

  /** Управление игрока `player` (0 или 1); возвращаемый объект переиспользуется */
  controls(player: 0 | 1, dt: number, pad: Gamepad | null = this.pads()[player] ?? null): VehicleControls {
    const m = SPLIT_KEYS[player];
    const target = (this.any(m.right) ? 1 : 0) - (this.any(m.left) ? 1 : 0);
    const drift = this.any(m.hand);
    let s = this.steer[player];
    if (target !== 0) {
      const flip = Math.sign(target) !== Math.sign(s) && s !== 0;
      let rate = flip ? INPUT_TUNING.keySteerCounter : INPUT_TUNING.keySteerRise;
      if (drift) rate = Math.max(rate, DRIFT_STEER_RISE);
      s = approach(s, target, rate * dt);
    } else {
      s = approach(s, 0, INPUT_TUNING.keySteerReturn * dt);
    }
    this.steer[player] = s;

    const o = this.outs[player];
    o.throttle = this.any(m.gas) ? 1 : 0;
    o.brake = this.any(m.brake) ? 1 : 0;
    o.steer = s;
    o.handbrake = drift;
    o.nitro = this.any(m.nitro);
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const stick = Math.abs(ax) > DEADZONE ? Math.sign(ax) * ((Math.abs(ax) - DEADZONE) / (1 - DEADZONE)) : 0;
      if (stick !== 0) o.steer = Math.sign(stick) * stick * stick * 0.35 + stick * 0.65;
      o.throttle = Math.max(o.throttle, pad.buttons[7]?.value ?? 0);
      o.brake = Math.max(o.brake, pad.buttons[6]?.value ?? 0);
      o.handbrake = o.handbrake || !!(pad.buttons[0]?.pressed || pad.buttons[2]?.pressed);
      o.nitro = o.nitro || !!(pad.buttons[1]?.pressed || pad.buttons[5]?.pressed);
    }
    return o;
  }
}
