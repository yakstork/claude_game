/** Экран «УПРАВЛЕНИЕ»: переназначение клавиш игрока 1 (Enter / тап — ждать клавишу, Esc — отмена). */
import type { BindAction, KeyBinds } from '../input/keybinds';
import { BIND_ACTIONS, BIND_LABELS, keyLabel } from '../input/keybinds';
import { el } from './dom';
import { Nav } from './nav';
import { makeButton } from './screens';

export class KeysScreen {
  readonly el: HTMLElement;
  readonly nav: Nav;
  private readonly vals = new Map<BindAction, HTMLElement>();
  private readonly rows = new Map<BindAction, HTMLElement>();
  private readonly note: HTMLElement;
  private readonly list: HTMLElement;
  private waiting: BindAction | null = null;
  private readonly onKey = (e: KeyboardEvent): void => this.capture(e);

  constructor(
    parent: HTMLElement,
    nav: Nav,
    private readonly binds: KeyBinds,
    private readonly sound: (k: 'move' | 'select' | 'back') => void,
    onBack: () => void,
  ) {
    this.nav = nav;
    const root = el('div', 'screen settings keys', undefined, parent);
    root.hidden = true;
    this.el = root;
    const wrap = el('div', 'glow', undefined, root);
    const panel = el('div', 'panel settings-panel keys-panel', undefined, wrap);
    el('div', 'screen-title', 'УПРАВЛЕНИЕ', panel);
    this.list = el('div', 'set-list nr-scroll keys-list', undefined, panel);
    const cols = [el('div', 'set-col', undefined, this.list), el('div', 'set-col', undefined, this.list)];
    BIND_ACTIONS.forEach((a, i) => {
      const row = el('div', 'set-row keys-row', undefined, cols[i < 5 ? 0 : 1]);
      row.setAttribute('role', 'button');
      el('span', 'set-label', BIND_LABELS[a], row);
      this.vals.set(a, el('span', 'keys-val', '', row));
      this.rows.set(a, row);
      nav.add({ el: row, activate: () => this.startWait(a) });
    });
    this.note = el('div', 'set-hint keys-note', 'Enter или тап — выбрать клавишу, Esc — отмена', panel);
    const acts = el('div', 'set-actions', undefined, panel);
    const reset = makeButton(acts, 'СБРОС');
    const back = makeButton(acts, 'НАЗАД');
    nav.add({
      el: reset,
      activate: () => {
        this.cancel();
        this.binds.reset();
        this.setNote('Клавиши по умолчанию');
        this.render();
      },
    });
    nav.add({ el: back, activate: () => onBack() });
  }

  onShown(): void {
    this.cancel();
    this.list.scrollTop = 0;
    this.nav.reset(0);
    this.setNote('Enter или тап — выбрать клавишу, Esc — отмена');
    this.render();
  }

  /** Экран закрывается: снять перехват */
  onHidden(): void {
    this.cancel();
  }

  get isWaiting(): boolean {
    return this.waiting !== null;
  }

  private startWait(a: BindAction): void {
    this.cancel();
    this.waiting = a;
    window.addEventListener('keydown', this.onKey, true);
    this.rows.get(a)?.classList.add('waiting');
    this.setNote('Нажми новую клавишу… (Esc — отмена)');
    this.render();
  }

  private cancel(): void {
    if (this.waiting === null) return;
    window.removeEventListener('keydown', this.onKey, true);
    this.rows.get(this.waiting)?.classList.remove('waiting');
    this.waiting = null;
  }

  private capture(e: KeyboardEvent): void {
    const a = this.waiting;
    if (a === null) return;
    // клавиша целиком уходит экрану, игра её не видит
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.code === 'Escape') {
      this.cancel();
      this.setNote('Отменено');
      this.sound('back');
      this.render();
      return;
    }
    const r = this.binds.assign(a, e.code);
    this.cancel();
    if (!r.ok) {
      this.setNote('Эту клавишу назначить нельзя');
      this.sound('back');
    } else {
      this.setNote(r.swapped ? `${keyLabel(e.code)} была у «${BIND_LABELS[r.swapped]}» — клавиши поменялись местами` : `${BIND_LABELS[a]}: ${keyLabel(e.code)}`);
      this.sound('select');
    }
    this.render();
  }

  private setNote(t: string): void {
    if (this.note.textContent !== t) this.note.textContent = t;
  }

  private render(): void {
    for (const a of BIND_ACTIONS) {
      const v = this.vals.get(a);
      if (!v) continue;
      const t = this.waiting === a ? '…' : keyLabel(this.binds.layout[a]);
      if (v.textContent !== t) v.textContent = t;
    }
  }
}
