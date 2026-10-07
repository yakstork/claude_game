/** Выбывание: первое выбывание через FIRST_AT с, далее каждые EVERY с; выбывает последний по прогрессу. Чистая логика. */

export const FIRST_AT = 30;
export const EVERY = 25;

export class Elimination {
  /** Время гонки, с */
  time = 0;
  /** Индексы выбывших машин в порядке выбывания */
  readonly order: number[] = [];
  private readonly out: boolean[];
  private nextAt = FIRST_AT;

  constructor(
    readonly count: number,
    readonly player: number,
  ) {
    this.out = new Array<boolean>(count).fill(false);
  }

  isOut(car: number): boolean {
    return this.out[car];
  }

  get aliveCount(): number {
    return this.count - this.order.length;
  }

  /** Секунд до следующего выбывания */
  get timeToNext(): number {
    return Math.max(0, this.nextAt - this.time);
  }

  /** Игрок выбыл или остался единственным */
  get over(): boolean {
    return this.out[this.player] || this.aliveCount <= 1;
  }

  get playerWon(): boolean {
    return !this.out[this.player] && this.aliveCount <= 1;
  }

  /** Место игрока: при выбывании — число оставшихся + 1, при победе — 1 */
  get playerPlace(): number {
    return this.out[this.player] ? this.count - this.order.indexOf(this.player) : this.aliveCount;
  }

  /** Шаг времени; progress[i] — пройденный путь машины i. Возвращает индекс выбывшей машины или −1. */
  update(dt: number, progress: ArrayLike<number>): number {
    if (this.over) return -1;
    this.time += dt;
    if (this.time < this.nextAt) return -1;
    this.nextAt += EVERY;
    let last = -1;
    for (let i = 0; i < this.count; i++) {
      if (this.out[i]) continue;
      if (last < 0 || progress[i] < progress[last]) last = i;
    }
    this.out[last] = true;
    this.order.push(last);
    return last;
  }

  /** Итоговый порядок (индексы машин): оставшиеся, затем выбывшие с конца. */
  finalOrder(): number[] {
    const alive: number[] = [];
    for (let i = 0; i < this.count; i++) if (!this.out[i]) alive.push(i);
    return alive.concat(this.order.slice().reverse());
  }
}
