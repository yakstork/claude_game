/**
 * Генератор случайных замкнутых трасс из seed. Чистая функция: работает в Node, без рендера.
 *
 * Контур — «звёздный» многоугольник (радиус как функция угла) с гармониками и дрожанием точек: такой контур
 * не пересекает сам себя. Затем он масштабируется до 1.8–2.6 км и проверяется (радиус, зазоры между участками),
 * старт переносится на самую прямую часть, на прямых ставятся 1–2 трамплина, на плавных поворотах — виражи.
 * Мосты не строим (контур без пересечений). Всё детерминировано seed-ом.
 */
import { Track } from './track';
import type { ControlPoint, TrackDefinition } from './trackData';
import type { PickupLayout, PickupSpot } from './pickups';

/** Минимальный радиус осевой линии, м (требование ≥ 25 м; берём запас) */
export const GEN_MIN_RADIUS = 28;
export const GEN_MIN_LENGTH = 1800;
export const GEN_MAX_LENGTH = 2600;
/** Seed по умолчанию для карточки «ГЕНЕРАТОР» */
export const GEN_DEFAULT_SEED = 1;

const MAX_ATTEMPTS = 300;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GenCheck {
  ok: boolean;
  length: number;
  /** Минимальный радиус поворота осевой линии, м */
  minRadius: number;
  /** Минимальное расстояние между далёкими (по длине) участками, м */
  minGap: number;
  /** Разрыв стыка замыкания, м (≈ шаг выборки) */
  closeGap: number;
  /** Требуемый зазор между участками (2·halfWidth + запас) */
  needGap: number;
}

/** Минимальное расстояние между далёкими (по длине, > 160 м) участками осевой, м */
function farGap(t: Track): number {
  const stride = Math.max(1, Math.round(8 / t.step));
  const idx: number[] = [];
  for (let i = 0; i < t.count; i += stride) idx.push(i);
  const far = 160 / t.step;
  let best = Infinity;
  const P = t.positions;
  for (let a = 0; a < idx.length; a++) {
    const ia = idx[a];
    const ax = P[ia * 3];
    const az = P[ia * 3 + 2];
    for (let b = a + 1; b < idx.length; b++) {
      const ib = idx[b];
      const d = Math.min(ib - ia, t.count - (ib - ia));
      if (d < far) continue;
      const g = (ax - P[ib * 3]) ** 2 + (az - P[ib * 3 + 2]) ** 2;
      if (g < best) best = g;
    }
  }
  return Math.sqrt(best);
}

/** Проверка трассы: длина, радиус, самопересечения/наложения, замкнутость (checkGap=false — без попарного перебора) */
export function checkTrack(def: TrackDefinition, checkGap = true): GenCheck {
  const t = new Track(def);
  let maxK = 0;
  for (let i = 0; i < t.count; i++) maxK = Math.max(maxK, Math.abs(t.curvatures[i]));
  let maxHw = 0;
  for (let i = 0; i < t.count; i++) maxHw = Math.max(maxHw, t.halfWidths[i]);
  const need = maxHw * 2 + 6;
  const minGap = checkGap ? farGap(t) : Infinity;
  const last = t.count - 1;
  const closeGap = Math.hypot(t.positions[0] - t.positions[last * 3], t.positions[1] - t.positions[last * 3 + 1], t.positions[2] - t.positions[last * 3 + 2]);
  const minRadius = maxK > 0 ? 1 / maxK : Infinity;
  const ok =
    t.length >= GEN_MIN_LENGTH &&
    t.length <= GEN_MAX_LENGTH &&
    minRadius >= GEN_MIN_RADIUS * 0.9 &&
    minGap >= need &&
    closeGap <= t.step * 1.5 + 0.01;
  return { ok, length: t.length, minRadius, minGap, closeGap, needGap: need };
}

type Pt = [number, number, number, number?, number?];

