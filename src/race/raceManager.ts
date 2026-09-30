/** RaceManager — круги, чекпоинты, позиции (GAME_DESIGN.md §3.5, §6.5). ЗАГЛУШКА: gameplay-engineer. */
import type { RaceEvent, RacerInfo, RacerStanding, VehicleState } from '../core/types';
import type { Track } from '../world/track';

export class RaceManager {
  readonly events: RaceEvent[] = [];
  raceTime = 0;
  private readonly rows: RacerStanding[];

  constructor(
    readonly track: Track,
    readonly racers: RacerInfo[],
    readonly laps = 3,
  ) {
    this.rows = racers.map((r, i) => ({
      car: i,
      name: r.name,
      isPlayer: r.isPlayer,
      position: i + 1,
      lap: 0,
      progress: 0,
      lapTimes: [],
      bestLap: null,
      currentLapTime: 0,
      nextCheckpoint: 1,
      finished: false,
      finishTime: null,
      wrongWay: false,
    }));
  }

  start(): void {}
  update(_dt: number, _cars: readonly VehicleState[]): void {
    this.events.length = 0;
  }
  standings(): RacerStanding[] {
    return [...this.rows].sort((a, b) => a.position - b.position);
  }
  standing(car: number): RacerStanding {
    return this.rows[car];
  }
  progress(car: number): number {
    return this.rows[car].progress;
  }
  projectedFinishTime(_car: number): number {
    return this.raceTime;
  }
  isFinished(car: number): boolean {
    return this.rows[car].finished;
  }
  allFinished(): boolean {
    return this.rows.every((r) => r.finished);
  }
}
