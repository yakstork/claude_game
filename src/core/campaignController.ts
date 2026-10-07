/**
 * Связка кампании с игрой: прогресс, временные условия события (настройки игрока не перетираются),
 * подсчёт звёзд и награда. Игра реализует CampaignHooks.
 */
import type { RaceResult, Settings } from './types';
import type { CampaignEvent, CampaignProgress, Outcome } from '../race/campaign';
import { evaluateStars, eventById, goalText, isEventUnlocked, loadCampaign, recordResult, saveCampaign } from '../race/campaign';
import type { CampaignApi } from '../ui/campaign';
import type { GarageController } from './garageController';

export interface CampaignHooks {
  settings(): Settings;
  /** Подменить настройки без сохранения и без обновления UI */
  setTempSettings(s: Settings): void;
  /** Вернуть игроку его режим/круги/сложность (остальные настройки — текущие) */
  restoreSettings(saved: Settings): void;
  /** Переключить трассу по id (без сохранения выбора) */
  setTrack(trackId: string): void;
  /** Индекс машины по id (-1 — нет) */
  carIndex(carId: string): number;
  selectedCar(): number;
  startRace(carIndex: number): void;
  sound(kind: 'move' | 'select' | 'back'): void;
}

export class CampaignController implements CampaignApi {
  readonly data: CampaignProgress = loadCampaign();
  private active: CampaignEvent | null = null;
  private saved: Settings | null = null;

  constructor(
    private readonly hooks: CampaignHooks,
    private readonly garage: GarageController,
  ) {}

  progress(): CampaignProgress {
    return this.data;
  }

  sound(kind: 'move' | 'select' | 'back'): void {
    this.hooks.sound(kind);
  }

  get activeEvent(): CampaignEvent | null {
    return this.active;
  }

  start(eventId: string): void {
    const ev = eventById(eventId);
    if (!ev || !isEventUnlocked(this.data, ev.id)) return;
    const cur = this.hooks.settings();
    this.saved ??= { ...cur };
    this.active = ev;
    this.hooks.setTempSettings({ ...cur, raceMode: ev.mode, laps: ev.laps, difficulty: ev.difficulty, timeOfDay: ev.timeOfDay });
    this.hooks.setTrack(ev.trackId);
    const car = ev.carId ? this.hooks.carIndex(ev.carId) : -1;
    this.hooks.startRace(car >= 0 ? car : this.hooks.selectedCar());
  }

  /** Настройки для записи в localStorage: пока идёт событие, временные подмены не сохраняются */
  persistable(s: Settings): Settings {
    const o = this.saved;
    return o ? { ...s, raceMode: o.raceMode, laps: o.laps, difficulty: o.difficulty, timeOfDay: o.timeOfDay } : s;
  }

  /** Во время события настройки из UI не должны сбивать условия события */
  impose(s: Settings): Settings {
    const ev = this.active;
    return ev ? { ...s, raceMode: ev.mode, laps: ev.laps, difficulty: ev.difficulty, timeOfDay: ev.timeOfDay } : s;
  }

  /** Выход из события (в меню): вернуть настройки игрока */
  end(): void {
    const saved = this.saved;
    this.saved = null;
    this.active = null;
    if (saved) this.hooks.restoreSettings(saved);
  }

  /** Итог события: звёзды, прогресс, награда NC. Дописывает result.campaign. */
  finish(result: RaceResult, outcome: Outcome): void {
    const ev = this.active;
    if (!ev) return;
    const stars = evaluateStars(ev.goal, outcome);
    const rec = recordResult(this.data, ev.id, stars);
    if (rec.newStars > 0) saveCampaign(this.data);
    if (rec.reward > 0) {
      this.garage.addCredits(rec.reward);
      if (result.credits) {
        result.credits.lines.push({ label: 'ЗВЁЗДЫ', value: rec.reward });
        result.credits.total += rec.reward;
        result.credits.balance = this.garage.data.credits;
      }
    }
    result.campaign = {
      title: ev.title,
      stars,
      newStars: rec.newStars,
      reward: rec.reward,
      goals: ([1, 2, 3] as const).map((k) => ({ text: `${'★'.repeat(k)} ${goalText(ev.goal, k)}`, on: stars >= k })),
    };
  }
}
