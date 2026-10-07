/** Экраны: загрузка, настройки, пауза, результаты. */
import type { CameraView, CarSpec, ControlMode, Difficulty, Quality, RaceMode, RaceResult, Settings, UICallbacks } from '../core/types';
import { isTouchDevice } from '../core/device';
import { el, onTap } from './dom';
import {
  fractionOf,
  formatPercentRaw,
  formatScore,
  formatTime,
  resultTitle,
  stepRange,
  valueFromFraction,
} from './format';
import { addFullscreenButton } from './fullscreen';
import { formatCredits } from '../race/career';
import { buildLogo } from './menu';
import { Nav } from './nav';
import { trackLabel } from './trackLogic';

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
  private readonly sub: HTMLElement;

  constructor(parent: HTMLElement, trackName?: string) {
    const root = el('div', 'screen loading', undefined, parent);
    root.hidden = true;
    this.el = root;
    this.sub = buildLogo(root, 'loading-logo', trackName).sub;
    this.text = el('div', 'loading-text', 'Загрузка…', root);
    const bar = el('div', 'loading-bar', undefined, root);
    el('div', 'loading-bar-fill', undefined, bar);
  }

  setText(t: string): void {
    this.text.textContent = t;
  }

  /** Подпись под логотипом — имя выбранной трассы. */
  setTrack(name: string | undefined): void {
    const t = trackLabel(name);
    if (this.sub.textContent !== t) this.sub.textContent = t;
  }
}

// ─── Настройки ──────────────────────────────────────────────────────────────

type SliderKey = 'masterVolume' | 'musicVolume' | 'sfxVolume' | 'touchSize' | 'touchOpacity';

interface SliderDef {
  key: SliderKey;
  label: string;
  min: number;
  max: number;
  /** Шаг клавиатуры/геймпада */
  step: number;
  /** Шаг привязки при перетаскивании пальцем/мышью */
  snap: number;
  /** При перетаскивании показывать предпросмотр сенсорных кнопок */
  preview?: boolean;
}

const SLIDERS: SliderDef[] = [
  { key: 'masterVolume', label: 'ОБЩАЯ ГРОМКОСТЬ', min: 0, max: 1, step: 0.1, snap: 0.01 },
  { key: 'musicVolume', label: 'МУЗЫКА', min: 0, max: 1, step: 0.1, snap: 0.01 },
  { key: 'sfxVolume', label: 'ЭФФЕКТЫ', min: 0, max: 1, step: 0.1, snap: 0.01 },
];
const TOUCH_SLIDERS: SliderDef[] = [
  { key: 'touchSize', label: 'РАЗМЕР КНОПОК', min: 0.7, max: 1.5, step: 0.1, snap: 0.05, preview: true },
  { key: 'touchOpacity', label: 'ПРОЗРАЧНОСТЬ КНОПОК', min: 0.2, max: 1, step: 0.1, snap: 0.05, preview: true },
];

const CONTROL_MODES: { mode: ControlMode; full: string; short: string }[] = [
  { mode: 'auto', full: 'АВТО', short: 'АВТО' },
  { mode: 'keyboard', full: 'КЛАВИАТУРА И ГЕЙМПАД', short: 'КЛАВИАТУРА' },
  { mode: 'touch', full: 'СЕНСОРНЫЕ КНОПКИ', short: 'КНОПКИ' },
];

type ChoiceKey = 'raceMode' | 'difficulty' | 'laps' | 'cameraView';
interface ChoiceDef<K extends ChoiceKey = ChoiceKey> {
  key: K;
  label: string;
  options: { value: Settings[K]; full: string; short?: string }[];
}

