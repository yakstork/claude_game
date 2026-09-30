/**
 * Rubber banding (GAME_DESIGN.md §3.4): множитель мощности бота по отставанию от игрока.
 * gap = bot − player (метры прогресса). Бот позади > 30 м → плавно до 1.10 (при −250 м),
 * впереди > 30 м → плавно до 0.92 (при +250 м). Монотонно убывает по gap.
 */
import { MathUtils } from 'three';

const DEAD_ZONE = 30;
const FULL_GAP = 250;
export const RUBBER_MAX = 1.1;
export const RUBBER_MIN = 0.92;

export function rubberBandFactor(botProgress: number, playerProgress: number, _trackLength: number): number {
  const gap = botProgress - playerProgress;
  if (!Number.isFinite(gap)) return 1;
  if (gap < -DEAD_ZONE) {
    const t = MathUtils.smoothstep(-gap, DEAD_ZONE, FULL_GAP);
    return 1 + (RUBBER_MAX - 1) * t;
  }
  if (gap > DEAD_ZONE) {
    const t = MathUtils.smoothstep(gap, DEAD_ZONE, FULL_GAP);
    return 1 - (1 - RUBBER_MIN) * t;
  }
  return 1;
}
