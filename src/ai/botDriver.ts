/**
 * BotDriver — ИИ бота (GAME_DESIGN.md §3.4, §6.4).
 *
 * Основа: идеальная линия по кривизне (внутренняя сторона в поворотах, внешняя на входе), pure pursuit на точку
 * впереди, скорость — по предельной скорости в повороте с учётом дистанции торможения. Поверх неё:
 *
 *  - Характер (BotProfile + seed): смелость в поворотах и в заносе, склонность к заносу, нитро-политика, частота
 *    ошибок (поздний тормоз, широкая траектория), реакция на старте. Все случайные решения — от seed (hash по
 *    повороту и кругу), поэтому гонка воспроизводима.
 *  - Темп (`pace`, доля возможностей машины) «плавает» по ходу гонки: медленный шум «формы» ±4–6%. Темп масштабирует
 *    целевые скорости, потолок скорости на прямых и скорость в поворотах; физику бот не обманывает.
 *  - Выравнивание по машине: пробный круг нейтрального бота на этой трассе (кэшируется) показывает, насколько
 *    машина быстрее среднего заводского круга; быстрые машины едут чуть осторожнее, медленные — чуть смелее.
 *    Иначе самая быстрая машина (Photon) всегда уезжала бы от остальных.
 *  - Дрифт ради буста: в подходящих поворотах бот заводит занос ручником, ведёт его по дуге и чисто выходит —
 *    физика выдаёт буст. Скорость не режется из-за превышения maxSpeed: потолок учитывает нитро и буст.
 *    В толчее занос не начинают, не вошли за 0.5 с — отказываются от него в этом повороте.
 *  - Нитро — не постоянно: на длинных прямых по «настроению», при догоне/обгоне, при полной шкале и на последнем круге.
 *  - Обгон (смена линии при сближении сзади, нырок внутрь), защита позиции (перекрытие линии в сторону атакующего
 *    перед торможением), боковой зазор с соседями, следование без столкновений.
 *  - Rubber banding по положению в пачке (сам бот не знает, кто игрок): оторвавшийся лидер «ждёт» второго
 *    (до −12% темпа), отставшие подтягиваются (до +5%, но не выше 1.04 от предела машины).
 *
 * Детерминирован (seed), без аллокаций в update(). Тяжёлые знания (повороты трассы, боковое ускорение заноса,
 * пробные круги) считаются в конструкторе и кэшируются (см. knowledge.ts).
 */
import { MathUtils } from 'three';
import type { BotProfile, CarSpec, TrackSample, VehicleControls, VehicleState } from '../core/types';
import { getHandling, steerAngleAt, steerForCurvature } from '../vehicle/handling';
import type { HandlingConfig } from '../vehicle/handling';
import { VehiclePhysics } from '../vehicle/physics';
import { specById } from '../vehicle/specs';
import { createSample } from '../world/track';
import type { Track } from '../world/track';
import { cornerIndexAt, driftKnowledge, driftLatAt, trackKnowledge } from './knowledge';
import type { DriftKnowledge, TrackKnowledge } from './knowledge';

const G = 9.81;
/** Отступ центра машины от стены, м */
const WALL_MARGIN = 2.8;
/** Горизонт просмотра скорости, м (на 75–85 м/с до шпильки надо тормозить ~150–170 м) */
const SPEED_HORIZON = 200;
const SPEED_STEP = 8;
/** Горизонт, на котором бот решает, как пройдёт поворот (занос / ошибка), м */
const PLAN_HORIZON = 230;
/** Прямая для нитро: до следующего поворота (|k| > RUN_K) не меньше, м */
const RUN_K = 0.005;
const RUN_MAX = 330;
/** Полная шкала нитро не копится зря: на длинной прямой жмём независимо от «настроения» */
const FULL_TANK = 0.85;
/** «Толчея»: машина в пределах 5 м по ширине и ближе этого впереди/сзади по s — занос не начинаем, м */
const CROWD_AHEAD = 8;
const CROWD_BEHIND = 4;
/** Желаемый боковой зазор между соседями, м (центры) */
const SIDE_GAP = 3.8;
/**
 * Темп бота — масштаб всех целевых скоростей (доля возможностей машины): pace = база × выравнивание по машине ×
 * «форма» × rubber banding, в пределах [0.8, 1.04]. На прямых потолок скорости падает с темпом быстрее, чем
 * скорость в поворотах (машина редко упирается в максималку): vCap = vFree·(1 − CAP_SLOPE·(1 − pace)).
 */
