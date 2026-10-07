/**
 * Море для трассы «Midnight Coast»: low-poly плоскость с медленными волнами (TSL),
 * неоновая дорожка отражения заката, песчаный пляж с неоновой кромкой прибоя.
 * Море лежит к востоку от линии берега shoreX(z), т. е. снаружи длинной правой дуги.
 */
import { BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  clamp,
  color,
  dot,
  exp,
  float,
  fract,
  length,
  max,
  mix,
  normalize,
  positionGeometry,
  positionLocal,
  sin,
  smoothstep,
  step,
  time,
  vec2,
  vec3,
  vertexColor,
} from 'three/tsl';
import { PALETTE } from './palette';
import { setGlow } from './materials';
import { GROUND_Y } from './constants';
import { sunDirUniform, sunGlintBottom, sunGlintTop } from './timeOfDay';

const SEA_Y = GROUND_Y + 0.2;
const SEA_SPAN = 1700;
export const BEACH_WIDTH = 50;

/** Линия берега: x как функция z (плавно виляет) */
export function shoreX(z: number): number {
  return 271 + 9 * Math.sin(z * 0.021 + 1.0) + 5 * Math.sin(z * 0.057);
}

function seaMaterial(): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({ fog: false });
  const p = positionGeometry.xz;
  // медленные волны: смещение вершин по высоте
  const wave = sin(p.x.mul(0.045).add(time.mul(0.55))).mul(0.14).add(sin(p.y.mul(0.06).sub(time.mul(0.4))).mul(0.1));
  mat.positionNode = positionLocal.add(vec3(0, wave, 0));

  const d = p.sub(cameraPosition.xz);
  const dist = length(d);
  const s = normalize(vec2(sunDirUniform.x, sunDirUniform.z));
  const along = dot(d, s);
  const perp = d.x.mul(s.y).sub(d.y.mul(s.x));
  // дорожка отражения: узкая у камеры, расширяется с расстоянием
  const ang = perp.abs().div(max(along, 8.0));
  const path = exp(ang.div(0.07).mul(ang.div(0.07)).negate()).mul(step(0.0, along));
  const chop = sin(p.x.mul(0.13).add(time.mul(1.4))).mul(sin(p.y.mul(0.11).sub(time.mul(1.0)))).mul(0.5).add(0.5);
  const slits = step(0.3, fract(along.mul(0.035).sub(time.mul(0.25)))).mul(0.55).add(0.45);
  const pathCol = mix(sunGlintBottom, sunGlintTop, smoothstep(0.0, 0.5, path).mul(path));
  const reflect = pathCol.mul(path.mul(slits).mul(chop.mul(1.3).add(0.25)).mul(1.6));

  // базовый цвет воды и неоновые гребни
  const deep = mix(color(PALETTE.deepViolet), color(PALETTE.void), smoothstep(0.0, 900.0, dist));
  const crestT = sin(p.x.mul(0.05).add(p.y.mul(0.025)).add(time.mul(0.7)));
  const crest = smoothstep(0.9, 1.0, crestT).mul(smoothstep(900.0, 80.0, dist));
  const crestCol = mix(color(PALETTE.violet), color(PALETTE.cyan), clamp(sin(p.y.mul(0.01)).mul(0.5).add(0.5), 0.0, 1.0)).mul(crest.mul(0.9));
  const lit = deep.add(crestCol).add(reflect);
  const haze = mix(lit, color(PALETTE.skyMid).mul(0.55), smoothstep(450.0, 1500.0, dist));
  mat.colorNode = haze;
  setGlow(mat, crestCol.mul(0.5).add(reflect.mul(0.7)).mul(float(1.0).sub(smoothstep(900.0, 1500.0, dist))));
  return mat;
}

/** Береговая полоса: песок (vertex colors) + светящаяся кромка прибоя */
function beachMesh(): Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const glow: number[] = [];
  const sandA = new Color(PALETTE.purple).lerp(new Color(PALETTE.orange), 0.18);
  const sandB = new Color(PALETTE.deepViolet).lerp(new Color(PALETTE.violet), 0.15);
  const foam = new Color(PALETTE.cyan);
  const z0 = -1000;
  const z1 = 700;
  const step_ = 12;
  const push = (x: number, y: number, z: number, c: Color, g: number) => {
    pos.push(x, y, z);
    col.push(c.r, c.g, c.b);
    glow.push(g);
  };
  for (let z = z0; z < z1; z += step_) {
    const xa = shoreX(z);
    const xb = shoreX(z + step_);
    const ia = xa - BEACH_WIDTH;
    const ib = xb - BEACH_WIDTH;
    // песок: от внутренней границы к берегу, плавно опускается
    push(ia, GROUND_Y + 0.35, z, sandB, 0);
    push(xa, SEA_Y - 0.05, z, sandA, 0);
    push(xb, SEA_Y - 0.05, z + step_, sandA, 0);
    push(ia, GROUND_Y + 0.35, z, sandB, 0);
    push(xb, SEA_Y - 0.05, z + step_, sandA, 0);
    push(ib, GROUND_Y + 0.35, z + step_, sandB, 0);
    // неоновая кромка прибоя
    push(xa - 1.4, SEA_Y + 0.12, z, foam, 1);
    push(xa + 0.6, SEA_Y + 0.12, z, foam, 1);
    push(xb + 0.6, SEA_Y + 0.12, z + step_, foam, 1);
    push(xa - 1.4, SEA_Y + 0.12, z, foam, 1);
    push(xb + 0.6, SEA_Y + 0.12, z + step_, foam, 1);
    push(xb - 1.4, SEA_Y + 0.12, z + step_, foam, 1);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.setAttribute('glow', new Float32BufferAttribute(glow, 1));
  const mat = new MeshBasicNodeMaterial({ fog: false, side: 2 });
  const g = attribute('glow', 'float');
  mat.colorNode = vertexColor().mul(g.mul(1.2).add(1.0));
  setGlow(mat, vertexColor().mul(g).mul(0.8));
  const m = new Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}

export class Sea {
  readonly group = new Group();

  constructor() {
    // сетка ~34 м: достаточно для медленных волн, 50×100 ячеек
    const nx = 50;
    const nz = 100;
    const pos: number[] = [];
    const idx: number[] = [];
    const x0 = 260;
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const z = -SEA_SPAN + (j / nz) * SEA_SPAN * 2;
        // у берега ближе к кромке: первая колонка идёт по линии берега
        const x = i === 0 ? shoreX(z) - 2 : x0 + (i / nx) * (SEA_SPAN + 200);
        pos.push(i === 0 ? x : Math.max(x, shoreX(z) + 1), SEA_Y, z);
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        const b = a + 1;
        const c = a + nx + 1;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const sea = new Mesh(geo, seaMaterial());
    sea.frustumCulled = false;
    sea.renderOrder = -4;
    this.group.add(sea, beachMesh());
  }
}
