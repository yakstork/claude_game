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
  sin,
  smoothstep,
  step,
  time,
  uniform,
  vec2,
  vec3,
  vertexColor,
  attribute,
} from 'three/tsl';
import { PALETTE } from './palette';
import { setGlow } from './materials';
import { Blimps } from './blimps';
import { skyUniforms, type TodPreset } from './timeOfDay';

/** Направление на солнце (над восточным горизонтом — по стартовой прямой) */
export const SUN_DIR = new Vector3(1, 0.075, 0.12).normalize();

const SKY_RADIUS = 1500;

export class Sky {
  readonly group = new Group();
  private readonly dome: Mesh;
  readonly sunIntensity = uniform(1);
  /** 0 — обычное закатное небо, 1 — ночная гроза */
  readonly storm = uniform(0);
  /** Вспышка молнии 0..1 */
  readonly flash = uniform(0);
  /** Направление на солнце (ночью — на луну) */
  readonly sunDirU = uniform(SUN_DIR.clone());
  private readonly sunVis = uniform(1);
  private readonly night = uniform(0);
  private readonly glowCol = uniform(new Color(PALETTE.orange));
  private readonly sunTop = uniform(new Color(PALETTE.yellow));
  private readonly sunBottom = uniform(new Color(PALETTE.magenta));
  private mountains: Mesh;
  private readonly blimps = new Blimps();
  private lastT = 0;

