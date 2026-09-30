/**
 * Сенсорные кнопки для телефонов (DOM-оверлей поверх HUD).
 *
 * Слева — руль ◀ ▶; справа — ряд «ДРИФТ / НИТРО» над рядом «ТОРМОЗ / ГАЗ»; сверху справа — пауза.
 * Мультитач через Pointer Events: каждый палец (pointerId) помнит, на какой кнопке он сейчас;
 * при pointermove попадание пересчитывается по прямоугольникам, поэтому палец можно
 * перетащить с одной кнопки на соседнюю без отрыва. Состояние `state` — живой объект,
 * его читает InputManager.
 *
 * Защита от «залипших» кнопок: pointerup/pointercancel/lostpointercapture, потеря фокуса окна,
 * скрытие вкладки, touchend без оставшихся касаний, мышь без зажатых кнопок, setVisible(false).
 */
import type { TouchState } from '../core/types';
import { el, svgEl } from './dom';
import {
  applyPointerKeys,
  effectiveTouchScale,
  emptyTouchState,
  hitTest,
  inRect,
  TOUCH_KEYS,
  type RectLike,
  type TouchKey,
} from './touchLogic';

export interface TouchControlsOptions {
  onPause(): void;
  /** Первое касание кнопки: разблокировать звук (на iOS — строго в обработчике жеста) */
  onFirstInteraction(): void;
}

interface PointerInfo {
  key: TouchKey | null;
  mouse: boolean;
  /** Палец начал на кнопке паузы: пауза срабатывает при отпускании над ней */
  fromPause: boolean;
  overPause: boolean;
}

/** Допуск попадания, px: зоны нажатия смежные, допуск нужен лишь на краях. */
const HIT_SLOP = 2;
const PAUSE_SLOP = 8;

interface ButtonDef {
  key: TouchKey;
  cls: string;
  label?: string;
  sub?: string;
  aria: string;
}

const LEFT_BUTTONS: ButtonDef[] = [
  { key: 'left', cls: 'tc-steer tc-left', aria: 'Руль влево' },
  { key: 'right', cls: 'tc-steer tc-right', aria: 'Руль вправо' },
];
const RIGHT_BUTTONS: ButtonDef[] = [
  { key: 'drift', cls: 'tc-drift', label: 'ДРИФТ', aria: 'Дрифт' },
  { key: 'nitro', cls: 'tc-nitro', label: 'НИТРО', aria: 'Нитро' },
  { key: 'brake', cls: 'tc-brake', label: 'ТОРМОЗ', sub: 'НАЗАД', aria: 'Тормоз / задний ход' },
  { key: 'throttle', cls: 'tc-gas', label: 'ГАЗ', aria: 'Газ' },
];

export class TouchControls {
  /** Живое состояние кнопок (читает InputManager). */
  readonly state: TouchState = emptyTouchState();

  private readonly root: HTMLElement;
  private readonly buttons = new Map<TouchKey, HTMLElement>();
  private readonly pauseBtn: HTMLElement;
  private readonly nitroFill: HTMLElement;
  private readonly nitroBtn: HTMLElement;
  private readonly rects: RectLike[] = TOUCH_KEYS.map(() => ({ left: 0, top: 0, right: 0, bottom: 0 }));
  private readonly pauseRect: RectLike = { left: 0, top: 0, right: 0, bottom: 0 };
  private readonly pointers = new Map<number, PointerInfo>();
  /** Какие классы .on сейчас выставлены (чтобы трогать DOM только при изменении). */
  private readonly shownOn: Record<TouchKey, boolean> = emptyTouchState();

  private visible = false;
  private preview = false;
  private pauseOnly = false;
  private size = 1;
  private opacity = 0.7;
  private cNitro = -1;
  private cNitroState = -1;
  private gotDown = false;
  private gotUp = false;
  private disposed = false;

