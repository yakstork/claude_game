/** Экран «КАМПАНИЯ»: карта лиги — неоновая линия с узлами-событиями по главам. */
import type { CampaignProgress } from '../race/campaign';
import { CHAPTERS, EVENTS, MAX_STARS, goalText, isChapterUnlocked, isEventUnlocked, starsOf, totalStars } from '../race/campaign';
import { el } from './dom';
import { Nav } from './nav';
import { makeButton } from './screens';

export interface CampaignApi {
  progress(): CampaignProgress;
  /** Запустить событие (game.ts выставляет условия и стартует гонку) */
  start(eventId: string): void;
  sound(kind: 'move' | 'select' | 'back'): void;
}

export class CampaignScreen {
  readonly el: HTMLElement;
  readonly nav: Nav;
  private readonly total: HTMLElement;
  private readonly nodes: HTMLElement[] = [];
  private readonly nodeStars: HTMLElement[][] = [];
  private readonly chapterNotes: HTMLElement[] = [];
  private readonly dTitle: HTMLElement;
  private readonly dBrief: HTMLElement;
  private readonly dGoals: HTMLElement[] = [];
  private readonly startBtn: HTMLElement;
  /** Индекс события, чьи детали показаны */
  private selected = 0;

  constructor(
    parent: HTMLElement,
    nav: Nav,
    private readonly api: CampaignApi,
    onBack: () => void,
  ) {
    this.nav = nav;
    const root = el('div', 'screen campaign', undefined, parent);
    root.hidden = true;
    this.el = root;
    const wrap = el('div', 'glow cmp-wrap', undefined, root);
    const panel = el('div', 'panel magenta cmp-panel', undefined, wrap);
    const head = el('div', 'cmp-head', undefined, panel);
    el('div', 'screen-title cmp-title', 'НЕОНОВАЯ ЛИГА', head);
    this.total = el('div', 'cmp-total', '', head);

    const map = el('div', 'cmp-map', undefined, panel);
    for (const ch of CHAPTERS) {
      const row = el('div', 'cmp-chapter', undefined, map);
      const lab = el('div', 'cmp-chlabel', undefined, row);
      el('span', 'cmp-chname', `${ch.id}. ${ch.title}`, lab);
      this.chapterNotes.push(el('span', 'cmp-chnote', '', lab));
      const line = el('div', 'cmp-line', undefined, row);
      for (const ev of EVENTS.filter((e) => e.chapter === ch.id)) {
        const idx = EVENTS.indexOf(ev);
        const node = el('div', 'cmp-node', undefined, line);
        node.setAttribute('role', 'button');
        el('span', 'cmp-num', String(idx + 1), node);
        const st = el('span', 'cmp-stars', undefined, node);
        this.nodeStars.push([0, 1, 2].map(() => el('i', 'cmp-star', '★', st)));
        this.nodes.push(node);
        nav.add({
          el: node,
          adjust: (d) => {
            this.moveSel(d);
            return true;
          },
          activate: () => this.onNode(idx),
        });
      }
    }

    const det = el('div', 'cmp-detail', undefined, panel);
    const left = el('div', 'cmp-dleft', undefined, det);
    this.dTitle = el('div', 'cmp-dtitle', '', left);
    this.dBrief = el('div', 'cmp-dbrief', '', left);
    const goals = el('div', 'cmp-goals', undefined, det);
    for (let i = 0; i < 3; i++) this.dGoals.push(el('div', 'cmp-goal', '', goals));
    const btns = el('div', 'cmp-actions', undefined, det);
    this.startBtn = makeButton(btns, 'СТАРТ', 'big');
    const back = makeButton(btns, 'НАЗАД');
    nav.add({ el: this.startBtn, activate: () => this.startSelected() });
    nav.add({ el: back, activate: onBack });
  }

  /** Показ: фокус на первое незавершённое открытое событие */
  onShown(): void {
    const p = this.api.progress();
    let first = EVENTS.findIndex((e) => isEventUnlocked(p, e.id) && starsOf(p, e.id) === 0);
    if (first < 0) first = 0;
    this.selected = first;
    this.nav.reset(first);
    this.render();
  }

  /** После действия с клавиатуры/геймпада: показать детали события в фокусе */
  syncFocus(): void {
    if (this.nav.index < EVENTS.length && this.nav.index !== this.selected) {
      this.selected = this.nav.index;
      this.render();
    }
  }

  private moveSel(dir: -1 | 1): void {
    const n = EVENTS.length;
    const i = Math.min(n - 1, Math.max(0, this.nav.index + dir));
    this.nav.focusAt(i, true);
    this.selected = i;
    this.render();
  }

  private onNode(i: number): void {
    if (this.selected === i) this.startSelected();
    else {
      this.selected = i;
      this.render();
    }
  }

  private startSelected(): void {
    const ev = EVENTS[this.selected];
    if (ev && isEventUnlocked(this.api.progress(), ev.id)) this.api.start(ev.id);
    else this.api.sound('back');
  }

  render(): void {
    const p = this.api.progress();
    setText(this.total, `★ ${totalStars(p)} / ${MAX_STARS}`);
    CHAPTERS.forEach((ch, k) => {
      const open = isChapterUnlocked(p, ch.id);
      setText(this.chapterNotes[k], open ? '' : `нужно ★ ${ch.need}`);
    });
    EVENTS.forEach((ev, i) => {
      const node = this.nodes[i];
      const s = starsOf(p, ev.id);
      const open = isEventUnlocked(p, ev.id);
      node.classList.toggle('locked', !open);
      node.classList.toggle('done', s > 0);
      node.classList.toggle('sel', i === this.selected);
      this.nodeStars[i].forEach((st, k) => st.classList.toggle('on', k < s));
      node.setAttribute('aria-label', `${ev.title}${open ? '' : ' (закрыто)'}, звёзд ${s} из 3`);
    });
    const ev = EVENTS[this.selected];
    if (!ev) return;
    const open = isEventUnlocked(p, ev.id);
    setText(this.dTitle, `${this.selected + 1}. ${ev.title}`);
    setText(this.dBrief, open ? `${ev.brief}${ev.carId ? '' : ' · своя машина'}` : 'Закрыто: пройди предыдущее событие и набери звёзды');
    this.dGoals.forEach((g, k) => {
      setText(g, `${'★'.repeat(k + 1)} ${goalText(ev.goal, (k + 1) as 1 | 2 | 3)}`);
      g.classList.toggle('on', starsOf(p, ev.id) > k);
    });
    this.startBtn.classList.toggle('disabled', !open);
  }
}

function setText(e: HTMLElement, t: string): void {
  if (e.textContent !== t) e.textContent = t;
}
