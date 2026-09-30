/**
 * Единый конфиг управления машинами (физика, ИИ и столкновения читают числа отсюда).
 *
 * HANDLING — ЖИВЫЕ объекты: физика читает их каждый шаг, панель тюнинга мутирует
 * их на лету. Сброс — resetHandling(): значения копируются обратно В ТЕ ЖЕ объекты.
 * Модуль не зависит от рендера и DOM (работает в Node).
 */
import type { CustomBuild, TuningParam } from '../core/types';
import { CUSTOM_CAR_ID } from '../core/types';
import { CAR_GEOMETRY } from './specs';

/** Все числа управления одной машины (плоский объект, только number). */
export type HandlingConfig = {
  // ── Двигатель ───────────────────────────────────────────────────────────
  /** Максимальная скорость без нитро, м/с */
  maxSpeed: number;
  /** Ускорение на малой скорости, м/с² */
  acceleration: number;
  /** Замедление при торможении, м/с² */
  brakeDecel: number;
  /** Торможение задними колёсами при ручнике без заноса, м/с² */
  handbrakeDecel: number;
  /** Масса, кг (только для столкновений машин) */
  mass: number;

  // ── Нитро ───────────────────────────────────────────────────────────────
  /** Дополнительное ускорение от нитро, м/с² */
  nitroBoost: number;
  /** Множитель максимальной скорости при нитро */
  nitroSpeedMul: number;
  /** Расход шкалы нитро, 1/с */
  nitroUse: number;

  // ── Руль ────────────────────────────────────────────────────────────────
  /** Угол передних колёс на месте, рад */
  steerAngleLow: number;
  /** Угол передних колёс на очень высокой скорости, рад */
  steerAngleHigh: number;
  /** Скорость, м/с, на которой угол падает до середины между Low и High */
  steerFalloffSpeed: number;
  /** Скорость поворота колёс, рад/с */
  steerRate: number;

  // ── Сцепление (режим GRIP) ──────────────────────────────────────────────
  /** Боковое сцепление, g (предел поперечного ускорения) */
  grip: number;
  /** Прибавка сцепления на максимальной скорости (прижимная сила), доля */
  downforce: number;
  /** Отклик рыскания на руль, 1/с */
  yawResponse: number;
  /** Гашение бокового скольжения (вектор скорости догоняет кузов), 1/с */
  slipDamping: number;
  /** Недостаточная поворачиваемость на пределе сцепления 0..1 (мягкость насыщения) */
  understeer: number;
  /** Характерная скорость падения «усиления» руля по рысканью, м/с */
  understeerSpeed: number;

  // ── Дрифт (режим DRIFT) ─────────────────────────────────────────────────
  /** Минимальная скорость входа в занос, м/с */
  driftMinSpeed: number;
  /** Минимальный руль (|steer|) для входа по ручнику */
  driftEntrySteer: number;
  /** Боковое ускорение в заносе (сцепление задней оси), g */
  driftGrip: number;
  /** Базовый угол заноса, рад */
  driftBaseAngle: number;
  /** Максимальный угол заноса, рад */
  driftMaxAngle: number;
  /** Прибавка угла от руля в сторону заноса, рад */
  driftSteerGain: number;
  /** Прибавка угла от газа (относительно 70%), рад */
  driftThrottleGain: number;
  /** Сила контрруления: убавка угла при руле против заноса, рад */
  driftCounterSteer: number;
  /** Скорость набора угла заноса (постоянная времени), 1/с */
  driftAngleRate: number;
  /** Предел скорости роста угла при входе в занос, рад/с (резкость срыва зада) */
  driftEntryRate: number;
  /** Скорость, м/с, выше которой угол заноса сужается (до ~65% на +30 м/с) */
  driftAngleFadeSpeed: number;
  /** Скорость выравнивания машины после выхода из заноса, 1/с */
  driftExitRate: number;
  /** Минимальный руль в сторону заноса, чтобы занос удерживался, 0..1 */
  driftHoldSteer: number;
  /** Потеря скорости в заносе (доля скорости в секунду при большом угле), 1/с */
  driftSpeedLoss: number;
  /** Заряд нитро в секунду полного заноса (доля шкалы) */
  driftChargeRate: number;
  /** Самовыравнивание: как быстро занос, удерживаемый лишь слабым рулём (без Space), сходит сам, 1/с */
  driftSelfAlign: number;
  /** То же на полном руле в занос без Space (клавиатура): 1/с; время удержания ≈ 1 / значение */
  driftSelfAlignFull: number;
  /** «Кивок» кузова на входе в занос: крен наружу, рад (клевок носом — ~40% от него; только визуал) */
  driftNod: number;

  // ── Стены ───────────────────────────────────────────────────────────────
  /** Трение скольжения вдоль стены (доля погашенной нормальной скорости) */
  wallFriction: number;
  /** Отскок от стены при лобовом ударе (доля нормальной скорости) */
  wallBounce: number;
  /** Дополнительная потеря скорости при лобовом ударе, доля */
  wallHeadOnLoss: number;
  /** Скорость доворота курса вдоль стены, 1/с */
  wallAlign: number;
  /** Скорость разворота носа вдоль трассы при упоре в стену с газом, рад/с */
  wallUnstick: number;

  // ── Подвеска ────────────────────────────────────────────────────────────
  /** Жёсткость пружины на колесо, 1/с² (в покое сжатие = g·k⁻¹/4) */
  suspStiffness: number;
  /** Демпфер, 1/с */
  suspDamping: number;
  /** Ход подвески, м */
  suspTravel: number;
  /** Множитель гравитации («аркадный вес»), × 9.81 */
  gravityScale: number;
};

