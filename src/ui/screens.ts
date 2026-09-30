/** Экраны: загрузка, настройки, пауза, результаты. */
import type { CarSpec, Quality, RaceResult, Settings, UICallbacks } from '../core/types';
import { el } from './dom';
import {
  clamp,
  formatPercent,
  formatScore,
  formatTime,
  resultTitle,
  stepSlider,
} from './format';
import { buildLogo } from './menu';
import { Nav } from './nav';

/** Кнопка со скосом: внутренний span выпрямляет текст. */
export function makeButton(parent: HTMLElement, text: string, cls = ''): HTMLElement {
  const b = el('div', `btn ${cls}`.trim(), undefined, parent);
  b.setAttribute('role', 'button');
  el('span', undefined, text, b);
  return b;
}

// ─── Загрузка ───────────────────────────────────────────────────────────────

export class LoadingScreen {
  readonly el: HTMLElement;
  private readonly text: HTMLElement;

  constructor(parent: HTMLElement) {
    const root = el('div', 'screen loading', undefined, parent);
    root.hidden = true;
    this.el = root;
    buildLogo(root, 'loading-logo');
    this.text = el('div', 'loading-text', 'Загрузка…', root);
    const bar = el('div', 'loading-bar', undefined, root);
    el('div', 'loading-bar-fill', undefined, bar);
  }

  setText(t: string): void {
    this.text.textContent = t;
  }
}

// ─── Настройки ──────────────────────────────────────────────────────────────

type VolumeKey = 'masterVolume' | 'musicVolume' | 'sfxVolume';

export class SettingsScreen {
  readonly el: HTMLElement;
  readonly nav: Nav;
  private settings: Settings;
  private readonly sliders: { key: VolumeKey; fill: HTMLElement; val: HTMLElement }[] = [];
  private readonly qualityBtns: Record<Quality, HTMLElement>;
  private readonly fpsBtn: HTMLElement;
  private readonly fpsVal: HTMLElement;

  constructor(
    parent: HTMLElement,
    settings: Settings,
    nav: Nav,
    private readonly cb: UICallbacks,
    onBack: () => void,
  ) {
    this.nav = nav;
    this.settings = { ...settings };
    const root = el('div', 'screen settings', undefined, parent);
    root.hidden = true;
    this.el = root;

    const wrap = el('div', 'glow', undefined, root);
    const panel = el('div', 'panel settings-panel', undefined, wrap);
    el('div', 'screen-title', 'НАСТРОЙКИ', panel);

    const sliderDefs: { key: VolumeKey; label: string }[] = [
      { key: 'masterVolume', label: 'ОБЩАЯ ГРОМКОСТЬ' },
      { key: 'musicVolume', label: 'МУЗЫКА' },
      { key: 'sfxVolume', label: 'ЭФФЕКТЫ' },
    ];
    for (const def of sliderDefs) this.addSlider(panel, def.key, def.label);

    // качество
    const qRow = el('div', 'set-row', undefined, panel);
    el('span', 'set-label', 'КАЧЕСТВО', qRow);
    const seg = el('div', 'segments', undefined, qRow);
    const low = el('div', 'seg', undefined, seg);
    el('span', undefined, 'НИЗКОЕ', low);
    const high = el('div', 'seg', undefined, seg);
    el('span', undefined, 'ВЫСОКОЕ', high);
    this.qualityBtns = { low, high };
    low.addEventListener('click', () => this.setQuality('low'));
    high.addEventListener('click', () => this.setQuality('high'));
    nav.add({
      el: qRow,
      noClick: true,
      adjust: () => {
        this.setQuality(this.settings.quality === 'low' ? 'high' : 'low');
        return true;
      },
      activate: () => this.setQuality(this.settings.quality === 'low' ? 'high' : 'low'),
    });

    // FPS
    const fRow = el('div', 'set-row', undefined, panel);
    el('span', 'set-label', 'ПОКАЗЫВАТЬ FPS', fRow);
    this.fpsBtn = el('div', 'toggle', undefined, fRow);
    el('span', 'toggle-knob', undefined, this.fpsBtn);
    this.fpsVal = el('span', 'slider-val', '', fRow);
    const toggleFps = (): void => this.setFps(!this.settings.showFps);
    this.fpsBtn.addEventListener('click', toggleFps);
    nav.add({
      el: fRow,
      noClick: true,
      adjust: () => {
        toggleFps();
        return true;
      },
      activate: toggleFps,
    });

    const back = makeButton(el('div', 'set-actions', undefined, panel), 'НАЗАД');
    nav.add({ el: back, activate: onBack });

    this.refresh();
  }

