/**
 * Слипстрим: машина в узком конусе позади другой набирает state.slipstream 0..1.
 * Чистая логика (Node), без аллокаций. Числа — SLIPSTREAM_TUNING (handling.ts).
 * Эффект применяет VehiclePhysics (макс. скорость, тяга, подзарядка нитро).
 */
import type { VehicleState } from '../core/types';
import { SLIPSTREAM_TUNING } from './handling';

/** Ближе этого расстояния вдоль курса лидер не считается «впереди» (борт о борт) */
const MIN_AHEAD = 2;

/** Находится ли follower в конусе слипстрима позади leader (с проверкой скоростей) */
export function inSlipstreamCone(follower: VehicleState, leader: VehicleState): boolean {
  const T = SLIPSTREAM_TUNING;
  if (follower.speed < T.minSpeed || leader.speed < T.minSpeed) return false;
  const dx = leader.position.x - follower.position.x;
  const dz = leader.position.z - follower.position.z;
  const sh = Math.sin(follower.heading);
  const ch = Math.cos(follower.heading);
  const f = dx * sh + dz * ch; // вдоль курса
  if (f < MIN_AHEAD || f > T.range) return false;
  const l = dx * ch - dz * sh; // поперёк
  const tan = Math.tan((T.coneDeg * Math.PI) / 180);
  return Math.abs(l) <= f * tan;
}

/** Раз в шаг: обновляет states[i].slipstream (нарастание ~riseTime, спад ~fallTime) */
export function updateSlipstream(states: readonly VehicleState[], dt: number): void {
  const T = SLIPSTREAM_TUNING;
  const up = dt / Math.max(1e-3, T.riseTime);
  const down = dt / Math.max(1e-3, T.fallTime);
  for (let i = 0; i < states.length; i++) {
    const me = states[i];
    let inCone = false;
    if (me.onGround) {
      for (let j = 0; j < states.length; j++) {
        if (j !== i && inSlipstreamCone(me, states[j])) {
          inCone = true;
          break;
        }
      }
    }
    const s = me.slipstream + (inCone ? up : -down);
    me.slipstream = s < 0 ? 0 : s > 1 ? 1 : s;
  }
}