/** Параметры гонки: режим, сложность, круги, камера */
export const RACE_CHOICES: ChoiceDef[] = [
  {
    key: 'raceMode',
    label: 'РЕЖИМ',
    options: [
      { value: 'race' as RaceMode, full: 'ГОНКА' },
      { value: 'cup' as RaceMode, full: 'КУБОК' },
      { value: 'timeAttack' as RaceMode, full: 'НА ВРЕМЯ' },
    ],
  },
  {
    key: 'difficulty',
    label: 'СЛОЖНОСТЬ',
    options: [
      { value: 'easy' as Difficulty, full: 'ЛЕГКО' },
      { value: 'normal' as Difficulty, full: 'НОРМА' },
      { value: 'hard' as Difficulty, full: 'ХАРД' },
    ],
  },
  {
    key: 'laps',
    label: 'КРУГИ',
    options: [
      { value: 1, full: '1' },
      { value: 3, full: '3' },
      { value: 5, full: '5' },
    ],
  },
  {
    key: 'cameraView',
    label: 'КАМЕРА (C)',
    options: [
      { value: 'far' as CameraView, full: 'ДАЛЬНЯЯ', short: 'ДАЛЬ' },
      { value: 'near' as CameraView, full: 'БЛИЖНЯЯ', short: 'БЛИЖЕ' },
      { value: 'bumper' as CameraView, full: 'БАМПЕР' },
    ],
  },
];

export class SettingsScreen {
  readonly el: HTMLElement;
  readonly nav: Nav;
  private settings: Settings;
  private readonly sliders: { def: SliderDef; fill: HTMLElement; val: HTMLElement }[] = [];
  private readonly qualityBtns: Record<Quality, HTMLElement>;
  private readonly modeBtns: Record<ControlMode, HTMLElement>;
  private readonly fpsBtn: HTMLElement;
  private readonly fpsVal: HTMLElement;
  private readonly list: HTMLElement;
  private readonly modeHint: HTMLElement;
  private readonly choices: { def: ChoiceDef; btns: HTMLElement[] }[] = [];

  constructor(
    parent: HTMLElement,
    settings: Settings,
    nav: Nav,
    private readonly cb: UICallbacks,
    onBack: () => void,
    /** Предпросмотр сенсорных кнопок, пока палец на слайдере размера/прозрачности */
    private readonly onPreview: (active: boolean) => void = () => undefined,
  ) {
    this.nav = nav;
    this.settings = { ...settings };
    const root = el('div', 'screen settings', undefined, parent);
    root.hidden = true;
    this.el = root;

    const wrap = el('div', 'glow', undefined, root);
    const panel = el('div', 'panel settings-panel', undefined, wrap);
    el('div', 'screen-title', 'НАСТРОЙКИ', panel);
    // список может прокручиваться (маленький экран): контейнер .nr-scroll разрешён guard'ом main.ts
    const listBox = el('div', 'set-list nr-scroll', undefined, panel);
    this.list = listBox;
    // две колонки на низких экранах (звук/графика | управление); на высоких — одна
    const list = el('div', 'set-col', undefined, listBox);
    const list2 = el('div', 'set-col', undefined, listBox);

    for (const def of RACE_CHOICES.slice(0, 3)) this.addChoice(list, def);
    for (const def of SLIDERS) this.addSlider(list, def);

    // качество
    const qRow = el('div', 'set-row', undefined, list);
    el('span', 'set-label', 'КАЧЕСТВО', qRow);
    const seg = el('div', 'segments', undefined, qRow);
    const low = this.addSeg(seg, 'НИЗКОЕ');
    const high = this.addSeg(seg, 'ВЫСОКОЕ');
    this.qualityBtns = { low, high };
    onTap(low, () => this.setQuality('low'));
    onTap(high, () => this.setQuality('high'));
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
    const fRow = el('div', 'set-row', undefined, list);
    el('span', 'set-label', 'ПОКАЗЫВАТЬ FPS', fRow);
    this.fpsBtn = el('div', 'toggle', undefined, fRow);
    el('span', 'toggle-knob', undefined, this.fpsBtn);
    this.fpsVal = el('span', 'slider-val', '', fRow);
    const toggleFps = (): void => this.setFps(!this.settings.showFps);
    // вся строка — цель нажатия (на телефоне сам переключатель мал)
    onTap(fRow, () => {
      this.nav.focusAt(this.nav.items.findIndex((it) => it.el === fRow), false);
      toggleFps();
    });
    nav.add({
      el: fRow,
      noClick: true,
      adjust: () => {
        toggleFps();
        return true;
      },
      activate: toggleFps,
    });

    // тип управления
    const mRow = el('div', 'set-row wide', undefined, list2);
    el('span', 'set-label', 'ТИП УПРАВЛЕНИЯ', mRow);
    const mSeg = el('div', 'segments', undefined, mRow);
    const modeBtns: Partial<Record<ControlMode, HTMLElement>> = {};
    for (const m of CONTROL_MODES) {
      const b = this.addSeg(mSeg, m.full, m.short);
      modeBtns[m.mode] = b;
      onTap(b, () => this.setControlMode(m.mode));
    }
    this.modeBtns = modeBtns as Record<ControlMode, HTMLElement>;
    // на сенсорном устройстве в режиме «Клавиатура и геймпад» кнопок в гонке не будет
    this.modeHint = el('div', 'set-hint', 'Кнопки на экране будут скрыты — нужен геймпад или клавиатура', mRow);
    this.modeHint.hidden = true;
    const cycleMode = (dir: -1 | 1): void => {
      const i = CONTROL_MODES.findIndex((m) => m.mode === this.settings.controlMode);
      const n = CONTROL_MODES.length;
      this.setControlMode(CONTROL_MODES[(i + dir + n) % n].mode);
    };
    nav.add({
      el: mRow,
      noClick: true,
      adjust: (dir) => {
        cycleMode(dir);
        return true;
      },
      activate: () => cycleMode(1),
    });

    this.addChoice(list2, RACE_CHOICES[3]);
    for (const def of TOUCH_SLIDERS) this.addSlider(list2, def);

    const back = makeButton(el('div', 'set-actions', undefined, panel), 'НАЗАД');
    nav.add({ el: back, activate: onBack });

    this.refresh();
  }