// ─── Заводские значения ────────────────────────────────────────────────────

/** Общие для всех машин числа подвески и стен (различаются только у отдельных машин) */
const COMMON = {
  nitroSpeedMul: 1.15,
  nitroUse: 0.3,
  downforce: 0.3,
  wallHeadOnLoss: 0.2,
  wallAlign: 14,
  wallUnstick: 4,
  suspStiffness: 31.4,
  suspDamping: 3.4,
  suspTravel: 0.25,
  gravityScale: 1.6,
} as const;

function build(): Record<string, HandlingConfig> {
  return {
    // Razor 86: отзывчивый и лёгкий в заносе
    razor: {
      ...COMMON,
      maxSpeed: 64,
      acceleration: 9.3,
      brakeDecel: 28,
      handbrakeDecel: 8,
      mass: 1150,
      nitroBoost: 12,
      steerAngleLow: 0.55,
      steerAngleHigh: 0.12,
      steerFalloffSpeed: 30,
      steerRate: 3.6,
      grip: 1.25,
      yawResponse: 12,
      slipDamping: 9,
      understeer: 0.5,
      understeerSpeed: 22,
      driftMinSpeed: 15,
      driftEntrySteer: 0.25,
      driftGrip: 1.25,
      driftBaseAngle: 0.38,
      driftMaxAngle: 0.72,
      driftSteerGain: 0.22,
      driftThrottleGain: 0.2,
      driftCounterSteer: 0.6,
      driftAngleRate: 13,
      driftEntryRate: 6,
      driftAngleFadeSpeed: 46,
      driftExitRate: 8,
      driftHoldSteer: 0.12,
      driftSpeedLoss: 0.16,
      driftSelfAlign: 1.2,
      driftSelfAlignFull: 0.27,
      driftNod: 0.095,
      driftChargeRate: 0.32,
      wallFriction: 0.1,
      wallBounce: 0.25,
    },
    // Grizzly V8: тяжёлый руль, самый длинный и лёгкий занос, быстрый заряд нитро
    grizzly: {
      ...COMMON,
      maxSpeed: 68,
      acceleration: 8.6,
      brakeDecel: 24,
      handbrakeDecel: 7,
      mass: 1550,
      nitroBoost: 13,
      steerAngleLow: 0.48,
      steerAngleHigh: 0.1,
      steerFalloffSpeed: 30,
      steerRate: 2.4,
      grip: 1.05,
      yawResponse: 8,
      slipDamping: 7,
      understeer: 0.65,
      understeerSpeed: 20,
      driftMinSpeed: 13,
      driftEntrySteer: 0.25,
      driftGrip: 0.95,
      driftBaseAngle: 0.5,
      driftMaxAngle: 0.95,
      driftSteerGain: 0.3,
      driftThrottleGain: 0.2,
      driftCounterSteer: 0.5,
      driftAngleRate: 12,
      driftEntryRate: 5.5,
      driftAngleFadeSpeed: 46,
      driftExitRate: 6.5,
      driftHoldSteer: 0.06,
      driftSpeedLoss: 0.12,
      driftSelfAlign: 0.08,
      driftSelfAlignFull: 0.04,
      driftNod: 0.1,
      driftChargeRate: 0.42,
      wallFriction: 0.1,
      wallBounce: 0.2,
    },
    // Photon X: самый быстрый и цепкий; занос требует скорости и короче
    photon: {
      ...COMMON,
      maxSpeed: 76,
      acceleration: 9.9,
      brakeDecel: 30,
      handbrakeDecel: 9,
      mass: 1250,
      nitroBoost: 14,
      steerAngleLow: 0.5,
      steerAngleHigh: 0.09,
      steerFalloffSpeed: 30,
      steerRate: 3.0,
      grip: 1.35,
      yawResponse: 10,
      slipDamping: 10,
      understeer: 0.4,
      understeerSpeed: 22,
      driftMinSpeed: 20,
      driftEntrySteer: 0.3,
      driftGrip: 1.5,
      driftBaseAngle: 0.28,
      driftMaxAngle: 0.5,
      driftSteerGain: 0.14,
      driftThrottleGain: 0.1,
      driftCounterSteer: 0.7,
      driftAngleRate: 16,
      driftEntryRate: 3.8,
      driftAngleFadeSpeed: 50,
      driftExitRate: 12,
      driftHoldSteer: 0.15,
      driftSpeedLoss: 0.2,
      driftSelfAlign: 2.0,
      driftSelfAlignFull: 0.67,
      driftNod: 0.085,
      driftChargeRate: 0.24,
      wallFriction: 0.09,
      wallBounce: 0.25,
    },
  };
}

