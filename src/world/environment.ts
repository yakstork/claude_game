/**
 * Окружение: low-poly город с процедурными окнами (TSL), пальмы и фонари.
 * Всё статичное слито в несколько мешей (минимум draw calls).
 */
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  Vector3,
} from 'three/webgpu';
import { attribute, color, floor, fract, hash, mix, sin, smoothstep, step, time, vertexColor } from 'three/tsl';
import type { Track } from './track';
import { Sea, shoreX, BEACH_WIDTH } from './sea';
import { PALETTE } from './palette';
import { GeometryBuilder } from './geometryBuilder';
import { uprightFrame } from './trackMesh';
import { SUN_DIR } from './sky';
import { GROUND_Y } from './constants';
import { SignBuilder } from './signs';
import { buildCanyon } from './canyon';

/** Детерминированный ГПСЧ (mulberry32) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Грубое поле расстояний до трассы (по горизонтали) для расстановки объектов */
class TrackDistanceField {
  private readonly cell = 8;
  private readonly half = 1600;
  private readonly size: number;
  private readonly data: Float32Array;
  private readonly heights: Float32Array;

  constructor(track: Track, maxR = 90) {
    this.size = Math.ceil((this.half * 2) / this.cell);
    this.data = new Float32Array(this.size * this.size).fill(1e9);
    this.heights = new Float32Array(this.size * this.size);
    const sample = track.sampleAt(0);
    const rc = Math.ceil(maxR / this.cell);
    for (let s = 0; s < track.length; s += 3) {
      track.sampleAt(s, sample);
      const { x, z, y } = sample.position;
      const cx = Math.floor((x + this.half) / this.cell);
      const cz = Math.floor((z + this.half) / this.cell);
      for (let dz = -rc; dz <= rc; dz++) {
        for (let dx = -rc; dx <= rc; dx++) {
          const ix = cx + dx;
          const iz = cz + dz;
          if (ix < 0 || iz < 0 || ix >= this.size || iz >= this.size) continue;
          const wx = (ix + 0.5) * this.cell - this.half;
          const wz = (iz + 0.5) * this.cell - this.half;
          const d = Math.hypot(wx - x, wz - z) - sample.halfWidth;
          const k = iz * this.size + ix;
          if (d < this.data[k]) {
            this.data[k] = d;
            this.heights[k] = y;
          }
        }
      }
    }
  }

  /** Расстояние от точки до края ближайшей дороги (≈, м) */
  distance(x: number, z: number): number {
    const ix = Math.floor((x + this.half) / this.cell);
    const iz = Math.floor((z + this.half) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.size || iz >= this.size) return 1e9;
    return this.data[iz * this.size + ix];
  }

  /** Высота ближайшей дороги */
  roadHeight(x: number, z: number): number {
    const ix = Math.floor((x + this.half) / this.cell);
    const iz = Math.floor((z + this.half) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.size || iz >= this.size) return 0;
    return this.heights[iz * this.size + ix];
  }
}

// ─── Здания ──────────────────────────────────────────────────────────────

const BUILDING_COLORS = [0x2b0f54, 0x24104a, 0x1d0b3a, 0x331463, 0x3a1a6e, 0x281050];
const ACCENTS = [PALETTE.magenta, PALETTE.cyan, PALETTE.pink, PALETTE.orange, PALETTE.lilac];

class BuildingBuilder {
  readonly pos: number[] = [];
  readonly bcol: number[] = [];
  readonly acc: number[] = [];
  readonly fac: number[] = [];

