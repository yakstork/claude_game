/**
 * InputManager — клавиатура + геймпад (Standard mapping).
 * controls() — непрерывное управление машиной; consumeActions() — дискретные
 * действия для меню/паузы/респауна.
 */
import type { MenuAction, VehicleControls } from '../core/types';

const KEY_ACTIONS: Record<string, MenuAction> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Escape: 'pause',
  KeyP: 'pause',
  Backspace: 'back',
  KeyR: 'reset',
};

// Standard gamepad: 0 A, 1 B, 2 X, 3 Y, 5 RB, 6 LT, 7 RT, 8 Back, 9 Start, 12-15 D-pad
const PAD_ACTIONS: [number, MenuAction][] = [
  [0, 'confirm'],
  [1, 'back'],
  [3, 'reset'],
  [9, 'pause'],
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
];

const DEADZONE = 0.15;
/** Скорость набора руля с клавиатуры, 1/с */
const KEY_STEER_RATE = 4.5;
/** Скорость возврата руля к центру, 1/с */
const KEY_STEER_RETURN = 7;

export class InputManager {
  private readonly keys = new Set<string>();
  private readonly actions: MenuAction[] = [];
  private readonly padPrev: boolean[] = [];
  private padStickPrev = { x: 0, y: 0 };
  private keySteer = 0;
  private lastTime = performance.now();
  private readonly out: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
  lastDevice: 'keyboard' | 'gamepad' = 'keyboard';

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.lastDevice = 'keyboard';
      if (!e.repeat) {
        const a = KEY_ACTIONS[e.code];
        if (a) this.actions.push(a);
      }
      this.keys.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());
  }

  private key(...codes: string[]): boolean {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  private pad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    for (const p of navigator.getGamepads()) if (p && p.connected && p.mapping === 'standard') return p;
    for (const p of navigator.getGamepads()) if (p && p.connected) return p;
    return null;
  }

  /** Опрос геймпада: кнопки → действия по фронту нажатия */
  poll(): void {
    const p = this.pad();
    if (!p) return;
    for (const [idx, action] of PAD_ACTIONS) {
      const down = !!p.buttons[idx]?.pressed;
      if (down && !this.padPrev[idx]) {
        this.actions.push(action);
        this.lastDevice = 'gamepad';
      }
      this.padPrev[idx] = down;
    }
    // Стик как D-pad для меню
    const x = p.axes[0] ?? 0;
    const y = p.axes[1] ?? 0;
    const th = 0.6;
    if (x > th && this.padStickPrev.x <= th) this.actions.push('right');
    if (x < -th && this.padStickPrev.x >= -th) this.actions.push('left');
    if (y > th && this.padStickPrev.y <= th) this.actions.push('down');
    if (y < -th && this.padStickPrev.y >= -th) this.actions.push('up');
    this.padStickPrev = { x, y };
  }

  consumeActions(): MenuAction[] {
    this.poll();
    if (this.actions.length === 0) return [];
    return this.actions.splice(0, this.actions.length);
  }

  /** Управление машиной на текущий момент (руль с клавиатуры сглаживается) */
  controls(): VehicleControls {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    const left = this.key('KeyA', 'ArrowLeft');
    const right = this.key('KeyD', 'ArrowRight');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    if (target !== 0) {
      // при смене направления — быстрый возврат через ноль
      const rate = Math.sign(target) !== Math.sign(this.keySteer) && this.keySteer !== 0 ? KEY_STEER_RETURN : KEY_STEER_RATE;
      this.keySteer = approach(this.keySteer, target, rate * dt);
    } else {
      this.keySteer = approach(this.keySteer, 0, KEY_STEER_RETURN * dt);
    }

    const o = this.out;
    o.throttle = this.key('KeyW', 'ArrowUp') ? 1 : 0;
    o.brake = this.key('KeyS', 'ArrowDown') ? 1 : 0;
    o.steer = this.keySteer;
    o.handbrake = this.key('Space');
    o.nitro = this.key('ShiftLeft', 'ShiftRight');

    const p = this.pad();
    if (p) {
      const ax = p.axes[0] ?? 0;
      const stick = Math.abs(ax) > DEADZONE ? Math.sign(ax) * ((Math.abs(ax) - DEADZONE) / (1 - DEADZONE)) : 0;
      const rt = p.buttons[7]?.value ?? 0;
      const lt = p.buttons[6]?.value ?? 0;
      const hb = !!(p.buttons[0]?.pressed || p.buttons[2]?.pressed);
      const ni = !!(p.buttons[1]?.pressed || p.buttons[5]?.pressed);
      if (stick !== 0 || rt > 0.05 || lt > 0.05 || hb || ni) this.lastDevice = 'gamepad';
      if (stick !== 0) o.steer = Math.sign(stick) * stick * stick * 0.35 + stick * 0.65; // мягкий центр
      o.throttle = Math.max(o.throttle, rt);
      o.brake = Math.max(o.brake, lt);
      o.handbrake = o.handbrake || hb;
      o.nitro = o.nitro || ni;
    }
    return o;
  }

  /** Сброс состояния (например, при паузе) */
  clear(): void {
    this.keys.clear();
    this.keySteer = 0;
    this.actions.length = 0;
  }
}

function approach(v: number, target: number, delta: number): number {
  if (v < target) return Math.min(target, v + delta);
  return Math.max(target, v - delta);
}
