/**
 * Знания ИИ о трассе и о своей машине (кэшируются, считаются один раз).
 *
 *  - trackKnowledge(track): повороты (участки кривизны) и таблица «номер поворота по s»;
 *  - driftKnowledge(spec): боковое ускорение установившегося заноса на разных скоростях
 *    (измеряется короткой симуляцией на широкой ровной площадке — как «пробный заезд» водителя).
 *
 * Только математика и физика машины: без рендера и DOM.
 */
import type { CarSpec, VehicleControls } from '../core/types';
import { Track } from '../world/track';
import type { ControlPoint } from '../world/trackData';
import { VehiclePhysics } from '../vehicle/physics';
import { getHandling } from '../vehicle/handling';

// ─── Трасса ────────────────────────────────────────────────────────────────

/** Поворот — участок с |кривизной| выше этого (R < 91 м) */
export const CORNER_K = 0.011;
/** Шаг таблицы поворотов, м */
const CELL = 2;
/** Короче этого поворот занос не окупает, м */
const MIN_DRIFT_LEN = 36;
/** Занос начинается за столько метров до начала поворота */
export const DRIFT_LEAD = 12;
/** Занос отпускается за столько метров до конца поворота (машина успевает выровняться) */
export const DRIFT_EXIT = 18;

export interface Corner {
  s0: number;
  s1: number;
  /** Пиковая |кривизна|, 1/м */
  peak: number;
  /** +1 — поворот вправо, −1 — влево */
  dir: number;
  /** Участок s, на котором можно вести занос [zs, ze]; ze − zs < 20 → заносом не проходим */
  zs: number;
  ze: number;
  driftable: boolean;
}

export interface TrackKnowledge {
  readonly corners: Corner[];
  /** Номер поворота (s0..s1) в ячейке CELL м или −1 */
  readonly cornerAt: Int16Array;
  readonly cells: number;
}

const trackCache = new WeakMap<Track, TrackKnowledge>();

export function trackKnowledge(track: Track): TrackKnowledge {
  const hit = trackCache.get(track);
  if (hit) return hit;
  const corners: Corner[] = [];
  let cur: Corner | null = null;
  let gap = 0;
  const L = track.length;
  const push = (c: Corner): void => {
    if (c.s1 - c.s0 >= 12) corners.push(c);
  };
  for (let s = 0; s < L; s += CELL) {
    const k = track.curvatureAt(s);
    const a = Math.abs(k);
    if (a > CORNER_K) {
      const dir = Math.sign(k);
      if (cur && dir !== cur.dir) {
        push(cur);
        cur = null;
      }
      if (!cur) cur = { s0: s, s1: s, peak: 0, dir, zs: 0, ze: 0, driftable: false };
      cur.s1 = s;
      gap = 0;
      if (a > cur.peak) cur.peak = a;
    } else if (cur) {
      gap += CELL;
      if (gap > 20) {
        push(cur);
        cur = null;
      }
    }
  }
  if (cur) push(cur);
  // поворот, пересекающий линию старта (s = 0): считаем отдельным куском в конце — для простоты оставляем как есть
  for (const c of corners) {
    c.zs = c.s0 - DRIFT_LEAD;
    c.ze = c.s1 - DRIFT_EXIT;
  }
  // цепочки поворотов: зона заноса не заходит на зону соседа
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const bz = i + 1 < corners.length ? b.zs : b.zs + L;
    if (a.ze > bz - 8) a.ze = bz - 8;
  }
  for (let i = 0; i < corners.length; i++) {
    const c = corners[i];
    const nx = corners[(i + 1) % corners.length];
    const gapNext = (i + 1 < corners.length ? nx.s0 : nx.s0 + L) - c.s1;
    // перед встречным поворотом без паузы (шикана) занос не выйти чисто: машину выносит к стене
    const chain = nx.dir !== c.dir && gapNext < 30;
    c.driftable = c.s1 - c.s0 >= MIN_DRIFT_LEN && c.ze - c.zs >= 28 && !chain;
  }
  const cells = Math.ceil(L / CELL);
  const cornerAt = new Int16Array(cells).fill(-1);
  corners.forEach((c, i) => {
    for (let s = c.s0; s <= c.s1; s += CELL) cornerAt[Math.floor(s / CELL) % cells] = i;
  });
  const k: TrackKnowledge = { corners, cornerAt, cells };
  trackCache.set(track, k);
  return k;
}