/** Круг/эллипс: запасной вариант, всегда валиден */
function fallbackPoints(rng: () => number): Pt[] {
  const pts: Pt[] = [];
  const n = 24;
  const R = 340;
  const sx = 1.0 + rng() * 0.3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([Math.cos(a) * R * sx, 0, Math.sin(a) * R / sx]);
  }
  return pts;
}

function starPoints(rng: () => number): Pt[] {
  const n = 22 + Math.floor(rng() * 8);
  const harm: [number, number, number][] = [];
  for (let k = 2; k <= 7; k++) harm.push([k, (rng() * 0.3) / (k * 0.6), rng() * Math.PI * 2]);
  const sx = 0.8 + rng() * 0.5;
  const sz = 1.1 - (sx - 0.8) * 0.5;
  const pts: Pt[] = [];
  const phase = rng() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = phase + ((i + (rng() - 0.5) * 0.35) / n) * Math.PI * 2;
    let r = 1;
    for (const [k, amp, ph] of harm) r += amp * Math.cos(k * a + ph);
    r = Math.max(0.4, r) * (1 + (rng() - 0.5) * 0.04);
    pts.push([Math.cos(a) * r * sx, 0, Math.sin(a) * r * sz]);
  }
  return pts;
}

function scaled(pts: Pt[], k: number): Pt[] {
  return pts.map((p) => [p[0] * k, p[1], p[2] * k, p[3], p[4]] as Pt);
}

function perimeter(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += Math.hypot(b[0] - a[0], b[2] - a[2]);
  }
  return s;
}

/** Знак поворота в точке i (>0 — вправо) и кривизна по трём точкам, 1/м */
function turnAt(pts: Pt[], i: number): { sign: number; k: number } {
  const n = pts.length;
  const a = pts[(i + n - 1) % n];
  const b = pts[i];
  const c = pts[(i + 1) % n];
  const abx = b[0] - a[0];
  const abz = b[2] - a[2];
  const bcx = c[0] - b[0];
  const bcz = c[2] - b[2];
  const cross = abx * bcz - abz * bcx;
  const la = Math.hypot(abx, abz);
  const lb = Math.hypot(bcx, bcz);
  const acx = c[0] - a[0];
  const acz = c[2] - a[2];
  const lc = Math.hypot(acx, acz);
  const k = (2 * Math.abs(cross)) / Math.max(1e-6, la * lb * lc);
  return { sign: Math.sign(cross), k };
}

/** Сделать точку i стартовой (циклический сдвиг) */
function rotate(pts: Pt[], i: number): Pt[] {
  return pts.slice(i).concat(pts.slice(0, i));
}

/** Макс. |кривизна| на отрезке s ∈ [s0, s1] (с зацикливанием) */
function maxCurv(t: Track, s0: number, s1: number): number {
  let m = 0;
  for (let s = s0; s <= s1; s += 4) {
    const k = Math.abs(t.curvatureAt(((s % t.length) + t.length) % t.length));
    if (k > m) m = k;
  }
  return m;
}

function build(pts: Pt[], hw: number, id: string, name: string): TrackDefinition {
  return {
    id,
    name,
    tagline: '',
    defaultHalfWidth: hw,
    checkpointCount: 8,
    points: pts as ControlPoint[],
  };
}

