/** Экран «Своя сборка»: три слайдера с бюджетом очков, образцы цвета кузова и неона. Центр прозрачен (3D-превью). */
import type { CustomBuild, UICallbacks } from '../core/types';
import { cssColor } from '../world/palette';
import {
  applySlider,
  BUILD_SNAP,
  colorName,
  cycleIndex,
  fitToBudget,
  formatPoints,
  formatSliderValue,
  pointsLeft,
  SLIDER_KEYS,
  sliderCap,
  stepBuildSlider,
} from './customLogic';
import type { CustomPalette, SliderKey, SliderResult } from './customLogic';
import { el, onTap, restartAnim } from './dom';
import { fractionOf, valueFromFraction } from './format';
import { Nav } from './nav';
import { makeButton } from './screens';

export interface CustomizeInit {
  build: CustomBuild;
  budget: number;
  palette: CustomPalette;
  /** Значения кнопки «СБРОС» */
  defaults: CustomBuild;
}

const SLIDER_LABELS: Record<SliderKey, string> = {
  speed: 'СКОРОСТЬ',
  handling: 'УПРАВЛЯЕМОСТЬ',
  drift: 'ДРИФТ',
};

type ColorKey = 'bodyColor' | 'neonColor';

interface SliderRow {
  key: SliderKey;
  fill: HTMLElement;
  cap: HTMLElement;
  val: HTMLElement;
}

interface ColorRow {
  key: ColorKey;
  list: number[];
  btns: HTMLElement[];
  name: HTMLElement;
}

const NOTE_LEFT = 'СВОБОДНО ';
const NOTE_FULL = 'ОЧКИ КОНЧИЛИСЬ';

export class CustomizeScreen {
  readonly el: HTMLElement;
  readonly nav: Nav;

  private build: CustomBuild;
  private readonly budget: number;
  private readonly defaults: CustomBuild;
  private readonly sliders: SliderRow[] = [];
  private readonly colors: ColorRow[] = [];
  private readonly budgetBox: HTMLElement;
  private readonly budgetFill: HTMLElement;
  private readonly budgetVal: HTMLElement;
  private readonly budgetNote: HTMLElement;
  private readonly scrollBox: HTMLElement;
  private lastHit = -1e9;

  constructor(
    parent: HTMLElement,
    nav: Nav,
    private readonly cb: UICallbacks,
    init: CustomizeInit,
    onDone: () => void,
  ) {
    this.nav = nav;
    this.budget = init.budget;
    this.defaults = fitToBudget(init.defaults, init.budget);
    this.build = fitToBudget(init.build, init.budget);

    const root = el('div', 'screen customize', undefined, parent);
    root.hidden = true;
    this.el = root;

    // ── левая панель: бюджет и слайдеры ──
    const leftWrap = el('div', 'glow cz-side cz-left', undefined, root);
    const left = el('div', 'panel cz-panel', undefined, leftWrap);
    el('div', 'cz-title', 'СВОЯ СБОРКА', left);

    const box = el('div', 'cz-budget', undefined, left);
    this.budgetBox = box;
    const bHead = el('div', 'cz-budget-head', undefined, box);
    el('span', 'hud-label', 'ОЧКИ СБОРКИ', bHead);
    this.budgetVal = el('span', 'cz-budget-val', '', bHead);
    const bTrack = el('div', 'cz-budget-track', undefined, box);
    this.budgetFill = el('div', 'cz-budget-fill', undefined, bTrack);
    this.budgetNote = el('div', 'cz-budget-note', '', box);

    this.scrollBox = el('div', 'cz-sliders nr-scroll', undefined, left);
    for (const key of SLIDER_KEYS) this.addSlider(this.scrollBox, key);

    // ── правая панель: цвета и кнопки ──
    const rightWrap = el('div', 'glow cz-side cz-right', undefined, root);
    const right = el('div', 'panel cyan cz-panel', undefined, rightWrap);
    const colorsBox = el('div', 'cz-colors nr-scroll', undefined, right);
    this.addColors(colorsBox, 'bodyColor', 'КУЗОВ', init.palette.body);
    this.addColors(colorsBox, 'neonColor', 'НЕОН', init.palette.neon);

    const actions = el('div', 'cz-actions', undefined, right);
    const done = makeButton(actions, 'ГОТОВО', 'big');
    const reset = makeButton(actions, 'СБРОС');
    const at = (b: HTMLElement): number => nav.items.findIndex((it) => it.el === b);
    // влево/вправо переключают фокус между кнопками ряда
    const hop = (other: HTMLElement) => (): boolean => {
      nav.focusAt(at(other), true);
      return true;
    };
    nav.add({ el: done, activate: onDone, adjust: hop(reset) });
    nav.add({ el: reset, activate: () => this.reset(), adjust: hop(done) });

    // подсказка управления (клавиатура/геймпад)
    el('div', 'cz-hint', '↑ ↓ строка · ← → изменить · Enter — выбрать · Esc — готово', root);

    this.refresh();
  }

  /** Сброс прокрутки и фокуса при открытии. */
  onShown(): void {
    this.scrollBox.scrollTop = 0;
    this.nav.reset(0);
    this.refresh();
  }

  /** Обновить значения извне (без колбэка). */
  setBuild(b: CustomBuild): void {
    this.build = fitToBudget(b, this.budget);
    this.refresh();
  }

  // ── построение ──────────────────────────────────────────────────────────────