  /** Башня-ярус: прямоугольник w×d на высоте y0..y1, поворот rot, seed */
  tier(cx: number, cz: number, w: number, d: number, y0: number, y1: number, rot: number, base: Color, accent: Color, seed: number): void {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const corner = (lx: number, lz: number): [number, number] => [cx + lx * c - lz * s, cz + lx * s + lz * c];
    const hw = w / 2;
    const hd = d / 2;
    const pts = [corner(-hw, -hd), corner(hw, -hd), corner(hw, hd), corner(-hw, hd)];
    const lens = [w, d, w, d];
    const push = (x: number, y: number, z: number, u: number, face: number, width: number) => {
      this.pos.push(x, y, z);
      this.bcol.push(base.r, base.g, base.b);
      this.acc.push(accent.r, accent.g, accent.b);
      // u (м вдоль грани), высота над y0 тира… кодируем: [u, y, seed, face*1000 + width], + верх тира отдельно
      this.fac.push(u, y, seed, face, width, y1);
    };
    for (let i = 0; i < 4; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[(i + 1) % 4];
      const L = lens[i];
      // грань смотрит наружу (нормаль = up × (b − a)): a0 → a1 → b1, a0 → b1 → b0
      push(ax, y0, az, 0, 0, L);
      push(ax, y1, az, 0, 0, L);
      push(bx, y1, bz, L, 0, L);
      push(ax, y0, az, 0, 0, L);
      push(bx, y1, bz, L, 0, L);
      push(bx, y0, bz, L, 0, L);
    }
    // крыша
    const roof = (i: number) => pts[i];
    for (const [a, b, cc] of [
      [0, 2, 1],
      [0, 3, 2],
    ]) {
      for (const k of [a, b, cc]) push(roof(k)[0], y1, roof(k)[1], 0, 1, 0);
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('bcol', new Float32BufferAttribute(this.bcol, 3));
    g.setAttribute('acc', new Float32BufferAttribute(this.acc, 3));
    // fac разбит на два vec3: (u, y, seed) и (face, width, top)
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < this.fac.length; i += 6) {
      a.push(this.fac[i], this.fac[i + 1], this.fac[i + 2]);
      b.push(this.fac[i + 3], this.fac[i + 4], this.fac[i + 5]);
    }
    g.setAttribute('facA', new Float32BufferAttribute(a, 3));
    g.setAttribute('facB', new Float32BufferAttribute(b, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

function buildingMaterial(): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0.15, flatShading: true });
  const A = attribute('facA', 'vec3');
  const B = attribute('facB', 'vec3');
  const u = A.x;
  const y = A.y;
  const seed = A.z;
  const isRoof = step(0.5, B.x);
  const width = B.y;
  const top = B.z;
  const base = attribute('bcol', 'vec3');
  const accent = attribute('acc', 'vec3');

  const cw = 3.4;
  const ch = 3.8;
  const fu = fract(u.div(cw));
  const fv = fract(y.div(ch));
  const win = step(0.2, fu).mul(step(fu, 0.8)).mul(step(0.3, fv)).mul(step(fv, 0.75));
  const id = floor(u.div(cw)).add(floor(y.div(ch)).mul(57.0)).add(seed.mul(131.0));
  const r = hash(id);
  const lit = step(0.6, r);
  // редкое мерцание
  const flicker = step(0.985, hash(id.add(floor(time.mul(2.0))))).oneMinus();
  const winCol = mix(mix(color(PALETTE.orange), color(PALETTE.pink), hash(id.mul(1.7))), color(PALETTE.cyan), step(0.86, hash(id.mul(3.1))));
  // не у земли, не у самой крыши, не у углов
  const inFacade = step(3.0, y).mul(step(y, top.sub(1.6))).mul(step(1.0, u)).mul(step(u, width.sub(1.0)));
  const windows = win.mul(lit).mul(flicker).mul(inFacade).mul(isRoof.oneMinus());
  const darkWin = win.mul(inFacade).mul(isRoof.oneMinus()).mul(lit.oneMinus());
  // неоновая кромка крыши тира и вертикальные рёбра на углах
  const roofStripe = smoothstep(top.sub(0.9), top.sub(0.7), y).mul(isRoof.oneMinus());
  const edge = step(u, 0.35).add(step(width.sub(0.35), u)).mul(isRoof.oneMinus()).mul(step(0.5, hash(seed.mul(7.3))));
  const pulse = sin(time.mul(1.5).add(seed.mul(10.0))).mul(0.2).add(0.8);

  const glow = winCol.mul(windows).mul(0.9).add(accent.mul(roofStripe.add(edge.mul(0.6))).mul(pulse));
  const wall = mix(base, base.mul(0.55), darkWin);
  mat.colorNode = mix(wall, base.mul(0.7), isRoof).add(glow.mul(0.5));
  mat.emissiveNode = glow;
  return mat;
}

/** Материал статичного декора: vertex colors + свечение; glow ≥ 2 — мигающий огонь (фаза = дробная часть) */
function propsMaterial(): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0.05, flatShading: true });
  const g = attribute('glow', 'float');
  const isBlink = step(1.5, g);
  const on = step(0.45, fract(time.mul(0.9).add(fract(g))));
  const amount = mix(g, on.mul(1.4), isBlink);
  mat.colorNode = vertexColor();
  mat.emissiveNode = vertexColor().mul(amount).mul(1.3);
  return mat;
}

const _m = new Matrix4();
const _r = new Matrix4();
const UP = new Vector3(0, 1, 0);

export class Environment {
  readonly group = new Group();
  private readonly field: TrackDistanceField;
  /** Весь статичный декор (детали крыш, пальмы, фонари, трибуны, знаки…) — один меш */
  private readonly props = new GeometryBuilder();
  private readonly signs = new SignBuilder();
  private signIndex = 0;
  /** Участки трассы [s0, s1], занятые трибунами/парковками — там без пальм */
  private readonly reserved: [number, number][] = [];

  /** Трасса-побережье: море с восточной (внешней) стороны, город — только с другой */
  private readonly isCoast: boolean;
  /** Каньон: скалы вместо небоскрёбов, без пальм */
  private readonly isCanyon: boolean;

  constructor(readonly track: Track) {
    this.isCoast = track.id === 'coast';
    this.isCanyon = track.id === 'canyon';
    this.field = new TrackDistanceField(track);
    this.buildTrackside();
    if (this.isCanyon) this.group.add(buildCanyon(track));
    else this.group.add(this.buildCity());
    this.buildProps();
    if (this.isCoast) {
      this.buildBeach();
      this.group.add(new Sea().group);
    }
    this.group.add(new Mesh(this.props.build(), propsMaterial()));
    const signs = this.signs.build();
    if (signs) this.group.add(signs);
  }

