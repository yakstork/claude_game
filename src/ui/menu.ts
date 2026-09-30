/** Главное меню: логотип, выбор машины, рекорды, кнопки. Центр экрана прозрачен (3D-превью). */
import type { CarSpec, Records, UICallbacks } from '../core/types';
import { CUSTOM_CAR_ID } from '../core/types';
import { cssColor } from '../world/palette';
import { arrowIcon, el, onTap, restartAnim } from './dom';
import { formatScore, formatTime } from './format';
import { addFullscreenButton } from './fullscreen';
import { Nav } from './nav';

export const HINT_KEYS =
  'W/↑ газ · S/↓ тормоз · A D / ← → руль · Space ручник · Shift нитро · R на трассу · Esc пауза';
export const HINT_PAD =
  'Геймпад: RT газ · LT тормоз · стик руль · A ручник · B нитро · Y на трассу · Start пауза';
/** Подсказка для сенсорного управления (вместо клавиатуры и геймпада). */
export const HINT_TOUCH_1 = 'Руль — слева · ГАЗ, ТОРМОЗ, ДРИФТ, НИТРО — справа';
export const HINT_TOUCH_2 = 'II сверху — пауза';

const STAT_ROWS: { label: string; key: 'speed' | 'handling' | 'drift' }[] = [
  { label: 'СКОРОСТЬ', key: 'speed' },
  { label: 'УПРАВЛЯЕМОСТЬ', key: 'handling' },
  { label: 'ДРИФТ', key: 'drift' },
];

export function buildLogo(parent: HTMLElement, cls: string): HTMLElement {
  const logo = el('div', `logo ${cls}`, undefined, parent);
  el('div', 'logo-title', 'NEON RUSH', logo).setAttribute('data-text', 'NEON RUSH');
  el('div', 'logo-sub', 'SUNSET LOOP', logo);
  return logo;
}

export class MainMenu {
  readonly el: HTMLElement;
  readonly nav: Nav;
  index = 0;

  private readonly nameEl: HTMLElement;
  private readonly tagEl: HTMLElement;
  private readonly counterEl: HTMLElement;
  private readonly bars: HTMLElement[] = [];
  private readonly swatchBody: HTMLElement;
  private readonly swatchNeon: HTMLElement;
  private readonly headLabel: HTMLElement;
  private readonly customBox: HTMLElement;
  private readonly customBtn: HTMLElement;
  /** Локальная копия списка: updateCarSpec не трогает массив игры */
  private readonly cars: CarSpec[];
  private readonly carPanel: HTMLElement;
  private readonly recLap: HTMLElement;
  private readonly recRace: HTMLElement;
  private readonly recDrift: HTMLElement;
  private readonly recWins: HTMLElement;
  private readonly hint1: HTMLElement;
  private readonly hint2: HTMLElement;
  private records: Records;

  constructor(
    parent: HTMLElement,
    cars: CarSpec[],
    records: Records,
    private readonly cb: UICallbacks,
    nav: Nav,
    onSettings: () => void,
    onCustomize: () => void = () => undefined,
  ) {
    this.cars = cars.slice();
    this.nav = nav;
    this.records = records;
    const root = el('div', 'screen menu', undefined, parent);
    root.hidden = true;
    this.el = root;

    buildLogo(root, 'menu-logo');

    // стрелки по бокам от центра (SVG: глифы ◀ ▶ на iOS превращаются в эмодзи)
    const left = el('div', 'car-arrow left', undefined, root);
    left.setAttribute('role', 'button');
    left.setAttribute('aria-label', 'Предыдущая машина');
    arrowIcon('left', el('span', undefined, undefined, left));
    onTap(left, () => this.step(-1));
    const right = el('div', 'car-arrow right', undefined, root);
    right.setAttribute('role', 'button');
    right.setAttribute('aria-label', 'Следующая машина');
    arrowIcon('right', el('span', undefined, undefined, right));
    onTap(right, () => this.step(1));

    // панель машины (слева снизу)
    const carWrap = el('div', 'glow menu-car-wrap', undefined, root);
    const car = el('div', 'panel menu-car', undefined, carWrap);
    this.carPanel = car;
    const head = el('div', 'car-head', undefined, car);
    // кнопки листания внутри панели — для низких экранов (боковые стрелки там скрыты)
    const stepL = el('div', 'car-step', undefined, head);
    stepL.setAttribute('role', 'button');
    stepL.setAttribute('aria-label', 'Предыдущая машина');
    arrowIcon('left', stepL);
    onTap(stepL, () => this.step(-1));
    this.headLabel = el('span', 'hud-label car-head-label', 'МАШИНА', head);
    this.counterEl = el('span', 'car-counter', '1 / 3', head);
    const stepR = el('div', 'car-step', undefined, head);
    stepR.setAttribute('role', 'button');
    stepR.setAttribute('aria-label', 'Следующая машина');
    arrowIcon('right', stepR);
    onTap(stepR, () => this.step(1));
    this.nameEl = el('div', 'car-name', '', car);
    this.tagEl = el('div', 'car-tag', '', car);
    const stats = el('div', 'car-stats', undefined, car);
    for (const row of STAT_ROWS) {
      const r = el('div', 'stat-row', undefined, stats);
      el('span', 'stat-label', row.label, r);
      const track = el('div', 'stat-track', undefined, r);
      this.bars.push(el('div', 'stat-fill', undefined, track));
    }
    const sw = el('div', 'car-colors', undefined, car);
    el('span', 'hud-label', 'ЦВЕТ', sw);
    this.swatchBody = el('span', 'swatch body', undefined, sw);
    this.swatchNeon = el('span', 'swatch neon', undefined, sw);
    // «Своя сборка»: кнопка настройки видна только у машины с id CUSTOM_CAR_ID
    this.customBox = el('div', 'car-custom', undefined, car);
    this.customBox.hidden = true;
    this.customBtn = el('div', 'btn compact cyan', undefined, this.customBox);
    this.customBtn.setAttribute('role', 'button');
    el('span', undefined, 'НАСТРОИТЬ', this.customBtn);

    // рекорды (справа сверху)
    const recWrap = el('div', 'glow menu-rec-wrap', undefined, root);
    const rec = el('div', 'panel cyan menu-rec', undefined, recWrap);
    el('div', 'panel-title', 'РЕКОРДЫ', rec);
    const grid = el('div', 'rec-grid', undefined, rec);
    el('span', 'hud-label', 'ЛУЧШИЙ КРУГ', grid);
    this.recLap = el('span', 'rec-val', '', grid);
    el('span', 'hud-label', 'ЛУЧШАЯ ГОНКА', grid);
    this.recRace = el('span', 'rec-val', '', grid);
    el('span', 'hud-label', 'ЛУЧШИЙ ДРИФТ', grid);
    this.recDrift = el('span', 'rec-val drift', '', grid);
    el('span', 'hud-label', 'ПОБЕДЫ / ГОНКИ', grid);
    this.recWins = el('span', 'rec-val', '', grid);

    // кнопки (справа снизу)
    const btns = el('div', 'menu-buttons', undefined, root);
    const race = el('div', 'btn big', undefined, btns);
    el('span', undefined, 'ГОНКА', race);
    const sett = el('div', 'btn', undefined, btns);
    el('span', undefined, 'НАСТРОЙКИ', sett);
    const adjust = (dir: -1 | 1): boolean => {
      this.step(dir);
      return true;
    };
    nav.add({ el: race, activate: () => cb.onStartRace(this.index), adjust });
    nav.add({ el: this.customBtn, activate: onCustomize, adjust });
    nav.add({ el: sett, activate: onSettings, adjust });
    // «На весь экран» — только если Fullscreen API есть (на iPhone нет)
    addFullscreenButton(btns, nav);

    // подсказка управления (внизу)
    const hint = el('div', 'menu-hint', undefined, root);
    this.hint1 = el('div', undefined, HINT_KEYS, hint);
    this.hint2 = el('div', undefined, HINT_PAD, hint);

    this.setCar(0, false);
  }

