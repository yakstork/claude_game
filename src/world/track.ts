/**
 * Track — сплайн трассы и быстрые запросы к нему (проекция точки, выборки).
 * Чистая математика: без рендера, работает в Node (используется физикой и ИИ).
 */
import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { Pose, TrackProjection, TrackSample } from '../core/types';
import type { TrackDefinition } from './trackData';
import { BARRIER_OFFSET } from './constants';

const UP = new Vector3(0, 1, 0);
/** Шаг дискретизации трассы, м */
const STEP = 1;
/** Окно поиска вокруг подсказки, м */
const HINT_WINDOW = 45;

const _a = new Vector3();
const _b = new Vector3();
const _ab = new Vector3();
const _ap = new Vector3();

export function createSample(): TrackSample {
  return {
    s: 0,
    position: new Vector3(),
    tangent: new Vector3(0, 0, 1),
    right: new Vector3(-1, 0, 0),
    up: new Vector3(0, 1, 0),
    halfWidth: 10,
    bank: 0,
  };
}

export function createProjection(): TrackProjection {
  return { s: 0, lateral: 0, height: 0, normal: new Vector3(0, 1, 0), sample: createSample(), distance: 0 };
}

export class Track {
  readonly name: string;
  readonly length: number;
  /** Номинальная полуширина (минимальная по трассе) */
  readonly halfWidth: number;
  readonly checkpoints: number[];
  /** Число дискретных выборок */
  readonly count: number;
  readonly step: number;

  // Плотные массивы выборок (каждые STEP метров)
  readonly positions: Float32Array;
  readonly tangents: Float32Array;
  readonly rights: Float32Array;
  readonly ups: Float32Array;
  readonly halfWidths: Float32Array;
  readonly banks: Float32Array;
  readonly curvatures: Float32Array;

  constructor(def: TrackDefinition) {
    this.name = def.name;
    const pts = def.points.map(([x, y, z]) => new Vector3(x, y, z));
    const curve = new CatmullRomCurve3(pts, true, 'centripetal');
    curve.arcLengthDivisions = pts.length * 200;
    const total = curve.getLength();
    const count = Math.max(64, Math.round(total / STEP));
    this.count = count;
    this.step = total / count;
    this.length = total;

    this.positions = new Float32Array(count * 3);
    this.tangents = new Float32Array(count * 3);
    this.rights = new Float32Array(count * 3);
    this.ups = new Float32Array(count * 3);
    this.halfWidths = new Float32Array(count);
    this.banks = new Float32Array(count);
    this.curvatures = new Float32Array(count);

    const n = pts.length;
    const p = new Vector3();
    for (let i = 0; i < count; i++) {
      const u = i / count;
      curve.getPointAt(u, p);
      this.positions.set([p.x, p.y, p.z], i * 3);
      // Атрибуты контрольных точек интерполируются по параметру t сплайна
      const t = curve.getUtoTmapping(u, 0) * n;
      const i0 = Math.floor(t) % n;
      const i1 = (i0 + 1) % n;
      const f = MathUtils.smoothstep(t - Math.floor(t), 0, 1);
      const w0 = def.points[i0][3] ?? def.defaultHalfWidth;
      const w1 = def.points[i1][3] ?? def.defaultHalfWidth;
      const b0 = def.points[i0][4] ?? 0;
      const b1 = def.points[i1][4] ?? 0;
      this.halfWidths[i] = MathUtils.lerp(w0, w1, f);
      this.banks[i] = MathUtils.degToRad(MathUtils.lerp(b0, b1, f));
    }

    // Сплайн может «проседать» ниже нуля у перепадов высот — дорога не должна
    // уходить под землю: зажимаем высоту и слегка сглаживаем профиль.
    // На виражах нижний край полотна опускается на halfWidth·sin(bank): поднимаем
    // осевую, чтобы любой край дороги был выше земли (GROUND_Y + ROAD_CLEARANCE).
    const ys = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const edgeDrop = (this.halfWidths[i] + BARRIER_OFFSET + 0.6) * Math.sin(Math.abs(this.banks[i]));
      ys[i] = Math.max(0, this.positions[i * 3 + 1], edgeDrop);
    }
    // «подъём» на вираже растягиваем на соседние участки (максимум в окне ±25 м)
    {
      const src = ys.slice();
      const win = Math.ceil(25 / this.step);
      for (let i = 0; i < count; i++) {
        let m = src[i];
        for (let k = -win; k <= win; k++) {
          const v = src[(i + k + count) % count];
          const fall = 1 - Math.abs(k) / (win + 1);
          if (v * fall > m) m = v * fall;
        }
        ys[i] = m;
      }
    }
    for (let pass = 0; pass < 3; pass++) {
      const src = ys.slice();
      for (let i = 0; i < count; i++) {
        let sum = 0;
        for (let k = -3; k <= 3; k++) sum += src[(i + k + count) % count];
        ys[i] = sum / 7;
      }
    }
    for (let i = 0; i < count; i++) this.positions[i * 3 + 1] = ys[i];

