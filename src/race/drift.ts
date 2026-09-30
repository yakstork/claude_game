/** DriftScorer — очки и комбо дрифта (GAME_DESIGN.md §3.3, §6.5). ЗАГЛУШКА: gameplay-engineer. */
import type { DriftCombo, DriftEvent, VehicleState } from '../core/types';

export class DriftScorer {
  total = 0;
  readonly combo: DriftCombo = { active: false, points: 0, multiplier: 1, time: 0 };
  private readonly out: DriftEvent[] = [];

  update(_dt: number, _state: VehicleState, _hitWall: boolean): DriftEvent[] {
    this.out.length = 0;
    return this.out;
  }

  reset(): void {
    this.total = 0;
    this.combo.active = false;
    this.combo.points = 0;
    this.combo.multiplier = 1;
    this.combo.time = 0;
  }
}