  private addSlider(parent: HTMLElement, key: VolumeKey, label: string): void {
    const row = el('div', 'set-row', undefined, parent);
    el('span', 'set-label', label, row);
    const track = el('div', 'slider', undefined, row);
    const fill = el('div', 'slider-fill', undefined, track);
    el('div', 'slider-thumb', undefined, fill);
    const val = el('span', 'slider-val', '', row);
    this.sliders.push({ key, fill, val });

    const fromPointer = (e: PointerEvent): void => {
      const r = track.getBoundingClientRect();
      const v = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
      this.setVolume(key, Math.round(v * 100) / 100);
    };
    track.addEventListener('pointerdown', (e) => {
      track.setPointerCapture(e.pointerId);
      const idx = this.nav.items.findIndex((it) => it.el === row);
      this.nav.focusAt(idx, false);
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
        this.setVolume(key, stepSlider(this.settings[key], dir));
        this.cb.onUiSound('move');
        return true;
      },
    });
  }

  private emit(): void {
    this.refresh();
    this.cb.onSettingsChanged({ ...this.settings });
  }

  private setVolume(key: VolumeKey, v: number): void {
    if (this.settings[key] === v) return;
    this.settings = { ...this.settings, [key]: v };
    this.emit();
  }

  private setQuality(q: Quality): void {
    if (this.settings.quality === q) return;
    this.settings = { ...this.settings, quality: q };
    this.emit();
  }

  private setFps(v: boolean): void {
    this.settings = { ...this.settings, showFps: v };
    this.emit();
  }

  private refresh(): void {
    for (const s of this.sliders) {
      const v = this.settings[s.key];
      s.fill.style.width = `${v * 100}%`;
      s.val.textContent = formatPercent(v);
    }
    this.qualityBtns.low.classList.toggle('on', this.settings.quality === 'low');
    this.qualityBtns.high.classList.toggle('on', this.settings.quality === 'high');
    this.fpsBtn.classList.toggle('on', this.settings.showFps);
    this.fpsVal.textContent = this.settings.showFps ? 'ВКЛ' : 'ВЫКЛ';
  }
}

// ─── Пауза ──────────────────────────────────────────────────────────────────

export class PauseScreen {
  readonly el: HTMLElement;
  readonly nav: Nav;

  constructor(
    parent: HTMLElement,
    nav: Nav,
    cb: UICallbacks,
    onSettings: () => void,
  ) {
    this.nav = nav;
    const root = el('div', 'screen pause', undefined, parent);
    root.hidden = true;
    this.el = root;
    const wrap = el('div', 'glow', undefined, root);
    const panel = el('div', 'panel pause-panel', undefined, wrap);
    el('div', 'screen-title', 'ПАУЗА', panel);
    const list = el('div', 'btn-col', undefined, panel);
    const items: { text: string; run: () => void }[] = [
      { text: 'ПРОДОЛЖИТЬ', run: () => cb.onResume() },
      { text: 'РЕСТАРТ', run: () => cb.onRestart() },
      { text: 'НАСТРОЙКИ', run: onSettings },
      { text: 'В МЕНЮ', run: () => cb.onQuitToMenu() },
    ];
    for (const it of items) {
      nav.add({ el: makeButton(list, it.text), activate: it.run });
    }
  }
}

