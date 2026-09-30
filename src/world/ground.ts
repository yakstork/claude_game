/**
 * Земля — огромная плоскость с анимированной неоновой сеткой (TSL):
 * сглаженные линии через fwidth, бегущие от солнца импульсы, затухание к горизонту.
 */
import { Mesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu';
import {
  abs,
  cameraPosition,
  clamp,
  color,
  float,
  fract,
  fwidth,
  length,
  max,
  mix,
  positionWorld,
  sin,
  smoothstep,
  time,
  uniform,
  vec2,
} from 'three/tsl';
import { PALETTE } from './palette';
import { setGlow } from './materials';

export class Ground {
  readonly mesh: Mesh;
  /** Дальность видимости сетки (зависит от качества) */
  readonly fadeDistance = uniform(1300);

  constructor() {
    const geo = new PlaneGeometry(9000, 9000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new MeshBasicNodeMaterial({ fog: false });
    const fadeDistance = this.fadeDistance;

    {
      const p = positionWorld.xz;
      const cell = float(16.0);
      const coord = p.div(cell);
      const fw = max(fwidth(coord), vec2(0.0001, 0.0001));
      // расстояние до ближайшей линии в пикселях
      const g = abs(fract(coord.sub(0.5)).sub(0.5)).div(fw);
      const line = float(1.0).sub(clamp(g.x.min(g.y), 0.0, 1.0));
      // крупная сетка (каждые 4 клетки) ярче
      const coord4 = coord.div(4.0);
      const fw4 = max(fwidth(coord4), vec2(0.0001, 0.0001));
      const g4 = abs(fract(coord4.sub(0.5)).sub(0.5)).div(fw4.mul(1.6));
      const major = float(1.0).sub(clamp(g4.x.min(g4.y), 0.0, 1.0));

      const dist = length(p.sub(cameraPosition.xz));
      const fade = float(1.0).sub(smoothstep(fadeDistance.mul(0.25), fadeDistance, dist));
      // импульсы бегут от солнца (с востока на запад)
      const pulse = smoothstep(0.82, 1.0, sin(p.x.mul(0.018).add(time.mul(2.2)))).mul(0.9);
      const shimmer = sin(p.y.mul(0.05).add(time.mul(0.7))).mul(0.15).add(0.85);

      const lineCol = mix(color(PALETTE.violet), color(PALETTE.magenta), clamp(dist.div(fadeDistance).mul(1.4), 0.0, 1.0));
      const pulseCol = color(PALETTE.pink);
      const intensity = line.mul(0.55).add(major.mul(0.6)).mul(shimmer).mul(fade);
      const lines = lineCol.mul(intensity).add(pulseCol.mul(pulse.mul(line.add(major)).mul(fade)));

      // пол: тёмный фиолетовый, у горизонта уходит в цвет дымки
      const floorCol = mix(color(PALETTE.void), color(PALETTE.deepViolet), smoothstep(0.0, fadeDistance, dist));
      const haze = mix(floorCol, color(PALETTE.skyHigh).mul(0.55), smoothstep(fadeDistance.mul(0.6), fadeDistance.mul(1.6), dist));
      mat.colorNode = haze.add(lines);
      setGlow(mat, lines.mul(0.55));
    }
    this.mesh = new Mesh(geo, mat);
    this.mesh.position.y = -0.3;
    this.mesh.renderOrder = -5;
  }
}
