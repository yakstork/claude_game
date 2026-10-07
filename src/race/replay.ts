/**
 * Повтор гонки: запись поз ВСЕХ машин с шагом 20 Гц в плоский Float32Array и
 * выборка с интерполяцией по времени. Чистая логика (без рендера и DOM).
 *
 * Кадр = carCount × 8 чисел: x, y, z, qx, qy, qz, qw, flags (битовые флаги).
 */
import type { Quaternion, Vector3 } from 'three';

/** Шаг записи, с */
export const REPLAY_DT = 0.05;
export const STRIDE = 8;
export const FLAG_NITRO = 1;
export const FLAG_DRIFT = 2;
export const FLAG_AIR = 4;
/** Начальный запас кадров (10 минут) — дальше буфер удваивается */
const INITIAL_FRAMES = 12000;

/** Что нужно от машины для записи (подмножество VehicleState) */
export interface PoseSource {
  position: Vector3;
  quaternion: Quaternion;
  nitroActive: boolean;
  drifting: boolean;
  onGround: boolean;
}

export class ReplayRecorder {
  private buf = new Float32Array(0);
  private cars = 0;
  private frames = 0;

  begin(carCount: number): void {
    this.cars = carCount;
    this.frames = 0;
    const need = INITIAL_FRAMES * carCount * STRIDE;
    if (this.buf.length < need) this.buf = new Float32Array(need);
  }

  /** t — время от начала записи, с. Пишет кадр, когда t достигло очередной отметки. */
  record(t: number, cars: readonly PoseSource[]): void {
    if (this.cars === 0 || cars.length < this.cars) return;
    // догоняем отметки (на случай большого dt) — по одному кадру на отметку
    while (t + 1e-9 >= this.frames * REPLAY_DT) {
      this.write(cars);
    }
  }

  private write(cars: readonly PoseSource[]): void {
    const fs = this.cars * STRIDE;
    if ((this.frames + 1) * fs > this.buf.length) {
      const nb = new Float32Array(this.buf.length * 2);
      nb.set(this.buf);
      this.buf = nb;
    }
    let o = this.frames * fs;
    for (let c = 0; c < this.cars; c++) {
      const s = cars[c];
      const b = this.buf;
      b[o] = s.position.x;
      b[o + 1] = s.position.y;
      b[o + 2] = s.position.z;
      b[o + 3] = s.quaternion.x;
      b[o + 4] = s.quaternion.y;
      b[o + 5] = s.quaternion.z;
      b[o + 6] = s.quaternion.w;
      b[o + 7] = (s.nitroActive ? FLAG_NITRO : 0) | (s.drifting ? FLAG_DRIFT : 0) | (s.onGround ? 0 : FLAG_AIR);
      o += STRIDE;
    }
    this.frames++;
  }

  get frameCount(): number {
    return this.frames;
  }

  get carCount(): number {
    return this.cars;
  }

  /** Запись как проигрыватель; null — слишком коротко для повтора. Данные не копируются. */
  finish(): ReplayPlayer | null {
    if (this.frames < 2 || this.cars === 0) return null;
    return new ReplayPlayer(this.buf.subarray(0, this.frames * this.cars * STRIDE), this.cars);
  }
}

export class ReplayPlayer {
  readonly frames: number;
  /** Длительность записи, с */
  readonly duration: number;
  private li = 0;
  private la = 0;

  constructor(
    private readonly data: Float32Array,
    readonly carCount: number,
  ) {
    this.frames = data.length / (carCount * STRIDE);
    this.duration = (this.frames - 1) * REPLAY_DT;
  }

  /** Поза машины car в момент t (с интерполяцией, t зажато в [0, duration]) */
  sample(t: number, car: number, outPos: Vector3, outQuat: Quaternion): void {
    this.locate(t);
    const a = this.la;
    const fs = this.carCount * STRIDE;
    const o = this.li * fs + car * STRIDE;
    const p = o + fs;
    const f = this.data;
    outPos.set(f[o] + (f[p] - f[o]) * a, f[o + 1] + (f[p + 1] - f[o + 1]) * a, f[o + 2] + (f[p + 2] - f[o + 2]) * a);
    const sgn = f[o + 3] * f[p + 3] + f[o + 4] * f[p + 4] + f[o + 5] * f[p + 5] + f[o + 6] * f[p + 6] < 0 ? -1 : 1;
    outQuat
      .set(
        f[o + 3] + (sgn * f[p + 3] - f[o + 3]) * a,
        f[o + 4] + (sgn * f[p + 4] - f[o + 4]) * a,
        f[o + 5] + (sgn * f[p + 5] - f[o + 5]) * a,
        f[o + 6] + (sgn * f[p + 6] - f[o + 6]) * a,
      )
      .normalize();
  }

  /** Скорость (м/с) как конечная разность соседних кадров */
  velocity(t: number, car: number, out: Vector3): void {
    this.locate(t);
    const fs = this.carCount * STRIDE;
    const o = this.li * fs + car * STRIDE;
    const p = o + fs;
    const f = this.data;
    out.set((f[p] - f[o]) / REPLAY_DT, (f[p + 1] - f[o + 1]) / REPLAY_DT, (f[p + 2] - f[o + 2]) / REPLAY_DT);
  }

  /** Флаги (FLAG_*) ближайшего кадра */
  flags(t: number, car: number): number {
    this.locate(t);
    const k = this.la >= 0.5 ? Math.min(this.frames - 1, this.li + 1) : this.li;
    return this.data[k * this.carCount * STRIDE + car * STRIDE + 7];
  }

  /** Пара соседних кадров (li, li+1) и доля la; li+1 всегда существует */
  private locate(t: number): void {
    const x = Math.min(Math.max(0, t), this.duration) / REPLAY_DT;
    const i = Math.min(Math.floor(x), this.frames - 2);
    this.li = i;
    this.la = x - i;
  }
}
