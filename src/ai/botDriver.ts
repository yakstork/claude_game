/**
 * BotDriver — ИИ бота (GAME_DESIGN.md §3.4, §6.4).
 *
 * Идеальная линия по кривизне (внутренняя сторона в поворотах, внешняя на входе),
 * pure pursuit на точку впереди, скорость — по предельной скорости в повороте с
 * учётом дистанции торможения, обгоны, нитро на прямых, иногда занос ручником,
 * выход из застревания. Детерминирован (seed), без аллокаций в update().
 */
import { MathUtils } from 'three';
import type { BotProfile, CarSpec, TrackSample, VehicleControls, VehicleState } from '../core/types';
import { getHandling, steerAngleAt, steerForCurvature } from '../vehicle/handling';
import { createSample } from '../world/track';
import type { Track } from '../world/track';

const G = 9.81;
/** Отступ центра машины от стены, м */
const WALL_MARGIN = 2.8;
/** Горизонт просмотра скорости, м */
const SPEED_HORIZON = 130;
const SPEED_STEP = 8;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Детерминированный хэш 0..1 */
function hash01(a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class BotDriver {
  private readonly out: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
  /** Время, прошедшее с последнего движения вперёд (>4 м/с), с. Для респауна ведущим. */
  stuckTime = 0;
  /** Включает случайные заносы ручником (по умолчанию — по профилю) */
  driftEnabled: boolean;

  private readonly sample: TrackSample = createSample();
  private readonly sampleB: TrackSample = createSample();
  private readonly skillN: number;
  private readonly kSkill: number;
  private readonly phase: [number, number, number, number];
  private readonly freq: [number, number];
  private time = 0;
  private lap = 0;
  private prevS = NaN;
  private steerSmooth = 0;
  private avoidShift = 0;
  private overtakeSide = 0;
  private overtakeTimer = 0;
  private slowTime = 0;
  private reverseTimer = 0;
  private hasMoved = false;
  private nitroLatch = false;
  private hbTimer = 0;
  private driftIntent = false;
  private driftCorner = -1;
  private driftTime = 0;
  private cornerCooldown = 0;

  constructor(
    readonly track: Track,
    readonly profile: BotProfile,
    readonly seed: number,
  ) {
    const rnd = mulberry32(seed * 7919 + 13);
    this.phase = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
    this.freq = [0.22 + rnd() * 0.12, 0.47 + rnd() * 0.2];
    this.skillN = MathUtils.clamp((profile.skill - 0.66) / 0.26, 0, 1);
    // доля от предела сцепления: skill 0.66..0.92 → ≈ 0.78..0.93
    this.kSkill = 0.78 + 0.15 * this.skillN;
    this.driftEnabled = profile.skill > 0.72;
  }

  /** Целевое смещение от осевой (+ вправо) в точке sp: линия без учёта соперников */
  private lineOffset(sp: number, hw: number, withNoise: boolean): number {
    const track = this.track;
    const k0 = track.curvatureAt(sp);
    const k1 = track.curvatureAt(sp + 25);
    const k2 = track.curvatureAt(sp + 60);
    const kIn = Math.abs(k0) > Math.abs(k1) ? k0 : k1;
    const insideFrac = MathUtils.clamp(Math.abs(kIn) * 55, 0, 1);
    const inside = Math.sign(kIn) * insideFrac * 0.72;
    const kOut = Math.abs(k2) > Math.abs(kIn) * 1.3 ? k2 : 0;
    const outFrac = MathUtils.clamp(Math.abs(kOut) * 55, 0, 1) * (1 - insideFrac);
    const outside = -Math.sign(kOut) * outFrac * 0.6;
    const usable = hw - WALL_MARGIN;
    let off = (inside + outside) * usable;
    off += this.profile.lineBias * 0.3 * hw * (1 - insideFrac * 0.7);
    if (withNoise) {
      const amp = hw * (0.08 + 0.2 * (1 - this.skillN)) * (1 - insideFrac * 0.8);
      const t = this.time;
      off += amp * (0.6 * Math.sin(t * this.freq[0] + this.phase[0]) + 0.4 * Math.sin(t * this.freq[1] + this.phase[1]));
    }
    return MathUtils.clamp(off, -usable, usable);
  }

  update(dt: number, self: VehicleState, spec: CarSpec, others: readonly VehicleState[]): VehicleControls {
    const track = this.track;
    const out = this.out;
    const profile = this.profile;
    this.time += dt;
    const s = self.trackS;
    if (Number.isFinite(this.prevS) && this.prevS > track.length * 0.75 && s < track.length * 0.25) this.lap++;
    this.prevS = s;
    const speed = self.speed;
    const vFwd = Math.max(speed, 0);
    const hw = track.sampleAt(s, this.sample).halfWidth;
    const usable = hw - WALL_MARGIN;

    // ── застревание ────────────────────────────────────────────────────────
    if (speed > 5) this.hasMoved = true;
    if (speed > 4) this.stuckTime = 0;
    else if (this.hasMoved || this.time > 6) this.stuckTime += dt;
    if (Math.abs(speed) < 2 && (this.hasMoved || this.time > 6)) this.slowTime += dt;
    else this.slowTime = 0;
    if (this.reverseTimer <= 0 && this.slowTime > 1.5) {
      this.reverseTimer = 1.0;
      this.slowTime = 0;
    }

    // ── соперники: обгон, следование, боковое уклонение ───────────────────
    const window = 10 + 15 * profile.aggression;
    let ahead: VehicleState | null = null;
    let aheadDs = Infinity;
    let side = 0;
    let sidePush = 0;
    for (let i = 0; i < others.length; i++) {
      const o = others[i];
      if (o === self) continue;
      if (Math.abs(o.position.y - self.position.y) > 3) continue; // другой уровень
      const ds = track.deltaS(s, o.trackS);
      const dl = o.lateral - self.lateral;
      if (ds > 1 && ds < 25 && Math.abs(dl) < 3.4 && o.speed < speed + 3) {
        if (ds < aheadDs) {
          aheadDs = ds;
          ahead = o;
        }
      } else if (Math.abs(ds) < 5.5 && Math.abs(dl) < 3) {
        side = Math.sign(dl) || 1;
        sidePush = Math.max(sidePush, 1 - Math.abs(dl) / 3);
      }
    }
    let followCap = Infinity;
    let shiftTarget = 0;
    if (this.overtakeTimer > 0) this.overtakeTimer -= dt;
    if (ahead !== null && aheadDs < window && aheadDs > 3.5 - 2 * profile.aggression + 1) {
      if (this.overtakeTimer <= 0 || this.overtakeSide === 0) {
        const spaceRight = usable - ahead.lateral;
        const spaceLeft = ahead.lateral + usable;
        const want = spaceRight >= spaceLeft ? 1 : -1;
        if (want !== this.overtakeSide) {
          this.overtakeSide = want;
          this.overtakeTimer = 1.3;
        }
      }
      const goal = MathUtils.clamp(ahead.lateral + this.overtakeSide * 3.6, -usable, usable);
      shiftTarget = goal - self.lateral;
      if (Math.abs(goal - ahead.lateral) < 2.5) {
        followCap = ahead.speed + Math.max(0, aheadDs - 7) * 0.6;
      }
    } else if (ahead !== null && aheadDs <= 6) {
      followCap = ahead.speed * 0.98;
    }
    if (ahead === null || aheadDs >= window) {
      if (this.overtakeTimer <= 0) this.overtakeSide = 0;
    }
    if (sidePush > 0 && shiftTarget === 0) shiftTarget = -side * 1.6 * sidePush;
    this.avoidShift += (shiftTarget - this.avoidShift) * (1 - Math.exp(-dt * 2.5));

    // ── целевая точка и руль (pure pursuit) ───────────────────────────────
    const look = 10 + Math.abs(speed) * 0.6;
    const sp = s + look;
    const smpT = track.sampleAt(sp, this.sampleB);
    const hwT = smpT.halfWidth;
    const usableT = hwT - WALL_MARGIN;
    const offT = MathUtils.clamp(this.lineOffset(sp, hwT, true) + this.avoidShift, -usableT, usableT);
    const tx = smpT.position.x + smpT.right.x * offT;
    const tz = smpT.position.z + smpT.right.z * offT;
    // опорное направление — вектор скорости (в заносе курс не совпадает с движением)
    const vx = self.velocity.x;
    const vz = self.velocity.z;
    const vh = Math.hypot(vx, vz);
    const ref = vh > 6 && speed > 0 ? Math.atan2(vx, vz) : self.heading;
    const fx = Math.sin(ref);
    const fz = Math.cos(ref);
    const dx = tx - self.position.x;
    const dz = tz - self.position.z;
    const along = dx * fx + dz * fz;
    const leftD = dx * fz - dz * fx;
    const dist = Math.max(4, Math.hypot(dx, dz));
    const alpha = Math.atan2(leftD, along);
    // pure pursuit: кривизна дуги к целевой точке → угол колёс той же моделью, что в физике
    const cfg = getHandling(spec.id);
    const deltaLeft = steerForCurvature(cfg, Math.abs(speed), (2 * Math.sin(alpha)) / dist);
    const authority = steerAngleAt(cfg, Math.abs(speed));
    let steerCmd = MathUtils.clamp(-deltaLeft / authority, -1, 1);
    // цель позади (развернуло): полный руль в сторону цели, медленно
    const targetBehind = along < 0;
    if (targetBehind) steerCmd = leftD >= 0 ? -1 : 1;

    // ── скорость: предел по кривизне вперёд ───────────────────────────────
    // в заносе боковое ускорение задаёт driftGrip (см. HandlingConfig)
    const driftCap = cfg.driftGrip * G;
    const gripA = self.drifting ? driftCap * 0.9 : cfg.grip * G * this.kSkill * 1.08;
    const aBrake = cfg.brakeDecel * (0.5 + 0.3 * this.skillN);
    let vTarget = cfg.maxSpeed * 1.02;
    let maxK = 0;
    let peakK = 0;
    let nearK = 0;
    let midMin = Infinity;
    let midMax = 0;
    for (let d = 0; d <= SPEED_HORIZON; d += SPEED_STEP) {
      const sd = s + d;
      const k = track.curvatureAt(sd);
      const ak = Math.abs(k);
      if (ak > maxK) maxK = ak;
      if (d <= 16 && ak > nearK) nearK = ak;
      if (d >= 8 && d <= 48) {
        if (ak < midMin) midMin = ak;
        if (ak > midMax) midMax = ak;
      }
      if (d <= 40 && ak > peakK) {
        peakK = ak;
      }
      const o = this.lineOffset(sd, hw, false);
      const kEff = ak / Math.max(0.5, 1 - k * o);
      const vLim = Math.sqrt(gripA / Math.max(kEff, 1e-4));
      const vAllowed = Math.sqrt(vLim * vLim + 2 * aBrake * d);
      if (vAllowed < vTarget) vTarget = vAllowed;
    }
    // дальше — прямая ли на 150 м (для нитро)
    let straight = maxK < 0.004;
    for (let d = SPEED_HORIZON; d <= 160 && straight; d += 15) {
      if (Math.abs(track.curvatureAt(s + d)) > 0.004) straight = false;
    }
    if (vTarget > followCap) vTarget = Math.max(followCap, 8);
    if (targetBehind) vTarget = Math.min(vTarget, 12);
    // большая ошибка по линии — сбросить скорость
    const lineErr = Math.abs(self.lateral - offT);
    if (lineErr > 5) vTarget = Math.min(vTarget, Math.max(20, vTarget - (lineErr - 5) * 2));

    let throttle: number;
    let brake = 0;
    const excess = speed - vTarget;
    if (excess > 0.6) {
      brake = MathUtils.clamp(excess / 4, 0, 1);
      throttle = 0;
    } else {
      throttle = MathUtils.clamp(0.45 + (vTarget - speed) * 0.5, 0, 1);
    }

    // ── нитро на прямых ───────────────────────────────────────────────────
    if (!this.nitroLatch) {
      if (self.nitro > 0.3 && straight && vFwd > 25 && Math.abs(this.steerSmooth) < 0.2 && throttle > 0.9) this.nitroLatch = true;
    } else if (self.nitro < 0.03 || maxK > 0.006 || throttle < 0.5) {
      this.nitroLatch = false;
    }

    // ── занос ручником в крутых поворотах ─────────────────────────────────
    let handbrake = false;
    if (this.cornerCooldown > 0) this.cornerCooldown -= dt;
    if (this.hbTimer > 0) {
      this.hbTimer -= dt;
      handbrake = true;
      throttle = Math.max(throttle, 0.6);
      brake = 0;
    } else if (
      this.driftEnabled &&
      !self.drifting &&
      this.cornerCooldown <= 0 &&
      midMin > 0.016 &&
      midMax < 0.032 &&
      Math.abs(vFwd - Math.sqrt(driftCap / (0.5 * (midMin + midMax)))) < 0.12 * vFwd &&
      vFwd > 20 &&
      vFwd < 34 &&
      Math.abs(this.steerSmooth) > 0.12
    ) {
      const corner = Math.floor(track.wrapS(s + 30) / 60);
      if (corner !== this.driftCorner) {
        this.driftCorner = corner;
        const chance = 0.25 + 0.5 * this.skillN;
        if (hash01(this.seed, corner, this.lap) < chance) {
          this.hbTimer = 0.35;
          this.driftIntent = true;
          this.cornerCooldown = 3;
          this.driftTime = 0;
        }
      }
    }
    if (self.drifting) {
      this.driftTime += dt;
      const cornerOver = nearK < 0.011;
      if (!this.driftIntent) {
        // нечаянный занос (толчок, стена): контр-руль и сброс газа
        steerCmd = -Math.sign(self.driftAngle || 1) * 0.7;
        throttle = 0.2;
        brake = 0;
      } else if (cornerOver || this.driftTime > 4.5 || Math.abs(self.driftAngle) > 0.85) {
        // сброс газа и нейтральный руль — физика плавно выводит из заноса
        steerCmd = -Math.sign(self.driftAngle || 1) * 0.1;
        throttle = 0.1;
        brake = 0;
      } else {
        // в заносе угол задают руль и газ: держим руль в занос (иначе физика выйдет из заноса)
        const into = Math.sign(self.driftAngle || 1);
        steerCmd = into * Math.max(steerCmd * into, 0.45);
        if (brake === 0) throttle = Math.max(throttle, 0.45);
      }
    } else {
      this.driftTime = 0;
      if (this.hbTimer <= 0) this.driftIntent = false;
    }

    // ── выход из застревания ──────────────────────────────────────────────
    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      throttle = 0;
      brake = 1;
      steerCmd = -Math.sign(steerCmd || 1) * 1;
      handbrake = false;
      this.nitroLatch = false;
    }

    // сглаживание руля
    const k = 1 - Math.exp(-dt / (self.drifting ? 0.03 : 0.07));
    this.steerSmooth += (steerCmd - this.steerSmooth) * k;

    out.throttle = throttle;
    out.brake = brake;
    out.steer = MathUtils.clamp(this.steerSmooth, -1, 1);
    out.handbrake = handbrake;
    out.nitro = this.nitroLatch && this.reverseTimer <= 0;
    return out;
  }
}
