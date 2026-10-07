/**
 * Сложность ботов: сдвиг мастерства профиля и множитель мощности.
 * «Нормальная» не меняет поведение (баланс и тесты рассчитаны на неё).
 */
import type { BotProfile, Difficulty } from '../core/types';

export interface DifficultyParams {
  /** Прибавка к skill профиля (результат ограничивается 0.3..1) */
  skill: number;
  /** Множитель мощности мотора ботов (поверх rubber banding) */
  power: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyParams> = {
  easy: { skill: -0.2, power: 0.93 },
  normal: { skill: 0, power: 1 },
  hard: { skill: 0.08, power: 1.035 },
};

export function applyDifficulty(p: BotProfile, d: Difficulty): BotProfile {
  const k = DIFFICULTY[d];
  if (k.skill === 0) return { ...p };
  return { ...p, skill: Math.min(1, Math.max(0.3, p.skill + k.skill)) };
}
