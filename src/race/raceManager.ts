/** RaceManager — круги, чекпоинты, позиции, WRONG WAY (GAME_DESIGN.md §3.5, §6.5). */
import type { RaceEvent, RacerInfo, RacerStanding, TrackSample, VehicleState } from '../core/types';
import { createSample } from '../world/track';
import type { Track } from '../world/track';

/** Смещение за апдейт больше этого — респаун/телепорт, прогресс не трогаем, м */
const TELEPORT_DISTANCE = 60;
/** Скорость вдоль трассы ниже этой считается движением назад, м/с */
const WRONG_WAY_SPEED = -3;
/** Угол между курсом и касательной, выше которого считаем «лицом назад», рад */
const WRONG_WAY_ANGLE = (110 * Math.PI) / 180;
const WRONG_WAY_MIN_SPEED = 5;
/** Сколько ехать неправильно до флага, с */
const WRONG_WAY_SET_TIME = 1.2;
/** Сколько ехать правильно до сброса флага, с */
const WRONG_WAY_CLEAR_TIME = 0.5;
/** Минимальная средняя скорость для прогноза финиша, м/с */
const MIN_AVG_SPEED = 20;

interface RacerInternal {
  initialized: boolean;
  prevS: number;
  /** Индекс следующей цели 1..count; count == линия старта/финиша (s = 0) */
  target: number;
  lapStart: number;
  badTime: number;
  goodTime: number;
  finishOrder: number;
}

export class RaceManager {
  readonly events: RaceEvent[] = [];
  raceTime = 0;
  private readonly rows: RacerStanding[];
  private readonly internal: RacerInternal[];
  /** Переиспользуемый массив, отсортированный по позиции */
  private readonly sorted: RacerStanding[];
  private readonly sample: TrackSample = createSample();
  private started = false;
  private finishCount = 0;

  constructor(
    readonly track: Track,
    readonly racers: RacerInfo[],
    readonly laps = 3,
  ) {
    this.rows = racers.map((r, i) => ({
      car: i,
      name: r.name,
      isPlayer: r.isPlayer,
      position: i + 1,
      lap: 0,
      progress: 0,
      lapTimes: [],
      bestLap: null,
      currentLapTime: 0,
      nextCheckpoint: 1,
      finished: false,
      finishTime: null,
      wrongWay: false,
    }));
    this.internal = racers.map(() => ({
      initialized: false,
      prevS: 0,
      target: 1,
      lapStart: 0,
      badTime: 0,
      goodTime: 0,
      finishOrder: 0,
    }));
    this.sorted = [...this.rows];
  }

  get hasStarted(): boolean {
    return this.started;
  }

  /** Сколько машин уже финишировало */
  get finishedCount(): number {
    return this.finishCount;
  }