  private addSlider(parent: HTMLElement, key: SliderKey): void {
    const row = el('div', 'set-row cz-row', undefined, parent);
    const head = el('div', 'cz-row-head', undefined, row);
    el('span', 'set-label', SLIDER_LABELS[key], head);
    const val = el('span', 'slider-val', '', head);
    const track = el('div', 'slider', undefined, row);
    const cap = el('div', 'slider-cap', undefined, track);
    cap.hidden = true;
    const fill = el('div', 'slider-fill', undefined, track);
    el('div', 'slider-thumb', undefined, fill);
    this.sliders.push({ key, fill, cap, val });

    const fromPointer = (e: PointerEvent): void => {
      const r = track.getBoundingClientRect();
      const frac = (e.clientX - r.left) / Math.max(1, r.width);
      this.commit(applySlider(this.build, key, valueFromFraction(frac, 0, 1, BUILD_SNAP), this.budget));
    };
    track.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try {
        track.setPointerCapture(e.pointerId);
      } catch {
        /* pointerId уже неактивен */
      }
      this.nav.focusAt(this.nav.items.findIndex((it) => it.el === row), false);
      this.cb.onUiSound('move');
      fromPointer(e);
    });
    track.addEventListener('pointermove', (e) => {
      if (track.hasPointerCapture(e.pointerId)) fromPointer(e);
    });
    this.nav.add({
      el: row,
      noClick: true,
      adjust: (dir) => {
        const res = stepBuildSlider(this.build, key, dir, this.budget);
        if (res.build !== this.build) this.cb.onUiSound('move');
        this.commit(res);
        return true;
      },
    });
  }

  private addColors(parent: HTMLElement, key: ColorKey, label: string, list: number[]): void {
    const row = el('div', 'set-row cz-row cz-colorrow', undefined, parent);
    const head = el('div', 'cz-row-head', undefined, row);
    el('span', 'set-label', label, head);
    const name = el('span', 'cz-color-name', '', head);
    const grid = el('div', 'cz-swatches', undefined, row);
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', label);
    const cr: ColorRow = { key, list, btns: [], name };
    list.forEach((hex, i) => {
      const b = el('div', 'pick', undefined, grid);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', colorName(hex));
      b.style.setProperty('--sw', cssColor(hex));
      onTap(b, () => {
        this.nav.focusAt(this.nav.items.findIndex((it) => it.el === row), false);
        this.pickColor(cr, i, true);
      });
      cr.btns.push(b);
    });
    this.colors.push(cr);
    const cycle = (dir: -1 | 1): void => {
      this.pickColor(cr, cycleIndex(cr.list.indexOf(this.build[key]), dir, cr.list.length), true);
    };
    this.nav.add({
      el: row,
      noClick: true,
      adjust: (dir) => {
        cycle(dir);
        return true;
      },
      activate: () => cycle(1),
    });
  }

  // ── изменения ───────────────────────────────────────────────────────────────

  private commit(res: SliderResult): void {
    if (res.blocked) this.flashLimit();
    if (res.build === this.build) return;
    this.build = res.build;
    this.refresh();
    this.emit();
  }

  private pickColor(cr: ColorRow, i: number, sound: boolean): void {
    const hex = cr.list[i];
    if (hex === undefined || this.build[cr.key] === hex) return;
    this.build = { ...this.build, [cr.key]: hex };
    if (sound) this.cb.onUiSound('move');
    this.refresh();
    this.emit();
  }

  private reset(): void {
    const d = this.defaults;
    const b = this.build;
    if (
      b.speed === d.speed &&
      b.handling === d.handling &&
      b.drift === d.drift &&
      b.bodyColor === d.bodyColor &&
      b.neonColor === d.neonColor
    ) {
      return;
    }
    this.build = { ...d };
    this.refresh();
    this.emit();
  }

  private emit(): void {
    this.cb.onCustomBuildChanged({ ...this.build });
  }

  /** Очки кончились: подсветить индикатор (не чаще раза в 250 мс — при перетаскивании упора). */
  private flashLimit(): void {
    const now = performance.now();
    if (now - this.lastHit < 250) return;
    this.lastHit = now;
    restartAnim(this.budgetBox, 'hit');
  }

  // ── отрисовка ───────────────────────────────────────────────────────────────

  private refresh(): void {
    const b = this.build;
    for (const s of this.sliders) {
      const v = b[s.key];
      setStyle(s.fill, 'width', `${fractionOf(v, 0, 1) * 100}%`);
      setText(s.val, formatSliderValue(v));
      // зона недоступных значений (за упором бюджета)
      const cap = sliderCap(b, s.key, this.budget);
      const showCap = cap < 1 - 1e-6;
      if (s.cap.hidden === showCap) s.cap.hidden = !showCap;
      if (showCap) setStyle(s.cap, 'left', `${cap * 100}%`);
    }
    const sum = b.speed + b.handling + b.drift;
    const left = pointsLeft(b, this.budget);
    const full = left < 0.005;
    setText(this.budgetVal, `${formatPoints(sum)} / ${formatPoints(this.budget)}`);
    setStyle(this.budgetFill, 'width', `${fractionOf(sum, 0, this.budget) * 100}%`);
    setText(this.budgetNote, full ? NOTE_FULL : `${NOTE_LEFT}${formatPoints(left)}`);
    this.budgetBox.classList.toggle('full', full);
    for (const cr of this.colors) {
      const cur = b[cr.key];
      cr.btns.forEach((btn, i) => {
        const on = cr.list[i] === cur;
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      setText(cr.name, colorName(cur));
    }
  }
}

function setText(e: HTMLElement, t: string): void {
  if (e.textContent !== t) e.textContent = t;
}

function setStyle(e: HTMLElement, prop: 'width' | 'left', v: string): void {
  if (e.style[prop] !== v) e.style[prop] = v;
}
