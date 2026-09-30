/**
 * Небо: градиентный TSL-шейдер с полосатым солнцем синтвейва, звёздами в
 * зените и низкополигональными горами с неоновой кромкой на горизонте.
 */
import {
  BackSide,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  SphereGeometry,
  Vector3,
} from 'three/webgpu';
import {
  Fn,
  abs,
  clamp,
  color,
  dot,
  exp,
  float,
  floor,
  fract,
  hash,
  max,
  mix,
  normalize,
  positionLocal,
  pow,
  smoothstep,
  step,
  time,
  uniform,
  vec3,
  vertexColor,
  attribute,
} from 'three/tsl';
import { PALETTE } from './palette';
import { setGlow } from './materials';

/** Направление на солнце (над восточным горизонтом — по стартовой прямой) */
export const SUN_DIR = new Vector3(1, 0.075, 0.12).normalize();

const SKY_RADIUS = 1500;

export class Sky {
  readonly group = new Group();
  private readonly dome: Mesh;
  readonly sunIntensity = uniform(1);

  constructor() {
    this.dome = new Mesh(new SphereGeometry(SKY_RADIUS, 48, 24), this.createSkyMaterial());
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);
    this.group.add(createMountains());
  }

  /** Небо и горы следуют за камерой по горизонтали */
  update(cameraPos: Vector3): void {
    this.group.position.set(cameraPos.x, 0, cameraPos.z);
  }

  private createSkyMaterial(): MeshBasicNodeMaterial {
    const mat = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false });
    const sunDir = vec3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z);
    const sunIntensity = this.sunIntensity;

    const dir = normalize(positionLocal);
    const h = dir.y;

    const skyColor = Fn(() => {
      const zenith = color(PALETTE.skyZenith);
      const high = color(PALETTE.skyHigh);
      const mid = color(PALETTE.skyMid);
      const horizon = color(PALETTE.skyHorizon);
      // градиент: горизонт → середина → высоко → зенит
      const c1 = mix(horizon, mid, smoothstep(0.0, 0.09, h));
      const c2 = mix(c1, high, smoothstep(0.07, 0.3, h));
      const c3 = mix(c2, zenith, smoothstep(0.28, 0.75, h));
      // ниже горизонта — тёмный фиолетовый (прячется за землёй и туманом)
      const below = mix(color(PALETTE.skyMid).mul(0.5), color(PALETTE.void), smoothstep(0.0, -0.15, h));
      const base = mix(below, c3, step(0.0, h));

      // свечение вокруг солнца, сильнее у горизонта
      const sd = dot(dir, sunDir);
      const glow = pow(max(sd, 0.0), 12.0).mul(0.55).add(pow(max(sd, 0.0), 90.0).mul(0.6));
      const horizonGlow = exp(abs(h).mul(-14.0)).mul(0.35);
      const warm = color(PALETTE.orange).mul(glow.add(horizonGlow.mul(max(sd, 0.2))));

      // звёзды: разреженные точки в верхней полусфере
      const cell = floor(dir.mul(260.0));
      const rnd = hash(cell.x.add(cell.y.mul(157.0)).add(cell.z.mul(113.0)));
      const twinkle = fract(rnd.mul(17.0).add(time.mul(0.15))).mul(0.6).add(0.4);
      const star = step(0.9965, rnd).mul(smoothstep(0.22, 0.55, h)).mul(twinkle);

      return base.add(warm).add(vec3(star, star, star).mul(0.9));
    })();

    // Полосатое солнце: диск в касательной плоскости к SUN_DIR
    const sunDisc = Fn(() => {
      const up = vec3(0, 1, 0);
      const right = normalize(sunDir.cross(up));
      const sUp = normalize(right.cross(sunDir));
      const u = dot(dir, right);
      const v = dot(dir, sUp);
      const facing = step(0.0, dot(dir, sunDir));
      const r = float(0.2);
      const d = u.mul(u).add(v.mul(v)).sqrt();
      const disc = float(1.0).sub(smoothstep(r.sub(0.004), r, d)).mul(facing);
      const t = clamp(v.div(r).mul(0.5).add(0.5), 0.0, 1.0); // 0 низ .. 1 верх
      const sunCol = mix(color(PALETTE.magenta), color(PALETTE.yellow), smoothstep(0.1, 0.95, t));
      // прорези в нижней половине: шире книзу, медленно ползут вниз
      const bands = fract(t.mul(9.0).add(time.mul(0.12)));
      const gap = smoothstep(0.62, 0.0, t).mul(0.55);
      const slit = step(gap, bands);
      // солнце частично за горизонтом
      const aboveHorizon = smoothstep(-0.002, 0.004, h);
      return sunCol.mul(disc.mul(slit).mul(aboveHorizon));
    })();

    mat.colorNode = skyColor.add(sunDisc.mul(1.6));
    // emissive-канал: солнце и немного ореола → bloom
    const sd = dot(dir, sunDir);
    setGlow(mat, sunDisc.mul(sunIntensity).add(color(PALETTE.pink).mul(pow(max(sd, 0.0), 220.0).mul(0.25))));
    return mat;
  }
}