/** Номер поворота, в котором лежит s (или −1) */
export function cornerIndexAt(track: Track, k: TrackKnowledge, s: number): number {
  return k.cornerAt[Math.floor(track.wrapS(s) / CELL) % k.cells];
}

// ─── Машина: боковое ускорение заноса ──────────────────────────────────────

const DT = 1 / 120;
/** Скорости, на которых измеряем боковое ускорение заноса, м/с */
const DRIFT_SPEEDS = [25, 35, 45, 55, 65];

export interface DriftKnowledge {
  readonly v: readonly number[];
  readonly a: readonly number[];
}

let wideTrack: Track | null = null;
const driftCache = new Map<string, DriftKnowledge>();
const _ctl: VehicleControls = { throttle: 1, brake: 0, steer: 1, handbrake: true, nitro: false };

/** Огромное кольцо с широкой дорогой — «бесконечная» ровная площадка для пробного заноса */
function getWideTrack(): Track {
  if (wideTrack) return wideTrack;
  const pts: ControlPoint[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    pts.push([Math.cos(a) * 2400, 0, Math.sin(a) * 2400]);
  }
  wideTrack = new Track({ name: 'ai-wide', points: pts, defaultHalfWidth: 1100, checkpointCount: 8 });
  return wideTrack;
}

function measureDriftLat(spec: CarSpec, v: number): number {
  const wide = getWideTrack();
  const car = new VehiclePhysics(spec, wide);
  const sm = wide.sampleAt(300);
  const h = Math.atan2(sm.tangent.x, sm.tangent.z);
  car.reset(sm.position, h, 300);
  car.state.velocity.set(Math.sin(h) * v, 0, Math.cos(h) * v);
  car.state.speed = v;
  const st = car.state;
  let psiPrev = h;
  let turned = 0;
  let sumV = 0;
  let n = 0;
  for (let k = 1; k <= 180; k++) {
    car.step(DT, _ctl);
    const psi = Math.atan2(st.velocity.x, st.velocity.z);
    let d = psi - psiPrev;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    psiPrev = psi;
    if (k > 90) {
      turned += Math.abs(d);
      sumV += Math.hypot(st.velocity.x, st.velocity.z);
      n++;
    }
  }
  return (sumV / n) * (turned / (n * DT));
}

/** Боковое ускорение заноса машины (кэш по ключевым числам конфига: живая подстройка пересчитает) */
export function driftKnowledge(spec: CarSpec): DriftKnowledge {
  const c = getHandling(spec.id);
  const key = `${spec.id}|${c.driftGrip}|${c.driftTurnBoost}|${c.driftMaxAngle}|${c.driftArcSteer}|${c.driftSpeedScrub}|${c.driftMinSpeed}|${c.driftSpeedAngleGain}|${c.driftBaseAngle}|${c.driftSteerGain}|${c.maxSpeed}`;
  const hit = driftCache.get(key);
  if (hit) return hit;
  const a = DRIFT_SPEEDS.map((v) => measureDriftLat(spec, v));
  const res: DriftKnowledge = { v: DRIFT_SPEEDS, a };
  driftCache.set(key, res);
  return res;
}

/** Боковое ускорение заноса на скорости v (линейная интерполяция, за краями — крайние значения) */
export function driftLatAt(k: DriftKnowledge, v: number): number {
  const vs = k.v;
  const a = k.a;
  if (v <= vs[0]) return a[0];
  for (let i = 1; i < vs.length; i++) {
    if (v <= vs[i]) return a[i - 1] + ((a[i] - a[i - 1]) * (v - vs[i - 1])) / (vs[i] - vs[i - 1]);
  }
  return a[a.length - 1];
}