/** Живые конфиги по id машины (мутируются панелью тюнинга на лету) */
export const HANDLING: Record<string, HandlingConfig> = build();

/** Глубокая копия заводских значений (не мутируется) */
export const HANDLING_DEFAULTS: Record<string, HandlingConfig> = build();

/** Конфиг машины; для неизвестного id — Razor */
export function getHandling(carId: string): HandlingConfig {
  return HANDLING[carId] ?? HANDLING.razor;
}

/** Возвращает заводские значения (в те же объекты). Без аргумента — для всех машин. */
export function resetHandling(carId?: string): void {
  const ids = carId === undefined ? Object.keys(HANDLING_DEFAULTS) : [carId];
  for (const id of ids) {
    const src = HANDLING_DEFAULTS[id];
    const dst = HANDLING[id];
    if (src && dst) Object.assign(dst, src);
  }
}

// ─── Руль: чистые функции (физика и ИИ считают одинаково) ──────────────────

/** Угол передних колёс, рад, на скорости v (м/с): Low → High по мере роста скорости */
export function steerAngleAt(h: HandlingConfig, v: number): number {
  const r = v / h.steerFalloffSpeed;
  return h.steerAngleHigh + (h.steerAngleLow - h.steerAngleHigh) / (1 + r * r);
}

/** Множитель падения «усиления» руля по рысканью на скорости v */
export function yawGainFactor(h: HandlingConfig, v: number): number {
  const r = v / h.understeerSpeed;
  return 1 + r * r;
}

/** Желаемая скорость рыскания, рад/с (влево > 0) при угле колёс delta (влево > 0): v·tan δ / L */
export function yawRateForSteer(h: HandlingConfig, v: number, delta: number): number {
  return (v * Math.tan(delta)) / (CAR_GEOMETRY.wheelBase * yawGainFactor(h, v));
}

/** Обратная функция: угол колёс (влево > 0) для желаемой кривизны пути kappa (1/м, влево > 0) */
export function steerForCurvature(h: HandlingConfig, v: number, kappa: number): number {
  return Math.atan(CAR_GEOMETRY.wheelBase * yawGainFactor(h, v) * kappa);
}