/** Кольцо низкополигональных хребтов на горизонте с неоновой кромкой */
function createMountains(): Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const glow: number[] = [];
  const R = 1420;
  const segs = 160;
  const base = new Color(PALETTE.void);
  const face = new Color(PALETTE.purple);
  const rim = new Color(PALETTE.magenta);
  const rimCyan = new Color(PALETTE.cyan);

  // детерминированный «шум» высот
  const heightAt = (i: number): number => {
    const a = (i / segs) * Math.PI * 2;
    const n =
      Math.sin(a * 3.0 + 1.3) * 0.5 +
      Math.sin(a * 7.0 + 0.4) * 0.3 +
      Math.sin(a * 17.0 + 2.1) * 0.2 +
      (((i * 7919) % 13) / 13 - 0.5) * 0.35;
    // ниже в направлении солнца, чтобы не загораживать его
    const sunA = Math.atan2(SUN_DIR.z, SUN_DIR.x);
    const da = Math.abs(Math.atan2(Math.sin(a - sunA), Math.cos(a - sunA)));
    const sunDip = 0.35 + 0.65 * Math.min(1, da / 0.6);
    return (55 + 70 * (n * 0.5 + 0.5)) * sunDip;
  };

  const push = (x: number, y: number, z: number, c: Color, g: number) => {
    positions.push(x, y, z);
    colors.push(c.r, c.g, c.b);
    glow.push(g);
  };

  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const h0 = heightAt(i);
    const h1 = heightAt(i + 1);
    const x0 = Math.cos(a0) * R;
    const z0 = Math.sin(a0) * R;
    const x1 = Math.cos(a1) * R;
    const z1 = Math.sin(a1) * R;
    const shade = face.clone().lerp(base, ((i * 31) % 7) / 10);
    // тело хребта (два треугольника, внутренняя сторона смотрит на центр)
    push(x0, -30, z0, base, 0);
    push(x1, -40, z1, base, 0);
    push(x0, h0, z0, shade, 0);
    push(x1, -40, z1, base, 0);
    push(x1, h1, z1, shade, 0);
    push(x0, h0, z0, shade, 0);
    // неоновая кромка по гребню
    const t = 5;
    const rc = i % 2 === 0 ? rim : rim.clone().lerp(rimCyan, 0.25);
    push(x0, h0 - t, z0, rc, 1);
    push(x1, h1 - t, z1, rc, 1);
    push(x0, h0, z0, rc, 1);
    push(x1, h1 - t, z1, rc, 1);
    push(x1, h1, z1, rc, 1);
    push(x0, h0, z0, rc, 1);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geo.setAttribute('glow', new Float32BufferAttribute(glow, 1));
  const mat = new MeshBasicNodeMaterial({ side: BackSide, fog: false, depthWrite: false });
  const g = attribute('glow', 'float');
  mat.colorNode = vertexColor().mul(g.mul(0.8).add(1.0));
  setGlow(mat, vertexColor().mul(g).mul(0.9));
  // горы тонут в дымке у подножия
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = -9;
  mesh.frustumCulled = false;
  return mesh;
}
