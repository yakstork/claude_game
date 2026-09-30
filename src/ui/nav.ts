/** Список фокусируемых элементов экрана: клавиатура/геймпад/мышь работают через него. */
import type { UiSound } from '../core/types';

export interface NavItem {
  el: HTMLElement;
  /** left/right (dir −1/+1); вернуть true, если действие обработано. */
  adjust?(dir: -1 | 1): boolean;
  /** confirm / клик. */
  activate?(): void;
  /** Не активировать по клику мыши (слайдер сам обрабатывает указатель). */
  noClick?: boolean;
}

export class Nav {
  readonly items: NavItem[] = [];
  index = 0;

  constructor(private readonly play: (k: UiSound) => void) {}

  add(item: NavItem): NavItem {
    const i = this.items.length;
    this.items.push(item);
    item.el.addEventListener('mouseenter', () => this.focusAt(i, true));
    item.el.addEventListener('click', () => {
      if (item.noClick) return;
      this.focusAt(i, false);
      this.activate();
    });
    return item;
  }

  get current(): NavItem | undefined {
    return this.items[this.index];
  }

  /** Сброс фокуса на элемент i без звука. */
  reset(i = 0): void {
    this.focusAt(i, false);
  }

  focusAt(i: number, sound: boolean): void {
    if (i < 0 || i >= this.items.length) return;
    const changed = i !== this.index || !this.items[i].el.classList.contains('is-focus');
    for (let k = 0; k < this.items.length; k++) {
      this.items[k].el.classList.toggle('is-focus', k === i);
    }
    const moved = i !== this.index;
    this.index = i;
    if (sound && moved && changed) this.play('move');
  }

  move(dir: -1 | 1): void {
    const n = this.items.length;
    if (n === 0) return;
    this.focusAt((this.index + dir + n) % n, true);
  }

  adjust(dir: -1 | 1): boolean {
    return this.current?.adjust?.(dir) ?? false;
  }

  activate(): void {
    const it = this.current;
    if (!it?.activate) return;
    this.play('select');
    it.activate();
  }
}
