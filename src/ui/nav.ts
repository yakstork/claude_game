/** Список фокусируемых элементов экрана: клавиатура/геймпад/мышь работают через него. */
import type { UiSound } from '../core/types';
import { onTap } from './dom';

export interface NavItem {
  el: HTMLElement;
  /** left/right (dir −1/+1); вернуть true, если действие обработано. */
  adjust?(dir: -1 | 1): boolean;
  /** confirm / клик. */
  activate?(): void;
  /** Не активировать по клику мыши (слайдер сам обрабатывает указатель). */
  noClick?: boolean;
  /** Активировать строго по click (действия, требующие жеста браузера: полноэкранный режим). */
  viaClick?: boolean;
}

export class Nav {
  readonly items: NavItem[] = [];
  index = 0;

  constructor(private readonly play: (k: UiSound) => void) {}

  add(item: NavItem): NavItem {
    const i = this.items.length;
    this.items.push(item);
    // наведение — только мышью (на тач-экране эмулированный hover давал бы лишний звук)
    item.el.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') this.focusAt(i, true);
    });
    if (!item.noClick) {
      onTap(
        item.el,
        () => {
          this.focusAt(i, false);
          this.activate();
        },
        item.viaClick === true,
      );
    }
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
    this.scrollToItem(this.items[i].el);
    if (sound && moved && changed) this.play('move');
  }

  /** Фокус клавиатурой/геймпадом в прокручиваемом списке: подвинуть прокрутку контейнера (.nr-scroll). */
  private scrollToItem(e: HTMLElement): void {
    const box = e.closest<HTMLElement>('.nr-scroll');
    if (!box || box.scrollHeight <= box.clientHeight) return;
    const b = box.getBoundingClientRect();
    const r = e.getBoundingClientRect();
    if (r.top < b.top) box.scrollTop += r.top - b.top - 6;
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 6;
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
