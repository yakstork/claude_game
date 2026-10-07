/**
 * Связка «Вызова дня» с игрой: условия по дате UTC, временные настройки (не сохраняются),
 * модификаторы, медаль, серия и награда NC. Игра реализует DailyHooks.
 */
import type { RaceResult, Settings } from './types';
import type { DailyApi, DailyView } from '../ui/daily';
import type { DailyChallenge, DailyContext, DailyModifier, DailyOutcome } from '../race/daily';
import {
  MEDAL_LABELS,
  currentStreak,
  dailyChallenge,
  dailySeed,
  formatScore,
  goalText,
  loadDaily,
  outcomeScore,
  recordDaily,
  saveDaily,
  todayBest,
} from '../race/daily';
import type { GarageController } from './garageController';

export interface DailyHooks {
  settings(): Settings;
  /** Подменить настройки (в т.ч. время суток) без сохранения */
  applyTemp(s: Settings): void;
  /** Вернуть настройки игрока (режим, круги, сложность, время суток) */
  restoreSettings(saved: Settings): void;
  setTrack(trackId: string): void;
  carIndex(carId: string): number;
  selectedCar(): number;
  startRace(carIndex: number): void;
  trackName(trackId: string): string;
  carName(carId: string): string;
  sound(kind: 'move' | 'select' | 'back'): void;
}

export class DailyController implements DailyApi {
  readonly data = loadDaily();
  private active: DailyChallenge | null = null;
  private saved: Settings | null = null;

  constructor(
    private readonly hooks: DailyHooks,
    private readonly garage: GarageController,
    private readonly ctx: DailyContext,
    private readonly now: () => Date = () => new Date(),
  ) {}

  challenge(): DailyChallenge {
    return dailyChallenge(dailySeed(this.now()), this.ctx);
  }

  view(): DailyView {
    const c = this.challenge();
    return {
      challenge: c,
      trackName: this.hooks.trackName(c.trackId),
      carName: this.hooks.carName(c.carId),
      best: todayBest(this.data, c.seed),
      streak: currentStreak(this.data, c.seed),
      maxStreak: this.data.maxStreak,
    };
  }

  sound(kind: 'move' | 'select' | 'back'): void {
    this.hooks.sound(kind);
  }

  /** Модификатор активного вызова (null — обычная гонка) */
  get modifier(): DailyModifier | null {
    return this.active && this.active.modifier !== 'none' ? this.active.modifier : null;
  }

  get isActive(): boolean {
    return this.active !== null;
  }

  start(): void {
    const c = this.challenge();
    const cur = this.hooks.settings();
    this.saved ??= { ...cur };
    this.active = c;
    this.hooks.applyTemp({ ...cur, raceMode: c.mode, laps: c.laps, difficulty: c.difficulty, timeOfDay: c.timeOfDay });
    this.hooks.setTrack(c.trackId);
    const car = this.hooks.carIndex(c.carId);
    this.hooks.startRace(car >= 0 ? car : this.hooks.selectedCar());
  }

  /** Выход в меню: вернуть настройки игрока */
  end(): void {
    if (this.saved) this.hooks.restoreSettings(this.saved);
    this.saved = null;
    this.active = null;
  }

  /** Итог попытки: медаль, лучший результат дня, серия, награда. Дописывает result.daily. */
  finish(result: RaceResult, outcome: DailyOutcome): void {
    const c = this.active;
    if (!c) return;
    const rec = recordDaily(this.data, c, outcome);
    saveDaily(this.data);
    if (rec.reward > 0) {
      this.garage.addCredits(rec.reward);
      if (result.credits) {
        result.credits.lines.push({ label: 'ВЫЗОВ ДНЯ', value: rec.reward });
        result.credits.total += rec.reward;
        result.credits.balance = this.garage.data.credits;
      }
    }
    const lines = [`РЕЗУЛЬТАТ: ${formatScore(c, outcomeScore(c, outcome))}`];
    if (rec.medal < 3) lines.push(`Следующая медаль: ${goalText(c, (rec.medal + 1) as 1 | 2 | 3)}`);
    if (c.modifier === 'cleanRun' && outcome.wallHits > 0) lines.push('Удары о стену: золото недоступно');
    lines.push(rec.streak > 0 ? `СЕРИЯ: ${rec.streak}` : 'Серия начнётся с первой медали');
    result.daily = { title: `ВЫЗОВ ДНЯ · ${c.dateKey}`, medal: MEDAL_LABELS[rec.medal], medalIndex: rec.medal, reward: rec.reward, lines };
  }
}
