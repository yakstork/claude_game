/** Экран «ГАРАЖ»: улучшения машин (3 ветки × 5 уровней) и покупка цветов заводских машин. */
import type { Career, BuyResult, ColorKind, UpgradeBranch } from '../race/career';
import { BRANCHES, BRANCH_DESC, BRANCH_LABEL, COLOR_PRICE, MAX_LEVEL, formatCredits, levelsOf, nextUpgradePrice } from '../race/career';
import { cssColor } from '../world/palette';
import { el, onTap, restartAnim } from './dom';
import { Nav } from './nav';
import { makeButton } from './screens';

/** Что гаражу нужно от игры (реализует game.ts: сохранение, превью, обновление спеков) */
export interface GarageApi {
  /** Текущая карьера (только чтение) */
  career(): Career;
  buyUpgrade(carId: string, branch: UpgradeBranch): BuyResult;
  buyColor(kind: ColorKind, color: number): BuyResult;
  /** Выбрать цвет (null — заводской) */
  selectColor(carId: string, kind: ColorKind, color: number | null): boolean;
  /** Заводские цвета машины (CarSpec уже может быть перекрашен) */
  factoryColors(carId: string): { body: number; neon: number };
  /** Палитры, разрешённые для покупки */
  palette: { body: number[]; neon: number[] };
  /** Показать машину в 3D-превью */
  preview(index: number): void;
  /** Звук интерфейса */
  sound(kind: 'move' | 'select' | 'back'): void;
}

export interface GarageCarInfo {
  id: string;
  name: string;
  /** «Своя сборка»: цвета настраиваются отдельно, здесь только улучшения */
  custom: boolean;
}

const COLOR_ROWS: { kind: ColorKind; label: string }[] = [
  { kind: 'body', label: 'КУЗОВ' },
  { kind: 'neon', label: 'НЕОН' },
];

export class GarageScreen {
  readonly el: HTMLElement;
  readonly nav: Nav;
  private index = 0;
  private readonly balance: HTMLElement;
  private readonly carName: HTMLElement;
  private readonly carCount: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly rows = new Map<UpgradeBranch, { root: HTMLElement; pips: HTMLElement[]; price: HTMLElement }>();
  private readonly colorRows = new Map<ColorKind, { root: HTMLElement; swatches: HTMLElement[]; info: HTMLElement }>();
  private readonly colorBox: HTMLElement;
  private readonly cursor: Record<ColorKind, number> = { body: 0, neon: 0 };
  private readonly note: HTMLElement;

  constructor(
    parent: HTMLElement,
    nav: Nav,
    private readonly cars: GarageCarInfo[],
    private readonly api: GarageApi,
    onBack: () => void,
  ) {
    this.nav = nav;
    const root = el('div', 'screen garage', undefined, parent);
    root.hidden = true;
    this.el = root;
    const wrap = el('div', 'glow garage-wrap', undefined, root);
    const panel = el('div', 'panel cyan garage-panel', undefined, wrap);
    this.panel = panel;

    const head = el('div', 'garage-head', undefined, panel);
    el('div', 'screen-title garage-title', 'ГАРАЖ', head);
    this.balance = el('div', 'garage-balance', '0 NC', head);

    // выбор машины (влево/вправо)
    const sel = el('div', 'garage-car', undefined, panel);
    sel.setAttribute('role', 'button');
    const stepL = el('span', 'garage-step', '‹', sel);
    this.carName = el('span', 'garage-car-name', '', sel);
    this.carCount = el('span', 'car-counter', '', sel);
    const stepR = el('span', 'garage-step', '›', sel);
    nav.add({
      el: sel,
      noClick: true,
      adjust: (d) => {
        this.step(d);
        return true;
      },
      activate: () => this.step(1),
    });
    onTap(stepL, () => this.tapFocus(0, () => this.step(-1)));
    onTap(stepR, () => this.tapFocus(0, () => this.step(1)));
    onTap(this.carName, () => this.tapFocus(0, () => this.step(1)));

    // ветки улучшений
    const up = el('div', 'garage-ups', undefined, panel);
    BRANCHES.forEach((b) => {
      const row = el('div', `garage-row b-${b}`, undefined, up);
      row.setAttribute('role', 'button');
      const lab = el('div', 'garage-label', undefined, row);
      el('span', 'garage-name', BRANCH_LABEL[b], lab);
      el('span', 'garage-desc', BRANCH_DESC[b], lab);
      const pipsEl = el('div', 'garage-pips', undefined, row);
      const pips: HTMLElement[] = [];
      for (let i = 0; i < MAX_LEVEL; i++) pips.push(el('i', 'pip', undefined, pipsEl));
      const price = el('div', 'garage-price', '', row);
      this.rows.set(b, { root: row, pips, price });
      nav.add({ el: row, activate: () => this.buyUpgrade(b) });
    });

    // цвета
    this.colorBox = el('div', 'garage-colors', undefined, panel);
    for (const cr of COLOR_ROWS) {
      const row = el('div', `garage-row colors ${cr.kind}`, undefined, this.colorBox);
      row.setAttribute('role', 'group');
      el('span', 'garage-name', cr.label, row);
      const sw = el('div', 'garage-swatches', undefined, row);
      const list = api.palette[cr.kind];
      const swatches: HTMLElement[] = [];
      list.forEach((color, i) => {
        const s = el('span', 'gsw', undefined, sw);
        s.style.setProperty('--sw', cssColor(color));
        s.setAttribute('role', 'button');
        onTap(s, () => {
          this.cursor[cr.kind] = i;
          this.focusColorRow(cr.kind);
          this.activateColor(cr.kind);
        });
        swatches.push(s);
      });
      const info = el('span', 'garage-price', '', row);
      this.colorRows.set(cr.kind, { root: row, swatches, info });
      nav.add({
        el: row,
        noClick: true,
        adjust: (d) => {
          this.moveCursor(cr.kind, d);
          return true;
        },
        activate: () => this.activateColor(cr.kind),
      });
    }
    this.note = el('div', 'garage-note', 'Цвета «своей сборки» — в её настройках', panel);

    const back = makeButton(el('div', 'garage-actions', undefined, panel), 'НАЗАД');
    nav.add({ el: back, activate: onBack });
  }

