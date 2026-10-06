/**
 * Погода трассы «Storm Boulevard»: дождь (капли целиком считаются в вершинном
 * шейдере по времени — на CPU за кадр ничего не пересчитывается) и молнии
 * (случайные короткие вспышки, управляющие небом и светом).
 */
import { AdditiveBlending, BoxGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicNodeMaterial, type Vector3 } from 'three/webgpu';
import { cameraPosition, color, float, instancedBufferAttribute, mod, positionLocal, smoothstep, time, uniform, vec3 } from 'three/tsl';
import { PALETTE } from './palette';
import { setGlow } from './materials';

const MAX_DROPS = 3200;
const BOX = [46, 26, 46] as const;

export class Rain {
  readonly mesh: InstancedMesh;
  readonly intensity = uniform(1);

  constructor() {
    // тонкая вертикальная полоска; наклон задаёт ветер в шейдере
    const geo = new BoxGeometry(0.014, 0.9, 0.014);
    const seeds = new Float32Array(MAX_DROPS * 3);
    let st = 12345;
    const rnd = () => {
      st = (Math.imul(st, 1664525) + 1013904223) >>> 0;
      return st / 4294967296;
    };
    for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
    geo.setAttribute('rainSeed', new InstancedBufferAttribute(seeds, 3));
    const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
    const seed = instancedBufferAttribute(geo.getAttribute('rainSeed') as InstancedBufferAttribute, 'vec3' as const);
    const size = vec3(BOX[0], BOX[1], BOX[2]);
    const fall = vec3(-3.0, -34.0, 1.5).mul(time);
    const rel = mod(seed.mul(size).add(fall).sub(cameraPosition), size);
    const world = cameraPosition.add(rel).sub(size.mul(vec3(0.5, 0.35, 0.5)));
    // наклон капли по вектору падения
    const slant = vec3(positionLocal.y.mul(-0.09), 0.0, positionLocal.y.mul(0.045));
    mat.positionNode = world.add(positionLocal).add(slant);
    // прозрачность: гасим у границ объёма
    const edge = rel.div(size).sub(0.5).abs().mul(2.0);
    const fade = float(1.0).sub(smoothstep(0.75, 1.0, edge.x.max(edge.y).max(edge.z)));
    const col = color(PALETTE.lilac).mul(0.9).add(color(PALETTE.cyan).mul(0.25));
    mat.colorNode = col.mul(fade.mul(0.55));
    mat.opacityNode = fade.mul(0.8);
    setGlow(mat, col.mul(fade.mul(0.25)));
    this.mesh = new InstancedMesh(geo, mat, MAX_DROPS);
    const id = new Matrix4();
    for (let i = 0; i < MAX_DROPS; i++) this.mesh.setMatrixAt(i, id);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.setDensity(1);
  }

  /** 1 — «Высокое», <1 — меньше капель */
  setDensity(k: number): void {
    this.mesh.count = Math.max(100, Math.floor(MAX_DROPS * k));
  }
}

/** Случайные вспышки молний: 0..1, двойной импульс с затуханием */
export class Lightning {
  /** Текущая яркость вспышки 0..1 */
  value = 0;
  private timer = 4 + Math.random() * 5;
  private phase = -1;
  private t = 0;

  update(dt: number): number {
    if (this.phase < 0) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = 0;
        this.t = 0;
      }
      this.value = 0;
      return 0;
    }
    this.t += dt;
    // импульсы в 0.00, 0.14 и затухание
    const a = Math.exp(-this.t * 9);
    const b = this.t > 0.14 ? Math.exp(-(this.t - 0.14) * 6) * 0.8 : 0;
    this.value = Math.min(1, Math.max(a, b));
    if (this.t > 0.9) {
      this.phase = -1;
      this.timer = 6 + Math.random() * 12;
      this.value = 0;
    }
    return this.value;
  }
}

export class Weather {
  readonly rain = new Rain();
  readonly lightning = new Lightning();
  private last = 0;

  update(_cameraPos: Vector3): number {
    const now = performance.now() / 1000;
    const dt = this.last ? Math.min(0.1, now - this.last) : 0;
    this.last = now;
    return this.lightning.update(dt);
  }
}
