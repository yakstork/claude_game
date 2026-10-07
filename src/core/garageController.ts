/**
 * Связка карьеры с игрой: хранит Career, реализует GarageApi для экрана гаража,
 * перекрашивает заводские машины (CAR_SPECS), применяет улучшения к физике игрока и начисляет награды.
 */
import type { CarSpec, RaceResult } from './types';
import { CUSTOM_CAR_ID } from './types';
import type { Career, BuyResult, ColorKind, Reward, RewardInput, UpgradeBranch } from '../race/career';
import {
  applyUpgrades,
  award,
  buyColor,
  buyNumberSlot,
  buyStripe,
  selectNumber,
  selectStripe,
  buyUpgrade,
  computeReward,
  hasUpgrades,
  levelsOf,
  loadCareer,
  saveCareer,
  selectColor,
} from '../race/career';
import { CUSTOM_PALETTE } from '../vehicle/specs';
import { getHandling } from '../vehicle/handling';
import type { VehiclePhysics } from '../vehicle/physics';
import type { GarageApi } from '../ui/garage';

export interface GarageHooks {
  /** Показать машину в 3D-превью */
  preview(index: number): void;
  /** Цвета машины изменились (перерисовать меню/превью) */
  recolored(index: number): void;
  sound(kind: 'move' | 'select' | 'back'): void;
}

export class GarageController implements GarageApi {
  readonly data: Career = loadCareer();
  readonly palette = CUSTOM_PALETTE;
  private readonly factory = new Map<string, { body: number; neon: number }>();

  constructor(
    private readonly specs: CarSpec[],
    private readonly hooks: GarageHooks,
  ) {
    for (const s of specs) if (s.id !== CUSTOM_CAR_ID) this.factory.set(s.id, { body: s.bodyColor, neon: s.neonColor });
    for (let i = 0; i < specs.length; i++) this.paint(i, false);
  }

  career(): Career {
    return this.data;
  }

  factoryColors(carId: string): { body: number; neon: number } {
    return this.factory.get(carId) ?? { body: 0, neon: 0 };
  }

  buyUpgrade(carId: string, branch: UpgradeBranch): BuyResult {
    const r = buyUpgrade(this.data, carId, branch);
    if (r === 'ok') saveCareer(this.data);
    return r;
  }

  buyColor(kind: ColorKind, color: number): BuyResult {
    const r = buyColor(this.data, kind, color);
    if (r === 'ok') saveCareer(this.data);
    return r;
  }

  selectColor(carId: string, kind: ColorKind, color: number | null): boolean {
    const f = this.factory.get(carId);
    if (!f) return false;
    const ok = selectColor(this.data, carId, kind, color, f[kind]);
    if (!ok) return false;
    saveCareer(this.data);
    const i = this.specs.findIndex((s) => s.id === carId);
    if (i >= 0) this.paint(i, true);
    return true;
  }

  buyStripe(pattern: number): BuyResult {
    const r = buyStripe(this.data, pattern);
    if (r === 'ok') saveCareer(this.data);
    return r;
  }

  selectStripe(carId: string, pattern: number): boolean {
    return this.commit(carId, selectStripe(this.data, carId, pattern));
  }

  buyNumberSlot(carId: string): BuyResult {
    const r = buyNumberSlot(this.data, carId);
    if (r === 'ok') saveCareer(this.data);
    return r;
  }

  selectNumber(carId: string, n: number | null): boolean {
    return this.commit(carId, selectNumber(this.data, carId, n));
  }

  /** Сохранить и перерисовать машину после смены ливреи */
  private commit(carId: string, ok: boolean): boolean {
    if (!ok || !this.factory.has(carId)) return false;
    saveCareer(this.data);
    const i = this.specs.findIndex((s) => s.id === carId);
    if (i >= 0) this.paint(i, true);
    return true;
  }

  preview(index: number): void {
    this.hooks.preview(index);
  }

  sound(kind: 'move' | 'select' | 'back'): void {
    this.hooks.sound(kind);
  }

  /** Записать выбранные цвета в спецификацию заводской машины */
  private paint(index: number, notify: boolean): void {
    const spec = this.specs[index];
    const f = this.factory.get(spec.id);
    if (!f) return;
    const cc = this.data.cars[spec.id];
    spec.bodyColor = cc?.body ?? f.body;
    spec.neonColor = cc?.neon ?? f.neon;
    spec.livery = cc && (cc.stripe > 0 || cc.number !== null) ? { stripe: cc.stripe, number: cc.number } : undefined;
    if (notify) this.hooks.recolored(index);
  }

  /** Улучшения → физика игрока (боты и общий HANDLING не затрагиваются) */
  applyToPhysics(physics: VehiclePhysics, carId: string): void {
    const lv = levelsOf(this.data, carId);
    if (hasUpgrades(lv)) physics.useHandling(applyUpgrades(getHandling(carId), lv));
  }

  /** Добавить кредиты (награда кампании) и сохранить */
  addCredits(n: number): void {
    award(this.data, { total: n, lines: [] });
    saveCareer(this.data);
  }

  /** Начислить награду за гонку и сохранить; возвращает данные для экрана результатов */
  awardRace(input: RewardInput): NonNullable<RaceResult['credits']> {
    const reward: Reward = computeReward(input);
    award(this.data, reward);
    saveCareer(this.data);
    return { total: reward.total, lines: reward.lines, balance: this.data.credits };
  }
}
