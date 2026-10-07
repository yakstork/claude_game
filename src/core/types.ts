/**
 * Общие контракты между модулями Neon Rush (см. GAME_DESIGN.md §6).
 * Менять — только ведущему разработчику.
 *
 * Система координат: Y вверх, метры, секунды.
 * Локальный «вперёд» машины = +Z, heading h: forward = (sin h, 0, cos h),
 * right = forward × up = (-cos h, 0, sin h).
 */
import type { Quaternion, Vector3 } from 'three';
import type { CupSummary } from '../race/cup';

// ─── Управление ────────────────────────────────────────────────────────────

export interface VehicleControls {
  /** Газ 0..1 */
  throttle: number;
  /** Тормоз 0..1; при почти нулевой скорости — задний ход */
  brake: number;
  /** Руль −1 (влево) .. 1 (вправо) */
  steer: number;
  handbrake: boolean;
  nitro: boolean;
}

export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause' | 'reset' | 'camera';

// ─── Машины ────────────────────────────────────────────────────────────────

export type CarModelKind = 'wedge' | 'muscle' | 'hyper' | 'custom' | 'hatch' | 'limo';

/** «Своя сборка»: слайдеры 0..1 и цвета (hex) — переводятся в HandlingConfig в безопасных диапазонах */
export interface CustomBuild {
  speed: number;
  handling: number;
  drift: number;
  bodyColor: number;
  neonColor: number;
}

/** id машины «своя сборка» */
export const CUSTOM_CAR_ID = 'custom';

export interface CarSpec {
  id: string;
  name: string;
  /** Короткое описание для меню (рус.) */
  tagline: string;
  model: CarModelKind;
  bodyColor: number;
  neonColor: number;
  accentColor: number;

  // Физические числа (скорость, ускорение, сцепление, дрифт, масса…) — в
  // src/vehicle/handling.ts (HandlingConfig), единый источник истины.
  /** Полоски характеристик в меню, 0..1 */
  stats: { speed: number; handling: number; drift: number };
}

export interface WheelState {
  /** Сжатие подвески 0..1 */
  compression: number;
  onGround: boolean;
  /** Накопленный угол вращения колеса, рад (для визуала) */
  spin: number;
  /** Текущий угол поворота колеса, рад */
  steerAngle: number;
  /** Интенсивность проскальзывания 0..1 (следы, дым, визг) */
  skid: number;
  /** Точка контакта с дорогой (мировые координаты) */
  contact: Vector3;
}

export interface VehicleState {
  /** Центр машины на уровне осей колёс, мировые координаты */
  position: Vector3;
  /** Полная ориентация кузова (yaw + крен/тангаж от подвески) */
  quaternion: Quaternion;
  /** Скорость, м/с, мировые координаты */
  velocity: Vector3;
  /** Рыскание, рад: forward = (sin h, 0, cos h) */
  heading: number;
  /** Угловая скорость рыскания, рад/с */
  yawRate: number;
  /** Продольная скорость, м/с (со знаком) */
  speed: number;
  /** Нормированные обороты мотора 0..1 */
  rpm: number;
  gear: number;
  /** Фактически применённый газ 0..1 */
  throttle: number;
  onGround: boolean;
  /** Время в воздухе текущего прыжка, с */
  airTime: number;
  /** Угол заноса (между курсом и вектором скорости), рад, со знаком */
  driftAngle: number;
  drifting: boolean;
  /** Интенсивность заноса 0..1 */
  driftIntensity: number;
  /** Нитро 0..1 */
  nitro: number;
  nitroActive: boolean;
  /** [FL, FR, RL, RR] */
  wheels: WheelState[];
  /** Дистанция вдоль трассы текущей проекции, м (0..track.length) */
  trackS: number;
  /** Смещение от осевой, м (+ вправо) */
  lateral: number;
  /** Временное ускорение (бонус за дрифт / старт): оставшееся время, с */
  boostTime: number;
  /** Сила текущего ускорения 0..1 (0 — нет) */
  boostPower: number;
  /** Слипстрим (аэродинамический мешок за другой машиной) 0..1; пишет updateSlipstream */
  slipstream: number;
}

export type VehicleEventType = 'wall' | 'car' | 'land';

export interface VehicleEvent {
  type: VehicleEventType;
  /** Сила 0..1 */
  strength: number;
  point: Vector3;
}

// ─── Трасса ────────────────────────────────────────────────────────────────

export interface TrackSample {
  s: number;
  position: Vector3;
  /** Единичная касательная (3D, по направлению движения) */
  tangent: Vector3;
  /** Единичный вектор вправо (с учётом наклона виража) */
  right: Vector3;
  /** Нормаль дороги */
  up: Vector3;
  halfWidth: number;
  /** Наклон виража, рад (+ правый край ниже) */
  bank: number;
}

