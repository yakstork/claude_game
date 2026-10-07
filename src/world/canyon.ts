/**
 * Декор трассы «Neon Canyon»: low-poly скалы-стены вдоль дороги (слоистые, цвета
 * из палитры), далёкие столовые горы и опоры моста-эстакады. Один смёрженный меш.
 */
import { Color, DoubleSide, Group, Matrix4, Mesh, MeshStandardNodeMaterial, Vector3 } from 'three/webgpu';
import { attribute, mix, step, vertexColor } from 'three/tsl';
import type { Track } from './track';
import { PALETTE } from './palette';
import { GeometryBuilder } from './geometryBuilder';
import { GROUND_Y } from './constants';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STRATA = [PALETTE.purple, PALETTE.skyHigh, PALETTE.deepViolet, PALETTE.purple];
const _m = new Matrix4();
const _r = new Matrix4();
const _c = new Color();

/** Одна скала: 2–3 слоя-призмы (страты), верхний слой окрашен «закатом» */
function addRock(gb: GeometryBuilder, x: number, y0: number, z: number, rot: number, w: number, d: number, h: number, rand: () => number): void {
  _m.makeTranslation(x, y0, z).multiply(_r.makeRotationY(rot));
  const layers = h > 30 ? 3 : 2;
  let yb = 0;
  let wd = w;
  let dd = d;
  for (let k = 0; k < layers; k++) {
    const hh = k === layers - 1 ? h - yb : (h - yb) * (0.4 + rand() * 0.2);
    const top = k === layers - 1;
    const col = _c.set(STRATA[Math.floor(rand() * STRATA.length)]);
    if (top) col.lerp(new Color(PALETTE.skyMid), 0.18 + rand() * 0.18);
    const j = () => (rand() - 0.5) * dd * 0.5;
    // профиль в (z, y), против часовой при взгляде с +X; верх — неровный
    const profile: [number, number][] = [
      [-dd, yb - 1],
      [dd, yb - 1],
      [dd * 0.85 + j() * 0.2, yb + hh * 0.55],
      [dd * 0.35 + j() * 0.3, yb + hh],
      [-dd * 0.3 + j() * 0.3, yb + hh * (0.9 + rand() * 0.1)],
      [-dd * 0.9 + j() * 0.2, yb + hh * 0.5],
    ];
    gb.prism(profile, wd, col, top ? 0.04 : 0, _m, top ? 0.35 : 0.18, top ? new Color(PALETTE.orange).lerp(col, 0.7) : undefined);
    yb += hh * 0.9;
    wd *= 0.72;
    dd *= 0.72;
  }
}

function canyonMaterial(): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0.0, flatShading: true, side: DoubleSide });
  const g = attribute('glow', 'float');
  mat.colorNode = vertexColor();
  mat.emissiveNode = mix(vertexColor().mul(0.0), vertexColor().mul(1.2), step(0.5, g));
  return mat;
}

export function buildCanyon(track: Track): Group {
  const group = new Group();
  const gb = new GeometryBuilder();
  const rand = rng(90210);
  const sample = track.sampleAt(0);
  const p = new Vector3();

  // грубая выборка осевой для проверки «не на чужом участке трассы»
  const pts: number[] = [];
  for (let s = 0; s < track.length; s += 10) {
    track.sampleAt(s, sample);
    pts.push(sample.position.x, sample.position.z, sample.halfWidth);
  }
  const clear = (x: number, z: number, r: number): boolean => {
    for (let i = 0; i < pts.length; i += 3) {
      if (Math.hypot(x - pts[i], z - pts[i + 1]) < pts[i + 2] + r + 6) return false;
    }
    return true;
  };

  // Скалы-стены вдоль дороги: два ряда с каждой стороны
  for (let s = 0; s < track.length; s += 15 + rand() * 9) {
    track.sampleAt(s, sample);
    // на мосту и эстакадных участках стены — только далеко и ниже уровня дороги
    const elevated = sample.position.y > 4;
    for (const side of [-1, 1]) {
      for (let row = 0; row < 2; row++) {
        const w = 14 + rand() * 18;
        const d = 12 + rand() * 16;
        const off = sample.halfWidth + (elevated ? 38 : 13) + row * (20 + rand() * 14) + rand() * 8 + w * 0.4;
        p.copy(sample.position).addScaledVector(sample.right, side * off);
        if (!clear(p.x, p.z, Math.max(w, d))) continue;
        let h = (elevated ? 18 : 30) + rand() * (elevated ? 22 : 38) + row * 14;
        if (rand() < 0.12) h *= 1.5;
        const rot = Math.atan2(sample.tangent.x, sample.tangent.z) + (rand() - 0.5) * 0.5;
        addRock(gb, p.x, GROUND_Y, p.z, rot, w, d, h, rand);
      }
    }
  }

  // Дальние столовые горы по кругу вокруг центра трассы
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < pts.length; i += 3) {
    cx += pts[i];
    cz += pts[i + 1];
  }
  cx /= pts.length / 3;
  cz /= pts.length / 3;
  for (let k = 0; k < 28; k++) {
    const a = (k / 28) * Math.PI * 2 + rand() * 0.15;
    const r = 700 + rand() * 260;
    const w = 60 + rand() * 80;
    addRock(gb, cx + Math.cos(a) * r, GROUND_Y, cz + Math.sin(a) * r, -a + Math.PI / 2, w, 50 + rand() * 60, 90 + rand() * 120, rand);
  }

  // Опоры моста: колонны под настилом, где дорога выше ~3 м
  const pillar = new Color(PALETTE.deepViolet);
  for (let s = 0; s < track.length; s += 28) {
    track.sampleAt(s, sample);
    const y = sample.position.y;
    if (y < 3.5) continue;
    const hgt = y - GROUND_Y - 0.9;
    const rot = Math.atan2(sample.tangent.x, sample.tangent.z);
    for (const side of [-1, 1]) {
      p.copy(sample.position).addScaledVector(sample.right, side * (sample.halfWidth * 0.55));
      _m.makeTranslation(p.x, GROUND_Y + hgt / 2, p.z).multiply(_r.makeRotationY(rot));
      gb.box(2.2, hgt, 2.2, pillar, 0, _m);
    }
    // поперечная балка с неоновой кромкой
    _m.makeTranslation(sample.position.x, y - 1.2, sample.position.z).multiply(_r.makeRotationY(rot));
    gb.box(sample.halfWidth * 2 + 0.4, 0.8, 1.6, pillar, 0, _m);
    _m.makeTranslation(sample.position.x, y - 0.75, sample.position.z).multiply(_r.makeRotationY(rot));
    gb.box(sample.halfWidth * 2 + 0.5, 0.12, 1.7, PALETTE.orange, 1, _m);
  }

  const geo = gb.build();
  const mesh = new Mesh(geo, canyonMaterial());
  mesh.frustumCulled = false;
  group.add(mesh);
  return group;
}