  private isReserved(s: number): boolean {
    const L = this.track.length;
    for (const [a, b] of this.reserved) {
      const d = this.track.deltaS(a, s);
      if (d >= 0 && d <= (((b - a) % L) + L) % L) return true;
    }
    return false;
  }

  private nextSign(): number {
    return this.signIndex++ * 5;
  }

  // ─── Город ─────────────────────────────────────────────────────────────

  private buildCity(): Mesh {
    const rand = rng(1337);
    const bb = new BuildingBuilder();
    const base = new Color();
    const accent = new Color();
    const probe = new Vector3();

    const place = (x: number, z: number, near: boolean) => {
      const w = 12 + rand() * (near ? 22 : 34);
      const d = 12 + rand() * (near ? 22 : 34);
      const r = Math.max(w, d) * 0.75;
      if (this.isCoast && x + r > shoreX(z) - BEACH_WIDTH - 4) return;
      const dist = this.field.distance(x, z);
      if (dist < r + 16) return;
      const rot = rand() < 0.7 ? Math.round(rand() * 4) * (Math.PI / 2) + (rand() - 0.5) * 0.08 : rand() * Math.PI;
      const c = Math.cos(rot);
      const sn = Math.sin(rot);
      const off = (lx: number, lz: number): [number, number] => [x + lx * c - lz * sn, z + lx * sn + lz * c];
      let h = 9 + rand() * 24 + Math.min(80, Math.max(0, dist - 30) * 0.28);
      if (!near) h += 50 + rand() * 110;
      if (rand() < 0.06) h *= 1.8;
      base.set(BUILDING_COLORS[Math.floor(rand() * BUILDING_COLORS.length)]);
      accent.set(ACCENTS[Math.floor(rand() * ACCENTS.length)]);
      const seed = rand() * 100;
      // LOD: ближний ряд у трассы — с деталями на крышах
      const lod = near && dist < 170;
      const T = (cx: number, cz: number, tw: number, td: number, y0: number, y1: number, sd: number) =>
        bb.tier(cx, cz, tw, td, y0, y1, rot, base, accent, sd);
      const kind = rand();
      const Y0 = GROUND_Y - 0.5;

      if (kind < 0.38 || (!near && kind < 0.7)) {
        // ступенчатая башня с уступами
        const tiers = h > 45 && rand() < 0.7 ? (rand() < 0.45 ? 3 : 2) : 1;
        let y0 = Y0;
        let tw = w;
        let td = d;
        for (let k = 0; k < tiers; k++) {
          const y1 = k === tiers - 1 ? h : y0 + (h - y0) * (0.5 + rand() * 0.2);
          T(x, z, tw, td, y0, y1, seed + k * 13);
          if (lod && k < tiers - 1) this.roofDetails(x, z, tw, td, y1, rot, accent, rand, false);
          y0 = y1;
          tw *= 0.6 + rand() * 0.2;
          td *= 0.6 + rand() * 0.2;
        }
        if (lod) this.roofDetails(x, z, tw / (0.7), td / 0.7, h, rot, accent, rand, true, probe.set(x, 0, z));
      } else if (kind < 0.58) {
        // башня + низкая пристройка сбоку
        const [tx, tz] = off(-w * 0.2, 0);
        T(tx, tz, w * 0.58, d * 0.64, Y0, h, seed);
        const [ax, az] = off(w * 0.3, 0);
        const ah = Math.max(6, h * (0.22 + rand() * 0.18));
        T(ax, az, w * 0.42, d * 0.92, Y0, ah, seed + 7);
        if (lod) {
          this.roofDetails(ax, az, w * 0.42, d * 0.92, ah, rot, accent, rand, true, probe.set(ax, 0, az));
          this.roofDetails(tx, tz, w * 0.58, d * 0.64, h, rot, accent, rand, false);
        }
      } else if (kind < 0.78) {
        // башни-близнецы на общем подиуме
        const ph = Math.max(5, h * 0.2);
        T(x, z, w, d, Y0, ph, seed);
        const [ax, az] = off(-w * 0.24, 0);
        const [bx, bz] = off(w * 0.24, 0);
        const h2 = h * (0.68 + rand() * 0.2);
        T(ax, az, w * 0.38, d * 0.6, ph, h, seed + 3);
        T(bx, bz, w * 0.38, d * 0.6, ph, h2, seed + 5);
        if (lod) {
          this.roofDetails(ax, az, w * 0.38, d * 0.6, h, rot, accent, rand, false);
          this.roofDetails(bx, bz, w * 0.38, d * 0.6, h2, rot, accent, rand, true, probe.set(bx, 0, bz));
        }
      } else {
        // башня с «короной» и шпилем
        T(x, z, w * 0.8, d * 0.8, Y0, h, seed);
        T(x, z, w * 0.56, d * 0.56, h, h + 4, seed + 2);
        T(x, z, w * 0.32, d * 0.32, h + 4, h + 8, seed + 4);
        this.antenna(x, z, h + 8, 6 + rand() * 10, rand);
      }
      // шпиль с огоньком на самых высоких
      if (h > 120) {
        bb.tier(x, z, 1.2, 1.2, h, h + 18, rot, base, accent, seed + 99);
        this.props.box(0.9, 0.9, 0.9, PALETTE.magenta, 2 + rand(), _m.makeTranslation(x, h + 18.5, z));
      }
    };

    // Ближний город вокруг трассы. К востоку от трассы (x > 330) — пусто:
    // неоновая сетка уходит к горизонту прямо под солнце.
    const sunAz = Math.atan2(SUN_DIR.z, SUN_DIR.x);
    for (let gx = -760; gx <= 330; gx += 42) {
      for (let gz = -560; gz <= 520; gz += 42) {
        const x = gx + (rand() - 0.5) * 22;
        const z = gz + (rand() - 0.5) * 22;
        if (rand() < 0.32) continue;
        place(x, z, true);
      }
    }
    // Дальний скайлайн по кольцу — вне сектора солнца, без деталей (LOD)
    for (let i = 0; i < 170; i++) {
      const a = rand() * Math.PI * 2;
      const da = Math.abs(Math.atan2(Math.sin(a - sunAz), Math.cos(a - sunAz)));
      if (da < 0.75) continue;
      const r = 850 + rand() * 450;
      place(Math.cos(a) * r - 60, Math.sin(a) * r, false);
    }

    return new Mesh(bb.build(), buildingMaterial());
  }