export interface TrackProjection {
  s: number;
  /** Смещение от осевой вдоль right, м */
  lateral: number;
  /** Высота поверхности дороги под точкой */
  height: number;
  /** Нормаль поверхности */
  normal: Vector3;
  sample: TrackSample;
  /** Расстояние от точки до поверхности дороги (для отладки/выбора уровня) */
  distance: number;
}

export interface Pose {
  position: Vector3;
  heading: number;
  s: number;
}

// ─── ИИ ────────────────────────────────────────────────────────────────────

export interface BotProfile {
  name: string;
  /** 0..1 — качество траектории и торможения */
  skill: number;
  /** 0..1 — готовность обгонять/толкаться */
  aggression: number;
  /** −1..1 — предпочитаемое смещение линии (доля полуширины) */
  lineBias: number;
  bodyColor: number;
  neonColor: number;
  carId: string;
}

// ─── Гонка ─────────────────────────────────────────────────────────────────

export interface RacerInfo {
  name: string;
  isPlayer: boolean;
}

export interface RacerStanding {
  car: number;
  name: string;
  isPlayer: boolean;
  /** 1-based */
  position: number;
  /** Завершённые круги */
  lap: number;
  /** Метры с начала гонки */
  progress: number;
  lapTimes: number[];
  bestLap: number | null;
  currentLapTime: number;
  nextCheckpoint: number;
  finished: boolean;
  finishTime: number | null;
  wrongWay: boolean;
}

export type RaceEvent =
  | { type: 'lap'; car: number; lap: number; lapTime: number; isBest: boolean }
  | { type: 'checkpoint'; car: number; index: number }
  | { type: 'finish'; car: number; position: number; time: number }
  | { type: 'wrongWay'; car: number; value: boolean };

export type DriftEvent =
  | { type: 'comboEnd'; points: number; multiplier: number; label: string }
  | { type: 'comboLost'; points: number }
  | { type: 'multiplier'; multiplier: number };

export interface DriftCombo {
  active: boolean;
  /** Очки текущего комбо (до умножения) */
  points: number;
  multiplier: number;
  /** Длительность комбо, с */
  time: number;
}

// ─── Настройки и рекорды ───────────────────────────────────────────────────

export type Quality = 'low' | 'high';

export interface Settings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  quality: Quality;
  showFps: boolean;
  /** Тип управления: авто (сенсорный экран → кнопки), клавиатура/геймпад, сенсорные кнопки */
  controlMode: ControlMode;
  /** Размер сенсорных кнопок, множитель 0.7..1.5 */
  touchSize: number;
  /** Непрозрачность сенсорных кнопок 0.2..1 */
  touchOpacity: number;
  /** Режим: гонка с ботами или заезд на время с призраком лучшего круга */
  raceMode: RaceMode;
  /** Сложность ботов */
  difficulty: Difficulty;
  /** Число кругов */
  laps: number;
  /** Вид камеры в гонке (переключается клавишей C) */
  cameraView: CameraView;
  /** Время суток: закат / ночь / рассвет (на Storm Boulevard погода приоритетнее) */
  timeOfDay: TimeOfDay;
}

export type TimeOfDay = 'sunset' | 'night' | 'dawn';

export type RaceMode = 'race' | 'timeAttack' | 'cup' | 'drift' | 'elimination' | 'versus';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type CameraView = 'far' | 'near' | 'bumper';
export const LAP_OPTIONS = [1, 3, 5] as const;

export type ControlMode = 'auto' | 'keyboard' | 'touch';

/** Состояние сенсорных кнопок (заполняет UI, читает InputManager) */
export interface TouchState {
  left: boolean;
  right: boolean;
  throttle: boolean;
  brake: boolean;
  drift: boolean;
  nitro: boolean;
}

export interface Records {
  /** Лучший круг по id машины, с */
  bestLap: Record<string, number>;
  /** Лучшее время гонки по id машины, с */
  bestRace: Record<string, number>;
  bestDrift: number;
  wins: number;
  races: number;
}

// ─── UI ────────────────────────────────────────────────────────────────────

export interface MinimapDot {
  x: number;
  z: number;
  /** CSS-цвет */
  color: string;
  isPlayer: boolean;
}

export interface HudData {
  speedKmh: number;
  /** 0..1 */
  nitro: number;
  nitroActive: boolean;
  /** Текущий круг 1..totalLaps */
  lap: number;
  totalLaps: number;
  position: number;
  totalRacers: number;
  lapTime: number;
  lastLap: number | null;
  bestLap: number | null;
  raceTime: number;
  drift: DriftCombo;
  driftTotal: number;
  wrongWay: boolean;
  minimap: MinimapDot[];
  /** Временное ускорение: оставшаяся доля 0..1 (0 — нет) и сила 0..1 */
  boost: number;
  boostPower: number;
  /** Разница с лучшим кругом (призраком) в той же точке трассы, с; null — нет данных */
  delta: number | null;
  /** Аэродинамический мешок за соперником 0..1 */
  slipstream: number;
  /** Режимы с таймером: оставшиеся секунды (undefined — обычная гонка) */
  challengeTime?: number;
  /** Подпись таймера и строка цели под ним */
  challengeLabel?: string;
  challengeGoal?: string;
}

