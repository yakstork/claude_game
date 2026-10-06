/**
 * VehiclePhysics — аркадная физика машины (GAME_DESIGN.md §3.1, §6.3).
 *
 * Все числа управления — в handling.ts (HandlingConfig), читаются каждый шаг.
 *
 * Два явных режима движения по земле:
 *  - GRIP: руль задаёт желаемую скорость рыскания v·tan(δ)/L (с падением усиления
 *    на скорости), ограниченную боковым сцеплением grip·g: при превышении мягкая
 *    недостаточная поворачиваемость (нос «плывёт», задняя ось не срывается).
 *    Боковое скольжение быстро гасится — вектор скорости следует за кузовом.
 *    Никакого автоматического срыва в занос нет.
 *  - DRIFT: только осознанно — ручник (Space) + руль на скорости выше порога.
 *    Угол заноса β = ψ_v − h (курс скорости минус курс кузова) управляется газом
 *    и рулём: целевой угол растёт от руля в занос/газа, контрруль его убавляет.
 *    Траектория загибается с боковым ускорением driftGrip·g, скорость теряется
 *    умеренно. Занос зависит от скорости («конвертер скорости в поворот»): выше
 *    driftSpeedStart угол растёт к driftMaxAngle, боковое ускорение усиливается
 *    (driftTurnBoost) и занос заметно тормозит (driftSpeedScrub ∝ sin|угол|·V). Вход резкий: зад срывается за ~0.2 с, кузов «кивает» (визуальный импульс
 *    крена/тангажа), задние шины сразу визжат. Без Space занос держится рулём + газом;
 *    слабый руль «тает» устойчивость заноса (driftSelfAlign). Выход (руль/газ отпущены,
 *    контрруль) — фаза EXIT: угол экспоненциально сводится к нулю, затем GRIP берёт
 *    управление без рывка и «маятника».
 *
 * Буст за дрифт: во время заноса копится «качество» ∫ (угол/макс.угол)·(скорость/опорная)·dt;
 * при чистом завершении заноса (по воле игрока, не от удара) качество с насыщением
 * переводится во временное ускорение state.boostTime/boostPower (доп. тяга и +N% к максималке
 * с плавным затуханием). Сильный удар о стену (strength > 0.15) в заносе сжигает качество.
 * Тот же механизм — публичный applyBoost(seconds, power) (стартовый буст и т.п.).
 *
 * Вертикаль: 4 пружины-демпфера, у каждого колеса свой луч вниз (высота дороги под
 * КОНКРЕТНЫМ колесом через Track.project), тангаж и крен кузова — из разницы высот
 * контактов. Жёсткое ограничение: колесо и днище никогда не ниже дороги.
 *
 * Конвенции: heading h — forward = (sin h, 0, cos h), left = (cos h, 0, −sin h).
 * yawRate > 0 — поворот влево. u — продольная скорость, w — боковая (влево > 0).
 * driftAngle = atan2(w, u) = ψ_v − h: > 0, когда нос смотрит правее вектора скорости
 * (занос в правом повороте); руль +1 (вправо) увеличивает такой угол.
 * WheelState.steerAngle > 0 — колесо повёрнуто влево. compression в покое ≈ 0.5.
 *
 * Логика не зависит от рендера и DOM; в step() нет аллокаций.
 */
import { MathUtils, Quaternion, Vector3 } from 'three';
import type { CarSpec, VehicleControls, VehicleEvent, VehicleEventType, VehicleState, WheelState } from '../core/types';
import { createProjection } from '../world/track';
import type { Track } from '../world/track';
import { CAR_GEOMETRY } from './specs';
import { SLIPSTREAM_TUNING, getHandling, steerAngleAt, yawRateForSteer } from './handling';
import type { HandlingConfig } from './handling';

// ─── Константы ─────────────────────────────────────────────────────────────

const G_REAL = 9.81;
const R = CAR_GEOMETRY.wheelRadius;
const WHEELBASE = CAR_GEOMETRY.wheelBase;
const TRACK_WIDTH = CAR_GEOMETRY.trackWidth;
const BUMP_SPRING = 750;
const BUMP_DAMPER = 26;
/** Днище кузова ниже центра (оси колёс) на столько, м */
export const BODY_FLOOR = 0.2;
/** Окно поиска дороги под колесом, м */
const WHEEL_WINDOW = 6;
/** Окно поиска дороги под центром, м */
const BODY_WINDOW = 25;
const REVERSE_MAX = 12;
const WHEEL_RADIUS_INV = 1 / R;
/** Полуразмеры кузова для проверки стен */
const HALF_W = CAR_GEOMETRY.width / 2;
const HALF_L = CAR_GEOMETRY.length / 2;
const EVENT_POOL = 8;
/** Верхние скорости передач, доля от maxSpeed */
const GEAR_TOPS = [0.17, 0.33, 0.49, 0.65, 0.82, 1.05];

/** Режим движения по земле */
const PHASE_GRIP = 0;
const PHASE_DRIFT = 1;
const PHASE_EXIT = 2;
/** Занос считается законченным, когда |угол| меньше этого, рад */
const EXIT_DONE_ANGLE = 0.07;
/** Предел скорости изменения угла заноса, рад/с */
const MAX_ANGLE_RATE = 3.2;
/** Занос принудительно завершается, если угол больше этого, рад */
const MAX_SLIDE_ANGLE = 1.15;
/** Время нарастания боковой силы и потерь скорости при входе в занос, с */
const DRIFT_ENTRY_TIME = 0.25;
/** Скорость, на которой «заводится» занос на скорости, растёт от driftSpeedStart на столько м/с (smoothstep) */
const DRIFT_SPEED_SPAN = 40;
/** Усиление дуги набирается от driftBoostStart до driftBoostFull (smoothstep) */
/** Торможение заносом набирается быстрее (на этих м/с выше driftSpeedStart — полное) */
const DRIFT_SCRUB_SPAN = 22;
/** Предел скорости поворота траектории в заносе, рад/с */
const MAX_PATH_RATE = 3.2;
/** «Кивок» кузова на входе: пик огибающей через NOD_PEAK с, затухание ~NOD_DUR с */
const NOD_PEAK = 0.08;
const NOD_DUR = 0.6;
/** Доля от крена кивка, идущая в клевок носом */
const NOD_PITCH_RATIO = 0.4;
/** Руль в занос, начиная с которого расход устойчивости равен driftSelfAlignFull */
const SELF_ALIGN_FULL_STEER = 0.75;
/** Предел динамического крена кузова (от поворота и «кивка»), рад: выше колёса отрываются */
const MAX_DYN_ROLL = 0.115;
/** Первые DRIFT_SKID_HOLD с заноса задние шины визжат на полную */
const DRIFT_SKID_HOLD = 0.3;