  /** Вызывать при показе: фокус на первый пункт, перерисовка */
  onShown(carIndex: number): void {
    this.index = Math.min(this.cars.length - 1, Math.max(0, carIndex));
    this.cursor.body = 0;
    this.cursor.neon = 0;
    this.nav.reset(0);
    this.render();
  }

  get carIndex(): number {
    return this.index;
  }

  /** Перерисовать (баланс мог измениться извне, например после гонки) */
  refresh(): void {
    this.render();
  }

  private get car(): GarageCarInfo {
    return this.cars[this.index];
  }

  private tapFocus(navIndex: number, fn: () => void): void {
    this.nav.focusAt(navIndex, false);
    fn();
  }

  private focusColorRow(kind: ColorKind): void {
    this.nav.focusAt(4 + COLOR_ROWS.findIndex((r) => r.kind === kind), false);
  }

  private step(dir: -1 | 1): void {
    const n = this.cars.length;
    if (n === 0) return;
    this.index = (this.index + dir + n) % n;
    this.cursor.body = 0;
    this.cursor.neon = 0;
    this.api.sound('move');
    this.api.preview(this.index);
    restartAnim(this.panel, 'flash');
    this.render();
  }

  private buyUpgrade(b: UpgradeBranch): void {
    const r = this.api.buyUpgrade(this.car.id, b);
    this.api.sound(r === 'ok' ? 'select' : 'back');
    if (r === 'ok') restartAnim(this.rows.get(b)!.root, 'bought');
    this.render();
  }

  private moveCursor(kind: ColorKind, dir: -1 | 1): void {
    const n = this.api.palette[kind].length;
    this.cursor[kind] = (this.cursor[kind] + dir + n) % n;
    this.api.sound('move');
    this.render();
  }

  private activateColor(kind: ColorKind): void {
    if (this.car.custom) return;
    const color = this.api.palette[kind][this.cursor[kind]];
    const id = this.car.id;
    const factory = this.api.factoryColors(id)[kind];
    const owned = color === factory || this.api.career().owned[kind].includes(color);
    let ok = true;
    if (!owned) ok = this.api.buyColor(kind, color) === 'ok';
    if (ok) ok = this.api.selectColor(id, kind, color);
    this.api.sound(ok ? 'select' : 'back');
    this.render();
  }

  private render(): void {
    const c = this.api.career();
    const car = this.car;
    setText(this.balance, formatCredits(c.credits));
    setText(this.carName, car.name);
    setText(this.carCount, `${this.index + 1} / ${this.cars.length}`);
    const levels = levelsOf(c, car.id);
    for (const b of BRANCHES) {
      const row = this.rows.get(b)!;
      const lv = levels[b];
      row.pips.forEach((p, i) => p.classList.toggle('on', i < lv));
      const price = nextUpgradePrice(c, car.id, b);
      const maxed = price === null;
      row.root.classList.toggle('maxed', maxed);
      row.root.classList.toggle('poor', !maxed && c.credits < price);
      setText(row.price, maxed ? 'МАКС' : formatCredits(price));
      row.root.setAttribute('aria-label', `${BRANCH_LABEL[b]}: уровень ${lv} из ${MAX_LEVEL}${maxed ? '' : `, улучшить за ${price} NC`}`);
    }
    this.colorBox.hidden = car.custom;
    this.note.hidden = !car.custom;
    if (car.custom) return;
    const factory = this.api.factoryColors(car.id);
    const cc = c.cars[car.id];
    for (const cr of COLOR_ROWS) {
      const row = this.colorRows.get(cr.kind)!;
      const list = this.api.palette[cr.kind];
      const selected = cc?.[cr.kind] ?? factory[cr.kind];
      list.forEach((color, i) => {
        const s = row.swatches[i];
        s.classList.toggle('sel', color === selected);
        s.classList.toggle('cur', i === this.cursor[cr.kind]);
        s.classList.toggle('locked', color !== factory[cr.kind] && !c.owned[cr.kind].includes(color));
      });
      const color = list[this.cursor[cr.kind]];
      const owned = color === factory[cr.kind] || c.owned[cr.kind].includes(color);
      const text = color === selected ? 'ВЫБРАНО' : owned ? 'ВЫБРАТЬ' : formatCredits(COLOR_PRICE[cr.kind]);
      setText(row.info, text);
      row.info.classList.toggle('poor', !owned && c.credits < COLOR_PRICE[cr.kind]);
    }
  }
}

function setText(e: HTMLElement, t: string): void {
  if (e.textContent !== t) e.textContent = t;
}