// ─── Клавиатура ────────────────────────────────────────────────────────────

/** Сглаживание руля с клавиатуры (живой объект; читается InputManager каждый кадр) */
export const INPUT_TUNING = {
  /** Нарастание руля при удержании клавиши, 1/с */
  keySteerRise: 3.5,
  /** Возврат руля к центру при отпускании, 1/с */
  keySteerReturn: 7,
  /** Скорость при смене направления (через ноль), 1/с */
  keySteerCounter: 12,
};

export const INPUT_TUNING_DEFAULTS = { ...INPUT_TUNING };

export const INPUT_PARAMS: TuningParam[] = [
  { key: 'keySteerRise', label: 'Нарастание руля', group: 'Клавиатура', min: 1, max: 10, step: 0.1 },
  { key: 'keySteerReturn', label: 'Возврат руля', group: 'Клавиатура', min: 2, max: 20, step: 0.5 },
  { key: 'keySteerCounter', label: 'Смена направления', group: 'Клавиатура', min: 4, max: 30, step: 0.5 },
];

// ─── Метаданные для панели тюнинга ─────────────────────────────────────────

function p(key: keyof HandlingConfig, label: string, group: string, min: number, max: number, step: number): TuningParam {
  return { key, label, group, min, max, step };
}

export const HANDLING_PARAMS: TuningParam[] = [
  p('maxSpeed', 'Макс. скорость, м/с', 'Двигатель', 30, 110, 1),
  p('acceleration', 'Ускорение, м/с²', 'Двигатель', 4, 18, 0.1),
  p('brakeDecel', 'Торможение, м/с²', 'Двигатель', 10, 50, 0.5),
  p('handbrakeDecel', 'Ручник без заноса, м/с²', 'Двигатель', 0, 30, 0.5),
  p('mass', 'Масса, кг', 'Двигатель', 600, 3000, 10),

  p('nitroBoost', 'Тяга нитро, м/с²', 'Нитро', 0, 30, 0.5),
  p('nitroSpeedMul', 'Макс. скорость с нитро, ×', 'Нитро', 1, 1.5, 0.01),
  p('nitroUse', 'Расход нитро, 1/с', 'Нитро', 0.05, 1, 0.01),

  p('steerAngleLow', 'Угол руля на месте, рад', 'Руль', 0.2, 0.9, 0.01),
  p('steerAngleHigh', 'Угол руля на скорости, рад', 'Руль', 0.02, 0.4, 0.01),
  p('steerFalloffSpeed', 'Скорость падения угла, м/с', 'Руль', 10, 80, 1),
  p('steerRate', 'Скорость поворота колёс, рад/с', 'Руль', 0.5, 10, 0.1),

  p('grip', 'Боковое сцепление, g', 'Сцепление', 0.5, 2.5, 0.01),
  p('downforce', 'Прижим на макс. скорости', 'Сцепление', 0, 1, 0.01),
  p('yawResponse', 'Отклик рыскания, 1/с', 'Сцепление', 2, 30, 0.5),
  p('slipDamping', 'Гашение скольжения, 1/с', 'Сцепление', 1, 30, 0.5),
  p('understeer', 'Недостаточная поворачиваемость', 'Сцепление', 0, 1, 0.01),
  p('understeerSpeed', 'Скорость спада усиления руля, м/с', 'Сцепление', 8, 80, 1),

  p('driftMinSpeed', 'Мин. скорость входа, м/с', 'Дрифт', 6, 40, 0.5),
  p('driftEntrySteer', 'Мин. руль для входа', 'Дрифт', 0.05, 0.8, 0.01),
  p('driftGrip', 'Сцепление в заносе, g', 'Дрифт', 0.5, 2.5, 0.01),
  p('driftBaseAngle', 'Базовый угол, рад', 'Дрифт', 0.1, 0.8, 0.01),
  p('driftMaxAngle', 'Макс. угол, рад', 'Дрифт', 0.3, 1.1, 0.01),
  p('driftSteerGain', 'Влияние руля на угол, рад', 'Дрифт', 0, 0.6, 0.01),
  p('driftThrottleGain', 'Влияние газа на угол, рад', 'Дрифт', 0, 0.6, 0.01),
  p('driftCounterSteer', 'Сила контрруления, рад', 'Дрифт', 0, 1.5, 0.01),
  p('driftAngleRate', 'Скорость набора угла, 1/с', 'Дрифт', 1, 20, 0.5),
  p('driftEntryRate', 'Резкость срыва зада, рад/с', 'Дрифт', 0.5, 10, 0.1),
  p('driftAngleFadeSpeed', 'Сужение угла от скорости, м/с', 'Дрифт', 20, 80, 1),
  p('driftExitRate', 'Скорость выравнивания, 1/с', 'Дрифт', 2, 20, 0.5),
  p('driftHoldSteer', 'Руль для удержания заноса', 'Дрифт', 0, 0.6, 0.01),
  p('driftSpeedLoss', 'Потеря скорости, 1/с', 'Дрифт', 0, 0.5, 0.01),
  p('driftChargeRate', 'Заряд нитро, 1/с', 'Дрифт', 0.05, 1, 0.01),
  p('driftSelfAlign', 'Самовыравнивание слабого руля, 1/с', 'Дрифт', 0, 6, 0.05),
  p('driftSelfAlignFull', 'Самовыравнивание на полном руле, 1/с', 'Дрифт', 0, 3, 0.01),
  p('driftNod', 'Кивок кузова на входе, рад', 'Дрифт', 0, 0.15, 0.005),

  p('wallFriction', 'Трение о стену', 'Стены', 0, 0.6, 0.01),
  p('wallBounce', 'Отскок от стены', 'Стены', 0, 0.8, 0.01),
  p('wallHeadOnLoss', 'Потеря при лобовом ударе', 'Стены', 0, 0.6, 0.01),
  p('wallAlign', 'Доворот вдоль стены, 1/с', 'Стены', 0, 30, 0.5),

  p('wallUnstick', 'Разворот при упоре в стену, рад/с', 'Стены', 0, 8, 0.1),

  p('suspStiffness', 'Жёсткость подвески, 1/с²', 'Подвеска', 10, 120, 0.5),
  p('suspDamping', 'Демпфер, 1/с', 'Подвеска', 0.5, 12, 0.1),
  p('suspTravel', 'Ход подвески, м', 'Подвеска', 0.1, 0.5, 0.01),
  p('gravityScale', 'Гравитация, ×g', 'Подвеска', 0.8, 3, 0.05),
];