  /** Сброс прокрутки при открытии. */
  onShown(): void {
    this.list.scrollTop = 0;
  }

  private addSeg(parent: HTMLElement, full: string, short?: string): HTMLElement {
    const seg = el('div', 'seg', undefined, parent);
    seg.setAttribute('role', 'button');
    const inner = el('span', undefined, undefined, seg);
    if (short === undefined) {
      inner.textContent = full;
    } else {
      el('span', 's-full', full, inner);
      el('span', 's-short', short, inner);
    }
    return seg;
  }

  get value(): Settings {
    return { ...this.settings };
  }

  /** Обновить значения извне (например, камера переключена клавишей C в гонке) */
  setSettings(s: Settings): void {
    this.settings = { ...s };
    this.refresh();
  }

  private addChoice(parent: HTMLElement, def: ChoiceDef): void {
    const row = el('div', 'set-row', undefined, parent);
    el('span', 'set-label', def.label, row);
    const seg = el('div', 'segments', undefined, row);
    const btns = def.options.map((o) => {
      const b = this.addSeg(seg, o.full, o.short);
      onTap(b, () => this.setChoice(def, o.value));
      return b;
    });
    this.choices.push({ def, btns });
    const cycle = (dir: -1 | 1): void => {
      const n = def.options.length;
      const i = def.options.findIndex((o) => o.value === this.settings[def.key]);
      this.setChoice(def, def.options[(i + dir + n) % n].value);
      this.cb.onUiSound('move');
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

  private setChoice(def: ChoiceDef, v: Settings[ChoiceKey]): void {
    if (this.settings[def.key] === v) return;
    this.settings = { ...this.settings, [def.key]: v };
    this.emit();
  }

  private addSlider(parent: HTMLElement, def: SliderDef): void {
    const row = el('div', 'set-row', undefined, parent);
    el('span', 'set-label', def.label, row);
    const track = el('div', 'slider', undefined, row);
    const fill = el('div', 'slider-fill', undefined, track);
    el('div', 'slider-thumb', undefined, fill);
    const val = el('span', 'slider-val', '', row);
    this.sliders.push({ def, fill, val });

    const fromPointer = (e: PointerEvent): void => {
      const r = track.getBoundingClientRect();
      const frac = (e.clientX - r.left) / Math.max(1, r.width);
      this.setSlider(def.key, valueFromFraction(frac, def.min, def.max, def.snap));
    };
    const endPreview = (): void => {
      if (previewing) {
        previewing = false;
        this.onPreview(false);
      }
    };
    let previewing = false;
    // дорожка — цель высотой ≥ 44 px с touch-action: none; остальная строка не мешает прокрутке списка
    track.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try {
        track.setPointerCapture(e.pointerId);
      } catch {
        /* pointerId уже неактивен */
      }
      const idx = this.nav.items.findIndex((it) => it.el === row);
      this.nav.focusAt(idx, false);
      this.cb.onUiSound('move');
      if (def.preview && !previewing) {
        previewing = true;
        this.onPreview(true);
      }
      fromPointer(e);
    });
    track.addEventListener('pointermove', (e) => {
      if (track.hasPointerCapture(e.pointerId)) fromPointer(e);
    });
    track.addEventListener('pointerup', endPreview);
    track.addEventListener('pointercancel', endPreview);
    track.addEventListener('lostpointercapture', endPreview);
    this.nav.add({
      el: row,
      noClick: true,
      adjust: (dir) => {
        this.setSlider(def.key, stepRange(this.settings[def.key], dir, def.min, def.max, def.step));
        this.cb.onUiSound('move');
        return true;
      },
    });
  }

