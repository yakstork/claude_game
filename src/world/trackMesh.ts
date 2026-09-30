/**
 * Геометрия трассы по сплайну: дорога (TSL-разметка), светящиеся ограждения
 * с бегущими шевронами в поворотах, опоры эстакады, арки чекпоинтов, стартовые ворота.
 */
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  Vector3,
} from 'three/webgpu';
import {
  abs,
  attribute,
  clamp,
  color,
  float,
  floor,
  fract,
  hash,
  mix,
  mod,
  positionWorld,
  sin,
  smoothstep,
  step,
  time,
  vertexColor,
} from 'three/tsl';
import type { Track } from './track';
import { PALETTE } from './palette';
import { GeometryBuilder, frameMatrix } from './geometryBuilder';

import { BARRIER_OFFSET } from './constants';
export { BARRIER_OFFSET };
const BARRIER_HEIGHT = 1.05;
const BARRIER_THICK = 0.55;
const DECK = 1.3;
const STEP = 2;

export class TrackMesh {
  readonly group = new Group();

  constructor(readonly track: Track) {
    this.group.add(this.buildRoad());
    this.group.add(this.buildBarriers());
    this.group.add(this.buildStructures());
  }

  // ─── Дорога ────────────────────────────────────────────────────────────
  private buildRoad(): Mesh {
    const t = this.track;
    const pos: number[] = [];
    const road: number[] = [];
    const idx: number[] = [];
    const n = Math.floor(t.count / STEP);
    const sample = t.sampleAt(0);
    const L = new Vector3();
    const R = new Vector3();
    for (let k = 0; k <= n; k++) {
      const s = k === n ? t.length : k * STEP * t.step;
      t.sampleAt(s % t.length, sample);
      const hw = sample.halfWidth + BARRIER_OFFSET;
      L.copy(sample.position).addScaledVector(sample.right, -hw);
      R.copy(sample.position).addScaledVector(sample.right, hw);
      pos.push(L.x, L.y + 0.02, L.z, R.x, R.y + 0.02, R.z);
      road.push(-hw, s, sample.halfWidth, hw, s, sample.halfWidth);
      if (k < n) {
        const a = k * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('road', new Float32BufferAttribute(road, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const mat = new MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.35, side: DoubleSide });
    const attr = attribute('road', 'vec3');
    const lat = attr.x;
    const s = attr.y;
    const hw = attr.z;
    const alat = abs(lat);
    const edgeDist = hw.sub(alat);

    // асфальт: тёмный фиолетовый с зерном и лёгкими поперечными стыками
    const grain = hash(floor(positionWorld.x.mul(7.0)).add(floor(positionWorld.z.mul(7.0)).mul(31.7))).mul(0.022);
    const seams = smoothstep(0.03, 0.0, abs(fract(s.div(24.0)).sub(0.5)).sub(0.49)).mul(0.03);
    const asphalt = color(PALETTE.asphalt).add(grain).add(seams);

    // неоновые края: широкая циан-линия и тонкая маджента внутри
    const edge = smoothstep(0.72, 0.6, edgeDist).mul(smoothstep(0.22, 0.34, edgeDist));
    const inner = smoothstep(1.02, 0.96, edgeDist).mul(smoothstep(0.84, 0.9, edgeDist));
    // пунктир полос (3 полосы)
    const laneX = hw.div(3.0);
    const lane = smoothstep(0.16, 0.08, abs(alat.sub(laneX))).mul(step(fract(s.div(9.0)), 0.5));
    // обочина за краем — тёмная
    const shoulder = smoothstep(0.2, 0.0, edgeDist);

    // шахматка старта/финиша (s ∈ [0, 3])
    const L2 = float(this.track.length);
    const sWrap = mod(s.add(L2).add(1.5), L2);
    const onStart = step(sWrap, 3.0);
    const checker = mod(floor(lat.div(1.0)).add(floor(sWrap.div(1.0))), 2.0);
    const startCol = mix(color(0x111111), color(PALETTE.white), checker);

    const edgeCol = color(PALETTE.cyan);
    const innerCol = color(PALETTE.magenta);
    const laneCol = color(PALETTE.lilac);
    let base = mix(asphalt, color(PALETTE.void), shoulder);
    base = mix(base, startCol, onStart.mul(step(edgeDist, hw).mul(step(0.4, edgeDist))));
    const glow = edgeCol.mul(edge).add(innerCol.mul(inner)).add(laneCol.mul(lane).mul(0.5));
    mat.colorNode = base.add(glow.mul(0.6));
    mat.emissiveNode = glow.mul(1.1);
    mat.roughnessNode = mix(float(0.5), float(0.25), onStart);

    const mesh = new Mesh(geo, mat);
    mesh.receiveShadow = false;
    return mesh;
  }

  // ─── Ограждения ────────────────────────────────────────────────────────
  private buildBarriers(): Mesh {
    const t = this.track;
    const pos: number[] = [];
    const bar: number[] = [];
    const idx: number[] = [];
    const n = Math.floor(t.count / STEP);
    const sample = t.sampleAt(0);
    const p = new Vector3();
    const up = new Vector3();

    // сечение (lat от края наружу, высота): внутренняя грань, верх, внешняя грань до низа настила
    const profile: [dl: number, h: number, face: number][] = [
      [0, 0, 0],
      [0, BARRIER_HEIGHT, 0],
      [0, BARRIER_HEIGHT, 1],
      [BARRIER_THICK, BARRIER_HEIGHT, 1],
      [BARRIER_THICK, BARRIER_HEIGHT, 2],
      [BARRIER_THICK, -DECK, 2],
    ];
    const perRing = profile.length;
    for (const side of [-1, 1]) {
      const baseIndex = pos.length / 3;
      for (let k = 0; k <= n; k++) {
        const s = k === n ? t.length : k * STEP * t.step;
        t.sampleAt(s % t.length, sample);
        const k0 = t.curvatureAt(s);
        // интенсивность поворота относительно этой стороны: внешняя сторона поворота
        const turn = clamp01((Math.abs(k0) - 1 / 220) * 90) * (Math.sign(k0) === -side ? 1 : 0.6);
        up.set(0, 1, 0);
        for (const [dl, h, face] of profile) {
          const lat = side * (sample.halfWidth + BARRIER_OFFSET + dl);
          p.copy(sample.position).addScaledVector(sample.right, lat).addScaledVector(up, h);
          pos.push(p.x, p.y, p.z);
          bar.push(face, h, s, turn);
        }
        if (k < n) {
          const a = baseIndex + k * perRing;
          const b = a + perRing;
          for (const [i0, i1] of [
            [0, 1],
            [2, 3],
            [4, 5],
          ]) {
            if (side > 0) idx.push(a + i0, a + i1, b + i0, a + i1, b + i1, b + i0);
            else idx.push(a + i0, b + i0, a + i1, a + i1, b + i0, b + i1);
          }
        }
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('bar', new Float32BufferAttribute(bar, 4));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const mat = new MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0.1, side: DoubleSide, flatShading: true });
    const a = attribute('bar', 'vec4');
    const face = a.x;
    const h = a.y;
    const s = a.z;
    const turn = a.w;
    const isInner = step(face, 0.5);
    const isTop = step(0.5, face).mul(step(face, 1.5));
    const isOuter = step(1.5, face);

    // верхняя неоновая полоса (внутренняя грань и верх)
    const stripe = smoothstep(BARRIER_HEIGHT - 0.32, BARRIER_HEIGHT - 0.22, h).mul(isInner).add(isTop);
    // шевроны в поворотах бегут по направлению движения
    const chevT = fract(s.div(3.2).add(h.mul(0.9)).sub(time.mul(1.6)));
    const chev = step(0.55, chevT).mul(smoothstep(0.1, 0.2, h)).mul(smoothstep(BARRIER_HEIGHT - 0.3, BARRIER_HEIGHT - 0.4, h)).mul(isInner).mul(turn);
    // низ внешней грани (настил эстакады) — тонкая маджента
    const under = smoothstep(-DECK + 0.25, -DECK + 0.1, h).mul(isOuter);
    // пульс по полосе
    const pulse = sin(s.mul(0.08).sub(time.mul(3.0))).mul(0.25).add(0.85);

    const stripeCol = mix(color(PALETTE.cyan), color(PALETTE.magenta), clamp(turn.mul(1.5), 0.0, 1.0));
    const glow = stripeCol.mul(stripe).mul(pulse).add(color(PALETTE.orange).mul(chev)).add(color(PALETTE.magenta).mul(under).mul(0.8));
    const baseCol = mix(color(PALETTE.purple), color(PALETTE.deepViolet), isOuter);
    mat.colorNode = baseCol.add(glow.mul(0.7));
    mat.emissiveNode = glow;
    return new Mesh(geo, mat);
  }

  // ─── Опоры, арки, ворота ───────────────────────────────────────────────
  private buildStructures(): Mesh {
    const t = this.track;
    const gb = new GeometryBuilder();
    const m = new Matrix4();
    const sample = t.sampleAt(0);
    const tmp = new Vector3();
    const purple = new Color(PALETTE.purple);
    const dark = new Color(PALETTE.deepViolet);

    // Опоры эстакады
    for (let s = 0; s < t.length; s += 24) {
      t.sampleAt(s, sample);
      const y = sample.position.y;
      if (y < 3.2) continue;
      // не ставим опору на другой участок дороги
      tmp.copy(sample.position);
      tmp.y = 0;
      const below = t.project(tmp);
      if (Math.abs(below.height) < 1 && Math.abs(below.lateral) < below.sample.halfWidth + 3 && Math.abs(t.deltaS(below.s, s)) > 50) {
        continue;
      }
      const hgt = y - DECK + 0.2;
      const center = sample.position.clone();
      center.y = hgt / 2 - 0.2;
      uprightFrame(center, sample.tangent, m);
      gb.box(sample.halfWidth * 1.3, 1.2, 2.2, dark, 0, new Matrix4().makeTranslation(0, hgt / 2 - 0.6, 0).premultiply(m));
      for (const side of [-1, 1]) {
        const off = new Matrix4().makeTranslation(side * sample.halfWidth * 0.45, 0, 0).premultiply(m);
        gb.box(1.8, hgt, 1.8, purple, 0, off);
        // светящееся кольцо у основания и под настилом
        gb.box(1.95, 0.25, 1.95, PALETTE.cyan, 1, new Matrix4().makeTranslation(side * sample.halfWidth * 0.45, -hgt / 2 + 0.5, 0).premultiply(m));
        gb.box(1.95, 0.18, 1.95, PALETTE.magenta, 1, new Matrix4().makeTranslation(side * sample.halfWidth * 0.45, hgt / 2 - 1.4, 0).premultiply(m));
      }
    }

    // Арки чекпоинтов (кроме старта)
    t.checkpoints.forEach((cs, i) => {
      if (i === 0) return;
      t.sampleAt(cs, sample);
      const f = uprightFrame(sample.position, sample.tangent, new Matrix4());
      const hw = sample.halfWidth + 1.6;
      const H = 8;
      const neon = i % 2 === 0 ? PALETTE.cyan : PALETTE.magenta;
      const add = (sx: number, sy: number, sz: number, x: number, y: number, z: number, c: number | Color, g: number) =>
        gb.box(sx, sy, sz, c, g, new Matrix4().makeTranslation(x, y, z).premultiply(f));
      for (const side of [-1, 1]) {
        add(1.0, H, 1.0, side * hw, H / 2, 0, purple, 0);
        add(0.25, H - 0.6, 0.25, side * (hw - 0.62), H / 2, 0, neon, 1);
      }
      add(hw * 2 + 1, 1.0, 1.0, 0, H, 0, purple, 0);
      add(hw * 2 - 1, 0.25, 0.25, 0, H - 0.62, 0, neon, 1);
      // треугольные «клыки» по верху
      for (let k = -3; k <= 3; k++) add(0.5, 0.5, 0.3, k * (hw / 3.5), H + 0.8, 0, PALETTE.yellow, 0.9);
    });

    // Стартовые ворота
    {
      t.sampleAt(0, sample);
      const f = uprightFrame(sample.position, sample.tangent, new Matrix4());
      const hw = sample.halfWidth + 2.2;
      const H = 11;
      const add = (sx: number, sy: number, sz: number, x: number, y: number, z: number, c: number | Color, g: number) =>
        gb.box(sx, sy, sz, c, g, new Matrix4().makeTranslation(x, y, z).premultiply(f));
      for (const side of [-1, 1]) {
        add(1.6, H + 2, 1.6, side * hw, (H + 2) / 2, 0, purple, 0);
        add(0.3, H + 1.4, 0.3, side * (hw - 0.95), (H + 2) / 2, 0.5, PALETTE.magenta, 1);
        add(0.3, H + 1.4, 0.3, side * (hw + 0.95), (H + 2) / 2, -0.5, PALETTE.cyan, 1);
      }
      // баннер-шахматка
      const cols = 16;
      const cw = (hw * 2) / cols;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < 2; r++) {
          const white = (c + r) % 2 === 0;
          add(cw, 1.1, 0.4, -hw + cw * (c + 0.5), H + r * 1.1, 0, white ? PALETTE.white : 0x0a0a12, white ? 0.35 : 0);
        }
      }
      add(hw * 2, 0.3, 0.5, 0, H - 0.7, 0, PALETTE.yellow, 1);
      add(hw * 2, 0.3, 0.5, 0, H + 2.35, 0, PALETTE.magenta, 1);
    }

    const geo = gb.build();
    const mat = new MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.2, flatShading: true });
    const g = attribute('glow', 'float');
    mat.colorNode = vertexColor();
    mat.emissiveNode = vertexColor().mul(g).mul(1.4);
    return new Mesh(geo, mat);
  }
}

/** Вертикальный базис по горизонтальной проекции касательной */
export function uprightFrame(p: Vector3, tangent: Vector3, out: Matrix4): Matrix4 {
  const f = new Vector3(tangent.x, 0, tangent.z);
  if (f.lengthSq() === 0) f.set(0, 0, 1);
  f.normalize();
  const up = new Vector3(0, 1, 0);
  const right = new Vector3().crossVectors(f, up);
  return frameMatrix(p, right, up, f, out);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