  /** Антенна с мигающим огнём */
  private antenna(x: number, z: number, y: number, hgt: number, rand: () => number): void {
    const gb = this.props;
    gb.box(0.16, hgt, 0.16, 0x4a3a66, 0, _m.makeTranslation(x, y + hgt / 2, z));
    gb.box(1.2, 0.08, 0.08, 0x4a3a66, 0, _m.makeTranslation(x, y + hgt * 0.7, z));
    gb.box(0.4, 0.4, 0.4, rand() < 0.5 ? PALETTE.magenta : 0xff3b3b, 2 + rand(), _m.makeTranslation(x, y + hgt + 0.2, z));
  }

  /** Детали крыши: кондиционеры, антенны, бак, иногда билборд лицом к трассе */
  private roofDetails(
    cx: number,
    cz: number,
    w: number,
    d: number,
    y: number,
    rot: number,
    accent: Color,
    rand: () => number,
    allowSign: boolean,
    at?: Vector3,
  ): void {
    const gb = this.props;
    _r.makeRotationY(-rot);
    const place = (lx: number, ly: number, lz: number) => {
      const c = Math.cos(rot);
      const sn = Math.sin(rot);
      return _m.copy(_r).setPosition(cx + lx * c - lz * sn, y + ly, cz + lx * sn + lz * c);
    };
    const ac = new Color(0x3b2a5a);
    const n = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const lx = (rand() - 0.5) * w * 0.6;
      const lz = (rand() - 0.5) * d * 0.6;
      const sx = 1.4 + rand() * 1.4;
      const sz = 1.2 + rand() * 1.2;
      gb.box(sx, 1.0, sz, ac, 0, place(lx, 0.5, lz));
      gb.box(sx * 0.55, 0.12, sz * 0.55, 0x1a1026, 0, place(lx, 1.06, lz));
      gb.box(sx * 1.02, 0.08, 0.08, accent, 0.5, place(lx, 0.1, lz + sz / 2));
    }
    if (rand() < 0.45) {
      const lx = (rand() - 0.5) * w * 0.5;
      const lz = (rand() - 0.5) * d * 0.5;
      const c = Math.cos(rot);
      const sn = Math.sin(rot);
      this.antenna(cx + lx * c - lz * sn, cz + lx * sn + lz * c, y, 3 + rand() * 7, rand);
    }
    if (rand() < 0.22) {
      const lx = (rand() - 0.5) * w * 0.4;
      const lz = (rand() - 0.5) * d * 0.4;
      gb.cylinder(1.1, 1.1, 2.0, 8, 0x4a2a6a, 0, place(lx, 2.2, lz));
      for (const [qx, qz] of [
        [-0.7, -0.7],
        [0.7, -0.7],
        [0.7, 0.7],
        [-0.7, 0.7],
      ])
        gb.box(0.12, 1.2, 0.12, 0x2a1a40, 0, place(lx + qx, 0.6, lz + qz));
    }
    // билборд на крыше лицом к ближайшему участку трассы
    if (allowSign && at && w > 13 && rand() < 0.45) {
      const pr = this.track.project(at);
      const nx = pr.sample.position.x - at.x;
      const nz = pr.sample.position.z - at.z;
      const len = Math.hypot(nx, nz) || 1;
      const normal = new Vector3(nx / len, 0, nz / len);
      const right = new Vector3().crossVectors(UP, normal).normalize();
      const sw = Math.min(14, w * 0.85);
      const sh = sw / 4;
      const center = new Vector3(cx, y + 1.6 + sh / 2, cz).addScaledVector(normal, d * 0.2);
      this.billboard(center, right, normal, sw, sh);
    }
  }

  /** Билборд: вывеска из атласа + тёмная рама, опоры и неоновая планка */
  private billboard(center: Vector3, right: Vector3, normal: Vector3, w: number, h: number, postsTo?: number): void {
    const gb = this.props;
    const up = new Vector3().crossVectors(normal, right).normalize();
    _m.makeBasis(right, up, normal).setPosition(center.x - normal.x * 0.2, center.y, center.z - normal.z * 0.2);
    gb.box(w + 0.5, h + 0.5, 0.3, 0x160a2e, 0, _m);
    gb.box(w + 0.6, 0.12, 0.35, PALETTE.cyan, 1, _r.copy(_m).multiply(new Matrix4().makeTranslation(0, -h / 2 - 0.3, 0.05)));
    const bottom = postsTo ?? center.y - h / 2 - 1.6;
    const postH = center.y - h / 2 - bottom;
    for (const sx of [-w * 0.32, w * 0.32]) {
      gb.box(0.3, postH, 0.3, 0x2a1245, 0, _r.copy(_m).multiply(new Matrix4().makeTranslation(sx, -h / 2 - postH / 2, -0.2)));
    }
    this.signs.add(center, right, normal, w, h, this.nextSign());
  }

  // ─── Окружение у трассы ────────────────────────────────────────────────

  private buildTrackside(): void {
    const t = this.track;
    const gb = this.props;
    const rand = rng(777);
    const sample = t.sampleAt(0);
    const frame = new Matrix4();
    const p = new Vector3();
    const local = (x: number, y: number, z: number) => _m.copy(frame).multiply(_r.makeTranslation(x, y, z));
    const G = GROUND_Y;

    // Трибуны у старта: слева длинная, справа короче. Локально +X — влево.
    for (const side of [1, -1]) {
      const len = side > 0 ? 72 : 46;
      const s0 = side > 0 ? -48 : -30;
      const sc = s0 + len / 2;
      t.sampleAt(sc, sample);
      p.copy(sample.position);
      p.y = G;
      uprightFrame(p, sample.tangent, frame);
      const x0 = sample.halfWidth + 4.2;
      const rows = side > 0 ? 7 : 5;
      // передняя стенка с неоном
      gb.box(0.4, 1.4, len, 0x2b0f54, 0, local(side * x0, 0.7, 0));
      gb.box(0.45, 0.14, len, PALETTE.magenta, 1, local(side * (x0 - 0.05), 1.3, 0));
      for (let k = 0; k < rows; k++) {
        const xk = side * (x0 + 0.8 + k * 1.5);
        const top = 1.2 + k * 0.9;
        gb.box(1.5, top, len, k % 2 ? 0x2a1250 : 0x331463, 0, local(xk, top / 2, 0));
        // зрители — яркие «пиксели»
        for (let zz = -len / 2 + 0.8; zz < len / 2 - 0.5; zz += 0.9 + rand() * 0.5) {
          if (rand() < 0.2) continue;
          const col = ACCENTS[Math.floor(rand() * ACCENTS.length)];
          const hgt = 0.6 + rand() * 0.35;
          gb.box(0.45, hgt, 0.42, col, 0.25, local(xk + side * (rand() - 0.5) * 0.4, top + hgt / 2, zz));
        }
      }
      // навес на опорах
      const back = side * (x0 + 0.8 + rows * 1.5);
      const roofY = 1.2 + rows * 0.9 + 3.2;
      for (let zz = -len / 2; zz <= len / 2; zz += 12) gb.box(0.35, roofY, 0.35, 0x2a1245, 0, local(back, roofY / 2, zz));
      const depth = rows * 1.5 + 2.4;
      gb.box(depth, 0.35, len + 2, 0x1d0b3a, 0, local(side * (x0 + depth / 2 - 0.4), roofY, 0));
      gb.box(0.2, 0.2, len + 2, PALETTE.cyan, 1, local(side * (x0 - 0.45), roofY - 0.1, 0));
      this.reserved.push([t.wrapS(s0 - 8), t.wrapS(s0 + len + 8)]);
    }

    // Светящиеся стрелки на внешней стороне крутых поворотов
    let chevron = 0;
    for (let s = 0; s < t.length; s += 7) {
      const k = t.curvatureAt(s);
      if (Math.abs(k) < 1 / 95) continue;
      t.sampleAt(s, sample);
      if (sample.position.y > 1.5) continue;
      const outer = k > 0 ? 1 : -1; // правый поворот → внешняя сторона слева (+X локально)
      p.copy(sample.position).addScaledVector(sample.right, -outer * (sample.halfWidth + 1.9));
      const roadY = p.y;
      p.y = G;
      uprightFrame(p, sample.tangent, frame);
      const hb = roadY - G + 1.7;
      for (const px of [-0.9, 0.9]) gb.box(0.12, hb, 0.12, 0x2a1245, 0, local(px, hb / 2, 0.1));
      gb.box(2.3, 1.25, 0.12, 0x12052a, 0, local(0, hb, 0.1));
      // «>» указывает в сторону поворота: вправо по ходу = −X локально
      const dir = k > 0 ? -1 : 1;
      const phase = 2 + ((chevron * 0.17) % 1);
      for (const [cx, sgn] of [
        [-0.45, 1],
        [0.35, 1],
      ]) {
        for (const vy of [1, -1]) {
          const a = Math.atan2(0.3, 0.5) * vy * sgn * -dir;
          const m2 = local(cx * dir + 0.0, hb + vy * 0.15, 0.03).multiply(new Matrix4().makeRotationZ(a));
          gb.box(0.62, 0.17, 0.05, chevron % 2 ? PALETTE.yellow : PALETTE.orange, phase, m2);
        }
      }
      chevron++;
    }

    // Парковки у задней прямой и за шпилькой: ряды машин носом к трассе
    const lots: [number, number, number][] = [
      [1700, 10, 1],
      [1760, 8, -1],
      [880, 6, 1],
    ];
    for (const [ls, count, side] of lots) {
      this.reserved.push([t.wrapS(ls - 6), t.wrapS(ls + count * 3.2 + 6)]);
      for (let i = 0; i < count; i++) {
        const s = ls + i * 3.2;
        t.sampleAt(s, sample);
        p.copy(sample.position).addScaledVector(sample.right, -side * (sample.halfWidth + 10.5));
        if (this.field.distance(p.x, p.z) < 7) continue;
        p.y = G;
        uprightFrame(p, sample.tangent, frame);
        // разметка
        gb.box(0.12, 0.03, 5.2, PALETTE.lilac, 0.5, local(0, 0.02, 1.6).multiply(new Matrix4().makeRotationY(Math.PI / 2)));
        if (rand() < 0.15) continue;
        // машина носом к дороге: локальный +Z машины → в сторону дороги (−side·X)
        const carM = local(0, 0, 0).multiply(new Matrix4().makeRotationY(side > 0 ? -Math.PI / 2 : Math.PI / 2));
        parkedCar(gb, carM, rand);
      }
    }

    // Декор под эстакадой: световые балки под настилом, неоновые тумбы и ящики
    let lastDecor = -100;
    for (let s = 0; s < t.length; s += 4) {
      t.sampleAt(s, sample);
      if (sample.position.y < 6) continue;
      if (s - lastDecor < 12) continue;
      lastDecor = s;
      p.copy(sample.position);
      uprightFrame(p, sample.tangent, frame);
      gb.box(sample.halfWidth * 1.7, 0.16, 0.3, PALETTE.cyan, 1, local(0, -1.5, 0));
      // тумбы на земле по бокам (если там не другая дорога)
      for (const side of [-1, 1]) {
        const q = p.clone().addScaledVector(sample.right, side * (sample.halfWidth - 2));
        q.y = 0;
        const pr = t.project(q);
        if (Math.abs(pr.height) < 1 && Math.abs(pr.lateral) < pr.sample.halfWidth + 2) continue;
        const gy = G - sample.position.y;
        gb.cylinder(0.3, 0.35, 1.0, 6, 0x2a1245, 0, local(side * -(sample.halfWidth - 2), gy + 0.5, 0));
        gb.cylinder(0.32, 0.32, 0.18, 6, rand() < 0.5 ? PALETTE.magenta : PALETTE.cyan, 1, local(side * -(sample.halfWidth - 2), gy + 1.05, 0));
        if (rand() < 0.5) gb.box(1.4, 0.9, 1.0, 0x3a1a5e, 0, local(side * -(sample.halfWidth - 4.5), gy + 0.45, (rand() - 0.5) * 3));
      }
    }

    // Световые тоннели: частые неоновые арки с бегущими огнями
    for (const [f0, f1] of t.def.tunnels ?? []) {
      const s0 = f0 * t.length;
      const s1 = f1 * t.length;
      this.reserved.push([t.wrapS(s0 - 4), t.wrapS(s1 + 4)]);
      let k = 0;
      for (let s = s0; s <= s1; s += 6, k++) {
        t.sampleAt(s, sample);
        uprightFrame(sample.position, sample.tangent, frame);
        const hw = sample.halfWidth + 1.3;
        const H = 7.5;
        const neon = k % 2 ? PALETTE.cyan : PALETTE.magenta;
        // фаза мигания бежит вдоль тоннеля — «световая волна» навстречу машине
        const wave = 2 + ((k * 0.11) % 1);
        for (const side of [-1, 1]) {
          gb.box(0.6, H + 1.2, 0.6, 0x1d0b3a, 0, local(side * hw, (H - 1.2) / 2, 0));
          gb.box(0.18, H - 0.6, 0.18, neon, 1, local(side * (hw - 0.4), H / 2, 0));
          // скосы к потолку
          gb.box(0.5, 0.5, 0.5, 0x1d0b3a, 0, local(side * (hw - 1.4), H - 0.6, 0).multiply(new Matrix4().makeRotationZ(Math.PI / 4)));
        }
        gb.box(hw * 2 - 1.6, 0.6, 0.6, 0x1d0b3a, 0, local(0, H, 0));
        gb.box(hw * 2 - 2.2, 0.16, 0.16, neon, 1, local(0, H - 0.42, 0));
        gb.box(1.6, 0.12, 0.3, PALETTE.yellow, wave, local(0, H - 0.5, 0.25));
      }
    }

    // Придорожные билборды на прямых, лицом к едущим
    let flip = 1;
    for (let s = 60; s < t.length; s += 150) {
      if (Math.abs(t.curvatureAt(s)) > 1 / 300 || this.isReserved(s)) continue;
      t.sampleAt(s, sample);
      if (sample.position.y > 1) continue;
      flip = -flip;
      const lat = flip * (sample.halfWidth + 8);
      p.copy(sample.position).addScaledVector(sample.right, lat);
      if (this.field.distance(p.x, p.z) < 6) continue;
      const tH = new Vector3(sample.tangent.x, 0, sample.tangent.z).normalize();
      const right = new Vector3().crossVectors(tH, UP).normalize();
      const normal = tH.clone().negate();
      p.y = G + 7 + 1.75;
      this.billboard(p.clone(), right, normal, 14, 3.5, G);
    }
  }

  // ─── Пальмы и фонари ───────────────────────────────────────────────────

  /** Пляж и набережная: пальмы и фонари вдоль берега */
  private buildBeach(): void {
    const gb = this.props;
    const rand = rng(777);
    const p = new Vector3();
    const pole = new Color(0x2a1245);
    for (let z = -520; z < 260; z += 16 + rand() * 14) {
      p.set(shoreX(z) - 7 - rand() * (BEACH_WIDTH - 12), GROUND_Y + 0.3, z);
      if (this.field.distance(p.x, p.z) < 6) continue;
      addPalm(gb, p, rand);
    }
    // набережная: фонари вдоль кромки пляжа
    for (let z = -520; z < 260; z += 34) {
      const x = shoreX(z) - BEACH_WIDTH + 2;
      if (this.field.distance(x, z) < 3) continue;
      const lamp = (Math.round(z / 34) & 1) === 0 ? PALETTE.pink : PALETTE.cyan;
      gb.cylinder(0.14, 0.2, 7.5, 6, pole, 0, new Matrix4().makeTranslation(x, GROUND_Y + 4.0, z));
      gb.box(0.9, 0.18, 0.9, lamp, 1.2, new Matrix4().makeTranslation(x, GROUND_Y + 7.7, z));
      gb.box(0.5, 0.12, 0.5, PALETTE.magenta, 0.8, new Matrix4().makeTranslation(x, GROUND_Y + 0.8, z));
    }
  }

  private buildProps(): void {
    const gb = this.props;
    const rand = rng(4242);
    const t = this.track;
    const sample = t.sampleAt(0);
    const m = new Matrix4();
    const p = new Vector3();

    // Пальмы вдоль трассы
    for (let s = 5; s < t.length; s += 17 + rand() * 12) {
      t.sampleAt(s, sample);
      if (this.isCanyon || sample.position.y > 1.0 || this.isReserved(s)) continue;
      const side = rand() < 0.5 ? -1 : 1;
      const off = sample.halfWidth + 6 + rand() * 7;
      p.copy(sample.position).addScaledVector(sample.right, side * off);
      if (this.field.distance(p.x, p.z) < 4.5) continue;
      p.y = GROUND_Y;
      addPalm(gb, p, rand);
    }

    // Фонари: через каждые ~46 м, чередуя стороны, лампа нависает над дорогой
    let flip = 1;
    for (let s = 20; s < t.length; s += 46) {
      t.sampleAt(s, sample);
      if (sample.position.y > 0.8 || this.isReserved(s)) continue;
      flip = -flip;
      const off = sample.halfWidth + 1.9;
      p.copy(sample.position).addScaledVector(sample.right, flip * off);
      if (this.field.distance(p.x, p.z) < 1.2) continue;
      p.y = GROUND_Y;
      uprightFrame(p, sample.tangent, m);
      // В локальном базисе: +X = влево от направления движения; дорога — в сторону −flip·X
      const inward = flip > 0 ? 1 : -1;
      const pole = new Color(0x2a1245);
      gb.cylinder(0.14, 0.22, 9.5, 6, pole, 0, new Matrix4().makeTranslation(0, 4.75, 0).premultiply(m));
      gb.box(0.18, 0.18, 0.18, pole, 0, new Matrix4().makeTranslation(0, 9.5, 0).premultiply(m));
      gb.box(2.6, 0.16, 0.2, pole, 0, new Matrix4().makeTranslation(inward * 1.2, 9.45, 0).premultiply(m));
      const lamp = (s / 46) % 2 < 1 ? PALETTE.pink : PALETTE.cyan;
      gb.box(1.1, 0.14, 0.42, lamp, 1, new Matrix4().makeTranslation(inward * 2.3, 9.3, 0).premultiply(m));
      gb.box(0.5, 0.12, 0.5, PALETTE.magenta, 0.8, new Matrix4().makeTranslation(0, 0.3, 0).premultiply(m));
    }
  }
}