const CAP_SLOPE = 2.4;
const PACE_MIN = 0.8;
const PACE_MAX = 1.04;
/** Rubber banding. Лидер «ждёт» второго: осторожность растёт от LEAD_FREE до LEAD_FULL м отрыва (до −RUBBER_SLOW) */
const LEAD_FREE = 8;
const LEAD_FULL = 70;
const RUBBER_SLOW = 0.12;
/** Остальные: +RUBBER_GAIN темпа на 200 м среднего отставания от соперников (не выше RUBBER_FAST, не ниже −RUBBER_SLACK) */
const RUBBER_GAIN = 0.1;
const RUBBER_FAST = 0.05;
const RUBBER_SLACK = 0.02;
/** Отставание/отрыв одной машины считаем не более чем на столько, м (далёкий игрок не тянет всю пачку) */
const PACK_CLAMP = 250;
/** Занос целится внутрь поворота на эту долю полуширины: на выходе машину выносит наружу */
const DRIFT_INNER = 0.55;

/** Слипстрим: садимся в мешок на прямой не короче DRAFT_MIN_RUN м, на дистанции до DRAFT_RANGE, не дольше DRAFT_MAX_TIME */
const DRAFT_MIN_RUN = 110;
const DRAFT_MIN_SPEED = 28;
const DRAFT_RANGE = 24;
const DRAFT_FULL = 0.95;
const DRAFT_MAX_TIME = 5;
const DRAFT_COOLDOWN = 5;
/** Если за это время мешок не начал заполняться (не попали в конус) — отказываемся, с */
const DRAFT_GRACE = 0.5;

const { clamp } = MathUtils;

