/**
 * Дирижабли на горизонте: low-poly эллипсоид с неоновыми полосами и огнями.
 * Все дирижабли — один смёрженный меш (1 draw call), движение — по кругу вокруг камеры.
 */
import { BufferGeometry, Color, Float32BufferAttribute, Group, IcosahedronGeometry, Mesh, MeshBasicNodeMaterial, BoxGeometry, Matrix4 } from 'three/webgpu';
import { attribute, float, sin, time, vertexColor } from 'three/tsl';
import { PALETTE } from './palette';
import { setGlow } from './materials';

const _m = new Matrix4();

interface Part {
  geo: BufferGeometry;
  color: Color;
  glow: number;
}

function addPart(out: { p: number[]; c: number[]; g: number[] }, part: Part, m: Matrix4): void {
  const geo = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
  geo.applyMatrix4(m);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    out.p.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    out.c.push(part.color.r, part.color.g, part.color.b);
    out.g.push(part.glow);
  }
  geo.dispose();
}

/** Один дирижабль, длина вдоль +X, в локальных координатах */
function buildBlimp(out: { p: number[]; c: number[]; g: number[] }, base: Matrix4, stripe: number): void {
  const body = new IcosahedronGeometry(1, 1);
  const T = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => _m.makeScale(sx, sy, sz).setPosition(x, y, z).premultiply(base);
  addPart(out, { geo: body, color: new Color(PALETTE.purple).lerp(new Color(PALETTE.lilac), 0.25), glow: 0 }, T(0, 0, 0, 38, 11, 11).clone());
  // неоновые «пояса»
  for (let i = -2; i <= 2; i++) {
    const x = i * 12;
    const k = Math.sqrt(Math.max(0, 1 - (x / 38) ** 2));
    addPart(out, { geo: new BoxGeometry(1.4, 22.6 * k + 0.4, 22.6 * k + 0.4), color: new Color(stripe), glow: 1 }, T(x, 0, 0, 1, 1, 1).clone());
  }
  // гондола и хвостовые стабилизаторы
  addPart(out, { geo: new BoxGeometry(9, 2.4, 3), color: new Color(PALETTE.void), glow: 0 }, T(0, -12, 0, 1, 1, 1).clone());
  addPart(out, { geo: new BoxGeometry(7, 12, 0.8), color: new Color(PALETTE.deepViolet), glow: 0.3 }, T(-35, 0, 0, 1, 1, 1).clone());
  addPart(out, { geo: new BoxGeometry(7, 0.8, 12), color: new Color(PALETTE.deepViolet), glow: 0.3 }, T(-35, 0, 0, 1, 1, 1).clone());
  // габаритные огни
  addPart(out, { geo: new BoxGeometry(1.6, 1.6, 1.6), color: new Color(PALETTE.magenta), glow: 2 }, T(-38, 6, 0, 1, 1, 1).clone());
  addPart(out, { geo: new BoxGeometry(1.6, 1.6, 1.6), color: new Color(PALETTE.cyan), glow: 2 }, T(0, -13.8, 0, 1, 1, 1).clone());
  body.dispose();
}

export class Blimps {
  readonly group = new Group();
  private readonly pivots: { g: Group; radius: number; speed: number; phase: number; y: number }[] = [];
  private clock = 0;

  constructor() {
    const specs = [
      { radius: 900, y: 130, speed: 0.006, phase: 0.3, stripe: PALETTE.cyan },
      { radius: 1000, y: 220, speed: -0.008, phase: 3.1, stripe: PALETTE.magenta },
    ];
    for (const s of specs) {
      const out = { p: [] as number[], c: [] as number[], g: [] as number[] };
      buildBlimp(out, new Matrix4(), s.stripe);
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(out.p, 3));
      geo.setAttribute('color', new Float32BufferAttribute(out.c, 3));
      geo.setAttribute('glow', new Float32BufferAttribute(out.g, 1));
      geo.computeVertexNormals();
      const mat = new MeshBasicNodeMaterial({ fog: false });
      const g = attribute('glow', 'float');
      const blink = sin(time.mul(3.0).add(s.phase)).mul(0.3).add(0.7);
      mat.colorNode = vertexColor().mul(g.mul(blink).mul(0.9).add(1.0));
      setGlow(mat, vertexColor().mul(g.mul(blink)).mul(float(0.9)));
      const mesh = new Mesh(geo, mat);
      mesh.frustumCulled = false;
      const pivot = new Group();
      pivot.add(mesh);
      pivot.scale.setScalar(1.7);
      this.group.add(pivot);
      this.pivots.push({ g: pivot, radius: s.radius, speed: s.speed, phase: s.phase, y: s.y });
    }
  }

  /** dt в секундах; позиция задаётся в системе группы неба (следует за камерой) */
  update(dt: number): void {
    this.clock += dt;
    for (const p of this.pivots) {
      const a = p.phase + this.clock * p.speed;
      p.g.position.set(Math.cos(a) * p.radius, p.y, Math.sin(a) * p.radius);
      // нос смотрит по касательной движения
      p.g.rotation.y = -a - Math.PI / 2 + (p.speed < 0 ? Math.PI : 0);
    }
  }
}
