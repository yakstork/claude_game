/**
 * Эффекты машин: неоновые следы шин, low-poly дым заноса, искры от ударов,
 * линии скорости вокруг камеры при нитро.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type PerspectiveCamera,
} from 'three/webgpu';
import {
  attribute,
  color,
  float,
  instancedDynamicBufferAttribute,
  mix,
  oneMinus,
  smoothstep,
  uniform,
} from 'three/tsl';
import type { VehicleState } from '../core/types';
import { PALETTE } from '../world/palette';
import { setGlow } from '../world/materials';

// ─── Следы шин ───────────────────────────────────────────────────────────

const SKID_MAX = 3000;
const SKID_WIDTH = 0.26;
const SKID_LIFE = 30;

interface SkidTrail {
  last: Vector3;
  active: boolean;
}

export class SkidMarks {
  readonly mesh: Mesh;
  private readonly pos: Float32Array;
  private readonly birth: Float32Array;
  private readonly posAttr: BufferAttribute;
  private readonly birthAttr: BufferAttribute;
  private cursor = 0;
  private readonly trails = new Map<number, SkidTrail>();
  readonly now = uniform(0);
  private dirtyFrom = Infinity;
  private dirtyTo = -1;

  constructor() {
    const g = new BufferGeometry();
    this.pos = new Float32Array(SKID_MAX * 6 * 3);
    this.birth = new Float32Array(SKID_MAX * 6).fill(-1000);
    this.posAttr = new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage);
    this.birthAttr = new BufferAttribute(this.birth, 1).setUsage(DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('birth', this.birthAttr);
    const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const age = this.now.sub(attribute('birth', 'float'));
    const fade = oneMinus(smoothstep(SKID_LIFE * 0.4, SKID_LIFE, age));
    const fresh = oneMinus(smoothstep(0.0, 2.5, age));
    mat.colorNode = mix(color(0x0b0514), color(PALETTE.magenta), fresh.mul(0.55));
    mat.opacityNode = fade.mul(0.62);
    setGlow(mat, color(PALETTE.magenta).mul(fresh.mul(fade).mul(0.5)));
    this.mesh = new Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /** key — уникальный id колеса (машина·4 + колесо) */
  add(key: number, point: Vector3, intensity: number, heading: number): void {
    let tr = this.trails.get(key);
    if (!tr) {
      tr = { last: new Vector3(), active: false };
      this.trails.set(key, tr);
    }
    if (intensity < 0.3) {
      tr.active = false;
      return;
    }
    if (!tr.active) {
      tr.last.copy(point);
      tr.active = true;
      return;
    }
    const dx = point.x - tr.last.x;
    const dz = point.z - tr.last.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 0.36) return;
    if (d2 > 25) {
      tr.last.copy(point);
      return;
    }
    // поперечный вектор — по курсу машины (след шире в заносе)
    const px = Math.cos(heading) * SKID_WIDTH;
    const pz = -Math.sin(heading) * SKID_WIDTH;
    const a = tr.last;
    const b = point;
    const y0 = a.y + 0.03;
    const y1 = b.y + 0.03;
    const i = this.cursor * 18;
    const v = [a.x + px, y0, a.z + pz, a.x - px, y0, a.z - pz, b.x - px, y1, b.z - pz, a.x + px, y0, a.z + pz, b.x - px, y1, b.z - pz, b.x + px, y1, b.z + pz];
    this.pos.set(v, i);
    this.birth.fill(this.now.value, this.cursor * 6, this.cursor * 6 + 6);
    this.dirtyFrom = Math.min(this.dirtyFrom, this.cursor);
    this.dirtyTo = Math.max(this.dirtyTo, this.cursor);
    this.cursor = (this.cursor + 1) % SKID_MAX;
    tr.last.copy(point);
  }

  update(time: number): void {
    this.now.value = time;
    if (this.dirtyTo >= 0) {
      const from = this.dirtyFrom;
      const count = this.dirtyTo - from + 1;
      this.posAttr.clearUpdateRanges();
      this.posAttr.addUpdateRange(from * 18, count * 18);
      this.posAttr.needsUpdate = true;
      this.birthAttr.clearUpdateRanges();
      this.birthAttr.addUpdateRange(from * 6, count * 6);
      this.birthAttr.needsUpdate = true;
      this.dirtyFrom = Infinity;
      this.dirtyTo = -1;
    }
  }

  clear(): void {
    this.birth.fill(-1000);
    this.birthAttr.clearUpdateRanges();
    this.birthAttr.needsUpdate = true;
    this.trails.clear();
  }
}

// ─── Частицы (дым и искры) ───────────────────────────────────────────────

