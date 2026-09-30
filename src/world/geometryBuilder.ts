/**
 * GeometryBuilder — сборка низкополигональной геометрии с vertex colors и
 * поканальным свечением (атрибут `glow` 0..1). Неиндексированная геометрия →
 * честный flat shading. Используется для трассы, окружения и машин.
 */
import { BufferGeometry, Color, Float32BufferAttribute, Matrix4, Vector3 } from 'three/webgpu';

const _v = new Vector3();
const _n = new Vector3();
const _e1 = new Vector3();
const _e2 = new Vector3();
const _c = new Color();

export type ColorLike = number | Color;

export class GeometryBuilder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly glw: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  tri(a: Vector3, b: Vector3, c: Vector3, color: ColorLike, glow = 0): this {
    const cc = color instanceof Color ? color : _c.set(color);
    for (const p of [a, b, c]) {
      this.pos.push(p.x, p.y, p.z);
      this.col.push(cc.r, cc.g, cc.b);
      this.glw.push(glow);
    }
    return this;
  }

  /** Четырёхугольник a-b-c-d (против часовой стрелки при взгляде снаружи) */
  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, color: ColorLike, glow = 0): this {
    this.tri(a, b, c, color, glow);
    this.tri(a, c, d, color, glow);
    return this;
  }

  /**
   * Выпуклый многогранник-«призма»: профиль в плоскости (z, y) с точками
   * против часовой стрелки при взгляде с +X, выдавленный от x = -hw до +hw.
   * `taper` — сужение верхних точек по ширине (0 — нет).
   */
  prism(
    profile: [z: number, y: number][],
    halfWidth: number,
    color: ColorLike,
    glow = 0,
    m?: Matrix4,
    taper = 0,
    capColor?: ColorLike,
  ): this {
    const n = profile.length;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of profile) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const width = (y: number) => halfWidth * (1 - (taper * (y - minY)) / Math.max(1e-6, maxY - minY));
    const L: Vector3[] = [];
    const R: Vector3[] = [];
    for (const [z, y] of profile) {
      const w = width(y);
      const l = new Vector3(w, y, z);
      const r = new Vector3(-w, y, z);
      if (m) {
        l.applyMatrix4(m);
        r.applyMatrix4(m);
      }
      L.push(l);
      R.push(r);
    }
    const cap = capColor ?? color;
    // боковины (веер)
    for (let i = 1; i < n - 1; i++) {
      this.tri(L[0], L[i + 1], L[i], cap, glow);
      this.tri(R[0], R[i], R[i + 1], cap, glow);
    }
    // обод
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad(L[i], L[j], R[j], R[i], color, glow);
    }
    return this;
  }

  /** Бокс размером sx×sy×sz с центром в (0,0,0), затем матрица m */
  box(sx: number, sy: number, sz: number, color: ColorLike, glow = 0, m?: Matrix4): this {
    const x = sx / 2;
    const y = sy / 2;
    const z = sz / 2;
    const p = [
      new Vector3(-x, -y, -z),
      new Vector3(x, -y, -z),
      new Vector3(x, y, -z),
      new Vector3(-x, y, -z),
      new Vector3(-x, -y, z),
      new Vector3(x, -y, z),
      new Vector3(x, y, z),
      new Vector3(-x, y, z),
    ];
    if (m) for (const v of p) v.applyMatrix4(m);
    this.quad(p[4], p[5], p[6], p[7], color, glow); // +z
    this.quad(p[1], p[0], p[3], p[2], color, glow); // -z
    this.quad(p[5], p[1], p[2], p[6], color, glow); // +x
    this.quad(p[0], p[4], p[7], p[3], color, glow); // -x
    this.quad(p[7], p[6], p[2], p[3], color, glow); // +y
    this.quad(p[0], p[1], p[5], p[4], color, glow); // -y
    return this;
  }

  /** Низкополигональный цилиндр вдоль оси Y (radiusTop/Bottom, высота h, центр в 0) */
  cylinder(rTop: number, rBottom: number, h: number, sides: number, color: ColorLike, glow = 0, m?: Matrix4, caps = true): this {
    const top: Vector3[] = [];
    const bot: Vector3[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const t = new Vector3(c * rTop, h / 2, s * rTop);
      const b = new Vector3(c * rBottom, -h / 2, s * rBottom);
      if (m) {
        t.applyMatrix4(m);
        b.applyMatrix4(m);
      }
      top.push(t);
      bot.push(b);
    }
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      this.quad(bot[j], bot[i], top[i], top[j], color, glow);
    }
    if (caps) {
      const ct = new Vector3(0, h / 2, 0);
      const cb = new Vector3(0, -h / 2, 0);
      if (m) {
        ct.applyMatrix4(m);
        cb.applyMatrix4(m);
      }
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        this.tri(ct, top[j], top[i], color, glow);
        this.tri(cb, bot[i], bot[j], color, glow);
      }
    }
    return this;
  }

  /** Меняет порядок вершин треугольников, если нормаль смотрит против `outward` */
  static faceNormal(a: Vector3, b: Vector3, c: Vector3, out: Vector3 = _n): Vector3 {
    _e1.subVectors(b, a);
    _e2.subVectors(c, a);
    return out.crossVectors(_e1, _e2).normalize();
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('glow', new Float32BufferAttribute(this.glw, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Матрица из базиса трассы: right → X, up → Y, tangent → Z, в точке p */
export function frameMatrix(p: Vector3, right: Vector3, up: Vector3, tangent: Vector3, out = new Matrix4()): Matrix4 {
  // локальный +X в наших моделях = «влево», поэтому X = −right
  _v.copy(right).negate();
  out.makeBasis(_v, up, tangent);
  out.setPosition(p);
  return out;
}
