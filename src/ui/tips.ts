/** Оверлей «Как играть»: показывается один раз при первом запуске, потом — по кнопке «?» в меню. */
import { el } from './dom';

export const TIPS_KEY = 'neonrush.tips.v1';

const TIPS: { icon: string; title: string; text: string; tone: string }[] = [
  { icon: '1', title: 'ДРИФТ', text: 'Входи в поворот с ручником или рулём на скорости: чем длиннее и острее занос, тем больше очков.', tone: 'pink' },
  { icon: '2', title: 'НИТРО', text: 'Дрифт заряжает шкалу нитро. Жми нитро на прямой — а удачный выход из дрифта даёт короткий буст.', tone: 'cyan' },
  { icon: '3', title: 'СЛИПСТРИМ', text: 'Держись вплотную за соперником: в его потоке машина разгоняется быстрее. Затем — обгон.', tone: 'orange' },
  { icon: '4', title: 'РЕЖИМ «НА ВРЕМЯ»', text: 'Кнопка «РЕЖИМ» в меню: гонка в одиночку против призрака своего рекорда.', tone: 'yellow' },
];

export function tipsSeen(): boolean {
  try {
    return localStorage.getItem(TIPS_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(TIPS_KEY, '1');
  } catch {
    /* хранилище недоступно — не страшно */
  }
}

/** Автопоказ: только если не показывали и это не автоматизированный браузер (e2e). */
export function shouldAutoShowTips(): boolean {
  if (typeof navigator !== 'undefined' && navigator.webdriver) return false;
  return !tipsSeen();
}

export class TipsOverlay {
  readonly el: HTMLElement;
  private opened = 0;

  constructor(parent: HTMLElement) {
    const root = el('div', 'screen tips', undefined, parent);
    root.hidden = true;
    this.el = root;
    const wrap = el('div', 'glow', undefined, root);
    const panel = el('div', 'panel tips-panel', undefined, wrap);
    el('div', 'tips-title', 'КАК ИГРАТЬ', panel);
    const list = el('div', 'tips-list nr-scroll', undefined, panel);
    TIPS.forEach((t, i) => {
      const row = el('div', `tip ${t.tone}`, undefined, list);
      row.style.animationDelay = `${0.08 + i * 0.09}s`;
      el('span', 'tip-num', t.icon, row);
      const body = el('div', 'tip-body', undefined, row);
      el('div', 'tip-head', t.title, body);
      el('div', 'tip-text', t.text, body);
    });
    el('div', 'tips-close', 'Любая кнопка или касание — закрыть', panel);
    // закрытие по тапу/клику; задержка, чтобы не закрыть тем же касанием, что открыло
    root.addEventListener('pointerdown', (e) => {
      if (this.visible && performance.now() - this.opened > 250) {
        e.stopPropagation();
        this.hide();
      }
    });
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  show(): void {
    this.opened = performance.now();
    this.el.hidden = false;
    markSeen();
  }

  hide(): void {
    this.el.hidden = true;
  }
}
