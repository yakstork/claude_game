/**
 * Кинематографичные кадры: облёт перед стартом и орбита вокруг машины на финише.
 * Чистая математика без three/DOM: на выходе поза камеры (позиция, цель, FOV).
 */

export interface CamPose {
  px: number;
  py: number;
  pz: number;
  lx: number;
  ly: number;
  lz: number;
  fov: number;
}

export function createPose(): CamPose {
  return { px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0, fov: 62 };
}

/** Длительность облёта перед стартом, с */
export const INTRO_DURATION = 3.6;
/** Длительность орбиты на финише, с */
export const FINISH_ORBIT_DURATION = 2.6;

const BASE_FOV = 62;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Облёт: сначала пролёт вдоль трассы к решётке (из точки ahead), затем виток вокруг
 * машины игрока и посадка ровно в позицию обычной дальней chase-камеры (u = 1).
 * (cx, cy, cz) — машина игрока на решётке, heading — её курс, (ax, ay, az) — начальная точка пролёта.
 */
export function introPose(u: number, cx: number, cy: number, cz: number, heading: number, ax: number, ay: number, az: number, out: CamPose): void {
  const k = clamp01(u);
  // пролёт: из высокой точки впереди к решётке
  const f = smooth(k / 0.7);
  const fx = lerp(ax, cx, f);
  const fy = lerp(ay + 24, cy + 12, f);
  const fz = lerp(az, cz, f);
  // виток: от бокового ракурса к виду сзади
  const e = smooth(k);
  const a = heading + Math.PI + (1 - e) * 2.4;
  const r = lerp(18, 7.6, e);
  const oy = lerp(11, 2.9, e);
  const ox = cx + Math.sin(a) * r;
  const oz = cz + Math.cos(a) * r;
  const w = smooth((k - 0.35) / 0.4);
  out.px = lerp(fx, ox, w);
  out.py = lerp(fy, cy + oy, w);
  out.pz = lerp(fz, oz, w);
  // цель: решётка → точка перед капотом, как у chase-камеры
  const sh = Math.sin(heading);
  const ch = Math.cos(heading);
  out.lx = cx + sh * 5 * e;
  out.ly = cy + 1.25;
  out.lz = cz + ch * 5 * e;
  out.fov = lerp(50, BASE_FOV, e);
}

/** Орбита вокруг машины после финиша: t — секунды с финиша; (ax, ay, az) — центр салюта над аркой. */
export function finishPose(t: number, tx: number, ty: number, tz: number, heading: number, ax: number, ay: number, az: number, out: CamPose): void {
  const k = smooth(t / FINISH_ORBIT_DURATION);
  const a = heading + Math.PI - 0.4 + k * 2.6;
  const r = lerp(9, 13, k);
  out.px = tx + Math.sin(a) * r;
  out.py = ty + lerp(2.4, 4.2, k);
  out.pz = tz + Math.cos(a) * r;
  // взгляд смещается от машины к арке, над которой салют
  const m = 0.32 * k;
  out.lx = lerp(tx, ax, m);
  out.ly = lerp(ty + 0.9, ay, m);
  out.lz = lerp(tz, az, m);
  out.fov = lerp(62, 58, k);
}