interface Particle {
  pos: Vector3;
  vel: Vector3;
  life: number;
  maxLife: number;
  size: number;
  spin: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const _dir = new Vector3();
const _up = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

class ParticlePool {
  readonly mesh: InstancedMesh;
  private readonly items: Particle[] = [];
  private next = 0;
  private readonly lifeAttr: InstancedBufferAttribute;

  constructor(
    geometry: BufferGeometry,
    material: MeshBasicNodeMaterial | MeshStandardNodeMaterial,
    readonly max: number,
    private readonly stretch: boolean,
    lifeName: string,
  ) {
    this.lifeAttr = new InstancedBufferAttribute(new Float32Array(max), 1).setUsage(DynamicDrawUsage) as InstancedBufferAttribute;
    geometry.setAttribute(lifeName, this.lifeAttr);
    this.mesh = new InstancedMesh(geometry, material, max);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < max; i++) {
      this.items.push({ pos: new Vector3(), vel: new Vector3(), life: 0, maxLife: 1, size: 1, spin: 0 });
      this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
    }
  }

  get lifeNode() {
    return instancedDynamicBufferAttribute(this.lifeAttr, 'float' as const);
  }

  spawn(pos: Vector3, vel: Vector3, life: number, size: number): void {
    const p = this.items[this.next];
    this.next = (this.next + 1) % this.max;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.life = life;
    p.maxLife = life;
    p.size = size;
    p.spin = Math.random() * Math.PI * 2;
  }

