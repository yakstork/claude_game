/**
 * Кубок: серия гонок по всем трассам, очки за места. Чистая логика.
 */
export const CUP_POINTS = [10, 8, 6, 5, 4, 3] as const;

export interface CupRow {
  name: string;
  isPlayer: boolean;
  color: string;
  points: number;
  /** Очки за последнюю гонку */
  last: number;
  /** 1-based место в кубке */
  position: number;
}

export interface CupSummary {
  /** Номер завершённой гонки 1..rounds */
  round: number;
  rounds: number;
  finished: boolean;
  rows: CupRow[];
}

export interface CupEntrant {
  name: string;
  isPlayer: boolean;
  color: string;
}

export class Cup {
  private readonly rows: CupRow[];
  round = 0;

  constructor(
    entrants: CupEntrant[],
    readonly rounds: number,
    /** Индекс первой трассы: дальше по кругу */
    readonly firstTrack: number,
    readonly trackCount: number,
  ) {
    this.rows = entrants.map((e) => ({ ...e, points: 0, last: 0, position: 1 }));
  }

  get finished(): boolean {
    return this.round >= this.rounds;
  }

  /** Индекс трассы для следующей (или текущей, если ещё не начата) гонки */
  trackFor(round: number): number {
    return (this.firstTrack + round) % Math.max(1, this.trackCount);
  }

  get nextTrack(): number {
    return this.trackFor(this.round);
  }

  /** Записать итог гонки: имена в порядке финиша */
  addRace(order: readonly string[]): CupSummary {
    for (const r of this.rows) r.last = 0;
    order.forEach((name, i) => {
      const r = this.rows.find((x) => x.name === name);
      if (!r) return;
      r.last = CUP_POINTS[i] ?? 0;
      r.points += r.last;
    });
    this.round += 1;
    return this.summary();
  }

  summary(): CupSummary {
    // при равенстве очков выше тот, кто лучше в последней гонке
    const sorted = [...this.rows].sort((a, b) => b.points - a.points || b.last - a.last);
    sorted.forEach((r, i) => (r.position = i + 1));
    return { round: this.round, rounds: this.rounds, finished: this.finished, rows: sorted.map((r) => ({ ...r })) };
  }
}