    // Касательные (центральные разности), right/up с учётом виража
    const t = new Vector3();
    const r = new Vector3();
    const up = new Vector3();
    for (let i = 0; i < count; i++) {
      const ip = (i + 1) % count;
      const im = (i - 1 + count) % count;
      t.set(
        this.positions[ip * 3] - this.positions[im * 3],
        this.positions[ip * 3 + 1] - this.positions[im * 3 + 1],
        this.positions[ip * 3 + 2] - this.positions[im * 3 + 2],
      ).normalize();
      r.crossVectors(t, UP).normalize();
      r.applyAxisAngle(t, this.banks[i]);
      up.crossVectors(r, t).normalize();
      this.tangents.set([t.x, t.y, t.z], i * 3);
      this.rights.set([r.x, r.y, r.z], i * 3);
      this.ups.set([up.x, up.y, up.z], i * 3);
    }

    // Горизонтальная кривизна со знаком (> 0 — поворот вправо), сглаженная
    const raw = new Float32Array(count);
    const span = 4;
    for (let i = 0; i < count; i++) {
      const a = (i - span + count) % count;
      const b = (i + span) % count;
      const ax = this.tangents[a * 3];
      const az = this.tangents[a * 3 + 2];
      const bx = this.tangents[b * 3];
      const bz = this.tangents[b * 3 + 2];
      const angA = Math.atan2(ax, az);
      const angB = Math.atan2(bx, bz);
      let d = angB - angA;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      // heading растёт при повороте влево → правый поворот = отрицательное d
      raw[i] = -d / (2 * span * this.step);
    }
    const smooth = 6;
    for (let i = 0; i < count; i++) {
      let sum = 0;
      for (let k = -smooth; k <= smooth; k++) sum += raw[(i + k + count) % count];
      this.curvatures[i] = sum / (smooth * 2 + 1);
    }

    let minW = Infinity;
    for (let i = 0; i < count; i++) minW = Math.min(minW, this.halfWidths[i]);
    this.halfWidth = minW;