  update(dt: number, gravity: number, drag: number, grow: number): void {
    for (let i = 0; i < this.max; i++) {
      const p = this.items[i];
      if (p.life <= 0) {
        this.lifeAttr.array[i] = 1;
        this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
        continue;
      }
      p.life -= dt;
      p.vel.y -= gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      const k = 1 - Math.max(0, p.life) / p.maxLife; // 0 → 1
      this.lifeAttr.array[i] = k;
      if (this.stretch) {
        const sp = p.vel.length();
        _dir.copy(p.vel).divideScalar(sp || 1);
        _q.setFromUnitVectors(Z, _dir);
        const len = Math.min(1.6, 0.15 + sp * 0.04) * (1 - k);
        _s.set(p.size * (1 - k * 0.5), p.size * (1 - k * 0.5), len / 0.5);
      } else {
        _q.setFromAxisAngle(_up, p.spin + k * 2);
        // low-poly дым: растёт, в конце сжимается
        const sc = p.size * (0.4 + grow * k) * (k > 0.8 ? (1 - k) / 0.2 : 1);
        _s.setScalar(sc);
      }
      _m.compose(p.pos, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
  }

  clear(): void {
    for (const p of this.items) p.life = 0;
  }
}

// ─── Линии скорости ──────────────────────────────────────────────────────

const LINES = 70;

export class SpeedLines {
  readonly mesh: InstancedMesh;
  readonly intensity = uniform(0);
  private readonly local: Vector3[] = [];
  private readonly dummy = new Object3D();

  constructor() {
    const geo = new BoxGeometry(0.035, 0.035, 7);
    const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    const c = mix(color(PALETTE.cyan), color(PALETTE.white), float(0.4));
    mat.colorNode = c.mul(this.intensity);
    setGlow(mat, c.mul(this.intensity).mul(0.6));
    this.mesh = new InstancedMesh(geo, mat, LINES);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < LINES; i++) this.local.push(this.randomLocal(new Vector3(), true));
  }

  private randomLocal(v: Vector3, anyZ: boolean): Vector3 {
    const a = Math.random() * Math.PI * 2;
    const r = 2.6 + Math.random() * 6;
    return v.set(Math.cos(a) * r, Math.sin(a) * r * 0.7, anyZ ? -Math.random() * 80 : -70 - Math.random() * 15);
  }

  update(dt: number, camera: PerspectiveCamera, speed: number, amount: number): void {
    this.intensity.value += (amount - this.intensity.value) * Math.min(1, dt * 6);
    const vis = this.intensity.value > 0.01;
    this.mesh.visible = vis;
    if (!vis) return;
    for (let i = 0; i < LINES; i++) {
      const l = this.local[i];
      l.z += (speed * 1.4 + 30) * dt;
      if (l.z > 6) this.randomLocal(l, false);
      this.dummy.position.copy(l).applyMatrix4(camera.matrixWorld);
      this.dummy.quaternion.copy(camera.quaternion);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ─── Менеджер эффектов ───────────────────────────────────────────────────

const _p = new Vector3();
const _v = new Vector3();
const SMOKE_COLOR = new Color(0xd8b8ff);

export class EffectsManager {
  readonly group = new Group();
  readonly skids = new SkidMarks();
  readonly speedLines = new SpeedLines();
  private readonly smoke: ParticlePool;
  private readonly sparks: ParticlePool;
  private time = 0;
  private smokeAcc = 0;
  /** Множитель количества частиц (качество) */
  density = 1;

  constructor() {
    const smokeMat = new MeshStandardNodeMaterial({ transparent: true, depthWrite: false, flatShading: true, roughness: 1, metalness: 0 });
    const smokeGeo = new IcosahedronGeometry(1, 0);
    this.smoke = new ParticlePool(smokeGeo, smokeMat, 220, false, 'smokeLife');
    const life = this.smoke.lifeNode;
    smokeMat.colorNode = mix(color(SMOKE_COLOR), color(PALETTE.lilac), life);
    smokeMat.opacityNode = oneMinus(smoothstep(0.1, 1.0, life)).mul(0.42);
    smokeMat.emissiveNode = color(PALETTE.pink).mul(oneMinus(life).mul(0.08));

    const sparkMat = new MeshBasicNodeMaterial({ blending: AdditiveBlending, transparent: true, depthWrite: false });
    this.sparks = new ParticlePool(new BoxGeometry(0.06, 0.06, 0.5), sparkMat, 240, true, 'sparkLife');
    const sl = this.sparks.lifeNode;
    const sc = mix(color(PALETTE.yellow), color(PALETTE.orange), sl).mul(oneMinus(sl).mul(2.0).add(0.4));
    sparkMat.colorNode = sc;
    setGlow(sparkMat, sc.mul(1.5));

    this.group.add(this.skids.mesh, this.smoke.mesh, this.sparks.mesh, this.speedLines.mesh);
  }

  /** Эффекты одной машины за кадр */
  updateCar(index: number, state: VehicleState, dt: number): void {
    for (let w = 2; w < 4; w++) {
      const ws = state.wheels[w];
      const skid = ws.onGround ? ws.skid : 0;
      this.skids.add(index * 4 + w, ws.contact, skid, state.heading);
    }
    // передние колёса тоже оставляют след в сильном заносе
    for (let w = 0; w < 2; w++) {
      const ws = state.wheels[w];
      this.skids.add(index * 4 + w, ws.contact, ws.onGround && ws.skid > 0.75 ? ws.skid : 0, state.heading);
    }

    const skidAmount = Math.max(state.wheels[2].skid, state.wheels[3].skid) * (state.onGround ? 1 : 0);
    if (skidAmount > 0.35 && Math.abs(state.speed) > 6) {
      this.smokeAcc += dt * 26 * skidAmount * this.density;
      while (this.smokeAcc > 1) {
        this.smokeAcc -= 1;
        const w = state.wheels[2 + Math.floor(Math.random() * 2)];
        _p.copy(w.contact);
        _p.y += 0.3;
        _v.set((Math.random() - 0.5) * 2, 1.2 + Math.random() * 1.5, (Math.random() - 0.5) * 2).addScaledVector(state.velocity, 0.25);
        this.smoke.spawn(_p, _v, 1.1 + Math.random() * 0.8, 0.55 + Math.random() * 0.4);
      }
    }
  }

  /** Сноп искр в точке удара */
  sparksAt(point: Vector3, velocity: Vector3, strength: number): void {
    const n = Math.ceil((8 + strength * 30) * this.density);
    for (let i = 0; i < n; i++) {
      _v.set((Math.random() - 0.5) * 12, 2 + Math.random() * 7, (Math.random() - 0.5) * 12).addScaledVector(velocity, 0.6);
      this.sparks.spawn(point, _v, 0.3 + Math.random() * 0.5, 0.8 + Math.random() * 0.6);
    }
  }

  /** Пыль/дым при приземлении */
  landingPuff(point: Vector3, strength: number): void {
    // небольшое кольцо пыли у колёс: не должно закрывать обзор камере
    const n = Math.ceil(4 + strength * 5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      _v.set(Math.cos(a) * 4, 0.5 + Math.random() * 0.6, Math.sin(a) * 4);
      this.smoke.spawn(point, _v, 0.55, 0.22 + strength * 0.22);
    }
  }

  update(dt: number, camera: PerspectiveCamera, playerSpeed: number, speedLineAmount: number): void {
    this.time += dt;
    this.skids.update(this.time);
    this.smoke.update(dt, -1.2, 1.4, 2.4);
    this.sparks.update(dt, 22, 0.6, 0);
    this.speedLines.update(dt, camera, playerSpeed, speedLineAmount);
  }

  clear(): void {
    this.skids.clear();
    this.smoke.clear();
    this.sparks.clear();
  }
}
