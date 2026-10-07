/**
 * Неоновый фейерверк над финишной аркой: low-poly частицы (октаэдры), по одному
 * InstancedMesh на цвет палитры. Все массивы выделены заранее — кадр без аллокаций.
 */
import { AdditiveBlending, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Group, MeshBasicNodeMaterial, Matrix4, OctahedronGeometry, Quaternion, Vector3 } from 'three/webgpu';
import { color, instancedDynamicBufferAttribute, mix, oneMinus } from 'three/tsl';
import { PALETTE } from './palette';
import { setGlow } from './materials';

const COLORS = [PALETTE.magenta, PALETTE.cyan, PALETTE.yellow, PALETTE.pink, PALETTE.lilac] as const;
const PER_COLOR = 220;
const BURST_COUNT = 58;
const GRAVITY = 9;
const DRAG = 0.9;
/** Интервал между залпами, с */
const BURST_EVERY = 0.38;
/** Сколько секунд идёт салют */
const SHOW_TIME = 6;

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();

class Swarm {
  readonly mesh: InstancedMesh;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly lifeAttr: InstancedBufferAttribute;
  private cursor = 0;

  constructor(hex: number) {
    this.pos = new Float32Array(PER_COLOR * 3);
    this.vel = new Float32Array(PER_COLOR * 3);
    this.life = new Float32Array(PER_COLOR);
    this.maxLife = new Float32Array(PER_COLOR).fill(1);
    const geo = new OctahedronGeometry(0.55, 0);
    this.lifeAttr = new InstancedBufferAttribute(new Float32Array(PER_COLOR), 1).setUsage(DynamicDrawUsage) as InstancedBufferAttribute;
    geo.setAttribute('fwLife', this.lifeAttr);
    const mat = new MeshBasicNodeMaterial({ blending: AdditiveBlending, transparent: true, depthWrite: false });
    const l = instancedDynamicBufferAttribute(this.lifeAttr, 'float' as const);
    const c = mix(color(hex), color(PALETTE.white), oneMinus(l).mul(0.15)).mul(oneMinus(l).mul(0.9).add(0.45)).mul(1.7);
    mat.colorNode = c;
    setGlow(mat, c.mul(2.6));
    this.mesh = new InstancedMesh(geo, mat, PER_COLOR);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < PER_COLOR; i++) this.mesh.setMatrixAt(i, _m);
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number): void {
    const i = this.cursor;
    this.cursor = (i + 1) % PER_COLOR;
    const j = i * 3;
    this.pos[j] = x;
    this.pos[j + 1] = y;
    this.pos[j + 2] = z;
    this.vel[j] = vx;
    this.vel[j + 1] = vy;
    this.vel[j + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  update(dt: number): void {
    const drag = Math.max(0, 1 - DRAG * dt);
    for (let i = 0; i < PER_COLOR; i++) {
      const j = i * 3;
      if (this.life[i] <= 0) {
        if (this.lifeAttr.array[i] !== 1) {
          this.lifeAttr.array[i] = 1;
          _m.makeScale(0, 0, 0);
          this.mesh.setMatrixAt(i, _m);
        }
        continue;
      }
      this.life[i] -= dt;
      this.vel[j + 1] -= GRAVITY * dt;
      this.vel[j] *= drag;
      this.vel[j + 1] *= drag;
      this.vel[j + 2] *= drag;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const k = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      this.lifeAttr.array[i] = k;
      _p.set(this.pos[j], this.pos[j + 1], this.pos[j + 2]);
      _q.setFromAxisAngle(_s.set(0, 1, 0), i + k * 6);
      _s.setScalar(k > 0.7 ? (1 - k) / 0.3 : 1);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.lifeAttr.array.fill(1);
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < PER_COLOR; i++) this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
  }
}

export class Fireworks {
  readonly group = new Group();
  private readonly swarms: Swarm[] = COLORS.map((c) => new Swarm(c));
  private active = false;
  private t = 0;
  private acc = 0;
  private cx = 0;
  private cy = 0;
  private cz = 0;
  private rx = 1;
  private rz = 0;
  private seq = 0;

  constructor() {
    for (const s of this.swarms) this.group.add(s.mesh);
  }

  /** Запуск салюта: center — над аркой, (rx, rz) — единичный вектор поперёк трассы. */
  start(cx: number, cy: number, cz: number, rx: number, rz: number): void {
    this.active = true;
    this.t = 0;
    this.acc = BURST_EVERY;
    this.cx = cx;
    this.cy = cy;
    this.cz = cz;
    this.rx = rx;
    this.rz = rz;
  }

  clear(): void {
    this.active = false;
    for (const s of this.swarms) s.clear();
  }

  /** Один залп: радиальный взрыв частиц одного цвета. */
  private burst(): void {
    const sw = this.swarms[this.seq++ % this.swarms.length];
    const side = (Math.random() - 0.5) * 36;
    const x = this.cx + this.rx * side;
    const z = this.cz + this.rz * side;
    const y = this.cy + Math.random() * 10;
    for (let i = 0; i < BURST_COUNT; i++) {
      // равномерное направление по сфере
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = 11 + Math.random() * 8;
      sw.spawn(x, y, z, Math.cos(phi) * r * sp, u * sp, Math.sin(phi) * r * sp, 1.3 + Math.random() * 0.7);
    }
  }

  /** Возвращает число залпов за кадр (для звука). */
  update(dt: number): number {
    let bursts = 0;
    if (this.active) {
      this.t += dt;
      this.acc += dt;
      while (this.acc >= BURST_EVERY && this.t < SHOW_TIME) {
        this.acc -= BURST_EVERY;
        this.burst();
        bursts += 1;
      }
      if (this.t >= SHOW_TIME + 2.5) this.active = false;
    }
    if (this.active || bursts > 0) for (const s of this.swarms) s.update(dt);
    return bursts;
  }
}
