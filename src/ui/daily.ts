/** Экран «ВЫЗОВ ДНЯ»: условия на сегодня, цели с медалями, лучший результат дня и серия. */
import type { DailyChallenge, DailyMedal } from '../race/daily';
import { DIFFICULTY_NAMES, MEDAL_LABELS, MODE_NAMES, MODIFIERS, TOD_NAMES, formatScore, goalText } from '../race/daily';
import { el } from './dom';
import { Nav } from './nav';
import { makeButton } from './screens';

export interface DailyView {
  challenge: DailyChallenge;
  trackName: string;
  carName: string;
  best: { medal: DailyMedal; score: number } | null;
  streak: number;
  maxStreak: number;
}

export interface DailyApi {
  /** Актуальные условия (дата берётся при каждом вызове) */
  view(): DailyView;
  start(): void;
  sound(kind: 'move' | 'select' | 'back'): void;
}

export class DailyScreen {
  readonly el: HTMLElement;
  readonly nav: Nav;
  private readonly date: HTMLElement;
  private readonly streak: HTMLElement;
  private readonly rows: HTMLElement[] = [];
  private readonly modDesc: HTMLElement;
  private readonly goals: HTMLElement[] = [];
  private readonly best: HTMLElement;

  constructor(
    parent: HTMLElement,
    nav: Nav,
    private readonly api: DailyApi,
    onBack: () => void,
  ) {
    this.nav = nav;
    const root = el('div', 'screen daily', undefined, parent);
    root.hidden = true;
    this.el = root;
    const wrap = el('div', 'glow dly-wrap', undefined, root);
    const panel = el('div', 'panel cyan dly-panel', undefined, wrap);
    const head = el('div', 'dly-head', undefined, panel);
    el('div', 'screen-title dly-title', 'ВЫЗОВ ДНЯ', head);
    this.date = el('div', 'dly-date', '', head);
    this.streak = el('div', 'dly-streak', '', panel);

    const body = el('div', 'dly-body', undefined, panel);
    const cond = el('div', 'dly-cond', undefined, body);
    for (const label of ['ТРАССА', 'МАШИНА', 'ВРЕМЯ СУТОК', 'РЕЖИМ', 'СЛОЖНОСТЬ', 'МОДИФИКАТОР']) {
      const row = el('div', 'dly-row', undefined, cond);
      el('span', 'dly-label', label, row);
      this.rows.push(el('span', 'dly-value', '', row));
    }
    this.modDesc = el('div', 'dly-moddesc', '', cond);

    const side = el('div', 'dly-side', undefined, body);
    el('div', 'dly-label', 'ЦЕЛЬ', side);
    for (let i = 0; i < 3; i++) this.goals.push(el('div', 'dly-goal', '', side));
    this.best = el('div', 'dly-best', '', side);

    const acts = el('div', 'dly-actions', undefined, panel);
    const start = makeButton(acts, 'СТАРТ', 'big');
    const back = makeButton(acts, 'НАЗАД');
    nav.add({ el: start, activate: () => this.api.start() });
    nav.add({ el: back, activate: onBack });
  }

  onShown(): void {
    this.nav.reset(0);
    this.render();
  }

  render(): void {
    const v = this.api.view();
    const c = v.challenge;
    setText(this.date, `${c.dateKey} UTC`);
    setText(this.streak, v.streak > 0 ? `СЕРИЯ: ${v.streak} ${dayWord(v.streak)} ПОДРЯД · РЕКОРД ${v.maxStreak}` : 'СЕРИИ НЕТ — ВОЗЬМИ МЕДАЛЬ СЕГОДНЯ');
    const lapsNote = c.mode === 'race' || c.mode === 'timeAttack' ? ` · ${c.laps} КР.` : '';
    const vals = [v.trackName, v.carName, TOD_NAMES[c.timeOfDay], `${MODE_NAMES[c.mode]}${lapsNote}`, DIFFICULTY_NAMES[c.difficulty], MODIFIERS[c.modifier].title];
    vals.forEach((t, i) => setText(this.rows[i], t));
    setText(this.modDesc, MODIFIERS[c.modifier].desc);
    const marks = ['БРОНЗА', 'СЕРЕБРО', 'ЗОЛОТО'];
    this.goals.forEach((g, i) => {
      setText(g, `${marks[i]}: ${goalText(c, (i + 1) as 1 | 2 | 3)}`);
      g.classList.toggle('on', !!v.best && v.best.medal > i);
    });
    setText(this.best, v.best ? `ЛУЧШИЙ СЕГОДНЯ: ${formatScore(c, v.best.score)} · ${MEDAL_LABELS[v.best.medal]}` : 'СЕГОДНЯ ЕЩЁ НЕ ЕХАЛ');
  }
}

function dayWord(n: number): string {
  const m = n % 10;
  const h = n % 100;
  if (m === 1 && h !== 11) return 'ДЕНЬ';
  if (m >= 2 && m <= 4 && (h < 12 || h > 14)) return 'ДНЯ';
  return 'ДНЕЙ';
}

function setText(e: HTMLElement, t: string): void {
  if (e.textContent !== t) e.textContent = t;
}
