/** Главное меню: логотип, выбор машины, рекорды, кнопки. Центр экрана прозрачен (3D-превью). */
import type { CarSpec, Records, UICallbacks } from '../core/types';
import { cssColor } from '../world/palette';
import { el, restartAnim } from './dom';
import { formatScore, formatTime } from './format';
import { Nav } from './nav';

export const HINT_KEYS =
  'W/↑ газ · S/↓ тормоз · A D / ← → руль · Space ручник · Shift нитро · R на трассу · Esc пауза';
export const HINT_PAD =
  'Геймпад: RT газ · LT тормоз · стик руль · A ручник · B нитро · Y на трассу · Start пауза';

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
  private readonly carPanel: HTMLElement;
  private readonly recLap: HTMLElement;
  private readonly recRace: HTMLElement;
  private readonly recDrift: HTMLElement;
  private readonly recWins: HTMLElement;
  private records: Records;

  constructor(
    parent: HTMLElement,
    private readonly cars: CarSpec[],
    records: Records,
    private readonly cb: UICallbacks,
    nav: Nav,
    onSettings: () => void,
  ) {
    this.nav = nav;
    this.records = records;
    const root = el('div', 'screen menu', undefined, parent);
    root.hidden = true;
    this.el = root;

    buildLogo(root, 'menu-logo');

    // стрелки по бокам от центра
    const left = el('div', 'car-arrow left', undefined, root);
    el('span', undefined, '◀', left);
    left.addEventListener('click', () => this.step(-1));
    const right = el('div', 'car-arrow right', undefined, root);
    el('span', undefined, '▶', right);
    right.addEventListener('click', () => this.step(1));

    // панель машины (слева снизу)
    const carWrap = el('div', 'glow menu-car-wrap', undefined, root);
    const car = el('div', 'panel menu-car', undefined, carWrap);
    this.carPanel = car;
    const head = el('div', 'car-head', undefined, car);
    el('span', 'hud-label', 'МАШИНА', head);
    this.counterEl = el('span', 'car-counter', '1 / 3', head);
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
    nav.add({ el: sett, activate: onSettings, adjust });

    // подсказка управления (внизу)
    const hint = el('div', 'menu-hint', undefined, root);
    el('div', undefined, HINT_KEYS, hint);
    el('div', undefined, HINT_PAD, hint);

    this.setCar(0, false);
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
    this.nameEl.textContent = spec.name;
    this.tagEl.textContent = spec.tagline;
    this.counterEl.textContent = `${i + 1} / ${this.cars.length}`;
    STAT_ROWS.forEach((row, k) => {
      this.bars[k].style.width = `${Math.round(spec.stats[row.key] * 100)}%`;
    });
    const body = cssColor(spec.bodyColor);
    const neon = cssColor(spec.neonColor);
    this.swatchBody.style.background = body;
    this.swatchBody.style.boxShadow = `0 0 .5em ${body}`;
    this.swatchNeon.style.background = neon;
    this.swatchNeon.style.boxShadow = `0 0 .6em ${neon}`;
    this.updateRecords();
    if (notify) {
      restartAnim(this.carPanel, 'flash');
      this.cb.onUiSound('move');
      this.cb.onPreviewCar(i);
    }
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