    this.checkpoints = [];
    for (let k = 0; k < def.checkpointCount; k++) this.checkpoints.push((k / def.checkpointCount) * total);
  }

  /** Приводит s к диапазону [0, length) */
  wrapS(s: number): number {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  /** Кратчайшая разница b − a по кольцу, в диапазоне [−L/2, L/2] */
  deltaS(a: number, b: number): number {
    const L = this.length;
    let d = (b - a) % L;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  }

  /** Интерполированная выборка в точке s. В горячих путях передавайте out. */
  sampleAt(s: number, out: TrackSample = createSample()): TrackSample {
    const ws = this.wrapS(s);
    const f = ws / this.step;
    const i0 = Math.floor(f) % this.count;
    const i1 = (i0 + 1) % this.count;
    const k = f - Math.floor(f);
    out.s = ws;
    lerp3(this.positions, i0, i1, k, out.position);
    lerp3(this.tangents, i0, i1, k, out.tangent).normalize();
    lerp3(this.rights, i0, i1, k, out.right).normalize();
    lerp3(this.ups, i0, i1, k, out.up).normalize();
    out.halfWidth = this.halfWidths[i0] + (this.halfWidths[i1] - this.halfWidths[i0]) * k;
    out.bank = this.banks[i0] + (this.banks[i1] - this.banks[i0]) * k;
    return out;
  }

  /** Горизонтальная кривизна, 1/м (> 0 — поворот вправо) */
  curvatureAt(s: number): number {
    const f = this.wrapS(s) / this.step;
    const i0 = Math.floor(f) % this.count;
    const i1 = (i0 + 1) % this.count;
    const k = f - Math.floor(f);
    return this.curvatures[i0] + (this.curvatures[i1] - this.curvatures[i0]) * k;
  }

  /**
   * Проекция точки на трассу. Для движущихся объектов ОБЯЗАТЕЛЬНО передавайте
   * hintS (прошлое значение s) — эстакада проходит над другим участком трассы.
   * Без подсказки ищется ближайшая точка по всей трассе в 3D.
   */
  project(p: Vector3, hintS?: number, out: TrackProjection = createProjection(), window = HINT_WINDOW): TrackProjection {
    let first: number;
    let n: number;
    if (hintS === undefined || !Number.isFinite(hintS)) {
      first = 0;
      n = this.count;
    } else {
      const w = Math.ceil(window / this.step);
      first = Math.floor(this.wrapS(hintS) / this.step) - w;
      n = w * 2 + 1;
    }

    let bestD = Infinity;
    let bestI = 0;
    let bestK = 0;
    for (let j = 0; j < n; j++) {
      const i0 = (((first + j) % this.count) + this.count) % this.count;
      const i1 = (i0 + 1) % this.count;
      _a.fromArray(this.positions, i0 * 3);
      _b.fromArray(this.positions, i1 * 3);
      _ab.subVectors(_b, _a);
      _ap.subVectors(p, _a);
      const len2 = _ab.lengthSq();
      const k = len2 > 0 ? MathUtils.clamp(_ap.dot(_ab) / len2, 0, 1) : 0;
      // расстояние до осевой: горизонталь + вертикаль с большим весом (выбор уровня)
      const cx = _a.x + _ab.x * k - p.x;
      const cy = _a.y + _ab.y * k - p.y;
      const cz = _a.z + _ab.z * k - p.z;
      const d = cx * cx + cz * cz + cy * cy * 4;
      if (d < bestD) {
        bestD = d;
        bestI = i0;
        bestK = k;
      }
    }

    const sample = this.sampleAt((bestI + bestK) * this.step, out.sample);
    _ap.subVectors(p, sample.position);
    // lateral — вдоль горизонтальной проекции right, чтобы вираж не искажал смещение
    const rx = sample.right.x;
    const rz = sample.right.z;
    const rl = Math.hypot(rx, rz) || 1;
    const lateral = (_ap.x * rx + _ap.z * rz) / rl;
    out.s = sample.s;
    out.lateral = lateral;
    // Высота поверхности: плоскость дороги через осевую точку с нормалью up
    const up = sample.up;
    // решаем up·(q − c) = 0 относительно q.y для q = (p.x, y, p.z)
    const dy = up.y !== 0 ? -(up.x * _ap.x + up.z * _ap.z) / up.y : 0;
    out.height = sample.position.y + dy;
    out.normal.copy(up);
    out.distance = Math.abs(p.y - out.height);
    return out;
  }

  /**
   * Поза на стартовой решётке. slot 0 — поул-позиция. Две колонны, шахматный
   * порядок, всё позади стартовой линии (s < 0).
   */
  gridPose(slot: number): Pose {
    const row = Math.floor(slot / 2);
    const col = slot % 2;
    const s = this.wrapS(-10 - row * 11 - col * 5.5);
    const sample = this.sampleAt(s);
    const lateral = col === 0 ? -3.6 : 3.6;
    const position = sample.position.clone().addScaledVector(sample.right, lateral);
    const heading = Math.atan2(sample.tangent.x, sample.tangent.z);
    return { position, heading, s };
  }

  /** Контур осевой для мини-карты: n точек {x, z} */
  outline(n = 256): { x: number; z: number }[] {
    const res: { x: number; z: number }[] = [];
    for (let k = 0; k < n; k++) {
      const i = Math.floor((k / n) * this.count);
      res.push({ x: this.positions[i * 3], z: this.positions[i * 3 + 2] });
    }
    return res;
  }
}

function lerp3(arr: Float32Array, i0: number, i1: number, k: number, out: Vector3): Vector3 {
  const a = i0 * 3;
  const b = i1 * 3;
  return out.set(
    arr[a] + (arr[b] - arr[a]) * k,
    arr[a + 1] + (arr[b + 1] - arr[a + 1]) * k,
    arr[a + 2] + (arr[b + 2] - arr[a + 2]) * k,
  );
}
