/**
 * Режим «2 игрока» на одном экране: вторая chase-камера, ввод двух игроков,
 * мини-HUD, автопилот финишировавшего игрока, итоговая таблица.
 * Game даёт только хуки (см. места вызова `split.*`).
 */
import { PerspectiveCamera } from 'three/webgpu';
import { ChaseCamera, type ChaseInput } from './camera';
import type { CarSpec, RaceEvent, RaceResult, ResultRow, VehicleControls, VehicleState } from './types';
import { SplitInput } from '../input/splitInput';
import { SplitHud, type SplitHudData } from '../ui/splitHud';
import { BotDriver } from '../ai/botDriver';
import { BOT_PROFILES } from '../vehicle/specs';
import type { Track } from '../world/track';
import type { RaceManager } from '../race/raceManager';

export interface SplitCar {
  name: string;
  color: string;
  isPlayer: boolean;
}

const _a: SplitHudData = { speedKmh: 0, position: 1, racers: 6, lap: 1, laps: 3, nitro: 0, nitroActive: false, finished: false };
const _b: SplitHudData = { ..._a };

const SPLIT_FOV_SCALE = 0.66;

export class SplitScreen {
  active = false;
  /** Слоты двух игроков на решётке */
  slots: [number, number] = [-1, -1];
  readonly camera2: PerspectiveCamera;
  readonly chase2: ChaseCamera;
  private readonly input = new SplitInput();
  private readonly hud: SplitHud;
  private readonly finished: [boolean, boolean] = [false, false];
  private readonly autos: [BotDriver | null, BotDriver | null] = [null, null];
  private lastAspect = 0;
  private snapPending = true;

  constructor(
    layer: HTMLElement,
    private readonly camera1: PerspectiveCamera,
  ) {
    this.camera2 = new PerspectiveCamera(camera1.fov, camera1.aspect, camera1.near, camera1.far);
    this.chase2 = new ChaseCamera(this.camera2);
    this.hud = new SplitHud(layer);
    this.layer = layer;
  }

  private readonly layer: HTMLElement;
  /** Подписка Game: применить fovScale к основной chase-камере */
  onFovScale: ((k: number) => void) | null = null;

  begin(on: boolean, p1: number, p2: number): void {
    this.active = on;
    this.snapPending = true;
    this.slots = [p1, p2];
    this.finished[0] = this.finished[1] = false;
    this.autos[0] = this.autos[1] = null;
    this.input.clear();
    this.layer.classList.toggle('nr-split', on);
    // полуэкран шире обычного кадра: сужаем вертикальный FOV, иначе машины крошечные
    this.chase2.fovScale = on ? SPLIT_FOV_SCALE : 1;
    this.onFovScale?.(on ? SPLIT_FOV_SCALE : 1);
    if (!on) this.hud.show(false);
  }

  reset(): void {
    this.begin(false, -1, -1);
    this.syncAspect(false);
  }

  /** 0 / 1 — какой игрок управляет слотом; -1 — не игрок */
  playerIndex(slot: number): number {
    return slot === this.slots[0] ? 0 : slot === this.slots[1] ? 1 : -1;
  }

  /** Управление машиной игрока (человек или автопилот после финиша) */
  controls(slot: number, dt: number, state: VehicleState, spec: CarSpec, states: VehicleState[], track: Track): VehicleControls {
    const i = this.playerIndex(slot) as 0 | 1;
    if (this.finished[i]) {
      const auto = (this.autos[i] ??= new BotDriver(track, { ...BOT_PROFILES[2], name: 'AUTO' }, 5 + i));
      return auto.update(dt, state, spec, states);
    }
    return this.input.controls(i, dt);
  }

  /** Событие гонки; true — оба игрока финишировали */
  onRaceEvent(ev: RaceEvent): boolean {
    if (ev.type !== 'finish') return false;
    const i = this.playerIndex(ev.car);
    if (i < 0) return false;
    this.finished[i] = true;
    return this.finished[0] && this.finished[1];
  }

  isFinished(i: 0 | 1): boolean {
    return this.finished[i];
  }

  updateCamera2(dt: number, inp: ChaseInput): void {
    if (this.snapPending) {
      this.snapPending = false;
      this.chase2.snap(inp);
    } else this.chase2.update(dt, inp);
  }

  /** Aspect камер: половина высоты в сплите, весь экран иначе */
  syncAspect(split: boolean): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = split ? w / (h / 2) : w / h;
    if (aspect === this.lastAspect && this.camera2.far === this.camera1.far) return;
    this.lastAspect = aspect;
    this.camera1.aspect = aspect;
    this.camera1.updateProjectionMatrix();
    this.camera2.aspect = aspect;
    this.camera2.far = this.camera1.far;
    this.camera2.updateProjectionMatrix();
  }

  /** Мини-HUD: показ и данные обоих игроков */
  updateHud(visible: boolean, race: RaceManager | null, states: VehicleState[], laps: number): void {
    this.hud.show(visible && this.active);
    if (!visible || !this.active || !race) return;
    const fill = (d: SplitHudData, slot: number): void => {
      const st = race.standing(slot);
      const ps = states[slot];
      d.speedKmh = Math.hypot(ps.velocity.x, ps.velocity.z) * 3.6;
      d.position = st.position;
      d.racers = states.length;
      d.lap = st.lap + 1;
      d.laps = laps;
      d.nitro = ps.nitro;
      d.nitroActive = ps.nitroActive;
      d.finished = st.finished;
    };
    fill(_a, this.slots[0]);
    fill(_b, this.slots[1]);
    this.hud.update(_a, _b);
  }

  /** Итоговая таблица для обоих игроков */
  buildResult(race: RaceManager, cars: SplitCar[], carId: string): RaceResult {
    const sorted = cars.map((c, i) => {
      const st = race.standing(i);
      const time = st.finished && st.finishTime !== null ? st.finishTime : race.projectedFinishTime(i);
      return { i, c, st, time };
    });
    sorted.sort((a, b) => {
      if (a.st.finished !== b.st.finished) return a.st.finished ? -1 : 1;
      if (a.st.finished) return a.st.position - b.st.position;
      return a.time - b.time;
    });
    const rows: ResultRow[] = sorted.map((r, k) => ({
      position: k + 1,
      name: r.c.name,
      color: r.c.color,
      isPlayer: r.c.isPlayer,
      time: r.time,
      projected: !r.st.finished,
      bestLap: r.st.bestLap,
    }));
    const pos = (slot: number): number => rows.findIndex((r) => r.name === cars[slot].name) + 1;
    const p1 = pos(this.slots[0]);
    const p2 = pos(this.slots[1]);
    const winner = p1 < p2 ? 'ИГРОК 1' : 'ИГРОК 2';
    const best = Math.min(p1, p2);
    const st = race.standing(p1 < p2 ? this.slots[0] : this.slots[1]);
    return {
      rows,
      playerPosition: best,
      playerTime: st.finishTime ?? race.raceTime,
      playerBestLap: st.bestLap,
      driftScore: 0,
      carId,
      newBestLap: false,
      newBestRace: false,
      newBestDrift: false,
      lapTimes: st.lapTimes.slice(),
      title: `${winner} ПОБЕДИЛ`,
    };
  }
}