// ─── Результаты ─────────────────────────────────────────────────────────────

export class ResultsScreen {
  readonly el: HTMLElement;
  readonly nav: Nav;
  private readonly body: HTMLElement;
  private readonly btnRow: HTMLElement;

  constructor(
    parent: HTMLElement,
    nav: Nav,
    private readonly cars: CarSpec[],
    cb: UICallbacks,
  ) {
    this.nav = nav;
    const root = el('div', 'screen results', undefined, parent);
    root.hidden = true;
    this.el = root;
    const wrap = el('div', 'glow', undefined, root);
    const panel = el('div', 'panel results-panel', undefined, wrap);
    this.body = el('div', 'results-body', undefined, panel);
    this.btnRow = el('div', 'results-actions', undefined, panel);
    const again = makeButton(this.btnRow, 'ЕЩЁ РАЗ', 'big');
    const menu = makeButton(this.btnRow, 'В МЕНЮ');
    nav.add({ el: again, activate: () => cb.onRestart() });
    nav.add({ el: menu, activate: () => cb.onQuitToMenu() });
  }

  show(r: RaceResult): void {
    const body = this.body;
    body.replaceChildren();
    const win = r.playerPosition === 1;
    const head = el('div', 'results-head', undefined, body);
    el('div', `results-title${win ? ' win' : ''}`, resultTitle(r.playerPosition), head);
    const car = this.cars.find((c) => c.id === r.carId);
    if (car) el('div', 'results-car', car.name, head);

    const badges = el('div', 'badges', undefined, body);
    if (r.newBestLap) el('div', 'badge yellow', 'НОВЫЙ РЕКОРД КРУГА', badges);
    if (r.newBestRace) el('div', 'badge cyan', 'РЕКОРД ГОНКИ', badges);
    if (r.newBestDrift) el('div', 'badge pink', 'РЕКОРД ДРИФТА', badges);
    badges.hidden = badges.childElementCount === 0;

    // лучший круг среди всех — подсветим жёлтым
    let fastest = Infinity;
    for (const row of r.rows) if (row.bestLap !== null && row.bestLap < fastest) fastest = row.bestLap;

    const table = el('div', 'rtable', undefined, body);
    const hr = el('div', 'rrow rhead', undefined, table);
    el('span', undefined, '#', hr);
    el('span', undefined, 'ПИЛОТ', hr);
    el('span', 'num', 'ВРЕМЯ', hr);
    el('span', 'num', 'ЛУЧШИЙ КРУГ', hr);
    for (const row of r.rows) {
      const cls = `rrow${row.isPlayer ? ' me' : ''}${row.projected ? ' proj' : ''}`;
      const rr = el('div', cls, undefined, table);
      el('span', 'rpos', String(row.position), rr);
      const who = el('span', 'rname', undefined, rr);
      const dot = el('i', 'rdot', undefined, who);
      dot.style.background = row.color;
      dot.style.boxShadow = `0 0 .5em ${row.color}`;
      el('span', undefined, row.name, who);
      el('span', 'num', `${row.projected ? '~' : ''}${formatTime(row.time)}`, rr);
      const fast = row.bestLap !== null && row.bestLap === fastest;
      el('span', `num${fast ? ' fastest' : ''}`, formatTime(row.bestLap), rr);
    }

    const sum = el('div', 'rsummary', undefined, body);
    this.stat(sum, 'ВРЕМЯ ГОНКИ', formatTime(r.playerTime), '');
    this.stat(sum, 'ЛУЧШИЙ КРУГ', formatTime(r.playerBestLap), 'yellow');
    this.stat(sum, 'ОЧКИ ДРИФТА', formatScore(r.driftScore), 'pink');

    this.nav.reset(0);
  }

  private stat(parent: HTMLElement, label: string, value: string, tone: string): void {
    const s = el('div', 'rstat', undefined, parent);
    el('span', 'hud-label', label, s);
    el('span', `rstat-val ${tone}`.trim(), value, s);
  }
}