/** Опорная скорость для оценки качества дрифта, м/с (на ней и при полном угле качество копится 1 ед./с) */
const BOOST_REF_SPEED = 40;
/** Предел множителя угла в качестве (заметно за максимальный угол не награждаем) */
const BOOST_ANGLE_CAP = 1.15;
/** Удар о стену с такой силой в заносе сжигает накопленное качество */
const BOOST_WALL_BURN = 0.15;
/** Нарастание буста в начале, с */
const BOOST_ATTACK = 0.12;
/** Максимальная длина плавного затухания в конце, с (для коротких бустов — до 45% их длительности) */
const BOOST_FADE = 0.6;
/** Показатель насыщения качества: sat = 1 − exp(−(q/ref)^γ); γ > 1 — короткие заносы дают заметно меньше длинных */
const BOOST_SAT_EXP = 1.25;
/** После буста скорость выше текущей максималки гасится ∝ превышению, 1/с (иначе прибавка «висела» бы десятки секунд) */
const BOOST_BLEED = 0.8;
/** Окно после конца буста, в течение которого действует это гашение, с */
const BOOST_TAIL = 4;
/** Доля мощности буста при минимальном качестве (остальное добавляет насыщающийся рост) */
const BOOST_POWER_FLOOR = 0.3;

// ─── Временные объекты уровня модуля (без аллокаций в step) ────────────────

const Y_AXIS = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);
const _v = new Vector3();
const _w = new Vector3();
const _qYaw = new Quaternion();
const _qPitch = new Quaternion();
const _qRoll = new Quaternion();

