/**
 * Три выдуманные машины и профили ботов (GAME_DESIGN.md §3.2, §3.4).
 * Визуальные поля — ведущий; физические числа может тюнить gameplay-engineer.
 */
import type { BotProfile, CarSpec } from '../core/types';
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
    maxSpeed: 64,
    acceleration: 9.3,
    brakeDecel: 28,
    steerAngle: 0.55,
    grip: 1.25,
    driftGrip: 0.55,
    driftChargeRate: 0.32,
    nitroBoost: 12,
    mass: 1150,
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
    maxSpeed: 68,
    acceleration: 8.4,
    brakeDecel: 24,
    steerAngle: 0.5,
    grip: 1.05,
    driftGrip: 0.42,
    driftChargeRate: 0.42,
    nitroBoost: 13,
    mass: 1550,
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
    maxSpeed: 76,
    acceleration: 10.3,
    brakeDecel: 30,
    steerAngle: 0.5,
    grip: 1.35,
    driftGrip: 0.65,
    driftChargeRate: 0.24,
    nitroBoost: 14,
    mass: 1250,
    stats: { speed: 0.95, handling: 0.7, drift: 0.4 },
  },
];

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
