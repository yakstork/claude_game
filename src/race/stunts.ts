/**
 * Трюки: награда за прыжки с трамплинов. Чистая логика (Node), без аллокаций в update().
 * Полёт определяется по onGround, при приземлении выдаётся StuntEvent с оценкой
 * (время в воздухе, высота, чистота посадки) и наградой (очки к очкам дрифта + немного нитро).
 * Нитро начисляет вызывающий (event.nitro, доля шкалы 0..1) — публичного API физики для этого нет.
 */
import type { VehicleState } from '../core/types';

export const STUNT_TUNING = {
  /** Короче этого полёта (с) трюком не считается (кочки) */
  minAir: 0.4,
  /** Границы меток по времени в воздухе, с */
  bigAir: 0.9,
  hugeAir: 1.5,
  /** Жёсткая посадка: наклон кузова от горизонта, рад / угол между курсом и скоростью, рад */
  hardTilt: 0.45,
  hardSlip: 0.55,
  /** «Идеальная» посадка */
  perfectTilt: 0.12,
  perfectSlip: 0.15,
  /** Очки: за секунду полёта, за метр высоты; множители по меткам */
  pointsPerSec: 150,
  pointsPerMeter: 20,
  perfectBonus: 100,
  /** Нитро (доля шкалы) по меткам и за идеальную посадку */
  nitroAir: 0.04,
  nitroBig: 0.1,
  nitroHuge: 0.18,
  nitroPerfect: 0.05,
} as const;

export type StuntLabel = 'AIR' | 'BIG AIR' | 'HUGE AIR!';

export interface StuntEvent {
  /** Метка прыжка; заполнена и для жёсткой посадки (награды нет) */
  label: StuntLabel;
  /** Время в воздухе, с */
  airTime: number;
  /** Набранная высота над точкой отрыва, м */
  height: number;
  /** Наклон кузова при посадке, рад */
  tilt: number;
  /** Угол между курсом и скоростью при посадке, рад */
  slip: number;
  /** Посадка жёсткая/боком: points = 0, nitro = 0 */
  hard: boolean;
  /** Идеальная посадка: показывать «PERFECT LANDING» */
  perfect: boolean;
  /** Очки (добавить к очкам дрифта игрока) */
  points: number;
  /** Нитро в долях шкалы 0..1 (прибавить к state.nitro, не выше 1) */
  nitro: number;
}

const POOL = 4;

function makeEvent(): StuntEvent {
  return { label: 'AIR', airTime: 0, height: 0, tilt: 0, slip: 0, hard: false, perfect: false, points: 0, nitro: 0 };
}

export class StuntScorer {
  private readonly events: StuntEvent[] = [];
  private readonly pool: StuntEvent[] = [];
  private poolIdx = 0;
  private flying = false;
  private air = 0;
  private startY = 0;
  private maxY = 0;
  /** Сумма очков за трюки с последнего reset */
  totalPoints = 0;

  constructor() {
    for (let i = 0; i < POOL; i++) this.pool.push(makeEvent());
  }

  reset(): void {
    this.events.length = 0;
    this.flying = false;
    this.air = 0;
    this.poolIdx = 0;
    this.totalPoints = 0;
  }

  /** Вызывать каждый шаг для игрока. Возвращает (переиспользуемый!) массив событий этого шага. */
  update(dt: number, st: VehicleState): StuntEvent[] {
    const evs = this.events;
    evs.length = 0;
    if (!st.onGround) {
      if (!this.flying) {
        this.flying = true;
        this.air = 0;
        this.startY = st.position.y;
        this.maxY = st.position.y;
      }
      this.air += dt;
      if (st.position.y > this.maxY) this.maxY = st.position.y;
      return evs;
    }
    if (!this.flying) return evs;
    this.flying = false;
    const T = STUNT_TUNING;
    if (this.air < T.minAir) return evs;

    const q = st.quaternion;
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    const tilt = Math.acos(upY < -1 ? -1 : upY > 1 ? 1 : upY);
    const vx = st.velocity.x;
    const vz = st.velocity.z;
    const v = Math.hypot(vx, vz);
    let slip = 0;
    if (v > 3) {
      const dot = vx * Math.sin(st.heading) + vz * Math.cos(st.heading);
      const cross = vx * Math.cos(st.heading) - vz * Math.sin(st.heading);
      slip = Math.abs(Math.atan2(cross, dot));
    }
    const height = this.maxY - this.startY;
    const air = this.air;

    const e = this.pool[this.poolIdx];
    this.poolIdx = (this.poolIdx + 1) % POOL;
    e.airTime = air;
    e.height = height;
    e.tilt = tilt;
    e.slip = slip;
    e.hard = tilt > T.hardTilt || slip > T.hardSlip;
    e.perfect = !e.hard && tilt < T.perfectTilt && slip < T.perfectSlip;
    let nitro: number;
    let mul: number;
    if (air >= T.hugeAir) {
      e.label = 'HUGE AIR!';
      nitro = T.nitroHuge;
      mul = 2;
    } else if (air >= T.bigAir) {
      e.label = 'BIG AIR';
      nitro = T.nitroBig;
      mul = 1.4;
    } else {
      e.label = 'AIR';
      nitro = T.nitroAir;
      mul = 1;
    }
    if (e.hard) {
      e.points = 0;
      e.nitro = 0;
    } else {
      e.points = Math.round((air * T.pointsPerSec + height * T.pointsPerMeter) * mul + (e.perfect ? T.perfectBonus : 0));
      e.nitro = nitro + (e.perfect ? T.nitroPerfect : 0);
    }
    this.totalPoints += e.points;
    evs.push(e);
    return evs;
  }
}