// ─── «Своя сборка» (машина id = CUSTOM_CAR_ID) ─────────────────────────────

/** Бюджет: сумма трёх слайдеров не больше этого (всё на максимум не сильнее заводских) */
export const CUSTOM_BUDGET = 2.0;

/** Сборка по умолчанию на момент импорта (цвета физику не интересуют) */
const DEFAULT_BUILD: CustomBuild = { speed: 0.6, handling: 0.6, drift: 0.6, bodyColor: 0, neonColor: 0 };

/** Неизменяемые «якоря» — заводские значения, не зависят от панели тюнинга */
const ANCHORS = build();

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Интерполяция через три якоря: t=0 → a, t=0.5 → b, t=1 → c */
function tri(a: number, b: number, c: number, t: number): number {
  return t < 0.5 ? lerp(a, b, t * 2) : lerp(b, c, t * 2 - 1);
}

function sliderValue(v: number): number {
  return Number.isNaN(v) ? 0.5 : Math.min(1, Math.max(0, v));
}

/** Зажимает слайдеры в [0,1] (NaN → 0.5) и пропорционально сводит сумму к CUSTOM_BUDGET. Цвета не трогает. */
export function normalizeBuild(b: CustomBuild): CustomBuild {
  let speed = sliderValue(b.speed);
  let handling = sliderValue(b.handling);
  let drift = sliderValue(b.drift);
  const sum = speed + handling + drift;
  if (sum > CUSTOM_BUDGET) {
    const k = CUSTOM_BUDGET / sum;
    speed *= k;
    handling *= k;
    drift *= k;
  }
  return { speed, handling, drift, bodyColor: b.bodyColor, neonColor: b.neonColor };
}

