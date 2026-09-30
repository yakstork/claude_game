/**
 * Неоновые вывески и билборды с выдуманными названиями. Атлас рисуется кодом
 * в canvas (без внешних файлов), все вывески — один меш с одним материалом.
 */
import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three/webgpu';
import { floor, fract, hash, sin, texture, time, uv, attribute, step, mix, float } from 'three/tsl';
import { PALETTE, cssColor } from './palette';
import { setGlow } from './materials';

/** Выдуманные бренды (никаких реальных марок) */
export const SIGN_NAMES = [
  'VAPOR COLA',
  'SYNTH FM 88.3',
  'NEON NOODLES',
  'LASER BOWL',
  'VHS PALACE',
  'CHROME MOTEL',
  'CLUB 2084',
  'TURBO ARCADE',
];

const SIGN_COLORS = [PALETTE.magenta, PALETTE.cyan, PALETTE.yellow, PALETTE.pink, PALETTE.orange, PALETTE.lilac, PALETTE.cyan, PALETTE.magenta];
const COLS = 2;
const ROWS = 8;
export const SIGN_COUNT = SIGN_NAMES.length * COLS;

function createAtlas(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const W = 1024;
  const H = 1024;
  const cw = W / COLS;
  const ch = H / ROWS;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  if (!g) return null;
  g.fillStyle = cssColor(PALETTE.void);
  g.fillRect(0, 0, W, H);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c * cw;
      const y = r * ch;
      // вариант 0 — основной цвет, вариант 1 — со сдвигом палитры
      const col = cssColor(SIGN_COLORS[(r + c * 3) % SIGN_COLORS.length]);
      const alt = cssColor(SIGN_COLORS[(r + c * 3 + 1) % SIGN_COLORS.length]);
      g.fillStyle = '#12052a';
      g.fillRect(x + 4, y + 4, cw - 8, ch - 8);
      // неоновая рамка
      g.shadowColor = alt;
      g.shadowBlur = 14;
      g.strokeStyle = alt;
      g.lineWidth = 5;
      g.strokeRect(x + 12, y + 12, cw - 24, ch - 24);
      // текст
      g.shadowColor = col;
      g.shadowBlur = 22;
      g.fillStyle = '#fff6ff';
      const text = SIGN_NAMES[r];
      let size = 58;
      g.font = `italic 900 ${size}px "Arial Black", "Trebuchet MS", sans-serif`;
      while (g.measureText(text).width > cw - 70 && size > 20) {
        size -= 2;
        g.font = `italic 900 ${size}px "Arial Black", "Trebuchet MS", sans-serif`;
      }
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, x + cw / 2, y + ch / 2 + 2);
      g.shadowBlur = 0;
      g.strokeStyle = col;
      g.lineWidth = 2.5;
      g.strokeText(text, x + cw / 2, y + ch / 2 + 2);
    }
  }
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Накопитель квадов вывесок с UV в атлас */
export class SignBuilder {
  private readonly pos: number[] = [];
  private readonly uvs: number[] = [];
  private readonly seed: number[] = [];
  private count = 0;

  get size(): number {
    return this.count;
  }

  /**
   * Вывеска: центр, направление «вправо» по плоскости (единичный), нормаль (куда смотрит),
   * ширина/высота (соотношение 4:1 выглядит лучше всего), индекс вывески 0..SIGN_COUNT-1.
   */
  add(center: Vector3, right: Vector3, normal: Vector3, w: number, h: number, index: number): void {
    const up = new Vector3().crossVectors(normal, right).normalize();
    const hw = w / 2;
    const hh = h / 2;
    const p = (sx: number, sy: number) =>
      new Vector3().copy(center).addScaledVector(right, sx * hw).addScaledVector(up, sy * hh).addScaledVector(normal, 0.05);
    const a = p(-1, -1);
    const b = p(1, -1);
    const c = p(1, 1);
    const d = p(-1, 1);
    const i = ((index % SIGN_COUNT) + SIGN_COUNT) % SIGN_COUNT;
    const col = Math.floor(i / ROWS);
    const row = i % ROWS;
    const u0 = col / COLS;
    const u1 = (col + 1) / COLS;
    // canvas: строка 0 сверху → v сверху = 1
    const v1 = 1 - row / ROWS;
    const v0 = 1 - (row + 1) / ROWS;
    const s = (this.count * 0.618034) % 1;
    for (const [v, uu, vv] of [
      [a, u0, v0],
      [b, u1, v0],
      [c, u1, v1],
      [a, u0, v0],
      [c, u1, v1],
      [d, u0, v1],
    ] as [Vector3, number, number][]) {
      this.pos.push(v.x, v.y, v.z);
      this.uvs.push(uu, vv);
      this.seed.push(s);
    }
    this.count++;
  }

  build(): Mesh | null {
    const tex = createAtlas();
    if (!tex || this.count === 0) return null;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2));
    geo.setAttribute('signSeed', new Float32BufferAttribute(this.seed, 1));
    geo.computeBoundingSphere();
    const mat = new MeshBasicNodeMaterial();
    const seed = attribute('signSeed', 'float');
    const tc = texture(tex, uv()).rgb;
    // редкое «моргание» неона у части вывесок
    const blinkOn = step(0.04, fract(time.mul(0.23).add(seed.mul(7.0))));
    const flick = mix(float(1.0), blinkOn, step(0.7, hash(floor(seed.mul(100.0)))));
    const pulse = sin(time.mul(2.0).add(seed.mul(20.0))).mul(0.08).add(0.92);
    mat.colorNode = tc.mul(flick).mul(pulse).mul(1.25);
    setGlow(mat, tc.mul(flick).mul(0.7));
    return new Mesh(geo, mat);
  }
}
