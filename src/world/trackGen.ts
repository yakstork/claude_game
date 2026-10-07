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

/**
 * «Трасса из элементов»: 5–7 вершин вокруг центра (контур без самопересечений), углы скруглены дугами
 * (1–2 шпильки радиусом ~35 м, остальные 60–130 м), на длинных ребрах — прямые 250+ м, на одной из них шикана.
 * Возвращает null, если элементы не поместились (попытка отбрасывается).
 */
function circuitPoints(rng: () => number, target: number): Pt[] | null {
  const V = 5 + Math.floor(rng() * 3);
  const phase = rng() * Math.PI * 2;
  const sx = 0.85 + rng() * 0.4;
  const sz = 1.15 - (sx - 0.85) * 0.5;
  let vs: [number, number][] = [];
  for (let i = 0; i < V; i++) {
    const a = phase + ((i + (rng() - 0.5) * 0.5) / V) * Math.PI * 2;
    const r = 0.55 + rng() * 0.75;
    vs.push([Math.cos(a) * r * sx, Math.sin(a) * r * sz]);
  }
  let per = 0;
  for (let i = 0; i < V; i++) per += Math.hypot(vs[(i + 1) % V][0] - vs[i][0], vs[(i + 1) % V][1] - vs[i][1]);
  const k = (target * 1.07) / per;
  vs = vs.map(([x, z]) => [x * k, z * k]);

  // направления рёбер, углы поворота
  const u: [number, number][] = [];
  const len: number[] = [];
  for (let i = 0; i < V; i++) {
    const dx = vs[(i + 1) % V][0] - vs[i][0];
    const dz = vs[(i + 1) % V][1] - vs[i][1];
    const l = Math.hypot(dx, dz);
    len.push(l);
    u.push([dx / l, dz / l]);
  }
  const phi: number[] = [];
  const sg: number[] = [];
  for (let i = 0; i < V; i++) {
    const a = u[(i + V - 1) % V];
    const b = u[i];
    phi.push(Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1]))));
    sg.push(Math.sign(a[0] * b[1] - a[1] * b[0]) || 1);
  }
  // радиусы: самые резкие углы (>= ~95°) — шпильки R ≈ 35, остальные 60–130
  const order = phi.map((_, i) => i).sort((x, y) => phi[y] - phi[x]);
  const hairpins = new Set<number>();
  for (const i of order.slice(0, 2)) if (phi[i] >= 1.65) hairpins.add(i);
  if (hairpins.size === 0) return null;
  const R = phi.map((_, i) => (hairpins.has(i) ? 34 + rng() * 5 : 60 + rng() * 70));
  const d = phi.map((f, i) => R[i] * Math.tan(f / 2));
  // прямые между скруглениями
  const straight: number[] = [];
  for (let i = 0; i < V; i++) straight.push(len[i] - d[i] - d[(i + 1) % V]);
  if (Math.min(...straight) < 40) return null;
  if (Math.max(...straight) < 250) return null;
  // шикана — на одной из длинных прямых (≥ 330 м), случайной
  const chic = straight.map((l, i) => (l >= 330 ? i : -1)).filter((i) => i >= 0);
  const chicEdge = chic.length ? chic[Math.floor(rng() * chic.length)] : -1;
  const A = (rng() < 0.5 ? -1 : 1) * (6 + rng() * 2);

  const out: Pt[] = [];
  for (let i = 0; i < V; i++) {
    // дуга вершины i: от T1 = V - u1·d до T2 = V + u2·d
    const u1 = u[(i + V - 1) % V];
    const u2 = u[i];
    const t1x = vs[i][0] - u1[0] * d[i];
    const t1z = vs[i][1] - u1[1] * d[i];
    // внутренняя нормаль: (−uz, ux) для левого поворота
    const nx = -u1[1] * sg[i];
    const nz = u1[0] * sg[i];
    for (let q = 0; q <= 4; q++) {
      const th = (phi[i] * q) / 4;
      out.push([t1x + R[i] * Math.sin(th) * u1[0] + R[i] * (1 - Math.cos(th)) * nx, 0, t1z + R[i] * Math.sin(th) * u1[1] + R[i] * (1 - Math.cos(th)) * nz]);
    }
    // прямая от T2 до T1 следующей вершины: промежуточные точки (держат её прямой) и шикана
    const sx0 = out[out.length - 1][0];
    const sz0 = out[out.length - 1][2];
    const Ls = straight[i];
    const along: { t: number; lat: number }[] = [];
    const fill = (from: number, to: number): void => {
      const n = Math.floor((to - from) / 140);
      for (let j = 1; j <= n; j++) along.push({ t: from + ((to - from) * j) / (n + 1), lat: 0 });
    };
    if (i === chicEdge) {
      const c0 = Ls / 2 - 60;
      fill(0, c0);
      for (let j = 0; j <= 4; j++) along.push({ t: c0 + j * 30, lat: A * Math.sin((Math.PI * j) / 2) });
      fill(c0 + 120, Ls);
    } else {
      fill(0, Ls);
    }
    for (const { t, lat } of along) out.push([sx0 + u2[0] * t - u2[1] * lat, 0, sz0 + u2[1] * t + u2[0] * lat]);
  }
  return out;
}

function scaled(pts: Pt[], k: number): Pt[] {
  return pts.map((p) => [p[0] * k, p[1], p[2] * k, p[3], p[4]] as Pt);
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
    const target = 1960 + rng() * 480;
    const circuit = attempt < MAX_ATTEMPTS ? circuitPoints(rng, target) : fallbackPoints(rng);
    if (!circuit) continue;
    let pts = circuit;
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
