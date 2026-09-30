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
import { PALETTE } from './palette';
import { GeometryBuilder } from './geometryBuilder';
import { uprightFrame } from './trackMesh';
import { SUN_DIR } from './sky';

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
      // грань смотрит наружу: обход a → b снизу вверх
      push(ax, y0, az, 0, 0, L);
      push(bx, y0, bz, L, 0, L);
      push(bx, y1, bz, L, 0, L);
      push(ax, y0, az, 0, 0, L);
      push(bx, y1, bz, L, 0, L);
      push(ax, y1, az, 0, 0, L);
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

export class Environment {
  readonly group = new Group();
  private readonly field: TrackDistanceField;

  constructor(readonly track: Track) {
    this.field = new TrackDistanceField(track);
    this.group.add(this.buildCity());
    this.group.add(this.buildProps());
  }

  private buildCity(): Mesh {
    const rand = rng(1337);
    const bb = new BuildingBuilder();
    const base = new Color();
    const accent = new Color();

    const place = (x: number, z: number, near: boolean) => {
      const w = 12 + rand() * (near ? 22 : 34);
      const d = 12 + rand() * (near ? 22 : 34);
      const r = Math.max(w, d) * 0.75;
      const dist = this.field.distance(x, z);
      if (dist < r + 16) return;
      const rot = rand() < 0.7 ? Math.round(rand() * 4) * (Math.PI / 2) + (rand() - 0.5) * 0.08 : rand() * Math.PI;
      let h = 9 + rand() * 24 + Math.min(80, Math.max(0, dist - 30) * 0.28);
      if (!near) h += 50 + rand() * 110;
      if (rand() < 0.06) h *= 1.8;
      base.set(BUILDING_COLORS[Math.floor(rand() * BUILDING_COLORS.length)]);
      accent.set(ACCENTS[Math.floor(rand() * ACCENTS.length)]);
      const seed = rand() * 100;
      const tiers = h > 60 && rand() < 0.6 ? (rand() < 0.4 ? 3 : 2) : 1;
      let y0 = -0.5;
      let tw = w;
      let td = d;
      for (let k = 0; k < tiers; k++) {
        const y1 = k === tiers - 1 ? h : y0 + (h - y0) * (0.55 + rand() * 0.15);
        bb.tier(x, z, tw, td, y0, y1, rot, base, accent, seed + k * 13);
        y0 = y1;
        tw *= 0.62 + rand() * 0.18;
        td *= 0.62 + rand() * 0.18;
      }
      // шпиль с огоньком на самых высоких
      if (h > 130) bb.tier(x, z, 1.2, 1.2, h, h + 18, rot, base, accent, seed + 99);
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
    // Дальний скайлайн по кольцу — вне сектора солнца
    for (let i = 0; i < 170; i++) {
      const a = rand() * Math.PI * 2;
      const da = Math.abs(Math.atan2(Math.sin(a - sunAz), Math.cos(a - sunAz)));
      if (da < 0.75) continue;
      const r = 850 + rand() * 450;
      place(Math.cos(a) * r - 60, Math.sin(a) * r, false);
    }

    return new Mesh(bb.build(), buildingMaterial());
  }

  private buildProps(): Mesh {
    const gb = new GeometryBuilder();
    const rand = rng(4242);
    const t = this.track;
    const sample = t.sampleAt(0);
    const m = new Matrix4();
    const p = new Vector3();

    // Пальмы вдоль трассы
    for (let s = 5; s < t.length; s += 17 + rand() * 12) {
      t.sampleAt(s, sample);
      if (sample.position.y > 1.0) continue;
      const side = rand() < 0.5 ? -1 : 1;
      const off = sample.halfWidth + 6 + rand() * 7;
      p.copy(sample.position).addScaledVector(sample.right, side * off);
      if (this.field.distance(p.x, p.z) < 4.5) continue;
      p.y = 0;
      addPalm(gb, p, rand);
    }

    // Фонари: через каждые ~46 м, чередуя стороны, лампа нависает над дорогой
    let flip = 1;
    for (let s = 20; s < t.length; s += 46) {
      t.sampleAt(s, sample);
      if (sample.position.y > 0.8) continue;
      flip = -flip;
      const off = sample.halfWidth + 1.9;
      p.copy(sample.position).addScaledVector(sample.right, flip * off);
      if (this.field.distance(p.x, p.z) < 1.2) continue;
      p.y = 0;
      uprightFrame(p, sample.tangent, m);
      // В локальном базисе: +X = влево от направления движения; дорога — в сторону −flip·X
      const inward = flip > 0 ? 1 : -1;
      const pole = new Color(0x2a1245);
      gb.cylinder(0.14, 0.22, 9, 6, pole, 0, new Matrix4().makeTranslation(0, 4.5, 0).premultiply(m));
      gb.box(0.18, 0.18, 0.18, pole, 0, new Matrix4().makeTranslation(0, 9, 0).premultiply(m));
      gb.box(2.6, 0.16, 0.2, pole, 0, new Matrix4().makeTranslation(inward * 1.2, 8.95, 0).premultiply(m));
      const lamp = (s / 46) % 2 < 1 ? PALETTE.pink : PALETTE.cyan;
      gb.box(1.1, 0.14, 0.42, lamp, 1, new Matrix4().makeTranslation(inward * 2.3, 8.8, 0).premultiply(m));
      gb.box(0.5, 0.12, 0.5, PALETTE.magenta, 0.8, new Matrix4().makeTranslation(0, 0.3, 0).premultiply(m));
    }

    const mat = new MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0.05, flatShading: true });
    const g = attribute('glow', 'float');
    mat.colorNode = vertexColor();
    mat.emissiveNode = vertexColor().mul(g).mul(1.3);
    return new Mesh(gb.build(), mat);
  }
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