/**
 * Полный HandlingConfig по слайдерам (чистая функция, без аллокаций вне результата).
 * Все значения — между заводскими якорями (Razor / Grizzly / Photon) или чуть шире.
 * Ось «Дрифт»: 0 = Photon, 0.5 = Razor, 1 = Grizzly (проверенные наборы заноса).
 */
export function customHandling(b: CustomBuild): HandlingConfig {
  const n = normalizeBuild(b);
  const sp = n.speed;
  const hd = n.handling;
  const dr = n.drift;
  const c: HandlingConfig = { ...ANCHORS.razor };

  // Скорость
  c.maxSpeed = lerp(58, 76, sp);
  c.acceleration = lerp(8.2, 10, sp);
  c.nitroBoost = lerp(11, 14.5, sp);
  c.mass = lerp(1150, 1300, sp);

  // Управляемость (цена скорости: чуть ленивее руль; цена дрифта: чуть меньше сцепление в GRIP)
  c.grip = tri(1.05, 1.25, 1.35, hd) - 0.1 * dr;
  c.steerRate = lerp(2.4, 3.6, hd) - 0.3 * sp;
  c.yawResponse = lerp(8, 12, hd) - 1 * sp;
  c.understeer = tri(0.65, 0.5, 0.4, hd);
  c.slipDamping = tri(7, 9, 10, hd);

  // Дрифт: Photon → Razor → Grizzly
  c.driftMinSpeed = tri(20, 15, 13, dr);
  c.driftEntrySteer = tri(0.3, 0.25, 0.25, dr);
  c.driftGrip = tri(1.5, 1.25, 0.95, dr);
  c.driftBaseAngle = tri(0.28, 0.38, 0.5, dr);
  c.driftMaxAngle = tri(0.5, 0.72, 0.95, dr);
  c.driftSteerGain = tri(0.14, 0.22, 0.3, dr);
  c.driftThrottleGain = tri(0.1, 0.2, 0.2, dr);
  c.driftCounterSteer = tri(0.7, 0.6, 0.5, dr);
  c.driftAngleRate = tri(16, 13, 12, dr);
  c.driftEntryRate = tri(3.8, 6, 5.5, dr);
  c.driftAngleFadeSpeed = tri(50, 46, 46, dr);
  c.driftExitRate = tri(12, 8, 6.5, dr);
  c.driftHoldSteer = tri(0.15, 0.12, 0.06, dr);
  c.driftSpeedLoss = tri(0.2, 0.16, 0.12, dr);
  c.driftChargeRate = tri(0.24, 0.32, 0.42, dr);
  c.driftSelfAlign = tri(2.0, 1.2, 0.08, dr);
  c.driftSelfAlignFull = tri(0.67, 0.27, 0.04, dr);
  c.driftNod = tri(0.085, 0.095, 0.1, dr);
  return c;
}

/** Характеристики 0..1 для полосок меню (по нормализованной сборке; шкала заводских stats) */
export function customStats(b: CustomBuild): { speed: number; handling: number; drift: number } {
  const n = normalizeBuild(b);
  return {
    speed: 0.5 + 0.45 * n.speed,
    handling: 0.45 + 0.4 * n.handling,
    drift: tri(0.4, 0.7, 0.95, n.drift),
  };
}

/** Записывает сборку в HANDLING и HANDLING_DEFAULTS (в те же объекты: физика и панель ?debug держат ссылки) */
export function applyCustomHandling(b: CustomBuild): void {
  const cfg = customHandling(b);
  const live = HANDLING[CUSTOM_CAR_ID];
  const def = HANDLING_DEFAULTS[CUSTOM_CAR_ID];
  if (live) Object.assign(live, cfg);
  else HANDLING[CUSTOM_CAR_ID] = { ...cfg };
  if (def) Object.assign(def, cfg);
  else HANDLING_DEFAULTS[CUSTOM_CAR_ID] = { ...cfg };
}

// Инициализация при импорте (дефолтная сборка)
applyCustomHandling(DEFAULT_BUILD);