const clamp = MathUtils.clamp;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function wrapPi(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Мягкое ограничение скорости рыскания: линейно до доли knee от предела, дальше
 * плавно (tanh) приближается к пределу — «нос плывёт», а не упирается в стену.
 */
function softLimit(x: number, lim: number, understeer: number): number {
  const k = 1 - 0.5 * clamp(understeer, 0, 1);
  const a = Math.abs(x) / lim;
  if (a <= k) return x;
  const r = k + (1 - k) * Math.tanh((a - k) / (1 - k));
  return (x < 0 ? -r : r) * lim;
}

export function createWheel(): WheelState {
  return { compression: 0.5, onGround: true, spin: 0, steerAngle: 0, skid: 0, contact: new Vector3() };
}

export function createVehicleState(): VehicleState {
  return {
    position: new Vector3(),
    quaternion: new Quaternion(),
    velocity: new Vector3(),
    heading: 0,
    yawRate: 0,
    speed: 0,
    rpm: 0,
    gear: 1,
    throttle: 0,
    onGround: true,
    airTime: 0,
    driftAngle: 0,
    drifting: false,
    driftIntensity: 0,
    nitro: 0.25,
    nitroActive: false,
    wheels: [createWheel(), createWheel(), createWheel(), createWheel()],
    trackS: 0,
    lateral: 0,
    boostTime: 0,
    boostPower: 0,
    slipstream: 0,
  };
}

export class VehiclePhysics {
  readonly state: VehicleState = createVehicleState();
  readonly events: VehicleEvent[] = [];
  /** Множитель мощности (rubber banding) */
  powerScale = 1;
  /** До старта: мотор крутится, машина стоит */
  frozen = false;
  /** Машина провалилась под дорогу / застряла / сломалась — ведущему нужен респаун */
  needsRespawn = false;
  /** Время, которое машина стоит, хотя ей дают газ/тормоз, с (>8 → needsRespawn) */
  blockedTime = 0;

  /** Живой конфиг управления (объект из HANDLING: панель тюнинга меняет его на лету) */
  private readonly cfg: HandlingConfig;
  // проекция центра на трассу (кэш конца прошлого шага)
  private readonly proj = createProjection();
  private projX = NaN;
  private projZ = NaN;
  // подвеска: точки крепления колёс и высота дороги под каждым колесом
  private readonly wproj = createProjection();
  private readonly mx = [0, 0, 0, 0];
  private readonly my = [0, 0, 0, 0];
  private readonly mz = [0, 0, 0, 0];
  private readonly ground = [0, 0, 0, 0];
  private readonly gRate = [0, 0, 0, 0];
  private groundValid = false;
  private stampValid = false;
  private stampX = 0;
  private stampY = 0;
  private stampZ = 0;
  private stampH = 0;
  private stampP = 0;
  private stampR = 0;
  private susForce = 0;
  private avgRate = 0;
  private landClosing = 0;
  private wasGrounded = true;
  // кузов
  private pitch = 0;
  private pitchVel = 0;
  private roll = 0;
  private rollVel = 0;
  private axSmooth = 0;
  // руль
  private delta = 0;
  // режимы GRIP / DRIFT / EXIT
  private phase = PHASE_GRIP;
  private driftDir = 0;
  private driftTime = 0;
  private driftCooldown = 0;
  private pathRate = 0;
  private angleRate = 0;
  /** Накопленное качество текущего заноса (сгорает при ударе о стену) */
  private driftQ = 0;
  /** Буст: полная длительность, номинальная мощность и текущая эффективная доля (0..1 с учётом огибающей) */
  private boostTotal = 0;
  private boostNom = 0;
  private boostEff = 0;
  /** Сколько ещё секунд после буста гасить скорость выше максималки */
  private boostTail = 0;
  /** «Устойчивость» заноса 1..0: при удержании только рулём тает со скоростью driftSelfAlign */
  private stability = 1;
  // «кивок» кузова на входе в занос (только визуал): время с начала и сторона заноса
  private nodT = NOD_DUR;
  private nodDir = 0;
  private skidKick = false;
  // визуал колёс
  private frontSkid = 0;
  private rearSkid = 0;
  private visSteer = 0;
  // прочее
  private shiftTimer = 0;
  private wallCooldown = 0;
  private evCount = 0;
  private lastAx = 0;
  private throttleIn = 0;
  private readonly eventPool: VehicleEvent[] = [];

  constructor(
    readonly spec: CarSpec,
    readonly track: Track,
  ) {
    this.cfg = getHandling(spec.id);
    for (let i = 0; i < EVENT_POOL; i++) this.eventPool.push({ type: 'car', strength: 0, point: new Vector3() });
  }

  /** Внутренний режим заноса (DRIFT или выравнивание после него) */
  get driftMode(): boolean {
    return this.phase !== PHASE_GRIP;
  }

  /** Полная длительность текущего буста, с (для HUD: доля = state.boostTime / boostDuration); 0 — буста нет */
  get boostDuration(): number {
    return this.state.boostTime > 0 ? this.boostTotal : 0;
  }

  /**
   * Временное ускорение: seconds — длительность, с; power — сила 0..1. Эффект: доп. тяга и +% к максималке
   * (boostThrust / boostSpeedPct машины × power) с плавным затуханием в конце. Не суммируется: новый буст
   * замещает текущий, только если он «сильнее» (power × seconds больше оставшегося у текущего).
   */
  applyBoost(seconds: number, power: number): void {
    if (!(seconds > 0) || !(power > 0)) return;
    const p = clamp01(power);
    const st = this.state;
    if (st.boostTime > 0 && p * seconds <= this.boostNom * st.boostTime) return;
    this.boostTotal = seconds;
    this.boostNom = p;
    st.boostTime = seconds;
    this.updateBoostEnvelope();
  }

  /** Эффективная сила буста по огибающей: быстрое нарастание, плато, плавное затухание */
  private updateBoostEnvelope(): void {
    const st = this.state;
    if (st.boostTime <= 0) {
      this.boostTotal = this.boostNom = this.boostEff = 0;
      st.boostTime = 0;
      st.boostPower = 0;
      return;
    }
    const elapsed = this.boostTotal - st.boostTime;
    const fade = Math.min(BOOST_FADE, this.boostTotal * 0.45);
    const attack = MathUtils.smoothstep(elapsed, 0, Math.min(BOOST_ATTACK, this.boostTotal * 0.3));
    const release = MathUtils.smoothstep(st.boostTime, 0, fade);
    this.boostEff = this.boostNom * attack * release;
    // для HUD/звука: номинальная сила с затуханием, без нарастания (в кадре старта уже полная)
    st.boostPower = this.boostNom * release;
  }

  /** Качество заноса → буст (вызывается при чистом выходе из заноса) */
  private grantDriftBoost(): void {
    const cfg = this.cfg;
    const q = this.driftQ;
    if (!(q >= cfg.boostMinQuality) || cfg.boostDuration <= 0 || cfg.boostPower <= 0) return;
    const sat = 1 - Math.exp(-Math.pow(q / Math.max(cfg.boostQualityRef, 0.05), BOOST_SAT_EXP));
    this.applyBoost(cfg.boostDuration * sat, clamp01(cfg.boostPower * (BOOST_POWER_FLOOR + (1 - BOOST_POWER_FLOOR) * sat)));
  }

  /** Центр колеса i (0..3 = FL, FR, RL, RR) в мировых координатах */
  wheelCenter(i: number, out: Vector3): Vector3 {
    const c = this.state.wheels[i].contact;
    return out.set(c.x, c.y + R, c.z);
  }

  /** Полный сброс (старт / респаун). position — примерно на дороге, высота уточняется. */
  reset(position: Vector3, heading: number, s: number): void {
    const st = this.state;
    st.position.copy(position);
    st.heading = heading;
    st.velocity.set(0, 0, 0);
    st.yawRate = 0;
    st.speed = 0;
    st.rpm = 0.14;
    st.gear = 1;
    st.throttle = 0;
    st.onGround = true;
    st.airTime = 0;
    st.driftAngle = 0;
    st.drifting = false;
    st.driftIntensity = 0;
    st.nitro = 0.25;
    st.nitroActive = false;
    st.boostTime = 0;
    st.boostPower = 0;
    st.slipstream = 0;
    this.boostTotal = this.boostNom = this.boostEff = 0;
    this.boostTail = 0;
    this.driftQ = 0;
    st.trackS = s;
    this.needsRespawn = false;
    this.blockedTime = 0;
    this.events.length = 0;
    this.evCount = 0;
    const pr = this.track.project(st.position, s, this.proj);
    st.position.y = pr.height + R;
    st.trackS = pr.s;
    st.lateral = pr.lateral;
    this.projX = st.position.x;
    this.projZ = st.position.z;
    this.groundValid = false;
    this.stampValid = false;
    this.landClosing = 0;
    this.wasGrounded = true;
    this.susForce = 0;
    this.avgRate = 0;
    this.pitchVel = this.rollVel = this.axSmooth = 0;
    this.delta = 0;
    this.phase = PHASE_GRIP;
    this.driftDir = 0;
    this.driftTime = this.driftCooldown = 0;
    this.pathRate = this.angleRate = 0;
    this.stability = 1;
    this.nodT = NOD_DUR;
    this.nodDir = 0;
    this.skidKick = false;
    this.frontSkid = this.rearSkid = this.visSteer = 0;
    this.shiftTimer = 0;
    this.wallCooldown = 0;
    this.lastAx = 0;
    for (let i = 0; i < 4; i++) {
      const wh = st.wheels[i];
      wh.compression = 0.5;
      wh.onGround = true;
      wh.skid = 0;
      wh.steerAngle = 0;
    }
    // кузов сразу принимает форму дороги под колёсами (без переходного процесса)
    this.pitch = this.roll = 0;
    this.composeQuaternion();
    this.sampleWheels(0, false);
    this.groundAttitude();
    this.composeQuaternion();
    this.sampleWheels(0, false);
    this.settleWheels(0);
    st.velocity.y = 0;
  }

  /** Добавить событие (используется и столкновениями машин; без аллокаций). */
  pushEvent(type: VehicleEventType, strength: number, point: Vector3): void {
    if (this.evCount >= EVENT_POOL) return;
    const e = this.eventPool[this.evCount++];
    e.type = type;
    e.strength = strength;
    e.point.copy(point);
    this.events.push(e);
  }

  step(dt: number, controls: VehicleControls): void {
    const st = this.state;
    const cfg = this.cfg;
    this.events.length = 0;
    this.evCount = 0;
    if (!(dt > 0)) return;

    const throttle = clamp01(controls.throttle);
    const brake = clamp01(controls.brake);
    const steerIn = clamp(controls.steer, -1, 1);
    const handbrake = controls.handbrake;
    this.throttleIn = throttle;

    if (!Number.isFinite(st.position.x + st.position.y + st.position.z + st.velocity.x + st.velocity.z)) {
      this.needsRespawn = true;
      return;
    }

    // ── проекция центра и колёса ───────────────────────────────────────────
    if (st.position.x !== this.projX || st.position.z !== this.projZ) {
      this.track.project(st.position, st.trackS, this.proj, BODY_WINDOW);
    }
    const pr = this.proj;
    if (!this.wheelsFresh()) this.sampleWheels(dt, false);
    const wasOnGround = this.wasGrounded;
    const contacts = this.suspension();
    const grounded = contacts > 0;
    if (grounded) {
      if (!wasOnGround) {
        if (st.airTime > 0.12 && this.landClosing > 2.5) {
          _v.set(st.position.x, pr.height, st.position.z);
          this.pushEvent('land', clamp(this.landClosing / 14, 0.1, 1), _v);
        }
        st.airTime = 0;
      }
    } else {
      st.airTime += dt;
    }

    // ── буст за дрифт / старт: таймер и огибающая (на старте с места не тратится) ──
    if (st.boostTime > 0) {
      if (!this.frozen) st.boostTime -= dt;
      this.updateBoostEnvelope();
      this.boostTail = BOOST_TAIL;
    } else if (this.boostTail > 0) {
      this.boostTail -= dt;
    }

    // ── нитро ──────────────────────────────────────────────────────────────
    const h0 = st.heading;
    const sinH0 = Math.sin(h0);
    const cosH0 = Math.cos(h0);
    let u = st.velocity.x * sinH0 + st.velocity.z * cosH0;
    let w = st.velocity.x * cosH0 - st.velocity.z * sinH0;
    const frozen = this.frozen;
    const nitroOn = !frozen && controls.nitro && st.nitro > 0 && (throttle > 0.1 || Math.abs(u) > 8) && grounded;
    st.nitroActive = nitroOn;
    if (nitroOn) st.nitro = Math.max(0, st.nitro - cfg.nitroUse * dt);

    // ── руль: угол падает со скоростью, колёса поворачиваются с ограниченной скоростью
    const vAbs = Math.abs(u);
    const targetDelta = -steerIn * steerAngleAt(cfg, vAbs);
    const maxStep = cfg.steerRate * dt;
    this.delta += clamp(targetDelta - this.delta, -maxStep, maxStep);

    // ── горизонтальное движение ────────────────────────────────────────────
    let yawRate = st.yawRate;
    this.frontSkid = 0;
    this.rearSkid = 0;
    if (frozen) {
      u = 0;
      w = 0;
      yawRate = 0;
      st.velocity.x = 0;
      st.velocity.z = 0;
      this.phase = PHASE_GRIP;
      this.pathRate = 0;
    } else if (grounded) {
      const gf = Math.min(1, contacts / 3);
      this.updatePhase(dt, controls, throttle, brake, steerIn, u, w, gf);
      // максималка: нитро (×) и буст (+доля) складываются в множитель
      const vmax = cfg.maxSpeed * ((nitroOn ? cfg.nitroSpeedMul : 1) + cfg.boostSpeedPct * this.boostEff + SLIPSTREAM_TUNING.speedPct * st.slipstream);
      if (!frozen && st.slipstream > 0) st.nitro = Math.min(1, st.nitro + SLIPSTREAM_TUNING.nitroRate * st.slipstream * dt);
      // склоны: гравитация вдоль поверхности
      const nx = pr.normal.x;
      const nz = pr.normal.z;
      const axSlope = G_REAL * (nx * sinH0 + nz * cosH0) * gf;
      const awSlope = G_REAL * (nx * cosH0 - nz * sinH0) * gf;
      if (this.phase === PHASE_GRIP) {
        yawRate = this.stepGrip(dt, u, w, yawRate, throttle, brake, handbrake, nitroOn, vmax, gf, axSlope, awSlope);
      } else {
        yawRate = this.stepDrift(dt, throttle, brake, steerIn, nitroOn, vmax, gf, axSlope);
      }
    } else {
      // воздух: скорость сохраняется, руль слабо вращает
      yawRate += -steerIn * 0.9 * dt;
      yawRate *= Math.exp(-0.5 * dt);
      st.heading += yawRate * dt;
      this.pathRate = yawRate;
      if (this.phase !== PHASE_GRIP && st.airTime > 0.4) this.endDrift(0.3);
    }
    st.yawRate = yawRate;
    st.throttle = throttle;

    // ── вертикаль и интегрирование положения ───────────────────────────────
    st.velocity.y += ((grounded ? this.susForce : 0) - G_REAL * cfg.gravityScale) * dt;
    st.position.x += st.velocity.x * dt;
    st.position.z += st.velocity.z * dt;
    st.position.y += st.velocity.y * dt;

    // ── стены и финальная проекция ─────────────────────────────────────────
    this.track.project(st.position, st.trackS, pr, BODY_WINDOW);
    this.handleWalls(dt, pr);
    st.trackS = pr.s;
    st.lateral = pr.lateral;
    this.projX = st.position.x;
    this.projZ = st.position.z;

    // ── производные величины состояния ─────────────────────────────────────
    const sinH = Math.sin(st.heading);
    const cosH = Math.cos(st.heading);
    u = st.velocity.x * sinH + st.velocity.z * cosH;
    w = st.velocity.x * cosH - st.velocity.z * sinH;
    st.speed = u;
    st.driftAngle = Math.abs(u) > 3 ? Math.atan2(w, u) : 0;
    this.updateDriftState(dt, u);
    this.stuckUpdate(dt, throttle, brake, pr.height);

    this.axSmooth += (clamp(this.lastAx, -30, 30) - this.axSmooth) * (1 - Math.exp(-dt * 8));
    this.updateBody(dt, contacts, u);
    // колёса на финальной позе: жёсткие ограничения и точные контакты
    this.sampleWheels(dt, true);
    const finalContacts = this.settleWheels(dt);
    this.wasGrounded = grounded;
    st.onGround = finalContacts > 0;
    this.updateWheels(dt, u, throttle, brake, handbrake, grounded);
    this.updateEngine(dt, u, throttle);
  }

  // ── Подвеска ──────────────────────────────────────────────────────────────

  /** Актуальна ли выборка высот дороги под колёсами для текущей позы */
  private wheelsFresh(): boolean {
    const st = this.state;
    return (
      this.stampValid &&
      st.position.x === this.stampX &&
      st.position.y === this.stampY &&
      st.position.z === this.stampZ &&
      st.heading === this.stampH &&
      this.pitch === this.stampP &&
      this.roll === this.stampR
    );
  }

  /**
   * Для каждого колеса: своя точка крепления в мире (из ориентации кузова) и своя
   * высота дороги под ней (Track.project по точке колеса). updateRates — обновить
   * скорость изменения высоты дороги (вызывается раз за шаг, на финальной позе).
   */
  private sampleWheels(dt: number, updateRates: boolean): void {
    const st = this.state;
    const pos = st.position;
    const offsets = CAR_GEOMETRY.wheelOffsets;
    for (let i = 0; i < 4; i++) {
      const o = offsets[i];
      _v.set(o[0], o[1], o[2]).applyQuaternion(st.quaternion);
      const x = pos.x + _v.x;
      const y = pos.y + _v.y;
      const z = pos.z + _v.z;
      this.mx[i] = x;
      this.my[i] = y;
      this.mz[i] = z;
      _w.set(x, y, z);
      const g = this.track.project(_w, st.trackS, this.wproj, WHEEL_WINDOW).height;
      if (updateRates) this.gRate[i] = this.groundValid && dt > 0 ? clamp((g - this.ground[i]) / dt, -40, 40) : 0;
      this.ground[i] = g;
    }
    if (updateRates) this.groundValid = true;
    this.stampX = pos.x;
    this.stampY = pos.y;
    this.stampZ = pos.z;
    this.stampH = st.heading;
    this.stampP = this.pitch;
    this.stampR = this.roll;
    this.stampValid = true;
  }

  /** Силы пружин/демпферов по колёсам; возвращает число колёс на земле */
  private suspension(): number {
    const cfg = this.cfg;
    const T = cfg.suspTravel;
    const vy = this.state.velocity.y;
    let contacts = 0;
    let sum = 0;
    let rateSum = 0;
    let minGap = Infinity;
    for (let i = 0; i < 4; i++) {
      const rate = this.gRate[i];
      rateSum += rate;
      const gap = this.my[i] + T * 0.5 - this.ground[i] - R;
      if (gap < minGap) minGap = gap;
      const x = T - gap;
      if (x > 0) {
        contacts++;
        const bottomed = x > T;
        const closing = -(vy - rate);
        let f = cfg.suspStiffness * (bottomed ? T : x);
        if (bottomed) f += BUMP_SPRING * (x - T);
        f += (bottomed ? BUMP_DAMPER : cfg.suspDamping) * closing;
        if (f > 0) sum += f;
      }
    }
    this.avgRate = rateSum * 0.25;
    this.landClosing = -(vy - this.avgRate);
    // провал глубоко под дорогу: пружины не «выстреливают», нужен респаун
    if (minGap < -2) {
      this.needsRespawn = true;
      sum = 0;
    }
    this.susForce = sum;
    return contacts;
  }

  /**
   * Жёсткие ограничения и финальное состояние колёс на текущей позе (высоты дороги
   * уже выбраны sampleWheels): низ колеса и днище не ниже дороги (при полном сжатии
   * кузов поднимается); contact — точка на поверхности (на земле) или низ колеса при
   * полном отбое (в воздухе). Возвращает число колёс на земле.
   */
  private settleWheels(dt: number): number {
    const st = this.state;
    const cfg = this.cfg;
    const T = cfg.suspTravel;
    let lift = 0;
    let gSum = 0;
    for (let i = 0; i < 4; i++) {
      const gap = this.my[i] + T * 0.5 - this.ground[i] - R;
      if (-gap > lift) lift = -gap;
      gSum += this.ground[i];
    }
    const floorGap = st.position.y - BODY_FLOOR - gSum * 0.25;
    if (floorGap < 0.01) lift = Math.max(lift, 0.01 - floorGap);
    if (lift > 0) {
      if (lift > 1.5 && dt > 0) this.needsRespawn = true;
      st.position.y += lift;
      for (let i = 0; i < 4; i++) this.my[i] += lift;
      if (st.velocity.y < this.avgRate) st.velocity.y = this.avgRate;
      this.stampY = st.position.y;
    }
    let contacts = 0;
    for (let i = 0; i < 4; i++) {
      const wh = st.wheels[i];
      const gap = this.my[i] + T * 0.5 - this.ground[i] - R;
      const x = T - gap;
      if (x > 0) {
        contacts++;
        wh.onGround = true;
        wh.compression = Math.min(1, x / T);
        wh.contact.set(this.mx[i], this.ground[i], this.mz[i]);
      } else {
        wh.onGround = false;
        wh.compression = 0;
        // полный отбой: низ колеса
        wh.contact.set(this.mx[i], this.my[i] + T * 0.5 - T - R, this.mz[i]);
      }
    }
    return contacts;
  }

  // ── Режимы GRIP / DRIFT / EXIT ────────────────────────────────────────────

  private endDrift(cooldown: number): void {
    this.driftQ = 0;
    this.phase = PHASE_GRIP;
    this.driftDir = 0;
    this.driftTime = 0;
    this.driftCooldown = cooldown;
    this.angleRate = 0;
  }

  /** Вход в занос только осознанно (ручник + руль на скорости); удержание и выход. */
  private updatePhase(
    dt: number,
    c: VehicleControls,
    throttle: number,
    brake: number,
    steerIn: number,
    u: number,
    w: number,
    gf: number,
  ): void {
    const cfg = this.cfg;
    if (this.driftCooldown > 0) this.driftCooldown -= dt;
    if (this.phase === PHASE_GRIP) {
      if (
        c.handbrake &&
        gf > 0.7 &&
        this.driftCooldown <= 0 &&
        u > cfg.driftMinSpeed &&
        Math.abs(steerIn) > cfg.driftEntrySteer
      ) {
        this.phase = PHASE_DRIFT;
        this.driftDir = steerIn > 0 ? 1 : -1;
        this.startDriftKick();
        this.pathRate = this.state.yawRate;
        this.angleRate = 0;
      }
      return;
    }
    const V = Math.hypot(this.state.velocity.x, this.state.velocity.z);
    const beta = u > 1 ? Math.atan2(w, u) : 0;
    if (
      this.phase === PHASE_DRIFT &&
      c.handbrake &&
      this.driftTime > 0.25 &&
      steerIn * this.driftDir <= -Math.max(cfg.driftEntrySteer, 0.5)
    ) {
      // переброс: Space + руль резко в другую сторону — занос в противоположном направлении
      this.driftDir = -this.driftDir;
      this.startDriftKick();
    }
    const bd = beta * this.driftDir;
    const steerInto = steerIn * this.driftDir;
    if (this.phase === PHASE_DRIFT) {
      this.driftTime += dt;
      // качество заноса: угол (от макс. угла машины) × скорость (от опорной) × время
      this.driftQ +=
        Math.min(Math.abs(beta) / cfg.driftMaxAngle, BOOST_ANGLE_CAP) * Math.min(V / BOOST_REF_SPEED, 1.4) * dt;
      // занос держится, пока игрок «вложен»: Space, либо руль в занос + газ/тормоз
      // без Space устойчивость тает тем быстрее, чем слабее руль в занос (driftSelfAlign)
      let held = c.handbrake;
      if (c.handbrake) {
        this.stability = 1;
      } else if (steerInto >= cfg.driftHoldSteer && (throttle >= 0.15 || brake >= 0.15)) {
        const slack = clamp(1 - steerInto / SELF_ALIGN_FULL_STEER, 0, 1);
        // расход: на полном руле — driftSelfAlignFull, на слабом растёт до driftSelfAlign
        this.stability -= (cfg.driftSelfAlignFull + (cfg.driftSelfAlign - cfg.driftSelfAlignFull) * slack * slack) * dt;
        held = this.stability > 0;
      }
      if (!held || V < cfg.driftMinSpeed * 0.55) this.phase = PHASE_EXIT;
    } else {
      const reenter =
        steerInto >= Math.max(cfg.driftEntrySteer, 0.3) &&
        (c.handbrake || (throttle >= 0.3 && this.stability > 0)) &&
        bd > 0.1 &&
        V > cfg.driftMinSpeed * 0.7 &&
        gf > 0.7;
      if (reenter) {
        this.phase = PHASE_DRIFT;
        if (c.handbrake) this.stability = 1;
      }
      else if (bd < EXIT_DONE_ANGLE || V < 3) {
        // чистый выход (машина выровнялась) — награда за занос
        if (V >= 3) this.grantDriftBoost();
        this.endDrift(0.15);
      }
    }
    if (this.phase !== PHASE_GRIP && (u <= 1 || bd > MAX_SLIDE_ANGLE)) this.endDrift(0.4);
  }

  /** Начало заноса (или переброса): сброс таймеров, «кивок» кузова, визг шин */
  private startDriftKick(): void {
    this.driftTime = 0;
    this.stability = 1;
    this.nodT = 0;
    this.nodDir = this.driftDir;
    this.skidKick = true;
  }

  /** Продольное ускорение (тяга, торможение, сопротивление, задний ход) */
  private longAccel(
    dt: number,
    u: number,
    throttle: number,
    brake: number,
    handbrake: boolean,
    nitroOn: boolean,
    vmax: number,
  ): number {
    const cfg = this.cfg;
    const A = cfg.acceleration * this.powerScale;
    // доп. тяга буста — только при газе
    const boostAx = (cfg.boostThrust * this.boostEff + SLIPSTREAM_TUNING.thrust * this.state.slipstream) * clamp01(throttle * 3);
    let ax = 0;
    if (u > 0.5) {
      const k = Math.max(0, 1 - (u / vmax) * (u / vmax));
      ax = throttle * A * k;
      if (nitroOn) ax += cfg.nitroBoost * k;
      ax += boostAx * k;
      if (this.boostTail > 0 && u > vmax) ax -= (u - vmax) * BOOST_BLEED;
      ax -= brake * cfg.brakeDecel;
      ax -= 0.4 + (throttle < 0.05 ? 0.6 + 0.0004 * u * u : 0);
    } else if (u < -0.5) {
      if (brake > 0.05) ax -= brake * A * 0.6 * Math.max(0, 1 - (u / REVERSE_MAX) * (u / REVERSE_MAX));
      if (throttle > 0.05) ax += throttle * cfg.brakeDecel * 0.7;
      ax += 0.5;
    } else if (throttle >= brake) {
      ax = throttle * A + boostAx;
      if (throttle < 0.05) ax = -clamp(u / dt, -0.5, 0.5);
    } else {
      ax = -brake * A * 0.6;
    }
    if (handbrake && u > 1) ax -= cfg.handbrakeDecel;
    return ax;
  }

  /** GRIP: чистый поворот по рулю в пределах бокового сцепления. Возвращает yawRate. */
  private stepGrip(
    dt: number,
    u0: number,
    w0: number,
    yawRate0: number,
    throttle: number,
    brake: number,
    handbrake: boolean,
    nitroOn: boolean,
    vmax: number,
    gf: number,
    axSlope: number,
    awSlope: number,
  ): number {
    const st = this.state;
    const cfg = this.cfg;
    let u = u0;
    let w = w0;
    const vAbs = Math.abs(u);
    const ax = this.longAccel(dt, u, throttle, brake, handbrake, nitroOn, vmax);
    this.lastAx = ax + axSlope;

    // предел бокового ускорения (с прижимной силой на скорости)
    const sp = Math.min(1.3, vAbs / cfg.maxSpeed);
    const aMax = cfg.grip * G_REAL * (1 + cfg.downforce * sp * sp) * gf;
    // желаемая скорость рыскания от руля и её мягкий предел по сцеплению
    const wd = yawRateForSteer(cfg, u, this.delta);
    const wLim = Math.max(aMax, 1) / Math.max(vAbs, 2);
    const wTarget = softLimit(wd, wLim, cfg.understeer);
    const yawRate = yawRate0 + (wTarget - yawRate0) * (1 - Math.exp(-cfg.yawResponse * dt));
    // скольжение (визуал): шины визжат у предела сцепления
    const use = (Math.abs(wTarget) * vAbs) / Math.max(aMax, 1);
    this.frontSkid = clamp((use - 0.92) / 0.08, 0, 1) * 0.7;

    // боковое скольжение быстро гасится: вектор скорости следует за кузовом
    const cap = aMax * 1.4 + 2;
    const damp = clamp(cfg.slipDamping * w, -cap, cap);
    u += (ax + axSlope) * dt;
    w += (awSlope - damp) * dt;
    this.rearSkid = clamp((Math.abs(w) / Math.max(vAbs, 5) - 0.06) / 0.1, 0, 1);
    // парковка: не ползаем на месте
    if (throttle < 0.05 && brake < 0.05 && Math.abs(u) < 0.4 && Math.abs(w) < 0.4) {
      const f = Math.exp(-6 * dt);
      u *= f;
      w *= f;
    }
    st.heading += yawRate * dt;
    const sinH = Math.sin(st.heading);
    const cosH = Math.cos(st.heading);
    st.velocity.x = u * sinH + w * cosH;
    st.velocity.z = u * cosH - w * sinH;
    this.pathRate = yawRate;
    this.visSteer = this.delta;
    return yawRate;
  }

  /**
   * DRIFT / EXIT: угол заноса β управляется газом и рулём, траектория загибается с
   * ускорением driftGrip·g (на скорости — усиленным), скорость теряется умеренно, а на
   * высокой скорости занос тормозит сильнее. Работает с вектором скорости
   * (курс скорости ψ) и курсом кузова h напрямую. Возвращает yawRate кузова.
   */
  private stepDrift(
    dt: number,
    throttle: number,
    brake: number,
    steerIn: number,
    nitroOn: boolean,
    vmax: number,
    gf: number,
    axSlope: number,
  ): number {
    const st = this.state;
    const cfg = this.cfg;
    const dir = this.driftDir;
    const drifting = this.phase === PHASE_DRIFT;
    const vx = st.velocity.x;
    const vz = st.velocity.z;
    let V = Math.hypot(vx, vz);
    let psi = Math.atan2(vx, vz);
    const beta = wrapPi(psi - st.heading);
    const bd = beta * dir;
    const steerInto = steerIn * dir;
    const cosB = Math.max(0.25, Math.cos(beta));

    // целевой угол: руль в занос и газ увеличивают, контрруль убавляет; на высокой
    // скорости угол РАСТЁТ к driftMaxAngle (занос — «конвертер скорости в поворот»)
    const entry = drifting ? clamp(this.driftTime / DRIFT_ENTRY_TIME, 0, 1) : 1;
    const speedT = MathUtils.smoothstep(V, cfg.driftSpeedStart, cfg.driftSpeedStart + DRIFT_SPEED_SPAN);
    const boostT = MathUtils.smoothstep(V, cfg.driftBoostStart, cfg.driftBoostFull);
    let aRate: number;
    let aT = 0;
    if (drifting) {
      aT =
        cfg.driftBaseAngle +
        cfg.driftSteerGain * Math.max(steerInto, 0) -
        cfg.driftCounterSteer * Math.max(-steerInto, 0) +
        cfg.driftThrottleGain * (throttle - 0.7);
      aT = clamp(aT, 0.12, cfg.driftMaxAngle);
      aT = Math.min(cfg.driftMaxAngle, aT * (1 + cfg.driftSpeedAngleGain * speedT));
      // самовыравнивание: когда занос держится лишь слабым рулём, угол сужается
      aT *= 0.65 + 0.35 * clamp(this.stability, 0, 1);
      aRate = cfg.driftAngleRate;
    } else {
      aRate = cfg.driftExitRate;
    }
    // рост угла ограничен driftEntryRate и «разгоняется» за первые ~0.05 с (зад срывается сразу)
    const rampUp = drifting ? MathUtils.smoothstep(this.driftTime, 0, 0.05) : 1;
    const rateT = clamp((aT - bd) * aRate, -MAX_ANGLE_RATE * 0.75, cfg.driftEntryRate * rampUp);
    this.angleRate += (rateT - this.angleRate) * (1 - Math.exp(-30 * dt));
    const bdDot = this.angleRate;

    // скорость поворота траектории (курса скорости); при входе плавно нарастает
    let target: number;
    if (drifting) {
      const angN = clamp(bd / cfg.driftMaxAngle, 0, 1);
      const pf = (0.8 + 0.25 * clamp(steerInto, 0, 1) + 0.25 * angN) * (0.1 + 0.9 * entry);
      // боковое ускорение растёт со скоростью и углом: на 70–80 м/с дуга реально загибается
      // дугой управляет руль в занос: при нейтральном руле — базовая дуга (без усиления и чуть шире)
      const ss = clamp(steerInto, 0, 1);
      const aLat = cfg.driftGrip * G_REAL * pf * (1 - cfg.driftArcSteer * (1 - ss)) * (1 + cfg.driftTurnBoost * boostT * angN * ss);
      target = clamp((-dir * aLat) / Math.max(V, 6), -MAX_PATH_RATE, MAX_PATH_RATE);
    } else {
      // выход: GRIP берёт управление — рыскание, как при обычном повороте
      const sp = Math.min(1.3, V / cfg.maxSpeed);
      const aMax = cfg.grip * G_REAL * (1 + cfg.downforce * sp * sp) * gf;
      const wd = yawRateForSteer(cfg, V * cosB, this.delta);
      target = softLimit(wd, Math.max(aMax, 1) / Math.max(V, 2), cfg.understeer);
    }
    const kPath = drifting ? (this.driftTime < DRIFT_ENTRY_TIME ? 25 : 10) : aRate;
    this.pathRate += (target - this.pathRate) * (1 - Math.exp(-kPath * dt));
    const omega = this.pathRate - dir * bdDot;

    // скорость: тяга вдоль вектора скорости минус потеря на скольжении
    const ax = this.longAccel(dt, V * cosB, throttle, brake, false, nitroOn, vmax);
    this.lastAx = ax * cosB + axSlope;
    // потеря скорости: базовая (как раньше) + на высокой скорости ∝ sin|угол|·V — занос тормозит
    const sinB = Math.abs(Math.sin(beta));
    const scrubT = MathUtils.smoothstep(V, cfg.driftSpeedStart, cfg.driftSpeedStart + DRIFT_SCRUB_SPAN);
    const scrub =
      (cfg.driftSpeedLoss * V * clamp(Math.abs(beta) / 0.6, 0, 1.2) + cfg.driftSpeedScrub * V * sinB * scrubT) *
      entry *
      entry;
    V = Math.max(0, V + (ax * cosB + axSlope - scrub) * dt);
    psi += this.pathRate * dt;
    st.heading += omega * dt;
    st.velocity.x = V * Math.sin(psi);
    st.velocity.z = V * Math.cos(psi);

    this.frontSkid = drifting ? clamp(Math.abs(beta) / 0.5, 0, 0.6) : 0;
    this.rearSkid = clamp(Math.abs(beta) / 0.25, 0, 1);
    this.visSteer = clamp(beta, -0.7, 0.7);
    return omega;
  }

  private updateDriftState(dt: number, u: number): void {
    const st = this.state;
    const absB = Math.abs(st.driftAngle);
    st.drifting = this.phase === PHASE_DRIFT && u > 7;
    const angleT = clamp((absB - 0.09) / 0.5, 0, 1);
    const speedT = clamp((u - 8) / 17, 0, 1);
    const target = st.drifting || (this.phase === PHASE_EXIT && absB > 0.15) ? angleT * speedT : 0;
    st.driftIntensity += (target - st.driftIntensity) * (1 - Math.exp(-dt * 10));
    if (st.driftIntensity < 0.001) st.driftIntensity = 0;
    if (st.drifting && st.onGround) {
      st.nitro = Math.min(1, st.nitro + this.cfg.driftChargeRate * st.driftIntensity * clamp(u / 30, 0, 1) * dt);
    }
  }

  // ── Стены ─────────────────────────────────────────────────────────────────

  private handleWalls(dt: number, pr: { lateral: number; sample: { halfWidth: number; right: Vector3 } }): void {
    const st = this.state;
    const cfg = this.cfg;
    if (this.wallCooldown > 0) this.wallCooldown -= dt;
    const sample = pr.sample;
    const rx = sample.right.x;
    const rz = sample.right.z;
    const rl = Math.hypot(rx, rz) || 1;
    const rhx = rx / rl;
    const rhz = rz / rl;
    // угол между курсом и осью дороги → эффективная полуширина кузова поперёк
    const fx = Math.sin(st.heading);
    const fz = Math.cos(st.heading);
    const cosT = Math.abs(fx * rhz - fz * rhx);
    const sinT = Math.abs(fx * rhx + fz * rhz);
    const ext = HALF_W * cosT + HALF_L * sinT;
    const limit = sample.halfWidth - Math.max(1.0, 0.25 + 0.7 * ext);
    const lat = pr.lateral;
    const side = lat >= 0 ? 1 : -1;
    const pen = Math.abs(lat) - limit;
    // упор носом в стену с газом (у стены ≤ 0.25 м): нос сам доворачивается вдоль трассы
    // («вперёд»), если угол к касательной < 150°, иначе — в ближайшую сторону; без рывков
    if (pen > -0.25 && cfg.wallUnstick > 0 && this.throttleIn > 0.1) {
      const inX = lat >= 0 ? -rhx : rhx;
      const inZ = lat >= 0 ? -rhz : rhz;
      if (Math.hypot(st.velocity.x, st.velocity.z) < 10 && fx * inX + fz * inZ < 0.15) {
        const trackH = Math.atan2(rhz, -rhx);
        let d = wrapPi(trackH - st.heading);
        if (Math.abs(d) > (150 * Math.PI) / 180) d = wrapPi(d + Math.PI);
        const maxTurn = cfg.wallUnstick * dt;
        st.heading += clamp(d, -maxTurn, maxTurn);
      }
    }
    if (pen <= 0) return;

    // внутренняя нормаль стены (горизонтальная)
    const nx = -side * rhx;
    const nz = -side * rhz;
    st.position.x += nx * pen;
    st.position.z += nz * pen;
    pr.lateral = side * limit;

    const vx = st.velocity.x;
    const vz = st.velocity.z;
    const vn = vx * nx + vz * nz;
    const vh = Math.hypot(vx, vz);
    let strength = 0;
    if (vn < 0) {
      const impact = -vn;
      // угол подхода к стене: < ~30° — скольжение, больше — лобовой удар
      const sinPhi = vh > 0.1 ? Math.min(1, impact / vh) : 1;
      const headOn = MathUtils.smoothstep(sinPhi, 0.5, 0.8);
      const newVn = impact * cfg.wallBounce * headOn;
      // гасится нормальная составляющая; касательная теряет трение ∝ погашенному импульсу
      let tvx = vx - vn * nx;
      let tvz = vz - vn * nz;
      const tl = Math.hypot(tvx, tvz);
      if (tl > 1e-3) {
        const dv = Math.min(tl, cfg.wallFriction * (impact + newVn));
        const k = ((tl - dv) / tl) * (1 - cfg.wallHeadOnLoss * headOn);
        tvx *= k;
        tvz *= k;
      }
      st.velocity.x = tvx + nx * newVn;
      st.velocity.z = tvz + nz * newVn;
      // курс плавно доворачивается вдоль стены (при лобовом ударе — почти нет)
      const tl2 = Math.hypot(tvx, tvz);
      if (tl2 > 1) {
        const forward = tvx * fx + tvz * fz >= 0;
        const target = Math.atan2(forward ? tvx : -tvx, forward ? tvz : -tvz);
        const weight = 1 - MathUtils.smoothstep(sinPhi, 0.6, 0.95);
        st.heading += wrapPi(target - st.heading) * (1 - Math.exp(-cfg.wallAlign * dt)) * weight;
      }
      if (headOn > 0.3) st.yawRate *= 0.6;
      strength = impact > 1.5 ? clamp(impact / 22, 0.08, 1) : clamp(vh / 120, 0.03, 0.2);
      if (this.phase !== PHASE_GRIP && (headOn > 0.3 || impact > 6)) this.endDrift(0.4);
    } else if (vh > 6) {
      // прижаты к стене без встречной скорости: скольжение, искры
      strength = clamp(vh / 120, 0.03, 0.2);
    }
    if (strength > BOOST_WALL_BURN && this.phase !== PHASE_GRIP) this.driftQ = 0;
    if (strength > 0 && (this.wallCooldown <= 0 || strength > 0.25)) {
      _v.set(st.position.x - nx * ext, st.position.y, st.position.z - nz * ext);
      this.pushEvent('wall', strength, _v);
      this.wallCooldown = 0.1;
    }
  }

  // ── Застревание / провал ──────────────────────────────────────────────────

  private stuckUpdate(dt: number, throttle: number, brake: number, roadHeight: number): void {
    const st = this.state;
    if (st.position.y < roadHeight - 3) this.needsRespawn = true;
    if (Math.abs(st.lateral) > this.track.halfWidth + 25) this.needsRespawn = true;
    if (!this.frozen && (throttle > 0.3 || brake > 0.3) && Math.abs(st.speed) < 0.8 && st.onGround) {
      this.blockedTime += dt;
      if (this.blockedTime > 8) this.needsRespawn = true;
    } else {
      this.blockedTime = 0;
    }
  }

  // ── Кузов, колёса, мотор ──────────────────────────────────────────────────

  /** Тангаж и крен, при которых кузов лежит на дороге под колёсами (по высотам контактов) */
  private groundAttitude(): void {
    const g = this.ground;
    const front = (g[0] + g[1]) * 0.5;
    const rear = (g[2] + g[3]) * 0.5;
    const left = (g[0] + g[2]) * 0.5;
    const right = (g[1] + g[3]) * 0.5;
    this.pitch = clamp(Math.atan2(front - rear, WHEELBASE), -0.6, 0.6);
    this.roll = clamp(Math.atan2(left - right, TRACK_WIDTH), -0.6, 0.6);
  }

  private updateBody(dt: number, contacts: number, u: number): void {
    const st = this.state;
    let tp: number;
    let tr: number;
    if (this.nodT < NOD_DUR) this.nodT += dt;
    if (contacts > 0) {
      // геометрия: кузов повторяет гребень, въезд на эстакаду, вираж — по высотам контактов
      const g = this.ground;
      const front = (g[0] + g[1]) * 0.5;
      const rear = (g[2] + g[3]) * 0.5;
      const left = (g[0] + g[2]) * 0.5;
      const right = (g[1] + g[3]) * 0.5;
      tp = Math.atan2(front - rear, WHEELBASE);
      tr = Math.atan2(left - right, TRACK_WIDTH);
      // динамика: клевок/приседание и крен от бокового ускорения
      // в заносе крен — от реального поворота траектории, а не от быстрого рыскания кузова
      const aLeft = (this.phase === PHASE_GRIP ? st.yawRate : this.pathRate) * u;
      const rollCap = this.phase === PHASE_GRIP ? 0.07 : 0.055;
      let dynRoll = clamp(aLeft * 0.0058, -rollCap, rollCap);
      tp += clamp(this.axSmooth * 0.0044, -0.0436, 0.0436);
      // «кивок» на входе в занос: крен наружу и клевок носом, затухает за ~0.3 с (визуал)
      if (this.nodT < NOD_DUR) {
        const x = this.nodT / NOD_PEAK;
        const env = x * Math.exp(1 - x);
        dynRoll -= this.nodDir * this.cfg.driftNod * env;
        tp -= this.cfg.driftNod * NOD_PITCH_RATIO * env;
      }
      // предел динамического крена: дальше начинается отрыв внутренних колёс от дороги
      tr += clamp(dynRoll, -MAX_DYN_ROLL, MAX_DYN_ROLL);
    } else {
      const vh = Math.hypot(st.velocity.x, st.velocity.z);
      tp = clamp(Math.atan2(st.velocity.y, Math.max(vh, 1)) * 0.7, -0.4, 0.4);
      tr = 0;
    }
    tp = clamp(tp, -0.6, 0.6);
    tr = clamp(tr, -0.6, 0.6);
    const wn = 26;
    const z = 0.8;
    this.pitchVel += (wn * wn * (tp - this.pitch) - 2 * z * wn * this.pitchVel) * dt;
    this.pitch += this.pitchVel * dt;
    this.rollVel += (wn * wn * (tr - this.roll) - 2 * z * wn * this.rollVel) * dt;
    this.roll += this.rollVel * dt;
    this.composeQuaternion();
  }

  private composeQuaternion(): void {
    const st = this.state;
    _qYaw.setFromAxisAngle(Y_AXIS, st.heading);
    _qPitch.setFromAxisAngle(X_AXIS, -this.pitch);
    _qRoll.setFromAxisAngle(Z_AXIS, this.roll);
    st.quaternion.copy(_qYaw).multiply(_qPitch).multiply(_qRoll);
  }

  private updateWheels(
    dt: number,
    u: number,
    throttle: number,
    brake: number,
    handbrake: boolean,
    grounded: boolean,
  ): void {
    const st = this.state;
    const wheels = st.wheels;
    const vAbs = Math.abs(u);
    const spinBase = u * WHEEL_RADIUS_INV * dt;
    const wheelspin = throttle > 0.7 && u > -1 && u < 15 ? 0.7 * throttle * (1 - Math.max(u, 0) / 15) : 0;
    const speedGate = MathUtils.smoothstep(vAbs, 2, 6);
    let rearSkid = this.rearSkid;
    if (handbrake && vAbs > 4) rearSkid = Math.max(rearSkid, 0.85);
    if (wheelspin > 0.15) rearSkid = Math.max(rearSkid, wheelspin * 0.8);
    if (this.phase !== PHASE_GRIP) rearSkid = Math.max(rearSkid, st.driftIntensity);
    // первые ~0.3 с заноса зад визжит на полную, дальше — по углу (мгновенный «срыв» шин)
    const entrySkid = this.phase === PHASE_DRIFT && this.driftTime < DRIFT_SKID_HOLD;
    if (entrySkid) rearSkid = 1;
    const hardBrake = brake > 0.95 && vAbs > 15 ? 0.25 : 0;
    // в заносе колёса визуально «контрулят» вдоль вектора скорости
    const steerL = MathUtils.lerp(this.delta, this.visSteer, clamp(st.driftIntensity * 1.5, 0, 1));
    const kSkid = 1 - Math.exp(-dt * 20);
    const kick = this.skidKick;
    this.skidKick = false;
    for (let i = 0; i < 4; i++) {
      const wh = wheels[i];
      const front = i < 2;
      if (front) {
        wh.spin += spinBase;
        wh.steerAngle = steerL;
      } else {
        wh.steerAngle = 0;
        if (handbrake && vAbs > 1) {
          // колесо заблокировано
        } else {
          wh.spin += spinBase * (1 + wheelspin);
        }
      }
      const raw = grounded && wh.onGround ? Math.min(1, (front ? this.frontSkid : rearSkid) + hardBrake) * speedGate : 0;
      wh.skid += (raw - wh.skid) * kSkid;
      if (kick && !front && raw > 0.9) wh.skid = Math.max(wh.skid, 0.95);
    }
  }

  private updateEngine(dt: number, u: number, throttle: number): void {
    const st = this.state;
    const vAbs = Math.abs(u);
    const max = this.cfg.maxSpeed;
    // передачи с гистерезисом
    let gear = st.gear;
    if (u < -0.5) {
      gear = 0;
    } else {
      if (gear < 1) gear = 1;
      while (gear < GEAR_TOPS.length && u > GEAR_TOPS[gear - 1] * max) {
        gear++;
        this.shiftTimer = 0.14;
      }
      while (gear > 1 && u < GEAR_TOPS[gear - 2] * max * 0.82) gear--;
    }
    st.gear = gear;
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    const top = gear === 0 ? REVERSE_MAX : GEAR_TOPS[gear - 1] * max;
    const speedRpm = (0.15 + 0.85 * Math.min(1, vAbs / top)) * (0.82 + 0.18 * throttle);
    const free = (0.14 + 0.86 * throttle) * (1 - MathUtils.smoothstep(vAbs, 3, 12));
    let target = Math.max(speedRpm, free);
    if (!st.onGround) target = Math.max(target * 0.9, 0.2 + 0.7 * throttle);
    if (this.shiftTimer > 0) target *= 0.8;
    st.rpm += (target - st.rpm) * (1 - Math.exp(-dt * 12));
    st.rpm = clamp(st.rpm, 0, 1);
  }
}
