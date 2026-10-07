/**
 * Визуал пикапов: бустер-пластины (неоновые шевроны на асфальте, бегущие стрелки в TSL) —
 * один InstancedMesh, канистры нитро (парящие вращающиеся кристаллы) — один InstancedMesh.
 * Положения берутся из PickupSystem; в кадре аллокаций нет.
 */
import {
  BufferGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
} from 'three/webgpu';
import { abs, color, dot, float, fract, mix, normalWorld, smoothstep, step, time, uv, vec3 } from 'three/tsl';
import type { Track } from './track';
import type { PickupSystem } from '../race/pickups';
import { PICKUP_TUNING } from '../race/pickups';
import { PALETTE } from './palette';
import { setGlow } from './materials';

/** Подъём пластины над асфальтом, м */
const PAD_LIFT = 0.09;
/** Высота парения канистры над дорогой, м */
const CAN_HOVER = 1.5;

/** Плоский прямоугольник с uv: u поперёк (0..1), v вдоль движения (0..1) */
function padGeometry(halfW: number, halfL: number): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-halfW, 0, -halfL, halfW, 0, -halfL, halfW, 0, halfL, -halfW, 0, halfL], 3));
  g.setAttribute('normal', new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

function padMaterial(): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({ side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const p = uv();
  const d = abs(p.x.sub(0.5)).mul(2.0); // 0 в центре .. 1 на краю
  // шевроны: линия v + d·k = const бежит вперёд (в +v) со временем
  const phase = fract(p.y.mul(2.0).add(d.mul(0.9)).sub(time.mul(1.4)));
  const chev = step(phase, float(0.42)).mul(step(d, float(0.86)));
  // рамка по краям пластины
  const rim = step(float(0.9), d).add(step(p.y, float(0.035))).add(step(float(0.965), p.y)).min(1.0);
  // затухание шевронов к заднему краю → ощущение направления
  const trail = mix(float(0.55), float(1.0), smoothstep(0.0, 0.8, p.y));
  const chevCol = mix(color(PALETTE.yellow), color(PALETTE.orange), p.y);
  const lit = chevCol.mul(chev.mul(trail).mul(1.5)).add(color(PALETTE.cyan).mul(rim));
  const base = vec3(0.03, 0.01, 0.08); // тёмная подложка (void)
  mat.colorNode = base.add(lit);
  setGlow(mat, lit.mul(1.4));
  return mat;
}

function canMaterial(): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial();
  // грани (плоские нормали) — разной яркости, чтобы кристалл читался объёмным
  const shade = dot(normalWorld, vec3(0.35, 0.8, 0.5).normalize()).mul(0.5).add(0.5);
  const col = mix(color(PALETTE.magenta), color(PALETTE.cyan), smoothstep(0.25, 0.75, shade)).add(color(PALETTE.white).mul(smoothstep(0.82, 1.0, shade).mul(0.6)));
  mat.colorNode = col.mul(1.15);
  setGlow(mat, col.mul(1.3));
  return mat;
}

export class PickupMesh {
  readonly group = new Group();
  private readonly pads: InstancedMesh | null = null;
  private readonly cans: InstancedMesh | null = null;
  private readonly canBase: Vector3[] = [];
  private readonly padGeo: BufferGeometry;
  private readonly canGeo: BufferGeometry;
  private t = 0;
  // временные объекты (создаются один раз)
  private readonly _m = new Matrix4();
  private readonly _q = new Quaternion();
  private readonly _e = new Euler();
  private readonly _p = new Vector3();
  private readonly _s = new Vector3();

  constructor(
    track: Track,
    private readonly system: PickupSystem,
  ) {
    this.padGeo = padGeometry(PICKUP_TUNING.padHalfWidth - 0.3, PICKUP_TUNING.padHalfLen - 0.5);
    this.canGeo = new OctahedronGeometry(0.62, 0);
    this.canGeo.computeVertexNormals();

    const sample = track.sampleAt(0);
    const basis = new Matrix4();
    if (system.padCount > 0) {
      const mesh = new InstancedMesh(this.padGeo, padMaterial(), system.padCount);
      for (let i = 0; i < system.padCount; i++) {
        track.sampleAt(system.padS[i], sample);
        const pos = sample.position.clone().addScaledVector(sample.right, system.padLateral[i]).addScaledVector(sample.up, PAD_LIFT);
        // x = right, y = up, z = вперёд
        basis.makeBasis(sample.right, sample.up, sample.tangent).setPosition(pos);
        mesh.setMatrixAt(i, basis);
      }
      mesh.frustumCulled = false;
      this.pads = mesh;
      this.group.add(mesh);
    }
    if (system.canCount > 0) {
      const mesh = new InstancedMesh(this.canGeo, canMaterial(), system.canCount);
      for (let i = 0; i < system.canCount; i++) {
        track.sampleAt(system.canS[i], sample);
        this.canBase.push(sample.position.clone().addScaledVector(sample.right, system.canLateral[i]).addScaledVector(sample.up, CAN_HOVER));
      }
      mesh.frustumCulled = false;
      this.cans = mesh;
      this.group.add(mesh);
      this.update(0);
    }
  }

  /** Анимация канистр: вращение, покачивание, скрытие подобранных */
  update(dt: number): void {
    const cans = this.cans;
    if (!cans) return;
    this.t += dt;
    const sys = this.system;
    for (let i = 0; i < this.canBase.length; i++) {
      const base = this.canBase[i];
      const timer = sys.canTimer[i];
      // подобранная — скрыта; перед возвращением плавно «вырастает»
      const k = timer > 0 ? 0 : 1;
      this._p.set(base.x, base.y + Math.sin(this.t * 2.2 + i * 1.7) * 0.18, base.z);
      this._e.set(0.25 * Math.sin(this.t * 1.3 + i), this.t * 1.9 + i * 0.9, 0);
      this._q.setFromEuler(this._e);
      this._s.set(1.15 * k, 1.9 * k, 1.15 * k);
      this._m.compose(this._p, this._q, this._s);
      cans.setMatrixAt(i, this._m);
    }
    cans.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Mesh) {
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
    this.padGeo.dispose();
    this.canGeo.dispose();
    this.pads?.dispose();
    this.cans?.dispose();
  }
}