/** Раскладка пикапов по кривизне: пластины на выходах из поворотов и после старта, канистры у внутренней кромки поворотов */
export function generatePickups(track: Track): PickupLayout {
  const L = track.length;
  const KC = 1 / 110;
  const corners: { s0: number; s1: number; peak: number; sign: number; sPeak: number }[] = [];
  let cur: { s0: number; s1: number; peak: number; sign: number; sPeak: number } | null = null;
  for (let s = 0; s < L; s += 4) {
    const k = track.curvatureAt(s);
    if (Math.abs(k) > KC) {
      if (!cur) cur = { s0: s, s1: s, peak: 0, sign: Math.sign(k), sPeak: s };
      cur.s1 = s;
      if (Math.abs(k) > cur.peak) {
        cur.peak = Math.abs(k);
        cur.sPeak = s;
        cur.sign = Math.sign(k);
      }
    } else if (cur && s - cur.s1 > 40) {
      corners.push(cur);
      cur = null;
    }
  }
  if (cur) corners.push(cur);
  const f = (s: number): number => Math.min(0.995, Math.max(0.005, s / L));
  // знак curvatureAt: правый поворот определяем по касательным (в physics руль +1 = вправо)
  const innerOffset = (s: number): number => {
    const a = track.sampleAt(Math.max(0, s - 8));
    const b = track.sampleAt((s + 8) % L);
    const cross = a.tangent.x * b.tangent.z - a.tangent.z * b.tangent.x;
    // поворот вправо (cross > 0) — внутренняя сторона справа (+)
    return cross > 0 ? 1 : -1;
  };
  const pads: PickupSpot[] = [{ f: 0.012, offset: 0 }];
  const cans: PickupSpot[] = [];
  let side = 1;
  for (const c of corners) {
    if (c.sPeak < 80 || c.sPeak > L - 80) continue;
    const inner = innerOffset(c.sPeak);
    const room = Math.max(3, track.halfWidth - 3);
    cans.push({ f: f(c.sPeak), offset: inner * room });
    if (c.peak > 1 / 70 && pads.length < 6) {
      pads.push({ f: f(Math.min(L - 40, c.s1 + 30)), offset: (side *= -1) * 3 });
    }
  }
  if (cans.length < 4) {
    // мало крутых поворотов: канистры на самых искривлённых местах
    const order: number[] = [];
    for (let s = 80; s < L - 80; s += 10) order.push(s);
    order.sort((a, b) => Math.abs(track.curvatureAt(b)) - Math.abs(track.curvatureAt(a)));
    for (const s of order) {
      if (cans.length >= 4) break;
      if (cans.every((c) => Math.abs(c.f * L - s) > 150)) cans.push({ f: f(s), offset: innerOffset(s) * Math.max(3, track.halfWidth - 3) });
    }
  }
  while (pads.length < 4) pads.push({ f: f(L * (0.2 + 0.2 * pads.length)), offset: 0 });
  return { pads, cans: cans.slice(0, 10) };
}

/** Имя трассы по seed */
export function genTrackName(seed: number): string {
  return `ГЕНЕРАТОР #${seed}`;
}

/**
 * Сгенерировать замкнутую трассу из seed. Результат — TrackDefinition (как записи trackData) с id `gen-<seed>`,
 * декором города или каньона и готовой раскладкой пикапов.
 */
