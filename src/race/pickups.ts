/**
 * Логика бустер-пластин и канистр нитро. Чистая (без рендера и DOM), без аллокаций в update.
 * Положение объектов считается один раз в конструкторе (s, lateral); срабатывание — по
 * проекции машины на трассу (trackS / lateral из состояния физики).
 */
import type { Track } from '../world/track';
import type { PickupLayout, PickupSpot } from '../world/pickups';

export const PICKUP_TUNING = {
  /** Пластина: полудлина/полуширина зоны срабатывания, м */
  padHalfLen: 4.5,
  padHalfWidth: 3.6,
  /** Буст от пластины: длительность, с и сила 0..1 */
  padBoostSeconds: 1.1,
  padBoostPower: 0.6,
  /** Повторное срабатывание той же пластины для той же машины не раньше, с */
  padCooldown: 1.5,
  /** Канистра: радиусы подбора, м */
  canHalfLen: 2.8,
  canHalfWidth: 2.6,
  /** Прирост нитро (доля шкалы) */
  canNitro: 0.25,
  /** Время до повторного появления, с */
  canRespawn: 8,
  /** Отступ от края полотна, м */
  edgeMargin: 1.5,
  maxCars: 8,
} as const;

/** Минимум полей машины, нужных логике */
export interface PickupCar {
  trackS: number;
  lateral: number;
  onGround: boolean;
  nitro: number;
}

export type PickupKind = 'pad' | 'can';
export type PickupHandler = (kind: PickupKind, car: number, index: number) => void;

export class PickupSystem {
  readonly padS: Float32Array;
  readonly padLateral: Float32Array;
  readonly canS: Float32Array;
  readonly canLateral: Float32Array;
  /** Оставшееся время до появления канистры, с (0 — на месте) */
  readonly canTimer: Float32Array;
  private readonly padCool: Float32Array;

  constructor(
    readonly track: Track,
    layout: PickupLayout,
  ) {
    const L = track.length;
    const place = (spots: PickupSpot[], s: Float32Array, lat: Float32Array): void => {
      spots.forEach((sp, i) => {
        s[i] = track.wrapS(sp.f * L);
        const hw = track.sampleAt(s[i]).halfWidth - PICKUP_TUNING.edgeMargin;
        lat[i] = Math.max(-hw, Math.min(hw, sp.offset));
      });
    };
    this.padS = new Float32Array(layout.pads.length);
    this.padLateral = new Float32Array(layout.pads.length);
    this.canS = new Float32Array(layout.cans.length);
    this.canLateral = new Float32Array(layout.cans.length);
    place(layout.pads, this.padS, this.padLateral);
    place(layout.cans, this.canS, this.canLateral);
    this.canTimer = new Float32Array(layout.cans.length);
    this.padCool = new Float32Array(layout.pads.length * PICKUP_TUNING.maxCars);
  }

  get padCount(): number {
    return this.padS.length;
  }
  get canCount(): number {
    return this.canS.length;
  }

  reset(): void {
    this.canTimer.fill(0);
    this.padCool.fill(0);
  }

  update(dt: number, cars: readonly PickupCar[], onHit: PickupHandler): void {
    const T = PICKUP_TUNING;
    const track = this.track;
    for (let k = 0; k < this.padCool.length; k++) if (this.padCool[k] > 0) this.padCool[k] -= dt;
    for (let k = 0; k < this.canTimer.length; k++) if (this.canTimer[k] > 0) this.canTimer[k] = Math.max(0, this.canTimer[k] - dt);

    const n = Math.min(cars.length, T.maxCars);
    for (let c = 0; c < n; c++) {
      const car = cars[c];
      for (let i = 0; i < this.padS.length; i++) {
        const slot = i * T.maxCars + c;
        if (this.padCool[slot] > 0 || !car.onGround) continue;
        if (Math.abs(track.deltaS(this.padS[i], car.trackS)) > T.padHalfLen) continue;
        if (Math.abs(car.lateral - this.padLateral[i]) > T.padHalfWidth) continue;
        this.padCool[slot] = T.padCooldown;
        onHit('pad', c, i);
      }
      if (car.nitro >= 0.999) continue;
      for (let i = 0; i < this.canS.length; i++) {
        if (this.canTimer[i] > 0) continue;
        if (Math.abs(track.deltaS(this.canS[i], car.trackS)) > T.canHalfLen) continue;
        if (Math.abs(car.lateral - this.canLateral[i]) > T.canHalfWidth) continue;
        this.canTimer[i] = T.canRespawn;
        car.nitro = Math.min(1, car.nitro + T.canNitro);
        onHit('can', c, i);
        if (car.nitro >= 0.999) break;
      }
    }
  }
}