/** Припаркованная low-poly машина (носом по +Z матрицы m, на земле) */
function parkedCar(gb: GeometryBuilder, m: Matrix4, rand: () => number): void {
  const bodies = [PALETTE.magenta, PALETTE.cyan, PALETTE.orange, PALETTE.lilac, PALETTE.yellow, PALETTE.pink, 0x3a1a6e];
  const body = new Color(bodies[Math.floor(rand() * bodies.length)]).multiplyScalar(0.75);
  const neon = ACCENTS[Math.floor(rand() * ACCENTS.length)];
  const L = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z).premultiply(m);
  const wedge = rand() < 0.5;
  if (wedge) {
    gb.prism(
      [
        [-2.1, 0.2],
        [2.1, 0.2],
        [2.15, 0.45],
        [0.9, 0.75],
        [-1.9, 0.95],
        [-2.1, 0.85],
      ],
      0.88,
      body,
      0,
      m,
    );
  } else {
    gb.box(1.8, 0.6, 4.3, body, 0, L(0, 0.55, 0));
  }
  gb.prism(
    [
      [-1.2, 0.8],
      [0.6, 0.78],
      [-0.1, 1.28],
      [-0.95, 1.28],
    ],
    0.7,
    0x120726,
    0,
    m,
    0.15,
  );
  for (const [x, z] of [
    [0.82, 1.35],
    [-0.82, 1.35],
    [0.82, -1.35],
    [-0.82, -1.35],
  ]) {
    gb.cylinder(0.33, 0.33, 0.26, 8, 0x0e0a16, 0, L(x, 0.33, z).multiply(new Matrix4().makeRotationZ(Math.PI / 2)));
  }
  gb.box(1.5, 0.08, 0.05, 0xff1f4f, 1, L(0, 0.7, -2.16));
  gb.box(1.3, 0.06, 0.05, 0xfff4d6, 0.9, L(0, 0.45, 2.18));
  gb.box(0.04, 0.05, 3.2, neon, 0.8, L(0.92, 0.22, 0));
  gb.box(0.04, 0.05, 3.2, neon, 0.8, L(-0.92, 0.22, 0));
}

