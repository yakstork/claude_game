/**
 * Мини-HUD режима «2 игрока»: по панели в углу каждой половины экрана
 * (скорость, позиция, круг, нитро) и разделительная линия.
 */
import { el } from './dom';
import './split.css';

export interface SplitHudData {
  speedKmh: number;
  position: number;
  racers: number;
  lap: number;
  laps: number;
  nitro: number;
  nitroActive: boolean;
  finished: boolean;
}

class Panel {
  readonly root: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly pos: HTMLElement;
  private readonly lap: HTMLElement;
  private readonly fill: HTMLElement;
  private last = '';

  constructor(parent: HTMLElement, cls: string, label: string) {
    this.root = el('div', `split-panel ${cls}`, undefined, parent);
    el('div', 'split-who', label, this.root);
    this.pos = el('div', 'split-pos', '', this.root);
    this.lap = el('div', 'split-lap', '', this.root);
    const sp = el('div', 'split-speed', undefined, this.root);
    this.speed = el('b', undefined, '0', sp);
    el('span', undefined, ' КМ/Ч', sp);
    const bar = el('div', 'split-nitro', undefined, this.root);
    this.fill = el('i', undefined, undefined, bar);
  }

  set(d: SplitHudData): void {
    const speed = String(Math.round(d.speedKmh));
    const key = `${speed}|${d.position}|${d.lap}|${Math.round(d.nitro * 50)}|${d.nitroActive}|${d.finished}`;
    if (key === this.last) return;
    this.last = key;
    this.speed.textContent = speed;
    this.pos.textContent = d.finished ? `ФИНИШ · ${d.position}` : `${d.position}/${d.racers}`;
    this.lap.textContent = `КРУГ ${Math.min(d.laps, d.lap)}/${d.laps}`;
    this.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, d.nitro))})`;
    this.root.classList.toggle('boost', d.nitroActive);
  }
}

export class SplitHud {
  readonly root: HTMLElement;
  private readonly p1: Panel;
  private readonly p2: Panel;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'split-hud', undefined, parent);
    this.root.hidden = true;
    el('div', 'split-divider', undefined, this.root);
    this.p1 = new Panel(this.root, 'top', 'ИГРОК 1');
    this.p2 = new Panel(this.root, 'bottom', 'ИГРОК 2');
  }

  show(on: boolean): void {
    if (this.root.hidden === !on) return;
    this.root.hidden = !on;
  }

  update(a: SplitHudData, b: SplitHudData): void {
    this.p1.set(a);
    this.p2.set(b);
  }
}
