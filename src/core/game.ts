/**
 * Game — стейт-машина и интеграция модулей (GAME_DESIGN.md §6.9).
 *
 *   loading → menu → countdown → racing → finished → (results) → menu / restart
 *   Пауза — флаг поверх countdown/racing/finished.
 */
import { PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three/webgpu';
import { GameLoop } from './loop';
import type { RenderSystem } from './renderer';
import { ChaseCamera } from './camera';
import { isTouchDevice, vibrate } from './device';
import { DEFAULT_CUSTOM_BUILD, loadCustomBuild, loadTrackIndex, saveTrackIndex, loadRecords, loadSettings, saveCustomBuild, saveRecords, saveSettings } from './storage';
import type {
  BotProfile,
  CarSpec,
  CustomBuild,
  HudData,
  MenuAction,
  MinimapDot,
  RaceResult,
  Records,
  ResultRow,
  Settings,
  VehicleControls,
  VehicleState,
} from './types';
import { Track, createProjection } from '../world/track';
import { TRACKS, type TrackDefinition } from '../world/trackData';
import { World } from '../world/world';
import { PALETTE, cssColor } from '../world/palette';
import { InputManager, resolveTouchMode } from '../input/input';
import { VehiclePhysics, createVehicleState } from '../vehicle/physics';
import { resolveCarCollisions } from '../vehicle/collisions';
import { CAR_GEOMETRY, BOT_PROFILES, CAR_SPECS, CUSTOM_PALETTE, specById } from '../vehicle/specs';
import { getHandling } from '../vehicle/handling';
import { CarModel } from '../vehicle/carModel';
import { EffectsManager } from '../vehicle/effects';
import { BotDriver } from '../ai/botDriver';
import { rubberBandFactor } from '../ai/rubberBand';
import { RaceManager } from '../race/raceManager';
import { DriftScorer } from '../race/drift';
import { UIManager } from '../ui/uiManager';
import type { DebugPanel } from '../ui/debugPanel';
import {
  CUSTOM_BUDGET,
  HANDLING,
  HANDLING_DEFAULTS,
  HANDLING_PARAMS,
  INPUT_PARAMS,
  INPUT_TUNING,
  INPUT_TUNING_DEFAULTS,
  applyCustomHandling,
  customStats,
  normalizeBuild,
} from '../vehicle/handling';
import { CUSTOM_CAR_ID, recordKey } from './types';
import type { TrackInfo } from './types';
import { AudioManager } from '../audio/audioManager';
import { StartBoostJudge, START_BOOST } from './startBoost';

export type GameState = 'loading' | 'menu' | 'countdown' | 'racing' | 'finished';

const LAPS = 3;
/** Потолок FPS на сенсорных устройствах */
export const MOBILE_MAX_FPS = 120;
const PLAYER_SLOT = 3;
const COUNTDOWN = 3.6;
const PREVIEW_S = 215;

interface RaceCar {
  name: string;
  spec: CarSpec;
  physics: VehiclePhysics;
  model: CarModel;
  bot: BotDriver | null;
  color: string;
  isPlayer: boolean;
  prevPos: Vector3;
  prevQuat: Quaternion;
  renderPos: Vector3;
  renderQuat: Quaternion;
  roadHeight: number;
}

export interface GameOptions {
  autostart: boolean;
  carIndex: number;
  quality: Settings['quality'] | null;
  showFps: boolean;
  autopilot: boolean;
  timeScale: number;
  /** ?debug — панель тюнинга управления */
  debug: boolean;
}

const NO_CONTROLS: VehicleControls = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
const _proj = createProjection();

export class Game {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 2000);
  readonly chase = new ChaseCamera(this.camera);
  track: Track;
  trackIndex: number;
  readonly world: World;
  readonly effects = new EffectsManager();
  readonly input = new InputManager();
  readonly audio = new AudioManager();
  readonly ui: UIManager;
  readonly loop: GameLoop;

  settings: Settings;
  records: Records;
  state: GameState = 'loading';
  paused = false;
  uiMode: 'menu' | 'pause' | 'results' | null = null;

  cars: RaceCar[] = [];
  race: RaceManager | null = null;
  readonly drift = new DriftScorer();
  selectedCar = 0;

  private countdownT = 0;
  /** Стартовый буст (дополнение): оценка нажатия газа на «GO» */
  private readonly startJudge = new StartBoostJudge();
  private lastCount = 0;
  private finishT = 0;
  private resultsShown = false;
  private playerAutopilot: BotDriver | null = null;
  private previewModel: CarModel | null = null;
  private readonly previewState = createVehicleState();
  private hitWallThisStep = false;
  private playerWasDrifting = false;
  private readonly states: VehicleState[] = [];
  private readonly physicsList: VehiclePhysics[] = [];
  private readonly hud: HudData;
  /** Отслеживание буста игрока (для HUD и звука) */
  private boostPrev = 0;
  private readonly dots: MinimapDot[] = [];
  private fpsTimer = 0;
  private lastResult: RaceResult | null = null;

  constructor(
    readonly render: RenderSystem,
    readonly opts: GameOptions,
  ) {
    this.settings = loadSettings();
    if (opts.quality) this.settings.quality = opts.quality;
    if (opts.showFps) this.settings.showFps = true;
    this.records = loadRecords();
    this.selectedCar = Math.min(CAR_SPECS.length - 1, Math.max(0, opts.carIndex));

    const urlTrack = Number(new URLSearchParams(location.search).get('track') ?? NaN);
    this.trackIndex = Number.isInteger(urlTrack) && urlTrack >= 0 && urlTrack < TRACKS.length ? urlTrack : loadTrackIndex(TRACKS.length);
    this.track = new Track(TRACKS[this.trackIndex]);
    this.world = new World(this.scene, this.track);
    this.scene.add(this.effects.group);

    this.syncCustomSpec();
    const uiRoot = document.getElementById('ui')!;
    this.ui = new UIManager(uiRoot, {
      cars: CAR_SPECS,
      settings: { ...this.settings },
      records: this.records,
      customBuild: { ...this.customBuild },
      customBudget: CUSTOM_BUDGET,
      customPalette: CUSTOM_PALETTE,
      tracks: TRACKS.map((d) => this.trackInfo(d)),
      trackIndex: this.trackIndex,
      callbacks: {
        onPreviewCar: (i) => this.setPreviewCar(i),
        onStartRace: (i) => this.startRace(i),
        onSettingsChanged: (s) => this.applySettings(s, true),
        onPause: () => this.pause(),
        onResume: () => this.resume(),
        onRestart: () => this.startRace(this.selectedCar),
        onQuitToMenu: () => this.enterMenu(),
        onUiSound: (k) => this.audio.play(k === 'move' ? 'uiMove' : k === 'select' ? 'uiSelect' : 'uiBack'),
        onCustomBuildChanged: (b) => this.applyCustomBuild(b),
        onSelectTrack: (i) => this.selectTrack(i),
        onFirstInteraction: () => {
          void this.audio.unlock();
        },
      },
    });

    this.hud = {
      speedKmh: 0,
      nitro: 0,
      nitroActive: false,
      lap: 1,
      totalLaps: LAPS,
      position: 1,
      totalRacers: 6,
      lapTime: 0,
      lastLap: null,
      bestLap: null,
      raceTime: 0,
      drift: this.drift.combo,
      driftTotal: 0,
      wrongWay: false,
      minimap: this.dots,
      boost: 0,
      boostPower: 0,
    };

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
    render.setView(this.scene, this.camera);
    this.applySettings(this.settings, false);

    this.loop = new GameLoop(
      {
        step: (dt) => this.step(dt),
        frame: (dt, alpha) => this.frame(dt, alpha),
      },
      (cb) => this.render.renderer.setAnimationLoop(cb),
    );
    this.loop.timeScale = opts.timeScale;
    // на телефонах — не чаще 120 кадров/с (батарея, нагрев); на десктопе — частота экрана
    this.loop.maxFps = isTouchDevice() ? MOBILE_MAX_FPS : 0;
  }

  private debugPanel: DebugPanel | null = null;
  customBuild: CustomBuild = paletteSafe(normalizeBuild(loadCustomBuild()));

  /** Выбор трассы в меню: пересобрать дорогу и окружение, сохранить выбор */
  selectTrack(i: number): void {
    if (i < 0 || i >= TRACKS.length || i === this.trackIndex || this.state !== 'menu') return;
    this.trackIndex = i;
    saveTrackIndex(i);
    this.track = new Track(TRACKS[i]);
    this.world.setTrack(this.track);
    this.world.setQuality(this.settings.quality);
    this.setPreviewCar(this.selectedCar);
  }

  private trackInfo(d: TrackDefinition): TrackInfo {
    const t = d === this.track?.def ? this.track : new Track(d);
    return { id: t.id, name: d.name, tagline: d.tagline ?? '', lengthKm: Math.round(t.length / 100) / 10 };
  }

  /** Индекс машины «своя сборка» в CAR_SPECS */
  private get customIndex(): number {
    return CAR_SPECS.findIndex((c) => c.id === CUSTOM_CAR_ID);
  }

  /** Перенести сборку в физику (HANDLING.custom) и в спецификацию машины (цвета, полоски) */
  private syncCustomSpec(): CarSpec | null {
    const i = this.customIndex;
    if (i < 0) return null;
    applyCustomHandling(this.customBuild);
    const spec = CAR_SPECS[i];
    spec.bodyColor = this.customBuild.bodyColor;
    spec.neonColor = this.customBuild.neonColor;
    spec.stats = customStats(this.customBuild);
    return spec;
  }

  /** «Своя сборка» изменилась: физика, превью, сохранение */
  applyCustomBuild(b: CustomBuild): void {
    const prev = this.customBuild;
    this.customBuild = paletteSafe(normalizeBuild(b));
    saveCustomBuild(this.customBuild);
    const spec = this.syncCustomSpec();
    if (!spec) return;
    this.ui.updateCarSpec(this.customIndex, spec);
    this.ui.setCustomBuild(this.customBuild); // без колбэка: держит UI в синхроне с нормализованной сборкой
    const colorsChanged = prev.bodyColor !== this.customBuild.bodyColor || prev.neonColor !== this.customBuild.neonColor;
    if (this.state === 'menu' && this.selectedCar === this.customIndex && colorsChanged) this.setPreviewCar(this.customIndex);
  }

  /** Панель тюнинга управления (?debug). Правки сохраняются и применяются только в debug-режиме. */
  private async initDebugPanel(): Promise<void> {
    const { createDebugPanel, loadTuningOverrides } = await import('../ui/debugPanel');
    loadTuningOverrides(HANDLING, INPUT_TUNING);
    const carNames: Record<string, string> = {};
    for (const c of CAR_SPECS) carNames[c.id] = c.name;
    this.debugPanel = await createDebugPanel({
      configs: HANDLING,
      defaults: HANDLING_DEFAULTS,
      carNames,
      params: HANDLING_PARAMS,
      extra: { title: 'Клавиатура', config: INPUT_TUNING, defaults: INPUT_TUNING_DEFAULTS, params: INPUT_PARAMS },
      getActiveCarId: () => CAR_SPECS[this.selectedCar].id,
      telemetry: (): Record<string, string | number | boolean> => {
        const car = this.cars.length ? this.player : null;
        if (!car) return { Состояние: this.state };
        const st = car.physics.state;
        return {
          Состояние: this.state,
          'Скорость, км/ч': Math.round(Math.abs(st.speed) * 3.6),
          Режим: car.physics.driftMode ? 'DRIFT' : 'GRIP',
          'Угол заноса, °': Math.round((st.driftAngle * 180) / Math.PI),
          'Рыскание, °/с': Math.round((st.yawRate * 180) / Math.PI),
          'Угол колёс, °': Math.round((st.wheels[0].steerAngle * 180) / Math.PI),
          Газ: st.throttle.toFixed(2),
          Нитро: st.nitro.toFixed(2),
          'На земле': st.onGround,
        };
      },
    });
  }

  async start(): Promise<void> {
    if (this.opts.debug) {
      try {
        await this.initDebugPanel();
      } catch (e) {
        console.warn('Панель тюнинга не загрузилась', e);
      }
    }
    // Прогрев: компилируем шейдеры мира и всех машин заранее, чтобы не было
    // фризов при старте гонки.
    this.ui.showLoading('Прогрев неона…');
    const temp = CAR_SPECS.map((spec, i) => {
      const m = new CarModel(spec);
      m.group.position.set(i * 6, 0.4, 0);
      this.scene.add(m.group);
      return m;
    });
    this.camera.position.set(-20, 15, -20);
    this.camera.lookAt(0, 0, 0);
    try {
      await this.render.renderer.compileAsync(this.scene, this.camera);
    } catch (e) {
      console.warn('Предкомпиляция шейдеров не удалась', e);
    }
    for (const m of temp) {
      this.scene.remove(m.group);
      m.dispose();
    }
    this.loop.start();
    if (this.opts.autostart) this.startRace(this.selectedCar);
    else this.enterMenu();
  }

  // ─── Настройки ─────────────────────────────────────────────────────────

  /** Сенсорные кнопки активны (настройка «Тип управления» + тип устройства) */
  touchMode = false;

  applySettings(s: Settings, persist: boolean): void {
    this.settings = { ...s };
    this.touchMode = resolveTouchMode(s.controlMode, isTouchDevice());
    this.ui.setTouchMode(this.touchMode);
    this.ui.setTouchLayout(s.touchSize, s.touchOpacity);
    this.input.setTouchSource(this.touchMode ? this.ui.touchState : null);
    this.audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume);
    this.render.setQuality(s.quality);
    this.world.setQuality(s.quality);
    this.effects.density = s.quality === 'high' ? 1 : 0.5;
    this.camera.far = s.quality === 'high' ? 2000 : 1600;
    this.camera.updateProjectionMatrix();
    this.ui.setFps(s.showFps ? Math.round(this.loop?.fps ?? 60) : null);
    if (persist) saveSettings(this.settings);
  }

  // ─── Меню ──────────────────────────────────────────────────────────────

  enterMenu(): void {
    this.clearRace();
    this.state = 'menu';
    this.paused = false;
    this.uiMode = 'menu';
    this.audio.setPaused(false);
    this.audio.updateEngine(null);
    this.audio.playMusic('menu');
    this.ui.setCountdown(null);
    this.ui.setSelectedCar(this.selectedCar);
    this.ui.showMainMenu();
    this.setPreviewCar(this.selectedCar);
  }

  private setPreviewCar(i: number): void {
    this.selectedCar = Math.min(CAR_SPECS.length - 1, Math.max(0, i));
    this.debugPanel?.setActiveCar(CAR_SPECS[this.selectedCar].id);
    if (this.previewModel) {
      this.scene.remove(this.previewModel.group);
      this.previewModel.dispose();
    }
    const spec = CAR_SPECS[this.selectedCar];
    const model = new CarModel(spec);
    this.previewModel = model;
    if (this.state === 'menu') this.scene.add(model.group);
    // статичное состояние: машина стоит на дороге
    const pose = this.track.sampleAt(PREVIEW_S);
    const st = this.previewState;
    st.position.copy(pose.position).addScaledVector(pose.right, -2);
    st.position.y += CAR_GEOMETRY.wheelRadius;
    st.heading = Math.atan2(pose.tangent.x, pose.tangent.z) + 0.5;
    st.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), st.heading);
    st.nitroActive = false;
    this.updatePreviewWheels();
  }

  private updatePreviewWheels(): void {
    const st = this.previewState;
    const m = new Vector3();
    CAR_GEOMETRY.wheelOffsets.forEach(([x, , z], i) => {
      m.set(x, -CAR_GEOMETRY.wheelRadius, z).applyQuaternion(st.quaternion).add(st.position);
      st.wheels[i].contact.copy(m);
    });
  }

  // ─── Гонка ─────────────────────────────────────────────────────────────

  private clearRace(): void {
    for (const c of this.cars) {
      this.scene.remove(c.model.group);
      c.model.dispose();
    }
    this.cars = [];
    this.states.length = 0;
    this.physicsList.length = 0;
    this.race = null;
    this.playerAutopilot = null;
    this.effects.clear();
    if (this.previewModel) this.scene.remove(this.previewModel.group);
  }

  startRace(carIndex: number): void {
    // сид гонки: у ботов разные «настроение», ошибки и решения о заносе в каждой гонке (?seed= — воспроизвести)
    const urlSeed = Number(new URLSearchParams(location.search).get('seed') ?? NaN);
    const raceSeed = Number.isFinite(urlSeed) ? urlSeed : Math.floor(Math.random() * 100000);
    this.clearRace();
    this.selectedCar = Math.min(CAR_SPECS.length - 1, Math.max(0, carIndex));
    const playerSpec = CAR_SPECS[this.selectedCar];

    // решётка: 0–2 сильные боты, 3 — игрок, 4–5 — остальные
    const bots = [...BOT_PROFILES];
    const order: (BotProfile | null)[] = [bots[0], bots[1], bots[2], null, bots[3], bots[4]];
    order.forEach((profile, slot) => {
      const spec: CarSpec = profile ? { ...specById(profile.carId), bodyColor: profile.bodyColor, neonColor: profile.neonColor } : playerSpec;
      const physics = new VehiclePhysics(spec, this.track);
      const pose = this.track.gridPose(slot);
      physics.reset(pose.position, pose.heading, pose.s);
      physics.frozen = true;
      const model = new CarModel(spec);
      this.scene.add(model.group);
      const car: RaceCar = {
        name: profile ? profile.name : 'ВЫ',
        spec,
        physics,
        model,
        bot: profile ? new BotDriver(this.track, profile, raceSeed + slot * 77) : null,
        color: profile ? cssColor(profile.bodyColor) : cssColor(PALETTE.white),
        isPlayer: !profile,
        prevPos: physics.state.position.clone(),
        prevQuat: physics.state.quaternion.clone(),
        renderPos: physics.state.position.clone(),
        renderQuat: physics.state.quaternion.clone(),
        roadHeight: pose.position.y,
      };
      this.cars.push(car);
    });
    for (const c of this.cars) {
      this.states.push(c.physics.state);
      this.physicsList.push(c.physics);
    }
    this.race = new RaceManager(
      this.track,
      this.cars.map((c) => ({ name: c.name, isPlayer: c.isPlayer })),
      LAPS,
    );
    if (this.opts.autopilot) {
      this.playerAutopilot = new BotDriver(this.track, { ...BOT_PROFILES[0], name: 'AUTO', skill: 0.9 }, 7);
    }
    this.drift.reset();
    this.effects.clear();
    this.hitWallThisStep = false;

    this.state = 'countdown';
    this.paused = false;
    this.uiMode = null;
    this.countdownT = COUNTDOWN;
    this.startJudge.reset();
    this.lastCount = 0;
    this.finishT = 0;
    this.resultsShown = false;
    this.lastResult = null;
    this.audio.setPaused(false);
    this.audio.playMusic('race');
    this.ui.showRaceHud(this.track.outline(256));
    this.hud.totalRacers = this.cars.length;
    this.input.clear();
    const p = this.player;
    this.chase.snap(this.chaseInput(p));
  }

  get player(): RaceCar {
    return this.cars[PLAYER_SLOT];
  }

  get playerIndex(): number {
    return PLAYER_SLOT;
  }

  pause(): void {
    if (this.paused || (this.state !== 'countdown' && this.state !== 'racing' && this.state !== 'finished')) return;
    if (this.resultsShown) return;
    this.paused = true;
    this.uiMode = 'pause';
    this.audio.setPaused(true);
    this.ui.showPause();
    this.input.clear();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.uiMode = null;
    this.audio.setPaused(false);
    this.ui.hidePause();
    this.input.clear();
  }

  /** R: вернуть игрока на трассу у последнего пройденного чекпоинта */
  respawnAtCheckpoint(car: RaceCar, index: number): void {
    if (!this.race) return this.respawn(car);
    const s = this.track.wrapS(this.race.lastCheckpointS(index) + 4);
    const sample = this.track.sampleAt(s);
    const pos = sample.position.clone();
    pos.y += CAR_GEOMETRY.wheelRadius + 0.3;
    const heading = Math.atan2(sample.tangent.x, sample.tangent.z);
    car.physics.reset(pos, heading, sample.s);
    car.prevPos.copy(car.physics.state.position);
    car.prevQuat.copy(car.physics.state.quaternion);
    this.chase.snap(this.chaseInput(car));
  }

  /** Респаун машины на осевую в текущей точке трассы */
  respawn(car: RaceCar): void {
    const st = car.physics.state;
    const sample = this.track.sampleAt(st.trackS);
    const lat = Math.max(-sample.halfWidth + 3, Math.min(sample.halfWidth - 3, st.lateral * 0.5));
    const pos = sample.position.clone().addScaledVector(sample.right, lat);
    pos.y += CAR_GEOMETRY.wheelRadius + 0.3;
    const heading = Math.atan2(sample.tangent.x, sample.tangent.z);
    car.physics.reset(pos, heading, sample.s);
    car.prevPos.copy(car.physics.state.position);
    car.prevQuat.copy(car.physics.state.quaternion);
  }

  // ─── Шаг симуляции ─────────────────────────────────────────────────────

  private step(dt: number): void {
    if (this.paused || !this.race) return;
    if (this.state !== 'countdown' && this.state !== 'racing' && this.state !== 'finished') return;
    const race = this.race;

    if (this.state === 'countdown') {
      this.countdownT -= dt;
      if (this.countdownT <= 0) {
        this.state = 'racing';
        for (const c of this.cars) c.physics.frozen = false;
        race.start();
      }
    }

    const player = this.player;
    const playerProgress = race.progress(PLAYER_SLOT);
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      c.prevPos.copy(c.physics.state.position);
      c.prevQuat.copy(c.physics.state.quaternion);
      let controls: VehicleControls;
      if (c.isPlayer) {
        if (this.state === 'finished' || this.playerAutopilot) {
          if (!this.playerAutopilot) this.playerAutopilot = new BotDriver(this.track, { ...BOT_PROFILES[2], name: 'AUTO' }, 5);
          controls = this.playerAutopilot.update(dt, c.physics.state, c.spec, this.states);
        } else {
          controls = this.input.controls(dt);
          this.judgeStart(c, controls);
        }
      } else if (c.bot) {
        controls = this.state === 'countdown' ? NO_CONTROLS : c.bot.update(dt, c.physics.state, c.spec, this.states);
        c.physics.powerScale = this.state === 'racing' ? rubberBandFactor(race.progress(i), playerProgress, this.track.length) : 1;
      } else {
        controls = NO_CONTROLS;
      }
      c.physics.step(dt, controls);
    }
    resolveCarCollisions(this.physicsList);

    // события физики
    this.hitWallThisStep = false;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      for (const ev of c.physics.events) {
        const near = c.isPlayer || c.physics.state.position.distanceToSquared(player.physics.state.position) < 60 * 60;
        if (ev.type === 'wall') {
          if (ev.strength > 0.08 && near) this.effects.sparksAt(ev.point, c.physics.state.velocity, ev.strength);
          if (c.isPlayer) {
            if (ev.strength > 0.12) {
              this.audio.play('hit');
              vibrate(Math.round(18 + ev.strength * 45));
              this.chase.kick(ev.strength * 0.8);
            }
            this.hitWallThisStep = this.hitWallThisStep || ev.strength > 0.15;
          }
        } else if (ev.type === 'car') {
          if (ev.strength > 0.1 && near) this.effects.sparksAt(ev.point, c.physics.state.velocity, ev.strength * 0.7);
          if (c.isPlayer && ev.strength > 0.15) {
            this.audio.play('hit');
            vibrate(Math.round(15 + ev.strength * 35));
            this.chase.kick(ev.strength * 0.6);
          }
        } else if (ev.type === 'land') {
          if (near && ev.strength > 0.2) this.effects.landingPuff(ev.point, ev.strength);
          if (c.isPlayer) {
            this.audio.play('land');
            this.chase.kick(ev.strength * 0.7);
          }
        }
      }
      // респаун застрявших/упавших
      const bot = c.bot;
      if (c.physics.needsRespawn || (bot && this.state === 'racing' && bot.stuckTime > 4)) {
        this.respawn(c);
        if (bot) bot.stuckTime = 0;
      }
    }

    // резкий срыв в занос — короткий толчок камеры
    const drifting = player.physics.state.drifting;
    if (drifting && !this.playerWasDrifting) this.chase.kick(0.28);
    this.playerWasDrifting = drifting;

    race.update(dt, this.states);
    for (const ev of race.events) {
      if (ev.car !== PLAYER_SLOT) continue;
      if (ev.type === 'lap') {
        this.audio.play('lap');
        if (ev.lap < LAPS) {
          this.ui.banner(ev.lap === LAPS - 1 ? 'ФИНАЛЬНЫЙ КРУГ' : `КРУГ ${ev.lap + 1}/${LAPS}`, ev.lap === LAPS - 1 ? 'orange' : 'cyan');
        }
        if (ev.isBest && ev.lap > 1) this.ui.popup('ЛУЧШИЙ КРУГ', formatTime(ev.lapTime), 'yellow');
      } else if (ev.type === 'finish') {
        this.state = 'finished';
        this.finishT = 0;
        for (const d of this.drift.flush()) {
          if (d.type === 'comboEnd') this.ui.popup(d.label, `+${d.points.toLocaleString('ru-RU')}`, 'pink');
        }
        this.audio.play('finish');
        this.ui.banner(ev.position === 1 ? 'ПОБЕДА!' : `ФИНИШ · ${ev.position}-Е МЕСТО`, ev.position === 1 ? 'yellow' : 'pink');
      }
    }

    if (this.state === 'racing') {
      for (const ev of this.drift.update(dt, player.physics.state, this.hitWallThisStep)) {
        if (ev.type === 'comboEnd') {
          this.ui.popup(ev.label, `+${ev.points.toLocaleString('ru-RU')}${ev.multiplier > 1 ? `  x${ev.multiplier}` : ''}`, ev.points >= 4000 ? 'yellow' : ev.points >= 1500 ? 'pink' : 'cyan');
          this.audio.play('combo');
        } else if (ev.type === 'comboLost') {
          if (ev.points > 50) {
            this.ui.popup('COMBO LOST', `−${ev.points.toLocaleString('ru-RU')}`, 'orange');
            this.audio.play('comboLost');
          }
        }
      }
    }

    if (this.state === 'finished') {
      this.finishT += dt;
      if (this.finishT > 2.6 && !this.resultsShown) this.showResults();
    }
  }

  private showResults(): void {
    if (!this.race) return;
    this.resultsShown = true;
    const race = this.race;
    const player = race.standing(PLAYER_SLOT);
    const rows: ResultRow[] = [];
    const sorted = this.cars.map((c, i) => {
      const st = race.standing(i);
      const time = st.finished && st.finishTime !== null ? st.finishTime : race.projectedFinishTime(i);
      return { i, c, st, time, projected: !st.finished };
    });
    // финишировавшие — по порядку финиша, остальные — по прогнозу
    sorted.sort((a, b) => {
      if (a.st.finished !== b.st.finished) return a.st.finished ? -1 : 1;
      if (a.st.finished) return a.st.position - b.st.position;
      return a.time - b.time;
    });
    sorted.forEach((r, k) =>
      rows.push({
        position: k + 1,
        name: r.c.name,
        color: r.c.color,
        isPlayer: r.c.isPlayer,
        time: r.time,
        projected: r.projected,
        bestLap: r.st.bestLap,
      }),
    );
    const playerPos = rows.find((r) => r.isPlayer)?.position ?? player.position;
    const carId = CAR_SPECS[this.selectedCar].id;
    const rec = this.records;
    const time = player.finishTime ?? race.raceTime;
    // рекорды — по трассе и машине; для Sunset Loop учитываем и старые ключи без трассы
    const key = recordKey(this.track.id, carId);
    const legacy = this.track.id === 'sunset' ? carId : null;
    const prevLap = rec.bestLap[key] ?? (legacy ? rec.bestLap[legacy] : undefined);
    const prevRace = rec.bestRace[key] ?? (legacy ? rec.bestRace[legacy] : undefined);
    const newBestLap = player.bestLap !== null && (prevLap === undefined || player.bestLap < prevLap);
    const newBestRace = prevRace === undefined || time < prevRace;
    const newBestDrift = this.drift.total > rec.bestDrift;
    if (newBestLap && player.bestLap !== null) rec.bestLap[key] = player.bestLap;
    if (newBestRace) rec.bestRace[key] = time;
    if (newBestDrift) rec.bestDrift = Math.round(this.drift.total);
    rec.races += 1;
    if (playerPos === 1) rec.wins += 1;
    saveRecords(rec);
    this.ui.setRecords(rec);

    const result: RaceResult = {
      rows,
      playerPosition: playerPos,
      playerTime: time,
      playerBestLap: player.bestLap,
      driftScore: Math.round(this.drift.total),
      carId,
      newBestLap,
      newBestRace,
      newBestDrift,
    };
    this.lastResult = result;
    this.uiMode = 'results';
    this.ui.showResults(result);
  }

  // ─── Кадр ──────────────────────────────────────────────────────────────

  private handleActions(actions: MenuAction[]): void {
    for (const a of actions) {
      if (this.uiMode) {
        this.ui.handleAction(a);
        continue;
      }
      // 'back' (Backspace / B на геймпаде) в гонке не ставит паузу: B — это нитро
      if (a === 'pause') this.pause();
      else if (a === 'reset' && this.state === 'racing') this.respawnAtCheckpoint(this.player, PLAYER_SLOT);
    }
  }

  private frame(dt: number, alpha: number): void {
    this.handleActions(this.input.consumeActions());

    if (this.state === 'menu' && this.previewModel) {
      const st = this.previewState;
      this.previewModel.update(st, st.position.y - CAR_GEOMETRY.wheelRadius, dt);
      this.chase.preview(dt, st.position, st.heading);
    } else if (this.cars.length > 0) {
      const a = this.paused ? 1 : alpha;
      for (let i = 0; i < this.cars.length; i++) {
        const c = this.cars[i];
        const st = c.physics.state;
        c.renderPos.lerpVectors(c.prevPos, st.position, a);
        c.renderQuat.slerpQuaternions(c.prevQuat, st.quaternion, a);
        this.track.project(c.renderPos, st.trackS, _proj);
        c.roadHeight = _proj.height;
        c.model.update(st, c.roadHeight, this.paused ? 0 : dt);
        c.model.group.position.copy(c.renderPos);
        c.model.group.quaternion.copy(c.renderQuat);
        if (!this.paused) this.effects.updateCar(i, st, dt);
      }
      const p = this.player;
      if (!this.paused) {
        const inp = this.chaseInput(p);
        inp.position = p.renderPos;
        this.chase.update(dt, inp);
      }
      this.updateHud();
      this.updateCountdown();
      const ps = p.physics.state;
      this.audio.updateEngine(
        this.paused
          ? null
          : { rpm: ps.rpm, throttle: ps.throttle, speed: Math.abs(ps.speed), skid: Math.max(ps.wheels[2].skid, ps.wheels[3].skid), nitro: ps.nitroActive, onGround: ps.onGround },
      );
    }

    const player = this.cars.length ? this.player.physics.state : null;
    let speedLines = 0;
    if (player && !this.paused) speedLines = player.nitroActive ? 1 : Math.min(0.5, Math.max(0, (Math.abs(player.speed) - 55) / 30));
    this.effects.update(this.paused ? 0 : dt, this.camera, player ? Math.abs(player.speed) : 0, speedLines);

    this.world.update(this.camera.position);

    this.fpsTimer += dt;
    if (this.settings.showFps && this.fpsTimer > 0.5) {
      this.fpsTimer = 0;
      this.ui.setFps(Math.round(this.loop.fps));
    }
    this.render.render();
  }

  private chaseInput(c: RaceCar) {
    const st = c.physics.state;
    return {
      position: st.position,
      heading: st.heading,
      velocity: st.velocity,
      speed: Math.sign(st.speed || 1) * Math.hypot(st.velocity.x, st.velocity.z),
      maxSpeed: getHandling(c.spec.id).maxSpeed,
      nitro: st.nitroActive,
      onGround: st.onGround,
      drifting: st.drifting,
    };
  }

  private updateCountdown(): void {
    if (this.state !== 'countdown') {
      if (this.lastCount !== 0 && this.lastCount !== -1) {
        this.ui.setCountdown('GO');
        this.audio.play('go');
        this.lastCount = -1;
        window.setTimeout(() => this.ui.setCountdown(null), 900);
      }
      return;
    }
    // ровный ритм 3-2-1-GO по секунде (первые 0.6 с — пауза на облёт камеры)
    const n = Math.ceil(this.countdownT);
    if (n >= 1 && n <= 3 && n !== this.lastCount) {
      this.lastCount = n;
      this.ui.setCountdown(n as 1 | 2 | 3);
      this.audio.play('countdown');
    }
  }

  /** Стартовый буст: газ точно на «GO» — короткий рывок */
  private judgeStart(c: RaceCar, controls: VehicleControls): void {
    if (this.state !== 'countdown' && this.state !== 'racing') return;
    const t = this.state === 'countdown' ? -this.countdownT : this.race?.raceTime ?? 0;
    const grade = this.startJudge.update(controls.throttle > 0.5, t);
    if (grade === 'perfect' || grade === 'good') {
      const [sec, power] = START_BOOST[grade];
      c.physics.applyBoost(sec, power);
      this.ui.popup(grade === 'perfect' ? 'ИДЕАЛЬНЫЙ СТАРТ' : 'ХОРОШИЙ СТАРТ', undefined, grade === 'perfect' ? 'yellow' : 'cyan');
    } else if (grade === 'early') {
      this.ui.popup('РАНО', 'жми газ на «GO»', 'orange');
    }
  }

  private updateHud(): void {
    const race = this.race;
    if (!race) return;
    const h = this.hud;
    const ps = this.player.physics.state;
    const st = race.standing(PLAYER_SLOT);
    // полная горизонтальная скорость: в заносе продольная составляющая падает, а машина — нет
    h.speedKmh = Math.hypot(ps.velocity.x, ps.velocity.z) * 3.6;
    h.nitro = ps.nitro;
    h.nitroActive = ps.nitroActive;
    h.lap = Math.min(LAPS, st.lap + 1);
    h.position = st.position;
    h.lapTime = st.currentLapTime;
    h.lastLap = st.lapTimes.length ? st.lapTimes[st.lapTimes.length - 1] : null;
    h.bestLap = st.bestLap;
    h.raceTime = race.raceTime;
    h.driftTotal = Math.round(this.drift.total);
    h.wrongWay = st.wrongWay && this.state === 'racing';
    // буст: новый — когда boostTime вырос; доля = остаток / полная длительность текущего буста
    if (ps.boostTime > this.boostPrev + 1e-4) this.audio.playBoost(ps.boostPower);
    this.boostPrev = ps.boostTime;
    const boostTotal = this.player.physics.boostDuration;
    h.boost = boostTotal > 0 ? Math.min(1, ps.boostTime / boostTotal) : 0;
    h.boostPower = ps.boostTime > 0 ? ps.boostPower : 0;
    this.audio.setBoostLevel(this.paused ? 0 : h.boostPower * h.boost);
    const dots = this.dots;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      let d = dots[i];
      if (!d) {
        d = { x: 0, z: 0, color: c.color, isPlayer: c.isPlayer };
        dots[i] = d;
      }
      d.x = c.renderPos.x;
      d.z = c.renderPos.z;
      d.color = c.color;
      d.isPlayer = c.isPlayer;
    }
    dots.length = this.cars.length;
    this.ui.updateHud(h);
  }

  /**
   * Для e2e/QA: прогнать симуляцию на `seconds` вперёд без рендера
   * (игрок на автопилоте). Позволяет проверить финиш гонки за секунды.
   */
  debugSimulate(seconds: number): void {
    if (!this.race) return;
    if (!this.playerAutopilot) this.playerAutopilot = new BotDriver(this.track, { ...BOT_PROFILES[0], name: 'AUTO', skill: 0.9 }, 7);
    const dt = 1 / 120;
    for (let t = 0; t < seconds && !this.resultsShown; t += dt) this.step(dt);
    if (this.cars.length) this.chase.snap(this.chaseInput(this.player));
  }

  /** Для e2e/QA */
  debugInfo() {
    const p = this.cars.length ? this.player.physics.state : null;
    return {
      state: this.state,
      paused: this.paused,
      uiMode: this.uiMode,
      backend: this.render.backendName,
      fps: Math.round(this.loop.fps),
      drawCalls: this.render.drawCalls(),
      quality: this.settings.quality,
      trackId: this.track.id,
      touchMode: this.touchMode,
      controlMode: this.settings.controlMode,
      speedKmh: p ? Math.round(Math.hypot(p.velocity.x, p.velocity.z) * 3.6) : 0,
      nitro: p ? p.nitro : 0,
      drifting: p ? p.drifting : false,
      lap: this.race ? this.race.standing(PLAYER_SLOT).lap : 0,
      position: this.race ? this.race.standing(PLAYER_SLOT).position : 0,
      raceTime: this.race ? this.race.raceTime : 0,
      driftTotal: Math.round(this.drift.total),
      result: this.lastResult,
    };
  }
}

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

/** Цвета «своей сборки» — только из палитры игры; чужие (например, из старого localStorage) заменяются */
function paletteSafe(b: CustomBuild): CustomBuild {
  return {
    ...b,
    bodyColor: CUSTOM_PALETTE.body.includes(b.bodyColor) ? b.bodyColor : DEFAULT_CUSTOM_BUILD.bodyColor,
    neonColor: CUSTOM_PALETTE.neon.includes(b.neonColor) ? b.neonColor : DEFAULT_CUSTOM_BUILD.neonColor,
  };
}
