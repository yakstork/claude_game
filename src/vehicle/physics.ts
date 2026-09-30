/**
 * VehiclePhysics — аркадная физика машины (GAME_DESIGN.md §3.1, §6.3).
 *
 * Модель:
 *  - плоское движение: bicycle model (две оси, насыщающаяся поперечная сила),
 *    продольная тяга по кривой (1 − (v/vmax)²), нитро, задний ход;
 *  - вертикаль: 4 пружины-демпфера по колёсам над плоскостью дороги, гравитация
 *    «аркадная» (×1.6), отрыв на трамплине и мягкая посадка;
 *  - дрифт: срыв задней оси (ручник / резкий руль) + drift assist (момент
 *    рыскания держит угол заноса 15–50°), плавный выход;
 *  - стены: выталкивание по |lateral|, отскок, потеря скорости, событие 'wall'.
 *
 * Конвенции: heading h — forward = (sin h, 0, cos h), left = (cos h, 0, −sin h).
 * yawRate > 0 — поворот влево. Внутри: u — продольная скорость, w — боковая
 * (влево положительна). driftAngle = atan2(w, u): > 0, когда нос смотрит правее
 * вектора скорости (занос в правом повороте); руль +1 (вправо) увеличивает такой угол.
 * WheelState.steerAngle > 0 — колесо повёрнуто влево (поворот вокруг +Y).
 * WheelState.compression в покое ≈ 0.5.
 *
 * Логика не зависит от рендера и DOM; в step() нет аллокаций.
 */
import { MathUtils, Quaternion, Vector3 } from 'three';
import type { CarSpec, VehicleControls, VehicleEvent, VehicleEventType, VehicleState, WheelState } from '../core/types';
import { createProjection } from '../world/track';
import type { Track } from '../world/track';
import { CAR_GEOMETRY } from './specs';

// ─── Константы ─────────────────────────────────────────────────────────────

const G_REAL = 9.81;
/** Гравитация «аркадного веса» (падение и подвеска) */
const G = G_REAL * 1.6;
const R = CAR_GEOMETRY.wheelRadius;
/** Ход подвески, м. В покое сжатие = TRAVEL/2 */
const TRAVEL = 0.25;
const SPRING = G / (2 * TRAVEL);
const DAMPER = 3.4;
const BUMP_SPRING = 750;
const BUMP_DAMPER = 26;
/** Расстояние от центра до передней/задней оси, м */
const AXLE_A = CAR_GEOMETRY.wheelBase / 2;
const AXLE_B = CAR_GEOMETRY.wheelBase / 2;
/** Радиус инерции рыскания², м² */
const YAW_K2 = 1.5;
/** Доли поперечного сцепления по осям (передняя слабее → недостаточная поворачиваемость) */
const FRONT_SHARE = 0.46;
const REAR_SHARE = 0.54;
/** Масштаб угла скольжения насыщения, рад */
const SLIP_SCALE = 0.1;
const NITRO_SPEED_MUL = 1.15;
const GRIP_ASSIST = 5;
/** Суммарный предел поперечной силы в полном заносе относительно обычного сцепления */
const DRIFT_CAPACITY = 1.12;
const NITRO_USE = 0.3;
const REVERSE_MAX = 12;
const WALL_RESTITUTION = 0.25;
const WHEEL_RADIUS_INV = 1 / R;
/** Полуразмеры кузова для проверки стен */
const HALF_W = CAR_GEOMETRY.width / 2;
const HALF_L = CAR_GEOMETRY.length / 2;
const EVENT_POOL = 8;

/** Верхние скорости передач, доля от maxSpeed */
const GEAR_TOPS = [0.17, 0.33, 0.49, 0.65, 0.82, 1.05];

// ─── Временные объекты уровня модуля (без аллокаций в step) ────────────────

const Y_AXIS = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);
const _v = new Vector3();
const _qAlign = new Quaternion();
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