  private emit(): void {
    this.refresh();
    this.cb.onSettingsChanged({ ...this.settings });
  }

  private setSlider(key: SliderKey, v: number): void {
    if (this.settings[key] === v) return;
    this.settings = { ...this.settings, [key]: v };
    this.emit();
  }

  private setQuality(q: Quality): void {
    if (this.settings.quality === q) return;
    this.settings = { ...this.settings, quality: q };
    this.emit();
  }

  private setControlMode(m: ControlMode): void {
    if (this.settings.controlMode === m) return;
    this.settings = { ...this.settings, controlMode: m };
    this.emit();
  }

  private setFps(v: boolean): void {
    this.settings = { ...this.settings, showFps: v };
    this.emit();
  }

  private refresh(): void {
    for (const s of this.sliders) {
      const v = this.settings[s.def.key];
      s.fill.style.width = `${fractionOf(v, s.def.min, s.def.max) * 100}%`;
      s.val.textContent = formatPercentRaw(v);
    }
    this.qualityBtns.low.classList.toggle('on', this.settings.quality === 'low');
    this.qualityBtns.high.classList.toggle('on', this.settings.quality === 'high');
    for (const m of CONTROL_MODES) this.modeBtns[m.mode].classList.toggle('on', this.settings.controlMode === m.mode);
    this.modeHint.hidden = !(this.settings.controlMode === 'keyboard' && isTouchDevice());
    this.fpsBtn.classList.toggle('on', this.settings.showFps);
    this.fpsVal.textContent = this.settings.showFps ? 'ВКЛ' : 'ВЫКЛ';
    for (const c of this.choices) c.def.options.forEach((o, i) => c.btns[i].classList.toggle('on', this.settings[c.def.key] === o.value));
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
    ];
    for (const it of items) {
      nav.add({ el: makeButton(list, it.text), activate: it.run });
    }
    // «На весь экран» — только если Fullscreen API есть (на iPhone нет)
    addFullscreenButton(list, nav);
    nav.add({ el: makeButton(list, 'В МЕНЮ'), activate: () => cb.onQuitToMenu() });
  }
}

// ─── Результаты ─────────────────────────────────────────────────────────────

type CupInfo = NonNullable<RaceResult['cup']>;