  constructor(
    parent: HTMLElement,
    private readonly opts: TouchControlsOptions,
  ) {
    const root = el('div', 'nr-touch', undefined, parent);
    root.hidden = true;
    this.root = root;

    const left = el('div', 'nr-tc-group tc-left', undefined, root);
    const right = el('div', 'nr-tc-group tc-right', undefined, root);
    let nitroBtn: HTMLElement | undefined;
    let nitroFill: HTMLElement | undefined;
    for (const [group, defs] of [
      [left, LEFT_BUTTONS],
      [right, RIGHT_BUTTONS],
    ] as const) {
      for (const d of defs) {
        const btn = el('div', `nr-tc-btn ${d.cls}`, undefined, group);
        btn.setAttribute('role', 'button');
        btn.setAttribute('aria-label', d.aria);
        const face = el('div', 'nr-tc-face', undefined, btn);
        if (d.key === 'nitro') {
          nitroFill = el('div', 'nr-tc-fill', undefined, face);
          nitroBtn = btn;
        }
        if (d.key === 'left' || d.key === 'right') {
          const svg = svgEl('svg', { viewBox: '0 0 24 24', class: 'nr-tc-icon', 'aria-hidden': 'true' }, btn);
          svgEl('polygon', { points: d.key === 'left' ? '17,3 5,12 17,21' : '7,3 19,12 7,21', fill: 'currentColor' }, svg);
        } else {
          const lab = el('div', 'nr-tc-label', undefined, btn);
          el('span', 'nr-tc-text', d.label, lab);
          if (d.sub) el('span', 'nr-tc-sub', d.sub, lab);
        }
        this.buttons.set(d.key, btn);
      }
    }
    this.nitroBtn = nitroBtn ?? root;
    this.nitroFill = nitroFill ?? root;

    const pause = el('div', 'nr-tc-pause', undefined, root);
    pause.setAttribute('role', 'button');
    pause.setAttribute('aria-label', 'Пауза');
    el('div', 'nr-tc-face', undefined, pause);
    const pIcon = svgEl('svg', { viewBox: '0 0 24 24', class: 'nr-tc-icon', 'aria-hidden': 'true' }, pause);
    svgEl('rect', { x: 6, y: 4, width: 4.2, height: 16, fill: 'currentColor' }, pIcon);
    svgEl('rect', { x: 13.8, y: 4, width: 4.2, height: 16, fill: 'currentColor' }, pIcon);
    this.pauseBtn = pause;

    root.addEventListener('pointerdown', this.onDown);
    root.addEventListener('contextmenu', this.prevent);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
    window.addEventListener('lostpointercapture', this.onCancel);
    window.addEventListener('touchend', this.onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', this.onTouchEnd, { passive: true });
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('pagehide', this.onBlur);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.applyLayout();
  }

  // ── публичный API ─────────────────────────────────────────────────────────

  /** Показывать только во время гонки. Скрытие отпускает все кнопки. */
  setVisible(v: boolean): void {
    if (this.visible === v) return;
    this.visible = v;
    this.syncHidden();
  }

  /** Только кнопка паузы (телефон в режиме «Клавиатура и геймпад»): остальные кнопки скрыты и не нажимаются. */
  setPauseOnly(on: boolean): void {
    if (this.pauseOnly === on) return;
    this.pauseOnly = on;
    this.root.classList.toggle('nr-tc-pause-only', on);
    this.reset();
  }

  /** Режим предпросмотра размера/прозрачности в настройках: видно, но не реагирует на касания. */
  setPreview(on: boolean): void {
    if (this.preview === on) return;
    this.preview = on;
    this.syncHidden();
  }

  /** size — Settings.touchSize (0.7..1.5), opacity — Settings.touchOpacity (0.2..1). */
  setLayout(size: number, opacity: number): void {
    this.size = Number.isFinite(size) ? size : 1;
    this.opacity = Math.min(1, Math.max(0.2, Number.isFinite(opacity) ? opacity : 0.7));
    this.applyLayout();
  }

  /** Заряд нитро на кнопке (вызывается каждый кадр, DOM трогается только при изменении). */
  setNitro(level: number, active: boolean): void {
    const q = Math.round(Math.min(1, Math.max(0, level)) * 100) / 100;
    if (q !== this.cNitro) {
      this.cNitro = q;
      this.nitroFill.style.transform = `scaleY(${q})`;
    }
    const st = active ? 2 : q >= 0.995 ? 1 : 0;
    if (st !== this.cNitroState) {
      this.cNitroState = st;
      this.nitroBtn.classList.toggle('ready', st === 1);
      this.nitroBtn.classList.toggle('active', st === 2);
    }
  }

  /** Отпустить все кнопки (пауза, конец гонки, blur). */
  reset(): void {
    this.pointers.clear();
    this.syncState();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.reset();
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onCancel);
    window.removeEventListener('lostpointercapture', this.onCancel);
    window.removeEventListener('touchend', this.onTouchEnd);
    window.removeEventListener('touchcancel', this.onTouchEnd);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pagehide', this.onBlur);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.root.remove();
  }

  // ── внутреннее ────────────────────────────────────────────────────────────

  private get interactive(): boolean {
    return this.visible && !this.disposed;
  }