/** Низкополигональная пальма с изогнутым стволом и поникшими листьями */
function addPalm(gb: GeometryBuilder, base: Vector3, rand: () => number): void {
  const height = 9 + rand() * 6;
  const lean = 0.8 + rand() * 1.8;
  const dir = rand() * Math.PI * 2;
  const lx = Math.cos(dir);
  const lz = Math.sin(dir);
  const segs = 7;
  const trunkA = new Color(0x5a2a6e);
  const trunkB = new Color(0x40195a);
  let prev = base.clone();
  const m = new Matrix4();
  const up = new Vector3(0, 1, 0);
  const q = new Vector3();
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const curve = lean * t * t;
    const next = new Vector3(base.x + lx * curve, base.y + height * t, base.z + lz * curve);
    const mid = prev.clone().add(next).multiplyScalar(0.5);
    const segLen = prev.distanceTo(next);
    q.subVectors(next, prev).normalize();
    m.makeRotationAxis(new Vector3().crossVectors(up, q).normalize(), Math.acos(Math.min(1, up.dot(q))));
    m.setPosition(mid);
    const r0 = 0.34 * (1 - t * 0.45);
    gb.cylinder(r0 * 0.86, r0, segLen * 1.02, 5, i % 2 ? trunkA : trunkB, 0, m, false);
    prev = next;
  }
  const top = prev;
  // «кокосы» и светящееся кольцо
  gb.cylinder(0.42, 0.3, 0.4, 6, PALETTE.cyan, 0.6, new Matrix4().makeTranslation(top.x, top.y - 0.2, top.z), true);
  // листья
  const fronds = 8;
  const leafA = new Color(0x3b1670);
  const leafB = new Color(0x52208f);
  for (let k = 0; k < fronds; k++) {
    const a = (k / fronds) * Math.PI * 2 + rand() * 0.4;
    const len = 4.2 + rand() * 1.6;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const px = -sa;
    const pz = ca;
    const w = 0.85;
    const midP = new Vector3(top.x + ca * len * 0.5, top.y + 0.9, top.z + sa * len * 0.5);
    const tip = new Vector3(top.x + ca * len, top.y - 1.4 - rand(), top.z + sa * len);
    const l1 = midP.clone().add(new Vector3(px * w, -0.15, pz * w));
    const r1 = midP.clone().add(new Vector3(-px * w, -0.15, -pz * w));
    const col = k % 2 ? leafA : leafB;
    gb.tri(top, l1, midP, col, 0);
    gb.tri(top, midP, r1, col, 0);
    gb.tri(midP, l1, tip, col, 0);
    gb.tri(midP, tip, r1, col, 0);
    // светящаяся прожилка у кончика
    const rib = midP.clone().lerp(tip, 0.55);
    gb.tri(rib, tip, rib.clone().add(new Vector3(px * 0.2, 0.06, pz * 0.2)), PALETTE.pink, 0.9);
    gb.tri(rib, rib.clone().add(new Vector3(-px * 0.2, 0.06, -pz * 0.2)), tip, PALETTE.pink, 0.9);
  }
}