export class ResultsScreen {
  readonly el: HTMLElement;
  readonly nav: Nav;
  private readonly body: HTMLElement;
  private readonly btnRow: HTMLElement;
  private fx: HTMLElement | null = null;
  private readonly againLabel: HTMLElement;

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
    // на низких экранах таблица прокручивается, кнопки остаются на виду
    this.body = el('div', 'results-body nr-scroll', undefined, panel);
    this.btnRow = el('div', 'results-actions', undefined, panel);
    const again = makeButton(this.btnRow, 'ЕЩЁ РАЗ', 'big');
    this.againLabel = again.firstElementChild as HTMLElement;
    const menu = makeButton(this.btnRow, 'В МЕНЮ');
    nav.add({ el: again, activate: () => cb.onRestart() });
    nav.add({ el: menu, activate: () => cb.onQuitToMenu() });
  }

  /** trackName — имя трассы (мелко рядом с машиной); не задано — не показывается. */
  show(r: RaceResult, trackName?: string, newAwards: readonly string[] = []): void {
    const body = this.body;
    body.replaceChildren();
    body.scrollTop = 0;
    const cup = r.cup;
    const win = r.playerPosition === 1 && !r.solo;
    // итог кубка: победа в кубке — праздник, иначе — место в зачёте
    const cupPlace = cup?.rows.find((x) => x.isPlayer)?.position ?? r.playerPosition;
    const cupDone = cup !== undefined && cup.finished;
    const celebrate = cupDone ? cupPlace === 1 : win || (r.solo === true && r.newBestLap);
    const title = cupDone
      ? cupPlace === 1
        ? 'КУБОК ВЫИГРАН!'
        : `КУБОК · ${cupPlace}-Е МЕСТО`
      : r.solo
        ? r.newBestLap
          ? 'НОВЫЙ РЕКОРД!'
          : 'ЗАЕЗД НА ВРЕМЯ'
        : resultTitle(r.playerPosition);
    this.againLabel.textContent = cup ? (cup.finished ? 'НОВЫЙ КУБОК' : 'СЛЕДУЮЩАЯ ГОНКА') : 'ЕЩЁ РАЗ';
    const head = el('div', 'results-head', undefined, body);
    el('div', `results-title${celebrate ? ' win' : ''}`, title, head);
    const car = this.cars.find((c) => c.id === r.carId);
    if (car || trackName) {
      const line = el('div', 'results-car', car ? car.name : '', head);
      if (trackName) el('span', 'results-track', `${car ? ' · ' : ''}${trackName}`, line);
    }

    const badges = el('div', 'badges', undefined, body);
    if (r.newBestLap) el('div', 'badge yellow', 'НОВЫЙ РЕКОРД КРУГА', badges);
    if (r.newBestRace) el('div', 'badge cyan', 'РЕКОРД ГОНКИ', badges);
    if (r.newBestDrift) el('div', 'badge pink', 'РЕКОРД ДРИФТА', badges);
    for (const t of newAwards) el('div', 'badge award-new', `НОВАЯ НАГРАДА: ${t}`, badges);
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
    r.rows.forEach((row, ri) => {
      const cls = `rrow${row.isPlayer ? ' me' : ''}${row.projected ? ' proj' : ''}`;
      const rr = el('div', cls, undefined, table);
      rr.style.animationDelay = `${0.12 + ri * 0.07}s`;
      el('span', 'rpos', String(row.position), rr);
      const who = el('span', 'rname', undefined, rr);
      const dot = el('i', 'rdot', undefined, who);
      dot.style.background = row.color;
      dot.style.boxShadow = `0 0 .5em ${row.color}`;
      el('span', undefined, row.name, who);
      el('span', 'num', `${row.projected ? '~' : ''}${formatTime(row.time)}`, rr);
      const fast = row.bestLap !== null && row.bestLap === fastest;
      el('span', `num${fast ? ' fastest' : ''}`, formatTime(row.bestLap), rr);
    });

    // времена кругов игрока (поле необязательное: пока гонка его не отдаёт — блок скрыт)
    const laps = r.lapTimes;
    if (laps && laps.length > 1) {
      let best = Infinity;
      for (const t of laps) if (t < best) best = t;
      const box = el('div', 'laps', undefined, body);
      el('span', 'hud-label', 'КРУГИ', box);
      laps.forEach((t, i) => {
        const chip = el('div', `lap${t === best ? ' best' : ''}`, undefined, box);
        chip.style.animationDelay = `${0.35 + i * 0.08}s`;
        el('span', 'lap-n', String(i + 1), chip);
        el('span', 'lap-t', formatTime(t), chip);
      });
    }

    const sum = el('div', 'rsummary', undefined, body);
    this.stat(sum, 'ВРЕМЯ ГОНКИ', formatTime(r.playerTime), '');
    this.stat(sum, 'ЛУЧШИЙ КРУГ', formatTime(r.playerBestLap), 'yellow');
    this.stat(sum, 'ОЧКИ ДРИФТА', formatScore(r.driftScore), 'pink');

    const cr = r.credits;
    if (cr) {
      const box = el('div', 'rcredits', undefined, body);
      el('span', 'rcredits-total', `+${formatCredits(cr.total)}`, box);
      for (const l of cr.lines) el('span', 'rcredits-line', `${l.label} +${l.value}`, box);
      el('span', 'rcredits-bal', `БАЛАНС ${formatCredits(cr.balance)}`, box);
    }

    if (cup) {
      this.cupTable(body, cup);
      // таблица кубка ниже результатов гонки: на невысоких экранах плавно докрутить до неё
      window.setTimeout(() => {
        if (body.isConnected && body.scrollHeight > body.clientHeight + 4) body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
      }, 2400);
    }
    this.confetti(celebrate);
    this.nav.reset(0);
  }

  private cupTable(parent: HTMLElement, cup: CupInfo): void {
    el('div', 'cup-title', `КУБОК · ГОНКА ${cup.round}/${cup.rounds}`, parent);
    const table = el('div', 'rtable cup-table', undefined, parent);
    const hr = el('div', 'rrow rhead', undefined, table);
    el('span', undefined, '#', hr);
    el('span', undefined, 'ПИЛОТ', hr);
    el('span', 'num', 'ГОНКА', hr);
    el('span', 'num', 'ОЧКИ', hr);
    const rows = cup.rows.slice().sort((a, b) => a.position - b.position);
    rows.forEach((row, i) => {
      const rr = el('div', `rrow${row.isPlayer ? ' me' : ''}`, undefined, table);
      rr.style.animationDelay = `${0.5 + i * 0.07}s`;
      el('span', 'rpos', String(row.position), rr);
      const who = el('span', 'rname', undefined, rr);
      const dot = el('i', 'rdot', undefined, who);
      dot.style.background = row.color;
      dot.style.boxShadow = `0 0 .5em ${row.color}`;
      el('span', undefined, row.name, who);
      el('span', 'num', row.last > 0 ? `+${row.last}` : '—', rr);
      el('span', 'num cup-pts', String(row.points), rr);
    });
  }

  /** Неоновое конфетти на CSS (только при победе); детерминированный разброс. */
  private confetti(win: boolean): void {
    this.fx?.remove();
    this.fx = null;
    if (!win) return;
    const tones = ['--magenta', '--cyan', '--yellow', '--pink', '--orange', '--lilac'];
    const fx = el('div', 'confetti', undefined, this.el);
    for (let i = 0; i < 36; i++) {
      const c = el('i', undefined, undefined, fx);
      const tone = tones[i % tones.length];
      c.style.left = `${(i * 97) % 100}%`;
      c.style.background = `var(${tone})`;
      c.style.boxShadow = `0 0 0.6em var(${tone})`;
      c.style.animationDelay = `${((i * 37) % 100) / 60}s`;
      c.style.animationDuration = `${2.6 + ((i * 53) % 100) / 50}s`;
      c.style.setProperty('--dx', `${((i * 29) % 21) - 10}em`);
      c.style.setProperty('--rot', `${360 + ((i * 71) % 5) * 180}deg`);
    }
    this.fx = fx;
  }

  private stat(parent: HTMLElement, label: string, value: string, tone: string): void {
    const s = el('div', 'rstat', undefined, parent);
    el('span', 'hud-label', label, s);
    el('span', `rstat-val ${tone}`.trim(), value, s);
  }
}