/** Доля максимального угла руля на скорости v, м/с (1 → 0.33, на 60 м/с ≈ 0.41) */
export function steerScale(v: number): number {
  const r = v / 22;
  return 0.33 + 0.67 / (1 + r * r);
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
  /** Внутренний режим заноса (assist активен) */
  driftMode = false;
  /** Время, которое машина стоит, хотя ей дают газ/тормоз, с (>8 → needsRespawn) */
  blockedTime = 0;

  // проекция на трассу (кэш конца прошлого шага)
  private readonly proj = createProjection();
  private readonly projPos = new Vector3(NaN, NaN, NaN);
  // подвеска и кузов
  private readonly prevGround = [0, 0, 0, 0];
  private groundValid = false;
  private landClosing = 0;
  private pitch = 0;
  private pitchVel = 0;
  private roll = 0;
  private rollVel = 0;
  private axSmooth = 0;
  private readonly nSmooth = new Vector3(0, 1, 0);
  // руль и сцепление
  private delta = 0;
  private rearMul = 1;
  // дрифт
  private driftDir = 0;
  private driftTimer = 0;
  private lowAngleTime = 0;
  private established = false;
  private hardSteerTime = 0;
  private driftCooldown = 0;
  private prevBeta = 0;
  private betaRate = 0;
  // прочее
  private shiftTimer = 0;
  private wallCooldown = 0;
  private evCount = 0;
  private readonly eventPool: VehicleEvent[] = [];

  constructor(
    readonly spec: CarSpec,
    readonly track: Track,
  ) {
    for (let i = 0; i < EVENT_POOL; i++) this.eventPool.push({ type: 'car', strength: 0, point: new Vector3() });
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
    st.trackS = s;
    this.needsRespawn = false;
    this.driftMode = false;
    this.blockedTime = 0;
    this.events.length = 0;
    this.evCount = 0;
    this.projPos.set(NaN, NaN, NaN);
    const pr = this.track.project(st.position, s, this.proj);
    st.position.y = pr.height + R;
    st.trackS = pr.s;
    st.lateral = pr.lateral;
    this.projPos.copy(st.position);
    this.nSmooth.copy(pr.normal);
    this.groundValid = false;
    this.landClosing = 0;
    this.pitch = this.pitchVel = this.roll = this.rollVel = this.axSmooth = 0;
    this.delta = 0;
    this.rearMul = 1;
    this.driftDir = 0;
    this.driftTimer = this.lowAngleTime = this.hardSteerTime = this.driftCooldown = 0;
    this.established = false;
    this.prevBeta = this.betaRate = 0;
    this.shiftTimer = 0;
    this.wallCooldown = 0;
    this.composeQuaternion();
    for (let i = 0; i < 4; i++) {
      const wh = st.wheels[i];
      wh.compression = 0.5;
      wh.onGround = true;
      wh.skid = 0;
      wh.steerAngle = 0;
    }
    this.updateSuspension(0, this.proj);
    // после сброса подвеска в равновесии, вертикальная скорость нулевая
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
    const spec = this.spec;
    this.events.length = 0;
    this.evCount = 0;
    if (!(dt > 0)) return;

    const throttle = clamp01(controls.throttle);
    const brake = clamp01(controls.brake);
    const steerIn = clamp(controls.steer, -1, 1);
    const handbrake = controls.handbrake;

    if (!Number.isFinite(st.position.x + st.position.y + st.position.z + st.velocity.x + st.velocity.z)) {
      this.needsRespawn = true;
      return;
    }

    // ── проекция и подвеска ────────────────────────────────────────────────
    if (
      st.position.x !== this.projPos.x ||
      st.position.y !== this.projPos.y ||
      st.position.z !== this.projPos.z
    ) {
      this.track.project(st.position, st.trackS, this.proj);
    }
    const pr = this.proj;
    const wasOnGround = st.onGround;
    const contacts = this.updateSuspension(dt, pr);
    const grounded = contacts > 0;
    st.onGround = grounded;
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

    // ── нитро ──────────────────────────────────────────────────────────────
    const h0 = st.heading;
    const sinH0 = Math.sin(h0);
    const cosH0 = Math.cos(h0);
    let u = st.velocity.x * sinH0 + st.velocity.z * cosH0;
    let w = st.velocity.x * cosH0 - st.velocity.z * sinH0;
    const frozen = this.frozen;
    const nitroOn =
      !frozen && controls.nitro && st.nitro > 0 && (throttle > 0.1 || Math.abs(u) > 8) && grounded;
    st.nitroActive = nitroOn;
    if (nitroOn) st.nitro = Math.max(0, st.nitro - NITRO_USE * dt);

    // ── горизонтальное движение ────────────────────────────────────────────
    let yawRate = st.yawRate;
    let du = 0;
    const vAbs = Math.abs(u);
    const vmax = spec.maxSpeed * (nitroOn ? NITRO_SPEED_MUL : 1);
    let slipF = 0;
    let slipR = 0;

    // руль: угол уменьшается со скоростью, но не до нуля (60 м/с ≈ 41%)
    const targetDelta = -steerIn * spec.steerAngle * steerScale(vAbs);
    this.delta += (targetDelta - this.delta) * (1 - Math.exp(-dt / 0.05));
    const delta = this.delta;

    if (frozen) {
      u = 0;
      w = 0;
      yawRate = 0;
      st.velocity.x = 0;
      st.velocity.z = 0;
      this.driftMode = false;
      this.rearMul = 1;
      this.resetDriftCounters();
    } else if (grounded) {
      const gf = Math.min(1, contacts / 3);
      let yawAssist = this.updateDrift(dt, controls, throttle, steerIn, u, w, gf);

      // продольная сила
      const A = spec.acceleration * this.powerScale;
      let ax = 0;
      if (u > 0.5) {
        const k = Math.max(0, 1 - (u / vmax) * (u / vmax));
        ax = throttle * A * k;
        if (nitroOn) ax += spec.nitroBoost * k;
        ax -= brake * spec.brakeDecel;
        ax -= 0.4 + (throttle < 0.05 ? 0.6 + 0.0004 * u * u : 0);
      } else if (u < -0.5) {
        if (brake > 0.05) ax -= brake * A * 0.6 * Math.max(0, 1 - (u / REVERSE_MAX) * (u / REVERSE_MAX));
        if (throttle > 0.05) ax += throttle * spec.brakeDecel * 0.7;
        ax += 0.5;
      } else if (throttle >= brake) {
        ax = throttle * A;
        if (throttle < 0.05) ax = -clamp(u / dt, -0.5, 0.5);
      } else {
        ax = -brake * A * 0.6;
      }
      if (handbrake && u > 1) ax -= 2;
      if (this.driftMode) ax -= 0.06 * u * st.driftIntensity;

      // склоны: гравитация вдоль поверхности
      const nx = pr.normal.x;
      const nz = pr.normal.z;
      const axSlope = G_REAL * (nx * sinH0 + nz * cosH0) * gf;
      const awSlope = G_REAL * (nx * cosH0 - nz * sinH0) * gf;

      // шины
      const uEff = Math.max(vAbs, 2.5);
      const sgn = u >= 0 ? 1 : -1;
      const sp = Math.min(1.3, vAbs / spec.maxSpeed);
      const gripScale = 1 + 0.3 * sp * sp;
      // в заносе суммарный предел по поперечной силе чуть выше, чем у сцепления (награда за дрифт)
      const driftFrac = clamp((1 - this.rearMul) / (1 - spec.driftGrip), 0, 1);
      const boost = 1 + (DRIFT_CAPACITY / (FRONT_SHARE + REAR_SHARE * spec.driftGrip) - 1) * driftFrac;
      const fmaxF = spec.grip * G_REAL * FRONT_SHARE * gripScale * boost * gf;
      const fmaxR = spec.grip * G_REAL * REAR_SHARE * gripScale * boost * this.rearMul * gf;
      slipF = Math.atan((w + AXLE_A * yawRate) / uEff) - delta * sgn;
      slipR = Math.atan((w - AXLE_B * yawRate) / uEff);
      const fyF = -fmaxF * Math.tanh(slipF / SLIP_SCALE);
      const fyR = -fmaxR * Math.tanh(slipR / SLIP_SCALE);
      const sinD = Math.sin(delta);
      const cosD = Math.cos(delta);
      if (!this.driftMode) {
        // стабилизация в режиме сцепления: рыскание следует за рулём, но не выше предела шин
        const wKin = (u * Math.tan(delta)) / (AXLE_A + AXLE_B);
        const wMax = (spec.grip * G_REAL * gripScale * 0.85) / Math.max(vAbs, 4);
        const wT = clamp(wKin, -wMax, wMax);
        yawAssist = clamp(GRIP_ASSIST * (wT - yawRate), -8, 8) * gf * this.rearMul * this.rearMul;
      }

      du = ax - fyF * sinD + yawRate * w + axSlope;
      let dw = fyF * cosD + fyR - yawRate * u + awSlope;
      const dyaw = (AXLE_A * fyF * cosD - AXLE_B * fyR) / YAW_K2 - 0.35 * yawRate + yawAssist;
      if (this.driftMode && throttle > 0.05) {
        // газ поддерживает занос: потеря скорости не быстрее ~8%/с
        const vmag = Math.hypot(u, w);
        if (vmag > 5) {
          const aV = (u * du + w * dw) / vmag;
          const floor = -0.08 * vmag;
          if (aV < floor) {
            const corr = (floor - aV) * clamp(throttle * 1.3, 0, 1);
            du += (corr * u) / vmag;
            dw += (corr * w) / vmag;
          }
        }
      }
      u += du * dt;
      w += dw * dt;
      yawRate += dyaw * dt;
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
    } else {
      // воздух: курс сохраняется, руль слабо вращает
      yawRate += -steerIn * 0.9 * dt;
      yawRate *= Math.exp(-0.5 * dt);
      st.heading += yawRate * dt;
      this.driftTimer += dt;
      if (this.driftMode && st.airTime > 0.8) this.exitDrift();
    }
    st.yawRate = yawRate;
    st.throttle = throttle;

    // ── интегрирование положения ───────────────────────────────────────────
    st.position.x += st.velocity.x * dt;
    st.position.z += st.velocity.z * dt;
    st.position.y += st.velocity.y * dt;

    // ── стены и финальная проекция ─────────────────────────────────────────
    this.track.project(st.position, st.trackS, pr);
    this.handleWalls(dt, pr);
    st.trackS = pr.s;
    st.lateral = pr.lateral;
    this.projPos.copy(st.position);

    // ── производные величины состояния ─────────────────────────────────────
    const sinH = Math.sin(st.heading);
    const cosH = Math.cos(st.heading);
    u = st.velocity.x * sinH + st.velocity.z * cosH;
    w = st.velocity.x * cosH - st.velocity.z * sinH;
    st.speed = u;
    st.driftAngle = Math.abs(u) > 3 ? Math.atan2(w, u) : 0;
    this.updateDriftState(dt, u);
    this.stuckUpdate(dt, throttle, brake, pr.height);

    this.axSmooth += (clamp(du, -30, 30) - this.axSmooth) * (1 - Math.exp(-dt * 8));
    this.updateBody(dt, grounded, u);
    this.updateWheels(dt, u, throttle, brake, handbrake, slipF, slipR, grounded);
    this.updateEngine(dt, u, throttle);
  }

  // ── Подвеска ──────────────────────────────────────────────────────────────

  /**
   * Считает состояние 4 колёс и вертикальную скорость. Возвращает число колёс
   * на земле. dt = 0 — только пересчитать колёса (для reset).
   */
  private updateSuspension(dt: number, pr: { height: number; normal: Vector3 }): number {
    const st = this.state;
    const pos = st.position;
    const n = pr.normal;
    const ny = Math.max(n.y, 0.3);
    const offsets = CAR_GEOMETRY.wheelOffsets;
    let contacts = 0;
    let sumForce = 0;
    let sumGroundRate = 0;
    let minGap = Infinity;
    const vy = st.velocity.y;
    const invDt = dt > 0 ? 1 / dt : 0;
    for (let i = 0; i < 4; i++) {
      const o = offsets[i];
      _v.set(o[0], o[1], o[2]).applyQuaternion(st.quaternion);
      const wx = pos.x + _v.x;
      const wz = pos.z + _v.z;
      const attachY = pos.y + _v.y + TRAVEL * 0.5;
      const ground = pr.height - (n.x * _v.x + n.z * _v.z) / ny;
      const groundRate = this.groundValid ? (ground - this.prevGround[i]) * invDt : 0;
      this.prevGround[i] = ground;
      sumGroundRate += groundRate;
      const gap = attachY - ground - R;
      if (gap < minGap) minGap = gap;
      const x = TRAVEL - gap;
      const wheel = st.wheels[i];
      if (x > 0) {
        contacts++;
        const bottomed = x > TRAVEL;
        const closing = -(vy - groundRate);
        let f = SPRING * (bottomed ? TRAVEL : x);
        if (bottomed) f += BUMP_SPRING * (x - TRAVEL);
        f += (bottomed ? BUMP_DAMPER : DAMPER) * closing;
        if (f > 0) sumForce += f;
        wheel.compression = Math.min(1, x / TRAVEL);
        wheel.onGround = true;
        wheel.contact.set(wx, ground, wz);
      } else {
        wheel.compression = 0;
        wheel.onGround = false;
        wheel.contact.set(wx, attachY - TRAVEL - R, wz);
      }
    }
    this.groundValid = true;
    if (dt <= 0) return contacts;

    const avgRate = sumGroundRate * 0.25;
    this.landClosing = -(vy - avgRate);
    // жёсткий предел проникновения (посадка на большой скорости)
    if (minGap < -3) {
      this.needsRespawn = true;
    } else if (minGap < -0.22) {
      pos.y += -0.22 - minGap;
      if (st.velocity.y < avgRate) st.velocity.y = avgRate;
    }
    st.velocity.y += ((contacts > 0 ? sumForce : 0) - G) * dt;
    return contacts;
  }

  // ── Занос ─────────────────────────────────────────────────────────────────

  private resetDriftCounters(): void {
    this.driftTimer = 0;
    this.lowAngleTime = 0;
    this.established = false;
    this.hardSteerTime = 0;
    this.betaRate = 0;
    this.prevBeta = 0;
  }

  private exitDrift(): void {
    this.driftMode = false;
    this.driftCooldown = 0.5;
    this.resetDriftCounters();
  }

  /**
   * Логика входа/выхода из заноса, сцепление задней оси и drift assist.
   * Возвращает добавочное угловое ускорение рыскания.
   */
  private updateDrift(
    dt: number,
    c: VehicleControls,
    throttle: number,
    steerIn: number,
    u: number,
    w: number,
    gf: number,
  ): number {
    const spec = this.spec;
    const vAbs = Math.abs(u);
    const beta = u > 3 ? Math.atan2(w, u) : 0;
    const absB = Math.abs(beta);
    const hb = c.handbrake;
    this.betaRate += ((beta - this.prevBeta) / dt - this.betaRate) * 0.2;
    this.prevBeta = beta;
    if (this.driftCooldown > 0) this.driftCooldown -= dt;

    // резкий руль + газ на скорости
    const steerSpeed = 36 - 12 * spec.stats.drift;
    if (Math.abs(steerIn) > 0.85 && throttle > 0.5 && u > steerSpeed) this.hardSteerTime += dt;
    else this.hardSteerTime = 0;

    if (!this.driftMode) {
      const byHandbrake = hb && u > 15;
      const bySteer = this.hardSteerTime > 0.15 && this.driftCooldown <= 0;
      const byNatural = absB > 0.26 && u > 14 && this.driftCooldown <= 0;
      if (gf > 0.7 && (byHandbrake || bySteer || byNatural)) {
        this.driftMode = true;
        this.driftTimer = 0;
        this.lowAngleTime = 0;
        this.established = false;
        this.driftDir = absB > 0.1 ? Math.sign(beta) : Math.abs(steerIn) > 0.1 ? Math.sign(steerIn) : 0;
      }
    } else {
      this.driftTimer += dt;
      if (absB > 0.15) this.driftDir = Math.sign(beta);
      else if (this.driftDir === 0 && Math.abs(steerIn) > 0.1) this.driftDir = Math.sign(steerIn);
      if (absB > 0.2) this.established = true;
      if (absB < 0.122 && !hb) this.lowAngleTime += dt;
      else this.lowAngleTime = 0;
      if (((this.established || this.driftTimer > 0.7) && this.lowAngleTime > 0.25) || u < 7) this.exitDrift();
    }

    // целевой угол заноса (drift assist): 15–50°; контр-руль уменьшает, руль в занос — увеличивает
    const dir = this.driftDir;
    const active = this.driftMode && dir !== 0;
    const a = active ? beta * dir : 0;
    let aT = 0;
    if (active) {
      const cs = steerIn * dir;
      const tf = 0.55 + 0.45 * throttle;
      aT = clamp((0.4 + 0.34 * cs) * tf, 0.26, 0.87);
      // контр-руль (или отпущенные газ и руль) выводит из заноса
      if (!hb && cs < -0.4) aT *= clamp(1 - (-cs - 0.4) * 1.7, 0, 1);
      if (!hb && throttle < 0.25 && Math.abs(cs) < 0.25) aT = 0;
    }

    // сцепление задней оси
    const dg = spec.driftGrip;
    let target = 1;
    if (this.driftMode) {
      target = hb ? dg * 0.6 : dg;
      if (a > 0.7) target = MathUtils.lerp(target, 1, MathUtils.smoothstep(a, 0.7, 1.05));
      if (active && aT === 0) target = MathUtils.lerp(target, 1, 1 - clamp(a / 0.3, 0, 1));
    } else if (hb && vAbs > 5) {
      target = 0.5;
    }
    if (target < this.rearMul) this.rearMul = Math.max(target, this.rearMul - 9 * dt);
    else this.rearMul = Math.min(target, this.rearMul + (this.driftMode ? 4 : 1.4) * dt);

    if (!active || vAbs < 8) return 0;
    const accel = clamp(9 * (aT - a) - 4 * dir * this.betaRate, -8, 8);
    return -dir * accel * gf * clamp((vAbs - 8) / 8, 0, 1);
  }

  private updateDriftState(dt: number, u: number): void {
    const st = this.state;
    const absB = Math.abs(st.driftAngle);
    st.drifting = this.driftMode && u > 7;
    const angleT = clamp((absB - 0.09) / 0.5, 0, 1);
    const speedT = clamp((u - 8) / 17, 0, 1);
    const target = st.drifting || absB > 0.15 ? angleT * speedT : 0;
    st.driftIntensity += (target - st.driftIntensity) * (1 - Math.exp(-dt * 10));
    if (st.driftIntensity < 0.001) st.driftIntensity = 0;
    if (st.drifting && st.onGround) {
      st.nitro = Math.min(1, st.nitro + this.spec.driftChargeRate * st.driftIntensity * clamp(u / 30, 0, 1) * dt);
    }
  }

  // ── Стены ─────────────────────────────────────────────────────────────────

  private handleWalls(dt: number, pr: { lateral: number; sample: { halfWidth: number; right: Vector3; tangent: Vector3 } }): void {
    const st = this.state;
    if (this.wallCooldown > 0) this.wallCooldown -= dt;
    const sample = pr.sample;
    const rx = sample.right.x;
    const rz = sample.right.z;
    const rl = Math.hypot(rx, rz) || 1;
    const rhx = rx / rl;
    const rhz = rz / rl;
    const tx = -rhz;
    const tz = rhx;
    // угол между курсом и осью дороги → эффективная полуширина кузова поперёк
    const fx = Math.sin(st.heading);
    const fz = Math.cos(st.heading);
    const cosT = Math.abs(fx * tx + fz * tz);
    const sinT = Math.abs(fx * rhx + fz * rhz);
    const ext = HALF_W * cosT + HALF_L * sinT;
    const limit = sample.halfWidth - Math.max(1.0, 0.25 + 0.7 * ext);
    const lat = pr.lateral;
    const side = lat >= 0 ? 1 : -1;
    const pen = Math.abs(lat) - limit;
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
      const sinPhi = vh > 0.1 ? Math.min(1, impact / vh) : 1;
      if (impact > 1.5) {
        // удар: отскок по нормали, потеря продольной скорости 10–30%
        const newVn = impact * WALL_RESTITUTION;
        const loss = 0.1 + 0.2 * sinPhi;
        let tvx = vx - vn * nx;
        let tvz = vz - vn * nz;
        tvx *= 1 - loss;
        tvz *= 1 - loss;
        st.velocity.x = tvx + nx * newVn;
        st.velocity.z = tvz + nz * newVn;
        // лёгкий доворот курса вдоль стены и гашение рыскания
        const tl = Math.hypot(tvx, tvz);
        if (tl > 1) {
          const forward = st.velocity.x * fx + st.velocity.z * fz >= -0.1 * vh;
          const dirx = forward ? tvx / tl : -tvx / tl;
          const dirz = forward ? tvz / tl : -tvz / tl;
          const target = Math.atan2(dirx, dirz);
          st.heading += wrapPi(target - st.heading) * 0.3 * Math.min(1, impact / 6);
        }
        st.yawRate *= 0.6;
        strength = clamp(impact / 22, 0.08, 1);
        if (impact > 4 && this.driftMode) this.exitDrift();
      } else {
        // скольжение вдоль стены: лёгкое трение
        st.velocity.x -= vn * nx;
        st.velocity.z -= vn * nz;
        const f = Math.max(0, 1 - 0.9 * dt);
        st.velocity.x *= f;
        st.velocity.z *= f;
        strength = clamp(vh / 120, 0.03, 0.2);
      }
    } else if (vh > 6) {
      // прижаты к стене без встречной скорости: трение
      const f = Math.max(0, 1 - 0.9 * dt);
      st.velocity.x *= f;
      st.velocity.z *= f;
      strength = clamp(vh / 120, 0.03, 0.2);
    }
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

  private updateBody(dt: number, grounded: boolean, u: number): void {
    const st = this.state;
    // сглаженная нормаль поверхности (в воздухе стремится к вертикали)
    const target = grounded ? this.proj.normal : Y_AXIS;
    const k = 1 - Math.exp(-dt * (grounded ? 16 : 1.2));
    this.nSmooth.lerp(target, k).normalize();

    let tp: number;
    let tr: number;
    if (grounded) {
      const aLeft = st.yawRate * u;
      tr = clamp(aLeft * 0.0058, -0.07, 0.07);
      tp = clamp(this.axSmooth * 0.0044, -0.0436, 0.0436);
    } else {
      const vh = Math.hypot(st.velocity.x, st.velocity.z);
      tp = clamp(Math.atan2(st.velocity.y, Math.max(vh, 1)) * 0.7, -0.4, 0.4);
      tr = 0;
    }
    const wn = 14;
    const z = 0.55;
    this.pitchVel += (wn * wn * (tp - this.pitch) - 2 * z * wn * this.pitchVel) * dt;
    this.pitch += this.pitchVel * dt;
    this.rollVel += (wn * wn * (tr - this.roll) - 2 * z * wn * this.rollVel) * dt;
    this.roll += this.rollVel * dt;
    this.composeQuaternion();
  }

  private composeQuaternion(): void {
    const st = this.state;
    _qAlign.setFromUnitVectors(Y_AXIS, this.nSmooth);
    _qYaw.setFromAxisAngle(Y_AXIS, st.heading);
    _qPitch.setFromAxisAngle(X_AXIS, -this.pitch);
    _qRoll.setFromAxisAngle(Z_AXIS, this.roll);
    st.quaternion.copy(_qAlign).multiply(_qYaw).multiply(_qPitch).multiply(_qRoll);
  }

  private updateWheels(
    dt: number,
    u: number,
    throttle: number,
    brake: number,
    handbrake: boolean,
    slipF: number,
    slipR: number,
    grounded: boolean,
  ): void {
    const st = this.state;
    const wheels = st.wheels;
    const vAbs = Math.abs(u);
    const spinBase = u * WHEEL_RADIUS_INV * dt;
    const wheelspin = throttle > 0.7 && u > -1 && u < 15 ? 0.7 * throttle * (1 - Math.max(u, 0) / 15) : 0;
    const speedGate = MathUtils.smoothstep(vAbs, 2, 6);
    const frontSkid = clamp((Math.abs(slipF) - 0.09) / 0.14, 0, 1);
    let rearSkid = clamp((Math.abs(slipR) - 0.09) / 0.14, 0, 1);
    if (handbrake && vAbs > 4) rearSkid = Math.max(rearSkid, 0.85);
    if (wheelspin > 0.15) rearSkid = Math.max(rearSkid, wheelspin * 0.8);
    if (this.driftMode) rearSkid = Math.max(rearSkid, st.driftIntensity);
    const hardBrake = brake > 0.95 && vAbs > 15 ? 0.25 : 0;
    // в заносе колёса визуально «контрулят» вдоль вектора скорости оси
    const velAngle = clamp(slipF + this.delta, -0.7, 0.7);
    const steerL = MathUtils.lerp(this.delta, velAngle, clamp(st.driftIntensity * 1.5, 0, 1));
    const kSkid = 1 - Math.exp(-dt * 20);
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
      const raw = grounded && wh.onGround ? Math.min(1, (front ? frontSkid : rearSkid) + hardBrake) * speedGate : 0;
      wh.skid += (raw - wh.skid) * kSkid;
    }
  }

  private updateEngine(dt: number, u: number, throttle: number): void {
    const st = this.state;
    const vAbs = Math.abs(u);
    const max = this.spec.maxSpeed;
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
