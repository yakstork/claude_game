/**
 * Три выдуманные машины и профили ботов (GAME_DESIGN.md §3.2, §3.4).
 * Визуальные поля — ведущий. Физические числа машин — в handling.ts (HANDLING).
 */
import type { BotProfile, CarSpec } from '../core/types';
import { CUSTOM_CAR_ID } from '../core/types';
import { PALETTE } from '../world/palette';

export const CAR_SPECS: CarSpec[] = [
  {
    id: 'razor',
    name: 'Razor 86',
    tagline: 'Лёгкий клиновидный купе. Точный руль, послушный занос.',
    model: 'wedge',
    bodyColor: PALETTE.magenta,
    neonColor: PALETTE.cyan,
    accentColor: PALETTE.void,
    stats: { speed: 0.65, handling: 0.85, drift: 0.7 },
  },
  {
    id: 'grizzly',
    name: 'Grizzly V8',
    tagline: 'Тяжёлый маслкар. Король заносов: нитро копится быстрее всех.',
    model: 'muscle',
    bodyColor: PALETTE.lilac,
    neonColor: PALETTE.orange,
    accentColor: PALETTE.yellow,
    stats: { speed: 0.75, handling: 0.5, drift: 0.95 },
  },
  {
    id: 'photon',
    name: 'Photon X',
    tagline: 'Гиперкар. Бешеная скорость и цепкие шины — занос даётся труднее.',
    model: 'hyper',
    bodyColor: PALETTE.white,
    neonColor: PALETTE.magenta,
    accentColor: PALETTE.violet,
    stats: { speed: 0.95, handling: 0.7, drift: 0.4 },
  },
  {
    // «Своя сборка»: цвета и stats перезаписываются из CustomBuild (game.ts), физика — customHandling()
    id: CUSTOM_CAR_ID,
    name: 'Stardust ST',
    tagline: 'Своя сборка: распредели очки между скоростью, управляемостью и дрифтом и выбери цвета.',
    model: 'custom',
    bodyColor: PALETTE.cyan,
    neonColor: PALETTE.magenta,
    accentColor: PALETTE.yellow,
    stats: { speed: 0.6, handling: 0.6, drift: 0.6 },
  },
];

/** Цвета, разрешённые для «своей сборки» (только палитра игры) */
export const CUSTOM_PALETTE = {
  body: [PALETTE.cyan, PALETTE.magenta, PALETTE.orange, PALETTE.yellow, PALETTE.lilac, PALETTE.pink, PALETTE.white, PALETTE.violet],
  neon: [PALETTE.magenta, PALETTE.cyan, PALETTE.pink, PALETTE.orange, PALETTE.yellow, PALETTE.lilac, PALETTE.white],
};

export const BOT_PROFILES: BotProfile[] = [
  { name: 'NOVA', skill: 0.92, aggression: 0.6, lineBias: -0.2, bodyColor: PALETTE.cyan, neonColor: PALETTE.pink, carId: 'photon' },
  { name: 'BLAZE', skill: 0.85, aggression: 0.9, lineBias: 0.3, bodyColor: PALETTE.orange, neonColor: PALETTE.cyan, carId: 'grizzly' },
  { name: 'ECHO', skill: 0.8, aggression: 0.4, lineBias: 0.0, bodyColor: PALETTE.violet, neonColor: PALETTE.yellow, carId: 'razor' },
  { name: 'RONIN', skill: 0.74, aggression: 0.7, lineBias: -0.4, bodyColor: PALETTE.yellow, neonColor: PALETTE.magenta, carId: 'grizzly' },
  { name: 'KITE', skill: 0.66, aggression: 0.3, lineBias: 0.45, bodyColor: PALETTE.pink, neonColor: PALETTE.cyan, carId: 'razor' },
];

export function specById(id: string): CarSpec {
  return CAR_SPECS.find((c) => c.id === id) ?? CAR_SPECS[0];
}

/**
 * Общие габариты машины (едины для физики и визуальных моделей).
 * Локальные координаты: +Z — вперёд, +X — влево, y = 0 — уровень осей колёс
 * (это точка VehicleState.position). В покое на ровной дороге
 * position.y ≈ высота дороги + wheelRadius.
 */
export const CAR_GEOMETRY = {
  wheelBase: 2.6,
  trackWidth: 1.72,
  wheelRadius: 0.36,
  /** Точки крепления колёс: FL, FR, RL, RR */
  wheelOffsets: [
    [0.86, 0, 1.3],
    [-0.86, 0, 1.3],
    [0.86, 0, -1.3],
    [-0.86, 0, -1.3],
  ] as const,
  /** Габариты кузова для столкновений */
  length: 4.4,
  width: 1.95,
  collisionRadius: 2.1,
} as const;
