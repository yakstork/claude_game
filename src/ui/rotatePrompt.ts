/** Полноэкранная подсказка «Поверни телефон» (портретная ориентация на сенсорном устройстве). */
import { el, svgEl } from './dom';

export class RotatePrompt {
  readonly el: HTMLElement;

  constructor(parent: HTMLElement) {
    const root = el('div', 'nr-rotate', undefined, parent);
    root.hidden = true;
    root.setAttribute('role', 'alert');
    this.el = root;

    const icon = svgEl('svg', { viewBox: '0 0 120 120', class: 'rotate-icon', 'aria-hidden': 'true' }, root);
    // телефон, который поворачивается из портрета в альбом
    const phone = svgEl('g', { class: 'rotate-phone' }, icon);
    svgEl('rect', { x: 38, y: 12, width: 44, height: 82, rx: 8, class: 'rotate-body' }, phone);
    svgEl('rect', { x: 44, y: 22, width: 32, height: 58, rx: 2, class: 'rotate-screen' }, phone);
    svgEl('rect', { x: 52, y: 15.5, width: 16, height: 2.6, rx: 1.3, class: 'rotate-notch' }, phone);
    svgEl('circle', { cx: 60, cy: 87, r: 2.6, class: 'rotate-notch' }, phone);
    // дуга со стрелкой
    svgEl('path', { d: 'M22 58 A38 38 0 0 1 60 20', class: 'rotate-arc' }, icon);
    svgEl('polygon', { points: '60,10 72,20 60,30', class: 'rotate-head' }, icon);
    svgEl('path', { d: 'M98 62 A38 38 0 0 1 60 100', class: 'rotate-arc' }, icon);
    svgEl('polygon', { points: '60,110 48,100 60,90', class: 'rotate-head' }, icon);

    el('div', 'rotate-title', 'ПОВЕРНИ ТЕЛЕФОН', root);
    el('div', 'rotate-sub', 'Neon Rush играется в альбомной ориентации', root);
  }

  get shown(): boolean {
    return !this.el.hidden;
  }

  setShown(v: boolean): void {
    if (this.el.hidden === !v) return;
    this.el.hidden = !v;
  }
}
