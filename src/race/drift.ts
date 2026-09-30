/** DriftScorer — очки и комбо дрифта (GAME_DESIGN.md §3.3, §6.5). */
import { MathUtils } from 'three';
import type { DriftCombo, DriftEvent, VehicleState } from '../core/types';

/** Минимальная скорость для начисления очков, м/с */
const MIN_SPEED = 12;
/** Угол заноса, при котором angleFactor = 1, рад */
const REF_ANGLE = 0.6;
const MIN_FACTOR = 0.2;
const MAX_FACTOR = 1.2;
/** Масштаб очков */
const POINTS_SCALE = 10;
/** Непрерывного заноса на +1 к множителю, с */
const MULT_STEP_TIME = 1.5;
const MAX_MULTIPLIER = 5;
/** Пауза без заноса, после которой комбо завершается, с */
const COMBO_GAP = 1.0;
/** Итог ниже — комбо считается случайным, без надписи */
const MIN_REPORT_POINTS = 50;

export function driftLabel(points: number): string {
  if (points < 500) return 'DRIFT';
  if (points < 1500) return 'NICE DRIFT';
  if (points < 4000) return 'GREAT DRIFT';
  if (points < 9000) return 'INSANE DRIFT!';
  return 'NEON GOD!!';
}

export class DriftScorer {
  total = 0;
  readonly combo: DriftCombo = { active: false, points: 0, multiplier: 1, time: 0 };
  private readonly out: DriftEvent[] = [];
  /** Непрерывное время текущего заноса (для роста множителя), с */
  private run = 0;
  /** Время с конца последнего заноса, с */
  private gap = 0;

  update(dt: number, state: VehicleState, hitWall: boolean): DriftEvent[] {
    const out = this.out;
    out.length = 0;
    const combo = this.combo;

    if (hitWall && combo.active) {
      const burned = Math.round(combo.points * combo.multiplier);
      out.push({ type: 'comboLost', points: burned });
      this.clearCombo();
      return out;
    }

    // «Занос» — держит комбо живым (в воздухе тоже); очки — только на земле
    const sliding = state.drifting && Math.abs(state.speed) > MIN_SPEED;

    if (sliding) {
      if (!combo.active) {
        combo.active = true;
        combo.points = 0;
        combo.multiplier = 1;
        combo.time = 0;
      }
      this.gap = 0;
      combo.time += dt;
      this.run += dt;
      if (state.onGround) {
        const factor = MathUtils.clamp(Math.abs(state.driftAngle) / REF_ANGLE, MIN_FACTOR, MAX_FACTOR);
        combo.points += factor * Math.abs(state.speed) * dt * POINTS_SCALE;
      }
      while (this.run >= MULT_STEP_TIME && combo.multiplier < MAX_MULTIPLIER) {
        this.run -= MULT_STEP_TIME;
        combo.multiplier += 1;
        out.push({ type: 'multiplier', multiplier: combo.multiplier });
      }
      if (combo.multiplier >= MAX_MULTIPLIER) this.run = Math.min(this.run, MULT_STEP_TIME);
    } else if (combo.active) {
      this.run = 0;
      this.gap += dt;
      if (this.gap >= COMBO_GAP) {
        const result = Math.round(combo.points * combo.multiplier);
        this.total += result;
        if (result >= MIN_REPORT_POINTS) {
          out.push({ type: 'comboEnd', points: result, multiplier: combo.multiplier, label: driftLabel(result) });
        }
        this.clearCombo();
      }
    }
    return out;
  }

  /** Завершить активное комбо сейчас (например, на финише) и начислить очки */
  flush(): DriftEvent[] {
    const out = this.out;
    out.length = 0;
    const combo = this.combo;
    if (combo.active) {
      const result = Math.round(combo.points * combo.multiplier);
      this.total += result;
      if (result >= MIN_REPORT_POINTS) {
        out.push({ type: 'comboEnd', points: result, multiplier: combo.multiplier, label: driftLabel(result) });
      }
      this.clearCombo();
    }
    return out;
  }

  reset(): void {
    this.total = 0;
    this.out.length = 0;
    this.clearCombo();
  }

  private clearCombo(): void {
    const combo = this.combo;
    combo.active = false;
    combo.points = 0;
    combo.multiplier = 1;
    combo.time = 0;
    this.run = 0;
    this.gap = 0;
  }
}