export interface ResultRow {
  position: number;
  name: string;
  /** CSS-цвет */
  color: string;
  isPlayer: boolean;
  /** Итоговое время; для незавершивших — прогноз */
  time: number;
  projected: boolean;
  bestLap: number | null;
}

export interface RaceResult {
  rows: ResultRow[];
  playerPosition: number;
  playerTime: number;
  playerBestLap: number | null;
  driftScore: number;
  carId: string;
  newBestLap: boolean;
  newBestRace: boolean;
  newBestDrift: boolean;
  /** Заезд на время (без соперников) */
  solo?: boolean;
  /** Времена кругов игрока, с */
  lapTimes?: number[];
  /** Кубок: таблица после этой гонки */
  cup?: CupSummary;
  /** Свой заголовок (режим «2 игрока») */
  title?: string;
  /** Карьера: награда за гонку (NC) и баланс после неё */
  credits?: { total: number; lines: { label: string; value: number }[]; balance: number };
  /** Кампания: итог события */
  campaign?: { title: string; stars: number; newStars: number; reward: number; goals: { text: string; on: boolean }[] };
  /** Дрифт-вызов: медаль и рекорд */
  challenge?: ChallengeResult;
  /** Выбывание: в таблице время — момент выбывания */
  elimination?: boolean;
}

export interface ChallengeResult {
  medal: 'none' | 'bronze' | 'silver' | 'gold';
  /** Пороги очков [бронза, серебро, золото] */
  thresholds: [number, number, number];
  /** Прежний рекорд по трассе и машине (0 — не было) */
  previous: number;
  isRecord: boolean;
}

export type UiSound = 'move' | 'select' | 'back';
export type PopupTone = 'pink' | 'cyan' | 'orange' | 'yellow';

export interface UICallbacks {
  onPreviewCar(index: number): void;
  onStartRace(index: number): void;
  onSettingsChanged(settings: Settings): void;
  onPause(): void;
  onResume(): void;
  onRestart(): void;
  onQuitToMenu(): void;
  onUiSound(kind: UiSound): void;
  /** Первый клик/клавиша/касание — разблокировать звук (на iOS — строго в обработчике жеста) */
  onFirstInteraction(): void;
  /** «Своя сборка» изменилась (живое превью и сохранение) */
  onCustomBuildChanged(build: CustomBuild): void;
  /** Выбор трассы в меню */
  onSelectTrack(index: number): void;
  /** Повтор гонки (кнопка на экране результатов) */
  onReplay?(): void;
  /** Фоторежим (кнопка в паузе) */
  onPhoto?(): void;
  /** Кампания: «ДАЛЕЕ» на результатах события — вернуться к карте */
  onCampaignMap?(): void;
}

// ─── Звук ──────────────────────────────────────────────────────────────────

export interface EngineAudioParams {
  rpm: number;
  throttle: number;
  /** м/с */
  speed: number;
  /** 0..1 */
  skid: number;
  nitro: boolean;
  onGround: boolean;
}

export type SfxName =
  | 'countdown'
  | 'go'
  | 'lap'
  | 'finish'
  | 'hit'
  | 'combo'
  | 'comboLost'
  | 'nitroStart'
  | 'land'
  | 'uiMove'
  | 'uiSelect'
  | 'uiBack';

export type MusicTrack = 'menu' | 'race';

// ─── Тюнинг (панель ?debug) ────────────────────────────────────────────────

/** Описание настраиваемого числового параметра для панели тюнинга */
export interface TuningParam {
  /** Ключ в объекте конфига */
  key: string;
  /** Подпись (рус.) */
  label: string;
  /** Группа в панели, напр. «Руль», «Сцепление», «Дрифт» */
  group: string;
  min: number;
  max: number;
  step: number;
}

// ─── Трассы ────────────────────────────────────────────────────────────────

export interface TrackInfo {
  id: string;
  name: string;
  /** Подзаголовок/характер трассы (рус.) */
  tagline: string;
  /** Длина круга, км */
  lengthKm: number;
}

/**
 * Ключ рекорда в Records.bestLap/bestRace: `${trackId}/${carId}`.
 * Для исходной трассы 'sunset' поддерживается старый ключ без префикса (только carId).
 */
export function recordKey(trackId: string, carId: string): string {
  return `${trackId}/${carId}`;
}
