/** Экран «НАГРАДЫ»: сетка карточек достижений + плашки новых наград для экрана результатов. */
import { el } from './dom';
import { Nav } from './nav';

/** Достижение для показа (данные приходят из игры). */
export interface AwardItem {
  id: string;
  title: string;
  desc: string;
  icon: string;
  tone: 'pink' | 'cyan' | 'orange' | 'yellow';
  unlocked?: boolean;
}

export function countUnlocked(list: readonly AwardItem[], unlocked: ReadonlySet<string>): number {
  let n = 0;
  for (const a of list) if (unlocked.has(a.id)) n++;
  return n;
}

export class AwardsScreen {
  readonly el: HTMLElement;
  readonly nav: Nav;
  private readonly counter: HTMLElement;
  private readonly grid: HTMLElement;
  private list: AwardItem[] = [];
  private unlocked = new Set<string>();
  private readonly cards = new Map<string, HTMLElement>();

  constructor(parent: HTMLElement, nav: Nav, onBack: () => void) {
    this.nav = nav;
    const root = el('div', 'screen awards', undefined, parent);
    root.hidden = true;
    this.el = root;
    const wrap = el('div', 'glow', undefined, root);
    const panel = el('div', 'panel cyan awards-panel', undefined, wrap);
    const head = el('div', 'awards-head', undefined, panel);
    el('div', 'screen-title awards-title', 'НАГРАДЫ', head);
    this.counter = el('div', 'awards-count', '0 / 0', head);
    this.grid = el('div', 'awards-grid nr-scroll', undefined, panel);
    const back = el('div', 'btn', undefined, panel);
    back.setAttribute('role', 'button');
    el('span', undefined, 'НАЗАД', back);
    nav.add({ el: back, activate: onBack });
  }

  /** Список достижений (порядок сохраняется); флаг `unlocked` в элементах учитывается. */
  setList(list: readonly AwardItem[]): void {
    this.list = list.map((a) => ({ ...a }));
    for (const a of this.list) if (a.unlocked) this.unlocked.add(a.id);
    this.build();
  }

  /** Какие id открыты (заменяет прежний набор). */
  setUnlocked(ids: readonly string[]): void {
    this.unlocked = new Set(ids);
    this.refresh();
  }

  get items(): readonly AwardItem[] {
    return this.list;
  }

  find(id: string): AwardItem | undefined {
    return this.list.find((a) => a.id === id);
  }

  isUnlocked(id: string): boolean {
    return this.unlocked.has(id);
  }

  onShown(): void {
    this.grid.scrollTop = 0;
    this.nav.reset(0);
  }

  scrollBy(dir: -1 | 1): void {
    this.grid.scrollBy({ top: dir * this.grid.clientHeight * 0.6 });
  }

  private build(): void {
    this.grid.replaceChildren();
    this.cards.clear();
    this.list.forEach((a, i) => {
      const card = el('div', `award ${a.tone}`, undefined, this.grid);
      card.style.animationDelay = `${0.04 + i * 0.03}s`;
      el('span', 'award-icon', a.icon, card);
      const body = el('div', 'award-body', undefined, card);
      el('div', 'award-name', a.title, body);
      el('div', 'award-desc', a.desc, body);
      this.cards.set(a.id, card);
    });
    this.refresh();
  }

  private refresh(): void {
    for (const a of this.list) {
      const card = this.cards.get(a.id);
      if (!card) continue;
      const on = this.unlocked.has(a.id);
      card.classList.toggle('locked', !on);
      card.classList.toggle('open', on);
      card.setAttribute('aria-label', `${a.title}: ${a.desc}${on ? ' (получено)' : ''}`);
    }
    const t = `${countUnlocked(this.list, this.unlocked)} / ${this.list.length}`;
    if (this.counter.textContent !== t) this.counter.textContent = t;
  }
}
