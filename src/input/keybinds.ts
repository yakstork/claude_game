/**
 * Раскладка клавиш игрока 1: действие → код клавиши (KeyboardEvent.code).
 * Чистая логика без DOM: хранение (`neonrush.keys.v1`), валидация, переназначение со сменой мест при конфликте.
 * Клавиши второго игрока (split-screen) здесь не участвуют.
 */
export type BindAction = 'throttle' | 'brake' | 'left' | 'right' | 'handbrake' | 'nitro' | 'camera' | 'radio' | 'reset' | 'pause';

export const BIND_ACTIONS: readonly BindAction[] = ['throttle', 'brake', 'left', 'right', 'handbrake', 'nitro', 'camera', 'radio', 'reset', 'pause'];

export const BIND_LABELS: Record<BindAction, string> = {
  throttle: 'ГАЗ',
  brake: 'ТОРМОЗ',
  left: 'РУЛЬ ВЛЕВО',
  right: 'РУЛЬ ВПРАВО',
  handbrake: 'РУЧНИК (ДРИФТ)',
  nitro: 'НИТРО',
  camera: 'КАМЕРА',
  radio: 'РАДИО',
  reset: 'НА ТРАССУ',
  pause: 'ПАУЗА',
};

export type KeyLayout = Record<BindAction, string>;

export const KEYS_KEY = 'neonrush.keys.v1';

export const DEFAULT_KEYS: Readonly<KeyLayout> = {
  throttle: 'KeyW',
  brake: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  handbrake: 'Space',
  nitro: 'ShiftLeft',
  camera: 'KeyC',
  radio: 'KeyM',
  reset: 'KeyR',
  pause: 'Escape',
};

/** Клавиши меню (подтверждение, возврат), их назначить нельзя */
const RESERVED = new Set(['Enter', 'NumpadEnter', 'Backspace', 'Tab']);

/** Допустимый код клавиши для действия */
export function isBindable(action: BindAction, code: unknown): code is string {
  if (typeof code !== 'string' || !/^[A-Za-z0-9]{1,20}$/.test(code)) return false;
  if (RESERVED.has(code)) return false;
  // Escape — это «отмена» при выборе клавиши: только как исходная клавиша паузы
  if (code === 'Escape') return action === 'pause';
  return true;
}

export function defaultLayout(): KeyLayout {
  return { ...DEFAULT_KEYS };
}

/** Приводит произвольные данные к корректной раскладке: мусор или дубли → умолчания */
export function sanitizeLayout(raw: unknown): KeyLayout {
  const out = defaultLayout();
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  const next: KeyLayout = { ...out };
  for (const a of BIND_ACTIONS) if (isBindable(a, r[a])) next[a] = r[a];
  // дубли недопустимы: в таком случае вся раскладка по умолчанию
  const used = new Set(Object.values(next));
  return used.size === BIND_ACTIONS.length ? next : out;
}

export interface AssignResult {
  layout: KeyLayout;
  ok: boolean;
  /** Действие, с которым поменялись местами (конфликт) */
  swapped?: BindAction;
}

/** Назначить клавишу действию; если она занята другим действием — они меняются клавишами */
export function assignKey(layout: KeyLayout, action: BindAction, code: string): AssignResult {
  if (!isBindable(action, code)) return { layout, ok: false };
  const next = { ...layout };
  const other = BIND_ACTIONS.find((a) => a !== action && next[a] === code);
  if (other) {
    // клавиша другого действия должна подходить и ему (иначе — например, Escape — отказ)
    if (!isBindable(other, next[action])) return { layout, ok: false };
    next[other] = next[action];
  }
  next[action] = code;
  return { layout: next, ok: true, swapped: other };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadKeys(storage: StorageLike | null = defaultStorage()): KeyLayout {
  try {
    const raw = storage?.getItem(KEYS_KEY);
    return raw ? sanitizeLayout(JSON.parse(raw)) : defaultLayout();
  } catch {
    return defaultLayout();
  }
}

export function saveKeys(layout: KeyLayout, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(KEYS_KEY, JSON.stringify(layout));
  } catch {
    /* без сохранения */
  }
}

/** Читаемое имя клавиши для экрана */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const map: Record<string, string> = {
    Space: 'Space',
    ShiftLeft: 'L-Shift',
    ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl',
    ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt',
    AltRight: 'R-Alt',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Escape: 'Esc',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
  };
  return map[code] ?? code;
}

/** Нормальные запасные клавиши (стрелки, правый Shift, P), работают, пока не заняты в раскладке */
export const FIXED_ALTS: Partial<Record<BindAction, string[]>> = {
  throttle: ['ArrowUp'],
  brake: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  nitro: ['ShiftRight'],
  pause: ['KeyP'],
};

/** Коды действия: клавиша раскладки + запасные, не занятые другими действиями */
export function codesFor(layout: KeyLayout, action: BindAction): string[] {
  const bound = new Set<string>(Object.values(layout));
  return [layout[action], ...(FIXED_ALTS[action] ?? []).filter((c) => !bound.has(c))];
}

/** Строка подсказки меню по текущей раскладке */
export function keysHint(layout: KeyLayout): string {
  const k = (a: BindAction): string => keyLabel(layout[a]);
  return `${k('throttle')}/↑ газ · ${k('brake')}/↓ тормоз · ${k('left')} ${k('right')} / ← → руль · ${k('handbrake')} ручник · ${k('nitro')} нитро · ${k('reset')} на трассу · ${k('pause')} пауза`;
}

/** Хранитель раскладки: общий для игры и экрана «УПРАВЛЕНИЕ» */
export class KeyBinds {
  layout: KeyLayout;
  /** Вызывается после каждого изменения (игра обновляет InputManager) */
  onChange: ((l: KeyLayout) => void) | null = null;

  constructor(private readonly storage: StorageLike | null = defaultStorage()) {
    this.layout = loadKeys(storage);
  }

  assign(action: BindAction, code: string): AssignResult {
    const r = assignKey(this.layout, action, code);
    if (r.ok) this.commit(r.layout);
    return r;
  }

  reset(): void {
    this.commit(defaultLayout());
  }

  private commit(l: KeyLayout): void {
    this.layout = l;
    saveKeys(l, this.storage);
    this.onChange?.(l);
  }
}