export function generateTrack(seed: number): TrackDefinition {
  const id = `gen-${seed}`;
  for (let attempt = 0; attempt <= MAX_ATTEMPTS; attempt++) {
    const rng = mulberry32((seed * 2654435761 + attempt * 40503 + 12345) >>> 0);
    const base = attempt < MAX_ATTEMPTS ? starPoints(rng) : fallbackPoints(rng);
    const target = 1960 + rng() * 480;
    // длина растёт линейно с масштабом — одного пересчёта достаточно
    let pts = scaled(base, target / perimeter(base));
    let pkPoly = 0;
    for (let i = 0; i < pts.length; i++) pkPoly = Math.max(pkPoly, turnAt(pts, i).k);
    // быстрый отсев по контрольному многоугольнику (без построения сплайна)
    if (pkPoly > 1 / (GEN_MIN_RADIUS * 0.8) && attempt < MAX_ATTEMPTS) continue;
    const hw = 10 + Math.floor(rng() * 3);
    const canyon = rng() < 0.4;

    // 1) ориентация и старт на самой прямой части
    const probe = new Track(build(pts, hw, id, 'tmp'));
    // быстрый отсев по радиусу (до дорогих проверок)
    let pk = 0;
    for (let i = 0; i < probe.count; i++) pk = Math.max(pk, Math.abs(probe.curvatures[i]));
    if (pk > 1 / (GEN_MIN_RADIUS * 1.05) && attempt < MAX_ATTEMPTS) continue;
    if (farGap(probe) < hw * 2 + 8 && attempt < MAX_ATTEMPTS) continue;
    let bestI = 0;
    let bestK = Infinity;
    for (let i = 0; i < pts.length; i++) {
      // длина до точки i по ближайшей выборке
      let ns = 0;
      let nd = Infinity;
      for (let j = 0; j < probe.count; j += 5) {
        const d = (probe.positions[j * 3] - pts[i][0]) ** 2 + (probe.positions[j * 3 + 2] - pts[i][2]) ** 2;
        if (d < nd) {
          nd = d;
          ns = j * probe.step;
        }
      }
      const k = maxCurv(probe, ns - 90, ns + 110);
      if (k < bestK) {
        bestK = k;
        bestI = i;
      }
    }
    if (bestK > 1 / 150) continue;
    pts = rotate(pts, bestI);

    // 2) трамплины на прямых (3 точки с шагом ~33 м: гребень 3.4 м, как на Sunset Loop)
    const t1 = new Track(build(pts, hw, id, 'tmp'));
    const segs: number[] = [];
    let acc = 0;
    const segS: number[] = [0];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      acc += Math.hypot(b[0] - a[0], b[2] - a[2]);
      segS.push(acc);
    }
    const scale = t1.length / acc;
    for (let j = 3; j < pts.length - 4; j++) {
      const L = Math.hypot(pts[j + 1][0] - pts[j][0], pts[j + 1][2] - pts[j][2]);
      if (L < 110) continue;
      if (maxCurv(t1, segS[j] * scale - 40, segS[j + 1] * scale + 40) > 1 / 200) continue;
      segs.push(j);
    }
    if (segs.length === 0) continue;
    const want = 1 + (rng() < 0.5 ? 1 : 0);
    const chosen: number[] = [];
    // выбираем разнесённые сегменты, начиная со случайного
    const startAt = Math.floor(rng() * segs.length);
    for (let q = 0; q < segs.length && chosen.length < want; q++) {
      const j = segs[(startAt + q) % segs.length];
      if (chosen.every((c) => Math.abs(c - j) >= 5)) chosen.push(j);
    }
    const out: Pt[] = [];
    for (let j = 0; j < pts.length; j++) {
      out.push(pts[j]);
      if (chosen.includes(j)) {
        const a = pts[j];
        const b = pts[j + 1];
        const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const d0 = (L - 66) / 2;
        const ys = [0, 3.4, 0.3];
        for (let q = 0; q < 3; q++) {
          const u = (d0 + q * 33) / L;
          out.push([a[0] + (b[0] - a[0]) * u, ys[q], a[2] + (b[2] - a[2]) * u]);
        }
      }
    }
    // 3) виражи на плавных поворотах (знак как на Sunset Loop: левый +, правый −)
    for (let j = 0; j < out.length; j++) {
      if (out[j][1] !== 0) continue;
      const { sign, k } = turnAt(out, j);
      if (k > 1 / 200 && k < 1 / 45) out[j] = [out[j][0], 0, out[j][2], undefined, Math.round(-sign * Math.min(7, k * 450) * 10) / 10];
    }
    const def = build(out, hw, id, genTrackName(seed));
    def.decor = canyon ? 'canyon' : 'city';
    if (!checkTrack(def, false).ok) continue;
    const tr = new Track(def);
    def.tagline = `Случайная трасса ${(tr.length / 1000).toFixed(1)} км: ${chosen.length === 1 ? 'трамплин' : 'два трамплина'}, ${canyon ? 'каньон' : 'город'}.`;
    def.pickups = generatePickups(tr);
    return def;
  }
  // недостижимо (последняя попытка — запасной эллипс без трамплинов)
  const pts = scaled(fallbackPoints(mulberry32(seed)), 1);
  const def = build(pts, 11, id, genTrackName(seed));
  def.pickups = generatePickups(new Track(def));
  return def;
}
