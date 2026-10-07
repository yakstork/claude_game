/**
 * InputManager — клавиатура + сенсорные кнопки + геймпад (Standard mapping).
 * controls() — непрерывное управление машиной; consumeActions() — дискретные
 * действия для меню/паузы/респауна.
 */
import type { ControlMode, MenuAction, TouchState, VehicleControls } from '../core/types';
import { INPUT_TUNING } from '../vehicle/handling';
import { codesFor, defaultLayout } from './keybinds';
import type { BindAction, KeyLayout } from './keybinds';

/** Неизменные клавиши меню: подтверждение и возврат */
const FIXED_KEY_ACTIONS: Record<string, MenuAction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Backspace: 'back',
};

/** Таблица код → действие меню по раскладке игрока (руль/газ/тормоз заодно двигают по меню) */
export function buildKeyActions(layout: KeyLayout): Record<string, MenuAction> {
  const m: Record<string, MenuAction> = { ...FIXED_KEY_ACTIONS };
  const add = (action: BindAction, menu: MenuAction): void => {
    for (const c of codesFor(layout, action)) m[c] = menu;
  };
  add('throttle', 'up');
  add('brake', 'down');
  add('left', 'left');
  add('right', 'right');
  add('pause', 'pause');
  add('reset', 'reset');
  add('camera', 'camera');
  add('radio', 'radio');
  return m;
}

// Standard gamepad: 0 A, 1 B, 2 X, 3 Y, 5 RB, 6 LT, 7 RT, 8 Back, 9 Start, 12-15 D-pad
const PAD_ACTIONS: [number, MenuAction][] = [
  [0, 'confirm'],
  [1, 'back'],
  [3, 'reset'],
  [4, 'radio'],
  [8, 'camera'],
  [9, 'pause'],
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
];

const DEADZONE = 0.15;
/** Скорость набора руля с клавиатуры при зажатом Space, 1/с */
const DRIFT_STEER_RISE = 10;

/** Включать ли сенсорное управление: 'touch' — да, 'keyboard' — нет, 'auto' — по устройству */
export function resolveTouchMode(mode: ControlMode, touchDevice: boolean): boolean {
  if (mode === 'touch') return true;
  if (mode === 'keyboard') return false;
  return touchDevice;
}

export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

export class InputManager {
  private readonly keys = new Set<string>();
  private readonly actions: MenuAction[] = [];
  private readonly padPrev: boolean[] = [];
  private padStickPrev = { x: 0, y: 0 };
  private keySteer = 0;
  private lastTime = performance.now();
  private readonly out: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
  private touch: TouchState | null = null;
  lastDevice: InputDevice = 'keyboard';
  private layout: KeyLayout = defaultLayout();
  private keyActions: Record<string, MenuAction> = buildKeyActions(this.layout);
  private codes: Record<BindAction, string[]> = this.makeCodes();

  /** target по умолчанию window; без DOM (Node) подписок нет */
  constructor(target: Pick<Window, 'addEventListener'> | null = typeof window === 'undefined' ? null : window) {
    if (!target) return;
    target.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code.startsWith('Arrow') || this.codes.handbrake.includes(e.code)) e.preventDefault();
      this.lastDevice = 'keyboard';
      if (!e.repeat) {
        const a = this.keyActions[e.code];
        if (a) this.actions.push(a);
      }
      this.keys.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());
  }

  private makeCodes(): Record<BindAction, string[]> {
    const o = {} as Record<BindAction, string[]>;
    for (const a of Object.keys(this.layout) as BindAction[]) o[a] = codesFor(this.layout, a);
    return o;
  }

  /** Новая раскладка клавиш (из экрана «УПРАВЛЕНИЕ») */
  setKeys(layout: KeyLayout): void {
    this.layout = { ...layout };
    this.keyActions = buildKeyActions(this.layout);
    this.codes = this.makeCodes();
    this.keys.clear();
  }

  /** Источник сенсорных кнопок (живой объект, его мутирует UI); null — нет. */
  setTouchSource(state: TouchState | null): void {
    this.touch = state;
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

  /**
   * Управление машиной на текущий момент (руль с клавиатуры сглаживается).
   * simDt — шаг симуляции: при вызове из фиксированного шага сглаживание идёт по
   * времени симуляции (не по реальному), без ступенек при нескольких шагах за кадр.
   */
  controls(simDt?: number): VehicleControls {
    const now = performance.now();
    const dt = simDt ?? Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    const t = this.touch;
    const left = this.key(...this.codes.left) || (t !== null && t.left);
    const right = this.key(...this.codes.right) || (t !== null && t.right);
    const drift = this.key(...this.codes.handbrake) || (t !== null && t.drift);
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    if (target !== 0) {
      // плавное нарастание; при смене направления — быстрый переход через ноль
      const flip = Math.sign(target) !== Math.sign(this.keySteer) && this.keySteer !== 0;
      let rate = flip ? INPUT_TUNING.keySteerCounter : INPUT_TUNING.keySteerRise;
      // с зажатым дрифтом руль набирается быстрее — срыв зада не ждёт плавного нарастания
      if (drift) rate = Math.max(rate, DRIFT_STEER_RISE);
      this.keySteer = approach(this.keySteer, target, rate * dt);
    } else {
      this.keySteer = approach(this.keySteer, 0, INPUT_TUNING.keySteerReturn * dt);
    }

    const o = this.out;
    o.throttle = this.key(...this.codes.throttle) || (t !== null && t.throttle) ? 1 : 0;
    o.brake = this.key(...this.codes.brake) || (t !== null && t.brake) ? 1 : 0;
    o.steer = this.keySteer;
    o.handbrake = drift;
    o.nitro = this.key(...this.codes.nitro) || (t !== null && t.nitro);
    if (t && (t.left || t.right || t.throttle || t.brake || t.drift || t.nitro)) this.lastDevice = 'touch';

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
