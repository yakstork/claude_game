/**
 * Столкновения машин (GAME_DESIGN.md §3.1).
 * Каждая машина — два круга (перед/зад). Раздвигание с учётом масс, обмен
 * импульсом по нормали с восстановлением и лёгким моментом рыскания.
 * Вызывать ПОСЛЕ step() всех машин: события 'car' добавляются в physics.events.
 * Без аллокаций.
 */
import { Vector3 } from 'three';
import type { VehiclePhysics } from './physics';
import { getHandling } from './handling';
import { CAR_GEOMETRY } from './specs';

const CIRCLE_R = 1.05;
/** Смещение центров кругов от центра машины вдоль оси, м */
const CIRCLE_OFFSET = CAR_GEOMETRY.length / 2 - CIRCLE_R;
/** Дальше этого между центрами машин столкновение невозможно */
const BROAD_DIST = 2 * (CIRCLE_OFFSET + CIRCLE_R) + 0.2;
/** Машины на разных уровнях (эстакада) не сталкиваются */
const MAX_LEVEL_DIFF = 3;
const RESTITUTION = 0.3;
/** Радиус инерции² для столкновений (мягче, чем в физике: «лёгкий» момент), м² */
const INERTIA_K2 = 2.6;
const MAX_PUSH = 1.5;
const MIN_EVENT_SPEED = 1.0;

const _p = new Vector3();
const OFFSETS = [CIRCLE_OFFSET, -CIRCLE_OFFSET];

export function resolveCarCollisions(cars: VehiclePhysics[]): void {
  const n = cars.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) collidePair(cars[i], cars[j]);
  }
}

function collidePair(a: VehiclePhysics, b: VehiclePhysics): void {
  const sa = a.state;
  const sb = b.state;
  const dxc = sb.position.x - sa.position.x;
  const dzc = sb.position.z - sa.position.z;
  if (dxc * dxc + dzc * dzc > BROAD_DIST * BROAD_DIST) return;
  if (Math.abs(sb.position.y - sa.position.y) > MAX_LEVEL_DIFF) return;

  const ma = getHandling(a.spec.id).mass;
  const mb = getHandling(b.spec.id).mass;
  const ima = 1 / ma;
  const imb = 1 / mb;
  const iia = 1 / (ma * INERTIA_K2);
  const iib = 1 / (mb * INERTIA_K2);
  const fax = Math.sin(sa.heading);
  const faz = Math.cos(sa.heading);
  const fbx = Math.sin(sb.heading);
  const fbz = Math.cos(sb.heading);

  let maxImpact = 0;
  let hit = false;
  let hitX = 0;
  let hitZ = 0;
  for (let ia = 0; ia < 2; ia++) {
    for (let ib = 0; ib < 2; ib++) {
      // центры кругов с учётом уже применённых сдвигов
      const rax = fax * OFFSETS[ia];
      const raz = faz * OFFSETS[ia];
      const rbx = fbx * OFFSETS[ib];
      const rbz = fbz * OFFSETS[ib];
      const cax = sa.position.x + rax;
      const caz = sa.position.z + raz;
      const cbx = sb.position.x + rbx;
      const cbz = sb.position.z + rbz;
      let nx = cbx - cax;
      let nz = cbz - caz;
      const d2 = nx * nx + nz * nz;
      const minD = CIRCLE_R * 2;
      if (d2 >= minD * minD) continue;
      const d = Math.sqrt(d2);
      if (d > 1e-4) {
        nx /= d;
        nz /= d;
      } else {
        // совпали центры: раздвигаем вдоль линии между машинами
        const dl = Math.hypot(dxc, dzc);
        nx = dl > 1e-4 ? dxc / dl : 1;
        nz = dl > 1e-4 ? dzc / dl : 0;
      }
      const pen = Math.min(minD - d, MAX_PUSH);

      // раздвигание пропорционально обратным массам
      const wa = ima / (ima + imb);
      const wb = 1 - wa;
      sa.position.x -= nx * pen * wa;
      sa.position.z -= nz * pen * wa;
      sb.position.x += nx * pen * wb;
      sb.position.z += nz * pen * wb;

      // скорость точек контакта (поступательная + вращение вокруг Y)
      const vax = sa.velocity.x + sa.yawRate * raz;
      const vaz = sa.velocity.z - sa.yawRate * rax;
      const vbx = sb.velocity.x + sb.yawRate * rbz;
      const vbz = sb.velocity.z - sb.yawRate * rbx;
      const vn = (vbx - vax) * nx + (vbz - vaz) * nz;
      if (vn >= 0) continue; // расходятся

      const rcaN = raz * nx - rax * nz;
      const rcbN = rbz * nx - rbx * nz;
      const denom = ima + imb + rcaN * rcaN * iia + rcbN * rcbN * iib;
      const jImp = (-(1 + RESTITUTION) * vn) / denom;
      sa.velocity.x -= jImp * nx * ima;
      sa.velocity.z -= jImp * nz * ima;
      sb.velocity.x += jImp * nx * imb;
      sb.velocity.z += jImp * nz * imb;
      sa.yawRate -= jImp * rcaN * iia;
      sb.yawRate += jImp * rcbN * iib;

      const impact = -vn;
      if (impact > maxImpact) {
        maxImpact = impact;
        hitX = cax + nx * CIRCLE_R;
        hitZ = caz + nz * CIRCLE_R;
      }
      hit = true;
    }
  }
  if (hit && maxImpact > MIN_EVENT_SPEED) {
    const strength = Math.min(1, Math.max(0.05, maxImpact / 15));
    _p.set(hitX, (sa.position.y + sb.position.y) * 0.5, hitZ);
    a.pushEvent('car', strength, _p);
    b.pushEvent('car', strength, _p);
  }
}