  private syncHidden(): void {
    const show = this.visible || this.preview;
    if (!this.visible) this.reset();
    this.root.hidden = !show;
    this.root.classList.toggle('preview', this.preview && !this.visible);
    if (show) this.applyLayout();
  }

  private applyLayout(): void {
    const k = effectiveTouchScale(this.size, window.innerWidth, window.innerHeight);
    this.root.style.setProperty('--k', k.toFixed(3));
    // HUD (соседний элемент) берёт ширину блока кнопок из этой переменной
    this.root.parentElement?.style.setProperty('--k', k.toFixed(3));
    this.root.style.setProperty('--op', this.opacity.toFixed(2));
  }

  private refreshRects(): void {
    for (let i = 0; i < TOUCH_KEYS.length; i++) {
      const b = this.buttons.get(TOUCH_KEYS[i])!.getBoundingClientRect();
      const r = this.rects[i];
      r.left = b.left;
      r.top = b.top;
      r.right = b.right;
      r.bottom = b.bottom;
    }
    const p = this.pauseBtn.getBoundingClientRect();
    this.pauseRect.left = p.left;
    this.pauseRect.top = p.top;
    this.pauseRect.right = p.right;
    this.pauseRect.bottom = p.bottom;
  }

  private keyAt(x: number, y: number): TouchKey | null {
    const i = hitTest(this.rects, x, y, HIT_SLOP);
    return i < 0 ? null : TOUCH_KEYS[i];
  }

  /** Состояние + CSS-классы «нажато» из набора пальцев. */
  private syncState(): void {
    applyPointerKeys(this.pointers.values(), this.state);
    for (const k of TOUCH_KEYS) {
      const on = this.state[k];
      if (on !== this.shownOn[k]) {
        this.shownOn[k] = on;
        this.buttons.get(k)!.classList.toggle('on', on);
      }
    }
    let pauseOn = false;
    for (const p of this.pointers.values()) if (p.fromPause && p.overPause) pauseOn = true;
    this.pauseBtn.classList.toggle('on', pauseOn);
  }

  private readonly prevent = (e: Event): void => {
    if (e.cancelable) e.preventDefault();
  };

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.interactive) return;
    if (e.cancelable) e.preventDefault();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.refreshRects();
    const fromPause = inRect(this.pauseRect, e.clientX, e.clientY, 0);
    const key = fromPause || this.pauseOnly ? null : this.keyAt(e.clientX, e.clientY);
    if (!fromPause && key === null) return;
    this.pointers.set(e.pointerId, { key, mouse: e.pointerType === 'mouse', fromPause, overPause: fromPause });
    this.syncState();
    if (!this.gotDown) {
      this.gotDown = true;
      this.opts.onFirstInteraction();
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    // мышь без зажатой кнопки: отпускание пропущено (например, вне окна)
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      this.pointers.delete(e.pointerId);
      this.syncState();
      return;
    }
    if (p.fromPause) {
      const over = inRect(this.pauseRect, e.clientX, e.clientY, PAUSE_SLOP);
      if (over !== p.overPause) {
        p.overPause = over;
        this.syncState();
      }
      return;
    }
    const key = this.keyAt(e.clientX, e.clientY);
    if (key !== p.key) {
      p.key = key;
      this.syncState();
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    const tapPause = p.fromPause && inRect(this.pauseRect, e.clientX, e.clientY, PAUSE_SLOP);
    this.syncState();
    if (!this.gotUp) {
      this.gotUp = true;
      this.opts.onFirstInteraction();
    }
    if (tapPause && this.interactive) this.opts.onPause();
  };

  private readonly onCancel = (e: PointerEvent): void => {
    if (!this.pointers.delete(e.pointerId)) return;
    this.syncState();
  };

  /** Страховка от потерянного pointerup: больше нет ни одного касания — отпускаем всё. */
  private readonly onTouchEnd = (e: TouchEvent): void => {
    if (e.touches.length > 0 || this.pointers.size === 0) return;
    // мышь не трогаем: у неё своя проверка по buttons. Отпускаем чуть позже: обычный pointerup
    // (он мог прийти после touchend) к этому моменту уже убрал свой палец и обработал тап паузы.
    const ids: number[] = [];
    for (const [id, p] of this.pointers) if (!p.mouse) ids.push(id);
    window.setTimeout(() => {
      let changed = false;
      for (const id of ids) changed = this.pointers.delete(id) || changed;
      if (changed) this.syncState();
    }, 50);
  };

  private readonly onBlur = (): void => this.reset();

  private readonly onVisibility = (): void => {
    if (document.hidden) this.reset();
  };

  private readonly onResize = (): void => {
    this.applyLayout();
  };
}