  constructor() {
    this.dome = new Mesh(new SphereGeometry(SKY_RADIUS, 48, 24), this.createSkyMaterial());
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);
    this.mountains = createMountains();
    this.group.add(this.mountains);
    this.group.add(this.blimps.group);
  }

  /** Применить пресет времени суток (цвета, солнце/луна, звёзды) */
  setPreset(p: TodPreset): void {
    skyUniforms.zenith.value.set(p.zenith);
    skyUniforms.high.value.set(p.high);
    skyUniforms.mid.value.set(p.mid);
    skyUniforms.horizon.value.set(p.horizon);
    this.sunDirU.value.copy(p.sunDir);
    this.sunVis.value = p.sunVis;
    this.night.value = p.night;
    this.glowCol.value.set(p.glow);
    this.sunTop.value.set(p.sunTop);
    this.sunBottom.value.set(p.sunBottom);
    // хребты «проседают» там, где солнце
    const a0 = Math.atan2(SUN_DIR.z, SUN_DIR.x);
    this.mountains.rotation.y = a0 - Math.atan2(p.sunDir.z, p.sunDir.x);
  }

  /** Небо и горы следуют за камерой по горизонтали */
  update(cameraPos: Vector3): void {
    this.group.position.set(cameraPos.x, 0, cameraPos.z);
    const now = performance.now() / 1000;
    this.blimps.update(this.lastT ? Math.min(0.1, now - this.lastT) : 0);
    this.lastT = now;
  }

  private createSkyMaterial(): MeshBasicNodeMaterial {
    const mat = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false });
    const sunDir = this.sunDirU;
    const night = this.night;
    const sunVis = this.sunVis;
    const sunIntensity = this.sunIntensity;

    const dir = normalize(positionLocal);
    const h = dir.y;

    // падающие звёзды: короткие вспышки-штрихи в верхней полусфере (2 независимых «слота»)
    const meteor = (period: number, seed: number) => {
      const q = vec2(dir.x, dir.z);
      const t = time.div(period).add(seed);
      const id = floor(t);
      const ph = fract(t).div(0.1); // активна первые 10% периода
      const r1 = hash(id.add(seed * 13.0));
      const r2 = hash(id.add(seed * 29.0 + 3.7));
      const r3 = hash(id.add(seed * 41.0 + 9.1));
      const start = vec2(r1.sub(0.5).mul(1.4), r2.sub(0.5).mul(1.4));
      const ang = r3.mul(6.283);
      const vel = vec2(ang.cos(), ang.sin());
      const head = start.add(vel.mul(ph.mul(0.55)));
      const tail = head.sub(vel.mul(0.16));
      const seg = head.sub(tail);
      const k = clamp(dot(q.sub(tail), seg).div(dot(seg, seg)), 0.0, 1.0);
      const dist = q.sub(tail.add(seg.mul(k))).length();
      const line = smoothstep(0.006, 0.0, dist).mul(k);
      const alive = step(ph, 1.0).mul(smoothstep(0.0, 0.1, ph)).mul(smoothstep(1.0, 0.7, ph));
      return line.mul(alive).mul(smoothstep(0.35, 0.6, dir.y));
    };
    const meteors = vec3(1.0, 0.85, 1.0).mul(meteor(9.0, 0.0).add(meteor(14.0, 0.37)).mul(1.4));

    const skyColor = Fn(() => {
      const zenith = skyUniforms.zenith;
      const high = skyUniforms.high;
      const mid = skyUniforms.mid;
      const horizon = skyUniforms.horizon;
      // градиент: горизонт → середина → высоко → зенит
      const c1 = mix(horizon, mid, smoothstep(0.0, 0.09, h));
      const c2 = mix(c1, high, smoothstep(0.07, 0.3, h));
      const c3 = mix(c2, zenith, smoothstep(0.28, 0.75, h));
      // ниже горизонта — тёмный фиолетовый (прячется за землёй и туманом)
      const below = mix(skyUniforms.mid.mul(0.5), color(PALETTE.void), smoothstep(0.0, -0.15, h));
      const base = mix(below, c3, step(0.0, h));

      // свечение вокруг солнца, сильнее у горизонта
      const sd = dot(dir, sunDir);
      const glow = pow(max(sd, 0.0), 12.0).mul(0.55).add(pow(max(sd, 0.0), 90.0).mul(0.6));
      const horizonGlow = exp(abs(h).mul(-14.0)).mul(0.35);
      const warmDay = this.glowCol.mul(glow.add(horizonGlow.mul(max(sd, 0.2))));
      // ночью — слабое свечение города у горизонта и ореол луны
      const warmNight = this.glowCol.mul(horizonGlow.mul(0.7)).add(color(PALETTE.lilac).mul(pow(max(sd, 0.0), 40.0).mul(0.3)));
      const warm = mix(warmDay, warmNight, night);

      // звёзды: разреженные точки в верхней полусфере
      const cell = floor(dir.mul(260.0));
      const rnd = hash(cell.x.add(cell.y.mul(157.0)).add(cell.z.mul(113.0)));
      const twinkle = fract(rnd.mul(17.0).add(time.mul(0.15))).mul(0.6).add(0.4);
      const thr = mix(float(0.9965), float(0.984), night);
      const lowH = mix(float(0.22), float(0.04), night);
      const star = step(thr, rnd).mul(smoothstep(lowH, lowH.add(0.33), h)).mul(twinkle);

      return base.add(warm).add(vec3(star, star, star).mul(0.9)).add(meteors);
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
      const sunCol = mix(this.sunBottom, this.sunTop, smoothstep(0.1, 0.95, t));
      // прорези в нижней половине: шире книзу, медленно ползут вниз
      const bands = fract(t.mul(9.0).add(time.mul(0.12)));
      const gap = smoothstep(0.62, 0.0, t).mul(0.55);
      const slit = step(gap, bands);
      // солнце частично за горизонтом
      const aboveHorizon = smoothstep(-0.002, 0.004, h);
      return sunCol.mul(disc.mul(slit).mul(aboveHorizon)).mul(sunVis);
    })();

    // луна-диск с неоновой сеткой (только ночью)
    const moon = Fn(() => {
      const up = vec3(0, 1, 0);
      const right = normalize(sunDir.cross(up));
      const mUp = normalize(right.cross(sunDir));
      const r = float(0.085);
      const u = dot(dir, right).div(r);
      const v = dot(dir, mUp).div(r);
      const d = u.mul(u).add(v.mul(v)).sqrt();
      const facing = step(0.0, dot(dir, sunDir));
      const disc = float(1.0).sub(smoothstep(0.96, 1.0, d)).mul(facing);
      // сетка: меридианы и параллели, сжатые к краю диска
      const gu = abs(fract(u.mul(1.5).add(0.5)).sub(0.5));
      const gv = abs(fract(v.mul(1.5).add(0.5)).sub(0.5));
      const line = max(smoothstep(0.07, 0.02, gu), smoothstep(0.07, 0.02, gv));
      const face = mix(color(PALETTE.white), color(PALETTE.lilac), smoothstep(-0.8, 0.9, v.negate()).mul(0.55));
      const col = mix(face, color(PALETTE.magenta), line.mul(0.85));
      return col.mul(disc).mul(night);
    })();

    // грозовое небо: тёмные тучи, свечение города у горизонта, вспышки молний
    const storm = this.storm;
    const flash = this.flash;
    const stormSky = Fn(() => {
      const q = vec2(dir.x, dir.z).div(max(h, 0.0).add(0.28));
      const n1 = sin(q.x.mul(1.7).add(time.mul(0.03))).mul(sin(q.y.mul(1.3).sub(time.mul(0.02))));
      const n2 = sin(q.x.mul(3.9).add(q.y.mul(2.7)).add(time.mul(0.045))).mul(0.5);
      const n3 = sin(q.y.mul(6.1).sub(q.x.mul(4.3)).sub(time.mul(0.06))).mul(0.25);
      const cloud = smoothstep(-0.25, 0.7, n1.add(n2).add(n3));
      const gradient = mix(color(0x2a0a40), color(PALETTE.void), smoothstep(0.0, 0.55, h));
      const body = mix(gradient, color(PALETTE.skyHigh).mul(0.45), cloud.mul(0.85));
      const cityGlow = color(PALETTE.magenta).mul(exp(abs(h).mul(-9.0)).mul(0.3));
      const below = color(PALETTE.void).mul(1.4);
      const lit = body.add(cityGlow).add(color(PALETTE.lilac).add(float(0.3)).mul(flash.mul(cloud.mul(0.9).add(0.25))));
      return mix(below, lit, step(-0.02, h));
    })();
    const clearSky = skyColor.add(sunDisc.mul(1.6)).add(moon.mul(1.3));
    mat.colorNode = mix(clearSky, stormSky, storm);
    // emissive-канал: солнце и немного ореола → bloom
    const sd = dot(dir, sunDir);
    setGlow(
      mat,
      sunDisc.mul(sunIntensity).add(moon.mul(0.55)).add(meteors.mul(0.8)).add(color(PALETTE.pink).mul(pow(max(sd, 0.0), 220.0).mul(0.25))).mul(float(1.0).sub(storm)).add(color(PALETTE.lilac).mul(flash.mul(0.5))),
    );
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
