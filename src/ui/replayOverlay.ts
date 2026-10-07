/**
 * Оверлей повтора и фоторежима: тонкая полоса прогресса и подсказки внизу,
 * кнопки для касаний, поверхность для жестов (тап / свайп / перетаскивание).
 * Логика не здесь: все действия уходят в обработчики контроллера.
 */
import { el } from './dom';
import { formatTime } from './format';
import './replay.css';

export interface ReplayOverlayHandlers {
  onTogglePause(): void;
  onSeek(deltaSeconds: number): void;
  onPhoto(): void;
  onExit(): void;
  onShoot(): void;
  /** Перетаскивание в фоторежиме, px */
  onDrag(dx: number, dy: number): void;
  onWheel(deltaY: number): void;
}

export interface ReplayStatus {
  time: number;
  duration: number;
  speed: number;
  paused: boolean;
  camera: string;
  auto: boolean;
}

export class ReplayOverlay {
  readonly root: HTMLElement;
  private readonly surface: HTMLElement;
  private readonly replayBar: HTMLElement;
  private readonly photoBar: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly infoEl: HTMLElement;
  private readonly flashEl: HTMLElement;
  private readonly toast: HTMLElement;
  private toastTimer = 0;
  private photoMode = false;
  private last = '';

  constructor(
    parent: HTMLElement,
    private readonly h: ReplayOverlayHandlers,
  ) {
    this.root = el('div', 'replay', undefined, parent);
    this.root.hidden = true;
    this.surface = el('div', 'replay-surface', undefined, this.root);
    this.flashEl = el('div', 'replay-flash', undefined, this.root);
    this.toast = el('div', 'replay-toast', undefined, this.root);
    this.toast.hidden = true;

    // режим повтора
    this.replayBar = el('div', 'replay-bar', undefined, this.root);
    const track = el('div', 'replay-track', undefined, this.replayBar);
    this.fill = el('i', 'replay-fill', undefined, track);
    const row = el('div', 'replay-row', undefined, this.replayBar);
    this.timeEl = el('span', 'replay-time', '', row);
    this.infoEl = el('span', 'replay-info', '', row);
    const btns = el('span', 'replay-btns', undefined, row);
    this.button(btns, '−5с', () => h.onSeek(-5));
    this.button(btns, 'ПАУЗА', () => h.onTogglePause());
    this.button(btns, '+5с', () => h.onSeek(5));
    this.button(btns, 'ФОТО', () => h.onPhoto());
    this.button(btns, 'НАЗАД', () => h.onExit());
    el(
      'div',
      'replay-hint',
      '← → перемотка · Пробел пауза · 1–5 камера · 0 авто · ↑ ↓ скорость · F фото · Esc назад',
      this.replayBar,
    );

    // режим фото
    this.photoBar = el('div', 'replay-bar photo', undefined, this.root);
    const prow = el('div', 'replay-row', undefined, this.photoBar);
    el('span', 'replay-info', 'ФОТОРЕЖИМ', prow);
    const pb = el('span', 'replay-btns', undefined, prow);
    this.button(pb, 'СНИМОК', () => h.onShoot(), true);
    this.button(pb, 'НАЗАД', () => h.onExit());
    el('div', 'replay-hint', 'Мышь / стрелки — вращение · колесо / + − — зум · Enter или P — снимок · Esc назад', this.photoBar);

    this.bindGestures();
  }

  private button(parent: HTMLElement, text: string, fn: () => void, primary = false): HTMLButtonElement {
    const b = el('button', `replay-btn${primary ? ' primary' : ''}`, text, parent);
    b.type = 'button';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
      b.blur();
    });
    // жесты поверхности не должны ловить нажатия на кнопках
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    return b;
  }

  private bindGestures(): void {
    const s = this.surface;
    let id = -1;
    let sx = 0;
    let sy = 0;
    let lx = 0;
    let ly = 0;
    let moved = 0;
    s.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      sx = lx = e.clientX;
      sy = ly = e.clientY;
      moved = 0;
      try {
        s.setPointerCapture(id);
      } catch {
        /* нет захвата — не критично */
      }
    });
    s.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (this.photoMode) this.h.onDrag(dx, dy);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      id = -1;
      if (this.photoMode) return;
      const dx = e.clientX - sx;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - sy) * 1.5) this.h.onSeek(dx > 0 ? 5 : -5);
      else if (moved < 12) this.h.onTogglePause();
    };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', () => {
      id = -1;
    });
    s.addEventListener(
      'wheel',
      (e) => {
        if (!this.photoMode) return;
        e.preventDefault();
        this.h.onWheel(e.deltaY);
      },
      { passive: false },
    );
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(mode: 'replay' | 'photo' | null): void {
    this.photoMode = mode === 'photo';
    this.root.hidden = mode === null;
    this.replayBar.hidden = mode !== 'replay';
    this.photoBar.hidden = mode !== 'photo';
    this.toast.hidden = true;
    this.last = '';
  }

  setStatus(s: ReplayStatus): void {
    const key = `${s.time.toFixed(2)}|${s.speed}|${s.paused}|${s.camera}|${s.auto}`;
    if (key === this.last) return;
    this.last = key;
    this.fill.style.transform = `scaleX(${s.duration > 0 ? Math.min(1, s.time / s.duration) : 0})`;
    this.timeEl.textContent = `${formatTime(s.time)} / ${formatTime(s.duration)}`;
    this.infoEl.textContent = `${s.paused ? 'ПАУЗА · ' : ''}${s.speed}× · КАМЕРА: ${s.camera}${s.auto ? ' (АВТО)' : ''}`;
  }

  /** Короткое сообщение над полосой (например «Снимок сохранён») */
  say(text: string): void {
    this.toast.textContent = text;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), 1800);
  }

  flash(): void {
    this.flashEl.classList.remove('go');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('go');
  }
}