  /** Подсказка управления: кнопки на экране (сенсорный режим) или клавиатура/геймпад. */
  setTouchHint(touch: boolean): void {
    const a = touch ? HINT_TOUCH_1 : HINT_KEYS;
    const b = touch ? HINT_TOUCH_2 : HINT_PAD;
    if (this.hint1.textContent !== a) this.hint1.textContent = a;
    if (this.hint2.textContent !== b) this.hint2.textContent = b;
  }

  /** Листание: wrap, звук 'move', onPreviewCar. */
  step(dir: -1 | 1): void {
    const n = this.cars.length;
    if (n === 0) return;
    this.setCar((this.index + dir + n) % n, true);
  }

  setCar(i: number, notify: boolean): void {
    const spec = this.cars[i];
    if (!spec) return;
    this.index = i;
    this.counterEl.textContent = `${i + 1} / ${this.cars.length}`;
    this.renderSpec(spec);
    this.updateRecords();
    if (notify) {
      restartAnim(this.carPanel, 'flash');
      this.cb.onUiSound('move');
      this.cb.onPreviewCar(i);
    }
  }

  /** Новые stats/цвета машины (у «своей сборки» они меняются на лету): перерисовать, если она показана. */
  updateCarSpec(i: number, spec: CarSpec): void {
    if (i < 0 || i >= this.cars.length) return;
    this.cars[i] = spec;
    if (i === this.index) this.renderSpec(spec);
  }

  private renderSpec(spec: CarSpec): void {
    setText(this.nameEl, spec.name);
    setText(this.tagEl, spec.tagline);
    const custom = spec.id === CUSTOM_CAR_ID;
    setText(this.headLabel, custom ? 'СВОЯ СБОРКА' : 'МАШИНА');
    this.headLabel.classList.toggle('custom', custom);
    if (this.customBox.hidden === custom) this.customBox.hidden = !custom;
    // фокус был на скрывшейся кнопке «НАСТРОИТЬ» → на «ГОНКА»
    if (!custom && this.nav.current?.el === this.customBtn) this.nav.reset(0);
    STAT_ROWS.forEach((row, k) => {
      this.bars[k].style.width = `${Math.round(spec.stats[row.key] * 100)}%`;
    });
    const body = cssColor(spec.bodyColor);
    const neon = cssColor(spec.neonColor);
    this.swatchBody.style.background = body;
    this.swatchBody.style.boxShadow = `0 0 .5em ${body}`;
    this.swatchNeon.style.background = neon;
    this.swatchNeon.style.boxShadow = `0 0 .6em ${neon}`;
  }

  setRecords(r: Records): void {
    this.records = r;
    this.updateRecords();
  }

  private updateRecords(): void {
    const id = this.cars[this.index]?.id ?? '';
    const r = this.records;
    this.recLap.textContent = formatTime(r.bestLap[id]);
    this.recRace.textContent = formatTime(r.bestRace[id]);
    this.recDrift.textContent = formatScore(r.bestDrift);
    this.recWins.textContent = `${r.wins} / ${r.races}`;
  }
}

function setText(e: HTMLElement, t: string): void {
  if (e.textContent !== t) e.textContent = t;
}