/** Детерминированный хэш 0..1 */
function hash01(a: number, b: number, c: number, d = 0): number {
  let h =
    (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(c | 0, 0xc2b2ae35) ^ Math.imul(d | 0, 0x27d4eb2f)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

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

/** План прохождения поворота (решается за PLAN_HORIZON м до него) */
const PLAN_NONE = 0;
const PLAN_GRIP = 1;
const PLAN_DRIFT = 2;
/** Ошибка в повороте */
const MIS_NONE = 0;
const MIS_LATE = 1;
const MIS_WIDE = 2;

export class BotDriver {
  /** Текущий темп (доля возможностей машины; для отладки и тестов) */
  pace = 1;
  private readonly out: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
  /** Время, прошедшее с последнего движения вперёд (>4 м/с), с. Для респауна ведущим. */
  stuckTime = 0;
  /** Слипстрим-логика: сколько секунд подряд сидим в мешке / пауза до следующей попытки */
  /** Выключатель слипстрим-логики (для тестов) */
  draftEnabled = true;
  private draftTime = 0;
  private draftCool = 0;
  /** Включает заносы ради буста (по умолчанию — да; бот сам решает, в каких поворотах) */
  driftEnabled = true;
  /** Число кругов гонки (для нитро «на финиш» на последнем круге) */
  totalLaps = 3;

  private readonly sample: TrackSample = createSample();
  private readonly sampleB: TrackSample = createSample();
  private readonly know: TrackKnowledge;
  private drift: DriftKnowledge | null = null;
  private specId = '';

  // ── характер (из профиля и seed) ───────────────────────────────────────
  private readonly skillN: number;
  private readonly aggr: number;
  /** Доля предела сцепления в поворотах на GRIP (база, до «формы» и rubber banding) */
  private readonly gripBase: number;
  /** Доля расчётной тормозной способности */
  private readonly brakeFrac: number;
  /** Доверие к измеренному боковому ускорению заноса (>1 — смелее) */
  private readonly driftUse: number;
  /** Шанс занести в подходящем повороте */
  private driftChance = 0.5;
  /** Вероятность ошибки на поворот */
  private readonly mistakeP: number;
  /** Резерв нитро, ниже которого бот копит его на обгон / финиш, и доля прямых, где он жмёт нитро */
  private readonly nitroReserve: number;
  private readonly nitroRate: number;
  /** Склонность прикрывать позицию (0..1) */
  private readonly defendP: number;
  /** Амплитуда колебаний темпа («форма»), доля */
  private readonly formAmp: number;
  private readonly launchDelay: number;
  /** Выравнивание по машине (≤ 1): быстрее среднего заводского круга — едем осторожнее */
  private carPace = 1;
  private readonly phase: [number, number, number, number, number, number];
  private readonly freq: [number, number, number, number];

  // ── состояние ──────────────────────────────────────────────────────────
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
  private defendTimer = 0;
  /** Бот сейчас в зоне запланированного заноса */
  private inZone = false;
  private abortZone = -1;
  private entryTime = 0;
  /** После зоны заноса ждём выравнивания: нейтральный руль, сброс газа */
  private exitTimer = 0;
  private readonly plan: Uint8Array;
  private readonly mis: Uint8Array;
  private readonly defend: Uint8Array;
  private readonly nitroRoll: Uint8Array;
  private rubber = 0;
  /** Базовый темп: доля от возможностей машины */
  private readonly paceBase: number;

  constructor(
    readonly track: Track,
    readonly profile: BotProfile,
    readonly seed: number,
    /** Служебный режим «пробный круг»: нейтральный темп, без ошибок/формы/rubber banding и без выравнивания по машине */
    private readonly calibrating = false,
  ) {
    const rnd = mulberry32(seed * 7919 + 13);
    this.phase = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
    // периоды «формы»: ~35–90 с и ~13–28 с
    this.freq = [0.22 + rnd() * 0.12, 0.47 + rnd() * 0.2, (Math.PI * 2) / (35 + rnd() * 55), (Math.PI * 2) / (13 + rnd() * 15)];
    this.skillN = clamp((profile.skill - 0.66) / 0.26, 0, 1);
    this.aggr = clamp(profile.aggression, 0, 1);
    // сцепление: skill 0.66..0.92 → 0.88..0.95 (разброс скилла сжат: гонку решают занос, тактика и ошибки), ±0.015 — характер
    this.gripBase = 0.92 + 0.015 * this.skillN + (rnd() - 0.5) * 0.03 + 0.02 * (this.aggr - 0.5);
    this.brakeFrac = 0.52 + 0.2 * this.skillN + (rnd() - 0.5) * 0.04;
    this.driftUse = 1.14 + 0.07 * this.skillN + 0.1 * (this.aggr - 0.5) + (rnd() - 0.5) * 0.06;
    this.mistakeP = calibrating ? 0 : (0.04 + 0.05 * (1 - this.skillN)) * (0.7 + 0.6 * this.aggr);
    this.nitroReserve = 0.1 + 0.3 * rnd();
    this.nitroRate = 0.45 + 0.4 * this.aggr + 0.15 * rnd();
    this.defendP = 0.1 + 0.6 * this.aggr * (0.6 + 0.4 * rnd());
    this.paceBase = calibrating ? 1 : 0.99 + 0.004 * this.skillN + (rnd() - 0.5) * 0.01;
    this.formAmp = calibrating ? 0 : 0.04 + 0.02 * rnd();
    // реакция на старте: 0.05–0.45 с (агрессивные чуть быстрее)
    this.launchDelay = calibrating ? 0 : 0.05 + 0.4 * rnd() - 0.1 * (this.aggr - 0.5);
    this.know = trackKnowledge(track);
    const n = this.know.corners.length;
    this.plan = new Uint8Array(n);
    this.mis = new Uint8Array(n);
    this.defend = new Uint8Array(n);
    this.nitroRoll = new Uint8Array(n);
    // знания о машине и трассе (в т.ч. пробные круги) — сразу, а не на первом кадре гонки: так возможная пауза приходится на создание ботов
    if (!calibrating) this.init(specById(profile.carId));
  }

  private init(spec: CarSpec): void {
    this.specId = spec.id;
    this.drift = driftKnowledge(spec);
    if (!this.calibrating) this.carPace = carPaceFactor(this.track, spec);
    // склонность к заносу: машина (Grizzly любит, Photon реже), скилл, характер
    const rnd = hash01(this.seed, 99, 1);
    this.driftChance = clamp(0.3 + 0.6 * spec.stats.drift + 0.25 * (this.skillN - 0.5) + 0.2 * (this.aggr - 0.5) + 0.15 * (rnd - 0.5), 0.2, 0.95);
  }

  /** «Форма» бота −1..1: медленно плавающий темп */
  private form(): number {
    const t = this.time;
    return 0.55 * Math.sin(t * this.freq[2] + this.phase[4]) + 0.3 * Math.sin(t * this.freq[3] + this.phase[5]) + 0.15 * Math.sin(t * 0.07 + this.phase[2]);
  }

  /** Целевое смещение от осевой (+ вправо) в точке sp: линия без учёта соперников */
  private lineOffset(sp: number, hw: number, withNoise: boolean): number {
    const track = this.track;
    const k0 = track.curvatureAt(sp);
    const k1 = track.curvatureAt(sp + 25);
    const k2 = track.curvatureAt(sp + 60);
    const kIn = Math.abs(k0) > Math.abs(k1) ? k0 : k1;
    const insideFrac = clamp(Math.abs(kIn) * 55, 0, 1);
    const inside = Math.sign(kIn) * insideFrac * 0.72;
    const kOut = Math.abs(k2) > Math.abs(kIn) * 1.3 ? k2 : 0;
    const outFrac = clamp(Math.abs(kOut) * 55, 0, 1) * (1 - insideFrac);
    const outside = -Math.sign(kOut) * outFrac * 0.6;
    const usable = hw - WALL_MARGIN;
    let off = (inside + outside) * usable;
    off += this.profile.lineBias * 0.3 * hw * (1 - insideFrac * 0.7);
    if (withNoise) {
      const amp = hw * (0.08 + 0.2 * (1 - this.skillN)) * (1 - insideFrac * 0.8);
      const t = this.time;
      off += amp * (0.6 * Math.sin(t * this.freq[0] + this.phase[0]) + 0.4 * Math.sin(t * this.freq[1] + this.phase[1]));
      // ошибка «широкая траектория»: на выходе из поворота и в нём уходим к внешней стороне
      const ci = cornerIndexAt(track, this.know, sp);
      if (ci >= 0 && this.mis[ci] === MIS_WIDE) off -= this.know.corners[ci].dir * 0.8 * usable;
    }
    return clamp(off, -usable, usable);
  }

  /** Номер запланированного заноса, чья зона содержит s (иначе −1) */
  private zoneAt(sx: number): number {
    if (!this.driftEnabled) return -1;
    const track = this.track;
    const w = track.wrapS(sx);
    const cs = this.know.corners;
    for (let i = 0; i < cs.length; i++) {
      if (this.plan[i] === PLAN_DRIFT && w >= cs[i].zs && w <= cs[i].ze) return i;
    }
    return -1;
  }

  /** Решения по приближающимся поворотам: занос, ошибка, защита, нитро; сброс прошедших */
  private planCorners(s: number, cfg: HandlingConfig): void {
    const track = this.track;
    const cs = this.know.corners;
    const L = track.length;
    const drift = this.drift as DriftKnowledge;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      const ahead = track.wrapS(c.s0 - s);
      const past = track.wrapS(s - c.s1);
      if (this.plan[i] !== PLAN_NONE) {
        // поворот пройден: освобождаем решение (на следующем круге решим заново)
        if (past > 15 && past < L * 0.5) {
          this.plan[i] = PLAN_NONE;
          this.mis[i] = MIS_NONE;
          this.defend[i] = 0;
          this.nitroRoll[i] = 0;
        }
        continue;
      }
      if (ahead > PLAN_HORIZON) continue;
      const lap = this.lap;
      // занос: подходящий поворот и хватает скорости на занос
      let wantDrift = false;
      if (this.driftEnabled && c.driftable && hash01(this.seed, i, lap) < this.driftChance) {
        const kEff = c.peak;
        let v = 30;
        for (let it = 0; it < 4; it++) v = Math.sqrt((driftLatAt(drift, v) * this.driftUse) / Math.max(kEff, 1e-4));
        wantDrift = v >= cfg.driftMinSpeed + 6;
      }
      this.plan[i] = wantDrift ? PLAN_DRIFT : PLAN_GRIP;
      // ошибка: поздний тормоз / широкая траектория
      const r = hash01(this.seed + 31, i, lap);
      if (r < this.mistakeP) this.mis[i] = hash01(this.seed + 57, i, lap) < 0.6 ? MIS_LATE : MIS_WIDE;
      else this.mis[i] = MIS_NONE;
      this.defend[i] = hash01(this.seed + 71, i, lap) < this.defendP ? 1 : 0;
      this.nitroRoll[i] = hash01(this.seed + 91, i, lap) < this.nitroRate ? 1 : 0;
    }
  }

  update(dt: number, self: VehicleState, spec: CarSpec, others: readonly VehicleState[]): VehicleControls {
    const track = this.track;
    const out = this.out;
    if (spec.id !== this.specId) this.init(spec);
    const cfg = getHandling(spec.id);
    this.time += dt;
    const s = self.trackS;
    if (Number.isFinite(this.prevS) && this.prevS > track.length * 0.75 && s < track.length * 0.25) this.lap++;
    this.prevS = s;
    const speed = self.speed;
    const vFwd = Math.max(speed, 0);
    const vx = self.velocity.x;
    const vz = self.velocity.z;
    const V = Math.hypot(vx, vz);
    const hw = track.sampleAt(s, this.sample).halfWidth;
    const usable = hw - WALL_MARGIN;
    this.planCorners(s, cfg);

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

    // ── соперники: впереди, сзади, рядом, положение в пачке ───────────────
    let ahead: VehicleState | null = null;
    let aheadDs = Infinity;
    let behind: VehicleState | null = null;
    let behindDs = Infinity;
    let side = 0;
    let sidePush = 0;
    let crowd = false;
    let maxAhead = 0;
    let minBehind = Infinity;
    let sumDs = 0;
    let nOthers = 0;
    for (let i = 0; i < others.length; i++) {
      const o = others[i];
      if (o === self) continue;
      const ds = track.deltaS(s, o.trackS);
      sumDs += clamp(ds, -PACK_CLAMP, PACK_CLAMP);
      nOthers++;
      if (Math.abs(o.position.y - self.position.y) > 3) continue; // другой уровень (эстакада)
      const dl = o.lateral - self.lateral;
      if (ds > 5 && ds > maxAhead) maxAhead = ds;
      if (ds < -5 && -ds < minBehind) minBehind = -ds;
      if (ds > 1 && ds < 55 && Math.abs(dl) < 3.6 && o.speed < speed + 6) {
        if (ds < aheadDs) {
          aheadDs = ds;
          ahead = o;
        }
      } else if (ds < -2 && ds > -30 && Math.abs(dl) < 5 && o.speed > speed - 3) {
        if (-ds < behindDs) {
          behindDs = -ds;
          behind = o;
        }
      }
      if (ds > -CROWD_BEHIND && ds < CROWD_AHEAD && Math.abs(dl) < 4.2) crowd = true;
      if (Math.abs(ds) < 6.5 && Math.abs(dl) < SIDE_GAP) {
        const push = SIDE_GAP - Math.abs(dl);
        if (push > sidePush) {
          sidePush = push;
          side = Math.sign(dl) || 1;
        }
      }
    }
    // rubber banding по пачке: лидер «ждёт» второго (чем больше отрыв, тем осторожнее), остальные подтягиваются к середине пачки
    const meanDs = nOthers > 0 ? sumDs / nOthers : 0;
    let rubber: number;
    if (maxAhead === 0 && minBehind < track.length * 0.45) {
      rubber = -RUBBER_SLOW * MathUtils.smoothstep(minBehind, LEAD_FREE, LEAD_FULL);
    } else {
      rubber = clamp((RUBBER_GAIN * meanDs) / 200, -RUBBER_SLACK, RUBBER_FAST);
    }
    if (this.calibrating) rubber = 0;
    this.rubber += (rubber - this.rubber) * (1 - Math.exp(-dt * 0.8));

    const aggrNow = this.aggr;
    // ближайший поворот и прямая до него
    let run = RUN_MAX;
    let runCorner = -1;
    for (let d = 0; d <= RUN_MAX; d += 15) {
      if (Math.abs(track.curvatureAt(s + d)) > RUN_K) {
        run = d;
        break;
      }
    }
    if (run < RUN_MAX) runCorner = cornerIndexAt(track, this.know, s + run + 12);
    else runCorner = -1;

    let followCap = Infinity;
    let shiftTarget = 0;
    if (this.overtakeTimer > 0) this.overtakeTimer -= dt;
    if (this.defendTimer > 0) this.defendTimer -= dt;
    const window = 12 + 20 * aggrNow + Math.max(0, vFwd - (ahead ? ahead.speed : vFwd)) * 0.7;
    // слипстрим: на прямой садимся в мешок к машине впереди, а когда он полный — выходим на обгон
    if (this.draftCool > 0) this.draftCool -= dt;
    let drafting = false;
    if (
      this.draftEnabled && ahead !== null && !this.calibrating && this.draftCool <= 0 &&
      (self.slipstream > 0.05 || this.draftTime > 0) && run >= DRAFT_MIN_RUN && speed > DRAFT_MIN_SPEED && aheadDs > 6 && aheadDs < DRAFT_RANGE && self.slipstream < DRAFT_FULL
    ) {
      this.draftTime += dt;
      if (this.draftTime > DRAFT_MAX_TIME || (this.draftTime > DRAFT_GRACE && self.slipstream < 0.1)) {
        this.draftTime = 0;
        this.draftCool = DRAFT_COOLDOWN;
      } else drafting = true;
    } else if (this.draftTime > 0 && !(ahead !== null && aheadDs < DRAFT_RANGE && self.slipstream < DRAFT_FULL)) {
      // мешок полный (или лидер потерян): обгон, повторно садиться в мешок не сразу
      if (ahead !== null && self.slipstream >= DRAFT_FULL) this.draftCool = DRAFT_COOLDOWN;
      this.draftTime = 0;
    }
    const overtaking = !drafting && ahead !== null && aheadDs < window && aheadDs > 3.5 - 2 * aggrNow + 1;
    if (drafting && ahead !== null) {
      // идём ровно в хвост лидера; близко — не наезжаем
      shiftTarget = clamp(ahead.lateral - self.lateral, -3, 3);
      if (aheadDs < 9) followCap = ahead.speed + Math.max(0, aheadDs - 7) * 0.6;
    }
    if (overtaking && ahead !== null) {
      if (this.overtakeTimer <= 0 || this.overtakeSide === 0) {
        const spaceRight = usable - ahead.lateral;
        const spaceLeft = ahead.lateral + usable;
        // сторона с запасом ширины; в приближении к повороту — внутренняя (там можно нырнуть)
        let want = spaceRight >= spaceLeft ? 1 : -1;
        const kAhead = track.curvatureAt(s + Math.min(aheadDs + 30, 80));
        if (Math.abs(kAhead) > 0.008 && aggrNow > 0.4) {
          const inner = Math.sign(kAhead);
          const space = inner > 0 ? spaceRight : spaceLeft;
          if (space > 4.5) want = inner;
        }
        if (want !== this.overtakeSide) {
          this.overtakeSide = want;
          this.overtakeTimer = 1.6;
        }
      }
      const goal = clamp(ahead.lateral + this.overtakeSide * 3.6, -usable, usable);
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
    // защита позиции: сзади близко и впереди торможение — слегка перекрываем линию в его сторону
    if (!overtaking && behind !== null && behindDs < 24 && run < 130 && runCorner >= 0 && this.defend[runCorner] === 1) {
      this.defendTimer = 1.2;
    }
    if (this.defendTimer > 0 && behind !== null && !overtaking && shiftTarget === 0) {
      shiftTarget = clamp(behind.lateral - self.lateral, -2.4, 2.4) * 0.85;
    }
    if (sidePush > 0 && shiftTarget === 0) shiftTarget = -side * Math.min(3, 0.9 * sidePush);
    this.avoidShift += (shiftTarget - this.avoidShift) * (1 - Math.exp(-dt * 2.5));

    // ── целевая точка и руль (pure pursuit) ───────────────────────────────
    const look = 10 + Math.abs(speed) * 0.6;
    const sp = s + look;
    const smpT = track.sampleAt(sp, this.sampleB);
    const hwT = smpT.halfWidth;
    const usableT = hwT - WALL_MARGIN;
    const offT = clamp(this.lineOffset(sp, hwT, true) + this.avoidShift, -usableT, usableT);
    const tx = smpT.position.x + smpT.right.x * offT;
    const tz = smpT.position.z + smpT.right.z * offT;
    // опорное направление — вектор скорости (в заносе курс не совпадает с движением)
    const ref = V > 6 && speed > 0 ? Math.atan2(vx, vz) : self.heading;
    const fx = Math.sin(ref);
    const fz = Math.cos(ref);
    const dx = tx - self.position.x;
    const dz = tz - self.position.z;
    const along = dx * fx + dz * fz;
    const leftD = dx * fz - dz * fx;
    const dist = Math.max(4, Math.hypot(dx, dz));
    const alpha = Math.atan2(leftD, along);
    // pure pursuit: кривизна дуги к целевой точке → угол колёс той же моделью, что в физике
    const deltaLeft = steerForCurvature(cfg, Math.abs(speed), (2 * Math.sin(alpha)) / dist);
    const authority = steerAngleAt(cfg, Math.abs(speed));
    let steerCmd = clamp(-deltaLeft / authority, -1, 1);
    // цель позади (развернуло): полный руль в сторону цели, медленно
    const targetBehind = along < 0;
    if (targetBehind) steerCmd = leftD >= 0 ? -1 : 1;

    // ── занос: зона запланированного поворота ─────────────────────────────
    const zone = this.zoneAt(s);
    const wasInZone = this.inZone;
    if (zone < 0) this.abortZone = -1;
    // входить в занос в толчее нельзя (машину бросает на соседей и на стену); не вошли за 0.5 с — отказываемся от заноса в этом повороте
    const canEnter = !crowd && this.abortZone !== zone;
    this.inZone =
      zone >= 0 &&
      (self.drifting ? V > cfg.driftMinSpeed * 0.7 : canEnter && V > cfg.driftMinSpeed + 4) &&
      this.reverseTimer <= 0 &&
      !targetBehind;
    if (this.inZone && !self.drifting) {
      this.entryTime += dt;
      if (this.entryTime > 0.5) {
        this.abortZone = zone;
        this.inZone = false;
      }
    } else {
      this.entryTime = 0;
    }
    if (wasInZone && !this.inZone) this.exitTimer = 1.6;
    else if (this.exitTimer > 0) this.exitTimer -= dt;
    const dir = zone >= 0 ? this.know.corners[zone].dir : 0;

    // ── скорость: предел по кривизне вперёд ───────────────────────────────
    const form = this.form();
    // темп: характер × выравнивание по машине × «форма» × положение в пачке
    const pace = (this.pace = clamp(this.paceBase * this.carPace * (1 + this.formAmp * form) * (1 + this.rubber), PACE_MIN, PACE_MAX));
    let gripFrac = this.gripBase;
    if (overtaking) gripFrac += 0.025 * aggrNow;
    const aGrip = cfg.grip * G * gripFrac * 1.08;
    const aBrake = cfg.brakeDecel * this.brakeFrac;
    const drift = this.drift as DriftKnowledge;
    let vTarget = Infinity;
    for (let d = 0; d <= SPEED_HORIZON; d += SPEED_STEP) {
      const sd = s + d;
      const k = track.curvatureAt(sd);
      const ak = Math.abs(k);
      const o = this.lineOffset(sd, hw, false);
      const kEff = ak / Math.max(0.5, 1 - k * o);
      let vLim = Math.sqrt(aGrip / Math.max(kEff, 1e-4));
      const zi = this.zoneAt(sd);
      if (zi >= 0) {
        // боковое ускорение заноса зависит от скорости: ищем скорость, при которой оно держит поворот
        vLim = 30;
        for (let it = 0; it < 4; it++) vLim = Math.sqrt((driftLatAt(drift, vLim) * this.driftUse) / Math.max(kEff, 1e-4));
      }
      const ci = cornerIndexAt(track, this.know, sd);
      if (ci >= 0 && this.mis[ci] === MIS_LATE) vLim *= 1.14;
      vLim *= zi >= 0 ? Math.min(pace, 1) : pace;
      const vAllowed = Math.sqrt(vLim * vLim + 2 * aBrake * d);
      if (vAllowed < vTarget) vTarget = vAllowed;
    }
    // потолок темпа на прямых: доля от максималки с учётом нитро и буста (не тормозим, а отпускаем газ)
    const vFree = cfg.maxSpeed * ((self.nitroActive ? cfg.nitroSpeedMul : 1) + cfg.boostSpeedPct * self.boostPower);
    const vCap = vFree * (1 - CAP_SLOPE * (1 - pace));
    if (vTarget > followCap) vTarget = Math.max(followCap, 8);
    if (targetBehind) vTarget = Math.min(vTarget, 12);
    // большая ошибка по линии — сбросить скорость
    const lineErr = Math.abs(self.lateral - offT);
    if (lineErr > 5) vTarget = Math.min(vTarget, Math.max(20, vTarget - (lineErr - 5) * 2));

    // в заносе продольная скорость сильно меньше модуля: сравниваем модуль
    const vCmp = this.inZone || self.drifting ? V : speed;
    let throttle: number;
    let brake = 0;
    const excess = vCmp - vTarget;
    if (excess > 0.6) {
      brake = clamp(excess / 4, 0, 1);
      throttle = 0;
    } else if (speed > vCap) {
      throttle = 0;
      brake = clamp((speed - vCap - 4) / 8, 0, 0.5);
    } else {
      throttle = clamp(0.45 + (vTarget - vCmp) * 0.5, 0, 1);
    }

    // ── занос: руль, ручник, выход ────────────────────────────────────────
    let handbrake = false;
    if (this.inZone) {
      handbrake = true;
      // руль: дуга заноса по вектору скорости к точке впереди (по линии с учётом соперников)
      const L2 = 10 + 0.35 * V;
      const tp = track.sampleAt(s + L2, this.sampleB);
      const off2 = clamp(this.avoidShift + dir * DRIFT_INNER * usable, -usable, usable);
      const ex = tp.position.x + tp.right.x * off2 - self.position.x;
      const ez = tp.position.z + tp.right.z * off2 - self.position.z;
      let err = Math.atan2(vx, vz) - Math.atan2(ex, ez);
      while (err > Math.PI) err -= 2 * Math.PI;
      while (err < -Math.PI) err += 2 * Math.PI;
      steerCmd = dir * clamp(0.45 + 2 * dir * err - 0.05 * dir * self.lateral, 0.2, 1);
      // в заносе угол держится газом: газ не бросаем, если не тормозим
      if (brake === 0) throttle = Math.max(throttle, 0.45);
    } else {
      if (self.drifting) {
        // занос не по плану (толчок, стена, окончание зоны): контр-руль и сброс газа
        steerCmd = -Math.sign(self.driftAngle || 1) * (this.exitTimer > 0 ? 0.1 : 0.7);
        throttle = Math.min(throttle, this.exitTimer > 0 ? 0.1 : 0.2);
        brake = 0;
      } else if (this.exitTimer > 0 && Math.abs(self.driftAngle) > 0.1 && Math.abs(self.driftAngle) < 1.2 && speed > 5) {
        // выравнивание после заноса ещё идёт: не газуем и не рулим в занос (иначе физика войдёт в него снова)
        steerCmd = -Math.sign(self.driftAngle) * 0.1;
        throttle = Math.min(throttle, 0.1);
        brake = 0;
      } else {
        this.exitTimer = 0;
      }
    }

    // реакция на старте: первые доли секунды после GO газ не даём
    if (this.time < this.launchDelay) {
      throttle = 0;
      brake = 0;
    }

    // ── нитро: прямые по «настроению», догон/обгон, последний круг ────────
    const finalLap = this.lap >= this.totalLaps;
    const chasing = ahead !== null || (maxAhead > 0 && maxAhead < 70 && behind === null);
    const needRun = chasing || finalLap ? 70 : 150;
    const allow =
      self.nitro > (chasing || finalLap ? 0.04 : this.nitroReserve) &&
      run >= needRun &&
      (chasing || finalLap || self.nitro > FULL_TANK || runCorner < 0 || this.nitroRoll[runCorner] === 1) &&
      (self.boostPower < 0.45 || chasing || finalLap);
    if (!this.nitroLatch) {
      if (allow && vFwd > 25 && Math.abs(this.steerSmooth) < 0.25 && throttle > 0.9 && !this.inZone && !self.drifting) this.nitroLatch = true;
    } else if (self.nitro < 0.03 || run < 45 || throttle < 0.5 || this.inZone) {
      this.nitroLatch = false;
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
    const kS = 1 - Math.exp(-dt / (self.drifting ? 0.03 : 0.07));
    this.steerSmooth += (steerCmd - this.steerSmooth) * kS;

    out.throttle = throttle;
    out.brake = brake;
    out.steer = clamp(this.steerSmooth, -1, 1);
    out.handbrake = handbrake;
    out.nitro = this.nitroLatch && this.reverseTimer <= 0;
    return out;
  }
}

// ─── Выравнивание по машине ────────────────────────────────────────────────

/** Заводские машины, по которым считается «средний» круг */
const FACTORY_CARS = ['razor', 'grizzly', 'photon'];
/** Чувствительность времени круга к темпу вблизи 1 (измерено: −7% темпа ≈ +2% времени круга) */
const LAP_PER_PACE = 0.3;
/** Не замедляем быстрые машины сильнее, чем до этого темпа */
const CAR_PACE_MIN = 0.88;
const CAR_PACE_MAX = 1.02;
const NEUTRAL: BotProfile = { name: 'CAL', skill: 0.8, aggression: 0.5, lineBias: 0, bodyColor: 0, neonColor: 0, carId: 'razor' };
const _calCtl: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
const lapCache = new Map<string, number>();
/** Шаг пробного круга (грубее физического 1/120: нужна лишь оценка времени круга) */
const CAL_DT = 1 / 60;

/** Среднее время двух кругов (обычного и «финального») нейтрального бота в одиночку (лётный старт), с. Кэшируется по трассе и числам машины. */
function soloLapTime(track: Track, spec: CarSpec): number {
  const key = `${track.id}|${track.length.toFixed(1)}|${spec.id}|${Object.values(getHandling(spec.id)).join(',')}`;
  const hit = lapCache.get(key);
  if (hit !== undefined) return hit;
  const dt = CAL_DT;
  const car = new VehiclePhysics(spec, track);
  const s0 = track.length - 1;
  const p = track.sampleAt(s0);
  const h = Math.atan2(p.tangent.x, p.tangent.z);
  car.reset(p.position, h, s0);
  car.state.velocity.set(Math.sin(h) * 35, 0, Math.cos(h) * 35);
  car.state.speed = 35;
  const bot = new BotDriver(track, NEUTRAL, 1, true);
  bot.totalLaps = 2;
  const others = [car.state];
  let dist = 0;
  let prevS = car.state.trackS;
  let t = 0;
  let lapStart = 0;
  let laps = 0;
  let lap = 0;
  while (laps < 2 && t < 400) {
    const c = bot.update(dt, car.state, spec, others);
    _calCtl.throttle = c.throttle;
    _calCtl.brake = c.brake;
    _calCtl.steer = c.steer;
    _calCtl.handbrake = c.handbrake;
    _calCtl.nitro = c.nitro;
    car.step(dt, _calCtl);
    t += dt;
    const d = track.deltaS(prevS, car.state.trackS);
    prevS = car.state.trackS;
    if (Math.abs(d) < 50) dist += d;
    if (dist >= (laps + 1) * track.length) {
      // два круга: обычный и последний (с нитро «на финиш») — берём среднее
      lap += (t - lapStart) / 2;
      lapStart = t;
      laps++;
    }
  }
  if (laps < 2) lap = Infinity;
  lapCache.set(key, lap);
  return lap;
}

/**
 * Коэффициент темпа ≤ 1: боты на машинах быстрее среднего заводского круга едут осторожнее, чтобы
 * самая быстрая машина не уезжала от остальных (победить можно на любой). Медленные машины не ускоряем.
 */
function carPaceFactor(track: Track, spec: CarSpec): number {
  let sum = 0;
  for (const id of FACTORY_CARS) sum += soloLapTime(track, specById(id));
  const ref = sum / FACTORY_CARS.length;
  const mine = soloLapTime(track, spec);
  if (!Number.isFinite(mine) || !Number.isFinite(ref)) return 1;
  return clamp(1 - (ref / mine - 1) / LAP_PER_PACE, CAR_PACE_MIN, CAR_PACE_MAX);
}