  /** Запускает гонку (можно вызывать повторно — сбрасывает состояние) */
  start(): void {
    this.started = true;
    this.raceTime = 0;
    this.finishCount = 0;
    this.events.length = 0;
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      r.position = i + 1;
      r.lap = 0;
      r.progress = 0;
      r.lapTimes = [];
      r.bestLap = null;
      r.currentLapTime = 0;
      r.nextCheckpoint = 1;
      r.finished = false;
      r.finishTime = null;
      r.wrongWay = false;
      const n = this.internal[i];
      n.initialized = false;
      n.prevS = 0;
      n.target = 1;
      n.lapStart = 0;
      n.badTime = 0;
      n.goodTime = 0;
      n.finishOrder = 0;
      this.sorted[i] = r;
    }
  }

  update(dt: number, cars: readonly VehicleState[]): void {
    this.events.length = 0;
    if (!this.started) return;
    this.raceTime += dt;

    const track = this.track;
    const cps = track.checkpoints;
    const count = cps.length;
    const n = Math.min(cars.length, this.rows.length);

    for (let i = 0; i < n; i++) {
      const car = cars[i];
      const row = this.rows[i];
      const st = this.internal[i];
      const s = car.trackS;

      if (row.finished) {
        st.prevS = s;
        continue;
      }

      if (!st.initialized) {
        // Решётка стоит позади линии: развёрнутая дистанция отрицательна
        st.initialized = true;
        st.prevS = s;
        row.progress = track.deltaS(0, s);
        row.currentLapTime = this.raceTime - st.lapStart;
        continue;
      }

      const d = track.deltaS(st.prevS, s);
      const teleport = Math.abs(d) > TELEPORT_DISTANCE;
      if (!teleport) {
        row.progress += d;

        // Чекпоинты строго по порядку; линия (target == count) закрывает круг
        if (d > 0) {
          const cpS = cps[st.target % count];
          const c = track.deltaS(st.prevS, cpS);
          if (c > 0 && c <= d) {
            if (st.target < count) {
              this.events.push({ type: 'checkpoint', car: i, index: st.target });
              st.target++;
            } else {
              this.completeLap(i, row, st);
              if (row.finished) {
                st.prevS = s;
                continue;
              }
            }
            row.nextCheckpoint = st.target % count;
          }
        }
      }

      this.updateWrongWay(i, dt, car, row, st, teleport ? 0 : d, teleport);
      st.prevS = s;
      row.currentLapTime = this.raceTime - st.lapStart;
    }

    this.sortStandings();
  }

  /** Копия не создаётся: возвращается переиспользуемый массив, обновляемый в update() */
  standings(): RacerStanding[] {
    return this.sorted;
  }

  standing(car: number): RacerStanding {
    return this.rows[car];
  }

  progress(car: number): number {
    return this.rows[car].progress;
  }

  projectedFinishTime(car: number): number {
    const row = this.rows[car];
    if (row.finished && row.finishTime !== null) return row.finishTime;
    const avg = this.raceTime > 0 ? Math.max(row.progress / this.raceTime, MIN_AVG_SPEED) : MIN_AVG_SPEED;
    const remaining = Math.max(0, this.laps * this.track.length - row.progress);
    return this.raceTime + remaining / avg;
  }

  /** s последнего пройденного чекпоинта машины (до первого чекпоинта — старт/финиш, 0) */
  lastCheckpointS(car: number): number {
    const target = this.internal[car]?.target ?? 1;
    // target — индекс следующей цели (1..count); последний пройденный — на единицу меньше
    return this.track.checkpoints[(target - 1) % this.track.checkpoints.length] ?? 0;
  }

  isFinished(car: number): boolean {
    return this.rows[car].finished;
  }

  allFinished(): boolean {
    for (let i = 0; i < this.rows.length; i++) if (!this.rows[i].finished) return false;
    return true;
  }

  private completeLap(i: number, row: RacerStanding, st: RacerInternal): void {
    const lapTime = this.raceTime - st.lapStart;
    st.lapStart = this.raceTime;
    st.target = 1;
    row.lap++;
    row.lapTimes.push(lapTime);
    const isBest = row.bestLap === null || lapTime < row.bestLap;
    if (isBest) row.bestLap = lapTime;
    row.nextCheckpoint = 1;
    row.currentLapTime = 0;
    this.events.push({ type: 'lap', car: i, lap: row.lap, lapTime, isBest });

    if (row.lap >= this.laps) {
      row.finished = true;
      row.finishTime = this.raceTime;
      row.progress = this.laps * this.track.length;
      row.currentLapTime = lapTime;
      st.finishOrder = ++this.finishCount;
      this.events.push({ type: 'finish', car: i, position: st.finishOrder, time: this.raceTime });
      if (row.wrongWay) {
        row.wrongWay = false;
        this.events.push({ type: 'wrongWay', car: i, value: false });
      }
    }
  }

  private updateWrongWay(
    i: number,
    dt: number,
    car: VehicleState,
    row: RacerStanding,
    st: RacerInternal,
    d: number,
    skip: boolean,
  ): void {
    if (skip || dt <= 0) return;
    let bad = d / dt < WRONG_WAY_SPEED;
    if (!bad && car.speed > WRONG_WAY_MIN_SPEED) {
      const t = this.track.sampleAt(car.trackS, this.sample).tangent;
      const trackHeading = Math.atan2(t.x, t.z);
      let diff = Math.abs(car.heading - trackHeading) % (Math.PI * 2);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      bad = diff > WRONG_WAY_ANGLE;
    }

    if (bad) {
      st.badTime += dt;
      st.goodTime = 0;
      if (!row.wrongWay && st.badTime >= WRONG_WAY_SET_TIME) {
        row.wrongWay = true;
        this.events.push({ type: 'wrongWay', car: i, value: true });
      }
    } else {
      st.goodTime += dt;
      st.badTime = 0;
      if (row.wrongWay && st.goodTime >= WRONG_WAY_CLEAR_TIME) {
        row.wrongWay = false;
        this.events.push({ type: 'wrongWay', car: i, value: false });
      }
    }
  }

  /** Финишировавшие — по порядку финиша, затем по прогрессу; insertion sort без аллокаций */
  private sortStandings(): void {
    const arr = this.sorted;
    for (let a = 1; a < arr.length; a++) {
      const x = arr[a];
      let b = a - 1;
      while (b >= 0 && this.ahead(x, arr[b])) {
        arr[b + 1] = arr[b];
        b--;
      }
      arr[b + 1] = x;
    }
    for (let a = 0; a < arr.length; a++) arr[a].position = a + 1;
  }

  /** true, если x должен стоять выше y */
  private ahead(x: RacerStanding, y: RacerStanding): boolean {
    if (x.finished !== y.finished) return x.finished;
    if (x.finished) return this.internal[x.car].finishOrder < this.internal[y.car].finishOrder;
    return x.progress > y.progress;
  }
}
