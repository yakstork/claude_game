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
import { DEFAULT_CUSTOM_BUILD, loadCustomBuild, loadTrackIndex, saveTrackIndex, loadRecords, loadSettings, loadGhost, saveGhost, saveCustomBuild, saveRecords, saveSettings } from './storage';
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
import { updateSlipstream } from '../vehicle/slipstream';
import { CAR_GEOMETRY, BOT_PROFILES, CAR_SPECS, CUSTOM_PALETTE, specById } from '../vehicle/specs';
import { getHandling } from '../vehicle/handling';
import { GarageController } from './garageController';
import { CampaignController } from './campaignController';
import { DailyController } from './dailyController';
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
import type { CameraView, RaceMode } from './types';
import { GhostPlayer, GhostRecorder } from '../race/ghost';
import { Cup } from '../race/cup';
import { Elimination } from '../race/elimination';
import { CHALLENGE_DURATION, DriftChallenge, medalFor, medalThresholds, nextGoal, submitChallengeScore } from '../race/driftChallenge';
import { StuntScorer } from '../race/stunts';
import { PICKUP_TUNING, PickupSystem, type PickupKind } from '../race/pickups';
import { pickupLayoutFor } from '../world/pickups';
import { PickupMesh } from '../world/pickupMesh';
import { ACHIEVEMENTS, evaluate, loadProgress, saveProgress, type AchievementProgress } from '../race/achievements';
import { DIFFICULTY, applyDifficulty } from '../ai/difficulty';
import type { TrackInfo } from './types';
import { AudioManager } from '../audio/audioManager';
import { STATION_NAMES } from '../audio/theory';
import { RADIO_ORDER } from './types';
import { StartBoostJudge, START_BOOST } from './startBoost';
import { ReplayController } from './replayController';
import { SplitScreen } from './splitScreen';

export type GameState = 'loading' | 'menu' | 'countdown' | 'racing' | 'finished';

/** Потолок FPS на сенсорных устройствах */
export const MOBILE_MAX_FPS = 120;
/** Слот игрока на решётке в гонке с ботами */
const RACE_PLAYER_SLOT = 3;
/** Прозрачность призрака лучшего круга */
const GHOST_OPACITY = 0.32;
/** Тембр мотора по машине: [высота, рык] — V8 ниже и злее, гиперкар выше и чище */
const ENGINE_TONE: Record<string, [number, number]> = {
  razor: [1, 1],
  grizzly: [0.8, 1.7],
  photon: [1.2, 0.6],
  custom: [1.06, 1.1],
};
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
const _gPos = new Vector3();
const _gQuat = new Quaternion();

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
  uiMode: 'menu' | 'pause' | 'results' | 'replay' | 'photo' | null = null;
  /** Повтор гонки и фоторежим */
  readonly replay: ReplayController;
  /** Режим «2 игрока» (split-screen) */
  readonly split: SplitScreen;

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
  private readonly stunts = new StuntScorer();
  private pickups: PickupSystem | null = null;
  private pickupMesh: PickupMesh | null = null;
  private readonly onPickup = (kind: PickupKind, car: number, _index: number): void => this.handlePickup(kind, car);
  private lastStrikes = 0;
  /** Прогресс наград */
  private achievements: AchievementProgress = loadProgress();
  /** Текущий кубок (серия гонок), null — вне кубка */
  cup: Cup | null = null;
  /** Дрифт-вызов: таймер 90 с (только в режиме 'drift') */
  private challenge: DriftChallenge | null = null;
  /** Режимы без кругов: гонка идёт по таймеру, а не по дистанции */
  private get timedMode(): boolean {
    return this.mode === 'drift' || this.mode === 'elimination';
  }
  /** Выбывание: каждые N секунд вылетает последний */
  private elim: Elimination | null = null;
  /** Время гонки (с), на котором выбыла машина; индекс — машина */
  private elimTimes: number[] = [];
  private readonly elimProgress: number[] = [];
  /** Параметры текущей гонки (из настроек на момент старта) */
  laps = 3;
  playerSlot = RACE_PLAYER_SLOT;
  mode: RaceMode = 'race';
  /** Призрак лучшего круга: запись текущего круга, воспроизведение рекорда, модель */
  private readonly ghostRec = new GhostRecorder();
  private ghost: GhostPlayer | null = null;
  private ghostModel: CarModel | null = null;
  private ghostKey = '';
  private ghostBeaten = false;
  /** Карьера: кредиты, улучшения, цвета */
  private readonly garageCtl: GarageController;
  /** Кампания «Неоновая лига» (src/core/campaignController.ts) */
  private readonly campaignCtl: CampaignController;
  /** Вызов дня (src/core/dailyController.ts) */
  private readonly dailyCtl: DailyController;
  /** Модификатор «нитро только с канистр»: допустимый запас нитро игрока */
  private dailyNitro = 0;
  private readonly trackLengths = new Map<string, number>();
  /** Статистика гонки игрока (для наград) */
  private stats = { bestCombo: 0, wallHits: 0, perfectStart: false, ghostRecord: false };

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
    // карьера: цвета заводских машин и улучшения (src/core/garageController.ts)
    this.garageCtl = new GarageController(CAR_SPECS, {
      preview: (i) => this.setPreviewCar(i),
      recolored: (i) => {
        this.ui.updateCarSpec(i, CAR_SPECS[i]);
        if (this.state === 'menu') this.setPreviewCar(i);
      },
      sound: (k) => this.audio.play(k === 'move' ? 'uiMove' : k === 'select' ? 'uiSelect' : 'uiBack'),
    });
    this.campaignCtl = new CampaignController(
      {
        settings: () => this.settings,
        setTempSettings: (s) => this.applySettings(s, false),
        restoreSettings: (saved) =>
          this.applySettings(
            { ...this.settings, raceMode: saved.raceMode, laps: saved.laps, difficulty: saved.difficulty, timeOfDay: saved.timeOfDay },
            true,
          ),
        setTrack: (id) => {
          const i = TRACKS.findIndex((t) => t.id === id);
          if (i >= 0) this.switchTrack(i);
        },
        carIndex: (id) => CAR_SPECS.findIndex((c) => c.id === id),
        selectedCar: () => this.selectedCar,
        startRace: (i) => {
          this.cup = null;
          this.startRace(i);
        },
        sound: (k) => this.audio.play(k === 'move' ? 'uiMove' : k === 'select' ? 'uiSelect' : 'uiBack'),
      },
      this.garageCtl,
    );
    this.dailyCtl = new DailyController(
      {
        settings: () => this.settings,
        // подмена без сохранения в localStorage; время суток применяем к миру сразу
        applyTemp: (s) => {
          this.settings = s;
          this.world.setTimeOfDay(s.timeOfDay);
        },
        restoreSettings: (saved) =>
          this.applySettings({ ...this.settings, raceMode: saved.raceMode, laps: saved.laps, difficulty: saved.difficulty, timeOfDay: saved.timeOfDay }, true),
        setTrack: (id) => {
          const i = TRACKS.findIndex((t) => t.id === id);
          if (i >= 0) this.switchTrack(i);
        },
        carIndex: (id) => CAR_SPECS.findIndex((c) => c.id === id),
        selectedCar: () => this.selectedCar,
        startRace: (i) => {
          this.cup = null;
          this.startRace(i);
        },
        trackName: (id) => TRACKS.find((t) => t.id === id)?.name ?? id,
        carName: (id) => CAR_SPECS.find((c) => c.id === id)?.name ?? id,
        sound: (k) => this.audio.play(k === 'move' ? 'uiMove' : k === 'select' ? 'uiSelect' : 'uiBack'),
      },
      this.garageCtl,
      {
        trackIds: TRACKS.map((t) => t.id ?? t.name),
        carIds: CAR_SPECS.filter((c) => c.id !== CUSTOM_CAR_ID).map((c) => c.id),
        trackLength: (id) => {
          let L = this.trackLengths.get(id);
          if (L === undefined) {
            const def = TRACKS.find((t) => t.id === id);
            L = def ? new Track(def).length : 2000;
            this.trackLengths.set(id, L);
          }
          return L;
        },
      },
    );
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
      garage: { api: this.garageCtl, cars: CAR_SPECS.map((c) => ({ id: c.id, name: c.name, custom: c.id === CUSTOM_CAR_ID })) },
      campaign: this.campaignCtl,
      daily: this.dailyCtl,
      callbacks: {
        onRadio: () => this.cycleRadio(),
        onCampaignMap: () => {
          this.enterMenu();
          this.ui.showCampaign();
        },
        onPreviewCar: (i) => this.setPreviewCar(i),
        onStartRace: (i) => {
          this.cup = null;
          this.startRace(i);
        },
        onSettingsChanged: (s) => this.applySettings(s, true),
        onPause: () => this.pause(),
        onResume: () => this.resume(),
        onRestart: () => this.restartOrNext(),
        onQuitToMenu: () => this.enterMenu(),
        onUiSound: (k) => this.audio.play(k === 'move' ? 'uiMove' : k === 'select' ? 'uiSelect' : 'uiBack'),
        onCustomBuildChanged: (b) => this.applyCustomBuild(b),
        onSelectTrack: (i) => this.selectTrack(i),
        onReplay: () => this.replay.startReplay(),
        onPhoto: () => this.paused && this.replay.startPhoto('pause'),
        onFirstInteraction: () => {
          void this.audio.unlock();
        },
      },
    });

    this.split = new SplitScreen(this.ui.layer, this.camera);
    this.split.onFovScale = (k) => (this.chase.fovScale = k);
    this.replay = new ReplayController(
      this,
      {
        enter: (kind) => {
          this.ui.hideAll();
          this.uiMode = kind;
          this.audio.updateEngine(null);
          if (this.ghostModel) this.ghostModel.group.visible = false;
        },
        leave: (to) => {
          this.input.clear();
          if (to === 'results') {
            this.uiMode = 'results';
            this.ui.restoreResults();
          } else {
            this.uiMode = 'pause';
            this.ui.showPause();
          }
        },
      },
      this.ui.layer,
    );

    this.ui.setAchievements(ACHIEVEMENTS.map((a) => ({ id: a.id, title: a.title, desc: a.desc, icon: a.icon, tone: a.tone })));
    this.ui.setUnlocked(this.achievements.unlocked);

    this.hud = {
      speedKmh: 0,
      nitro: 0,
      nitroActive: false,
      lap: 1,
      totalLaps: 3,
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
      delta: null,
      slipstream: 0,
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

  /** Смена трассы между гонками кубка (вне меню) */
  private switchTrack(i: number): void {
    if (i < 0 || i >= TRACKS.length || i === this.trackIndex) return;
    this.trackIndex = i;
    this.track = new Track(TRACKS[i]);
    this.world.setTrack(this.track);
    this.world.setQuality(this.settings.quality);
    this.ui.setTrackIndex(i);
  }

  /** «Ещё раз» на результатах: в кубке — следующая гонка серии */
  private restartOrNext(): void {
    if (this.cup?.finished) this.cup = null;
    this.startRace(this.selectedCar);
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

  /** Радио: следующая станция (клавиша M, кнопка геймпада LB, тап по названию в HUD) */
  cycleRadio(): void {
    const i = RADIO_ORDER.indexOf(this.settings.radio);
    const next = RADIO_ORDER[(i + 1) % RADIO_ORDER.length];
    this.applySettings({ ...this.settings, radio: next }, true);
    this.audio.setRadio(next, true);
    this.ui.banner(`РАДИО · ${this.audio.radioLabel()}`, 'cyan');
  }

  applySettings(s: Settings, persist: boolean): void {
    this.settings = { ...this.campaignCtl.impose(s) };
    this.touchMode = resolveTouchMode(s.controlMode, isTouchDevice());
    this.ui.setTouchMode(this.touchMode);
    this.ui.setTouchLayout(s.touchSize, s.touchOpacity);
    this.input.setTouchSource(this.touchMode ? this.ui.touchState : null);
    this.audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume);
    this.chase.view = s.cameraView;
    this.render.setQuality(s.quality);
    this.world.setQuality(s.quality);
    this.world.setTimeOfDay(s.timeOfDay);
    this.audio.setRadio(s.radio);
    this.ui.setRadio(STATION_NAMES[s.radio]);
    this.world.setWeather(s.weather);
    this.previewModel?.setHeadlights(this.world.headlights, s.quality === 'high');
    this.effects.density = s.quality === 'high' ? 1 : 0.5;
    this.camera.far = s.quality === 'high' ? 2000 : 1600;
    this.camera.updateProjectionMatrix();
    this.ui.setFps(s.showFps ? Math.round(this.loop?.fps ?? 60) : null);
    // пока идёт событие кампании, временные режим/круги/сложность/время суток не сохраняются
    if (persist) saveSettings(this.campaignCtl.persistable(this.settings));
  }

  // ─── Меню ──────────────────────────────────────────────────────────────

  enterMenu(): void {
    this.campaignCtl.end();
    this.dailyCtl.end();
    this.cup = null;
    this.audio.setAmbience(null);
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
    model.setHeadlights(this.world.headlights, this.settings.quality === 'high');
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
    this.replay.leaveSilently();
    this.split.reset();
    this.cars = [];
    this.states.length = 0;
    this.physicsList.length = 0;
    this.race = null;
    this.playerAutopilot = null;
    if (this.ghostModel) {
      this.scene.remove(this.ghostModel.group);
      this.ghostModel.dispose();
      this.ghostModel = null;
    }
    this.ghost = null;
    this.effects.clear();
    if (this.pickupMesh) {
      this.scene.remove(this.pickupMesh.group);
      this.pickupMesh.dispose();
      this.pickupMesh = null;
    }
    this.pickups = null;
    if (this.previewModel) this.scene.remove(this.previewModel.group);
  }

  /** Пластина — буст (звук игроку даёт HUD по росту boostTime); канистра — звук только игроку */
  private handlePickup(kind: PickupKind, car: number): void {
    const c = this.cars[car];
    if (!c) return;
    if (kind === 'pad') {
      const dbl = this.dailyCtl.modifier === 'doubleBoost';
      c.physics.applyBoost(PICKUP_TUNING.padBoostSeconds * (dbl ? 2 : 1), Math.min(1, PICKUP_TUNING.padBoostPower * (dbl ? 1.5 : 1)));
    } else if (c.isPlayer) {
      this.dailyNitro = Math.min(1, this.dailyNitro + PICKUP_TUNING.canNitro);
      this.audio.play('nitroStart');
    }
  }

  startRace(carIndex: number): void {
    // сид гонки: у ботов разные «настроение», ошибки и решения о заносе в каждой гонке (?seed= — воспроизвести)
    const urlSeed = Number(new URLSearchParams(location.search).get('seed') ?? NaN);
    const raceSeed = Number.isFinite(urlSeed) ? urlSeed : Math.floor(Math.random() * 100000);
    this.clearRace();
    this.selectedCar = Math.min(CAR_SPECS.length - 1, Math.max(0, carIndex));
    const playerSpec = CAR_SPECS[this.selectedCar];
    const urlMode = new URLSearchParams(location.search).get('mode');
    this.mode = urlMode === 'versus' ? 'versus' : this.settings.raceMode;
    const versus = this.mode === 'versus';
    if (this.mode !== 'cup') this.cup = null;
    else if (this.cup) this.switchTrack(this.cup.nextTrack);
    this.laps = this.timedMode ? 999 : this.settings.laps;
    const solo = this.mode === 'timeAttack' || this.mode === 'drift';
    this.challenge = this.mode === 'drift' ? new DriftChallenge() : null;
    this.elim = null;
    this.elimTimes = [];
    this.playerSlot = solo ? 0 : versus ? 2 : RACE_PLAYER_SLOT;
    const p2Spec = CAR_SPECS[(this.selectedCar + 1) % CAR_SPECS.length];
    this.difficulty = DIFFICULTY[this.settings.difficulty];

    // решётка: 0–2 сильные боты, 3 — игрок, 4–5 — остальные; заезд на время — только игрок
    const bots = BOT_PROFILES.map((b) => applyDifficulty(b, this.settings.difficulty));
    const order: (BotProfile | null)[] = solo ? [null] : versus ? [bots[0], bots[1], null, bots[2], null, bots[3]] : [bots[0], bots[1], bots[2], null, bots[3], bots[4]];
    order.forEach((profile, slot) => {
      const isP2 = versus && !profile && slot !== this.playerSlot;
      const spec: CarSpec = profile ? { ...specById(profile.carId), bodyColor: profile.bodyColor, neonColor: profile.neonColor, livery: undefined } : isP2 ? p2Spec : playerSpec;
      const physics = new VehiclePhysics(spec, this.track);
      const pose = this.track.gridPose(slot);
      physics.reset(pose.position, pose.heading, pose.s);
      physics.frozen = true;
      const model = new CarModel(spec);
      this.scene.add(model.group);
      const car: RaceCar = {
        name: profile ? profile.name : versus ? (isP2 ? 'ИГРОК 2' : 'ИГРОК 1') : 'ВЫ',
        spec,
        physics,
        model,
        bot: profile ? new BotDriver(this.track, profile, raceSeed + slot * 77) : null,
        color: profile ? cssColor(profile.bodyColor) : isP2 ? cssColor(PALETTE.pink) : cssColor(PALETTE.white),
        isPlayer: !profile,
        prevPos: physics.state.position.clone(),
        prevQuat: physics.state.quaternion.clone(),
        renderPos: physics.state.position.clone(),
        renderQuat: physics.state.quaternion.clone(),
        roadHeight: pose.position.y,
      };
      if (!profile) this.garageCtl.applyToPhysics(physics, spec.id);
      this.cars.push(car);
    });
    for (const c of this.cars) {
      this.states.push(c.physics.state);
      this.physicsList.push(c.physics);
    }
    if (this.mode === 'elimination') this.elim = new Elimination(this.cars.length, this.playerSlot);
    this.race = new RaceManager(
      this.track,
      this.cars.map((c) => ({ name: c.name, isPlayer: c.isPlayer })),
      this.laps,
    );
    if (this.opts.autopilot) {
      this.playerAutopilot = new BotDriver(this.track, { ...BOT_PROFILES[0], name: 'AUTO', skill: 0.9 }, 7);
    }
    this.drift.reset();
    this.effects.clear();
    this.replay.begin(this.states);
    this.split.begin(versus, this.playerSlot, 4);
    this.hitWallThisStep = false;
    this.setupGhost(playerSpec);
    this.stunts.reset();
    this.dailyNitro = 0;
    if (this.dailyCtl.modifier === 'nitroCans') this.player.physics.state.nitro = 0;
    this.pickups = new PickupSystem(this.track, pickupLayoutFor(this.track.id));
    this.pickupMesh = new PickupMesh(this.track, this.pickups);
    for (const c of this.cars) c.bot?.setPads(this.pickups.padS, this.pickups.padLateral);
    this.playerAutopilot?.setPads(this.pickups.padS, this.pickups.padLateral);
    this.scene.add(this.pickupMesh.group);
    this.stats = { bestCombo: 0, wallHits: 0, perfectStart: false, ghostRecord: false };
    const [ePitch, eGrowl] = ENGINE_TONE[playerSpec.id] ?? ENGINE_TONE.custom;
    this.audio.setEngineProfile(ePitch, eGrowl);
    this.chase.view = this.settings.cameraView;
    this.split.chase2.view = this.settings.cameraView;

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
    this.audio.setMusicIntensity(this.laps === 1 ? 1 : 0);
    this.audio.setAmbience(this.world.ambience);
    this.lastStrikes = this.world.lightningStrikes;
    this.ui.showRaceHud(this.track.outline(256));
    this.hud.totalRacers = this.cars.length;
    if (this.mode === 'cup') {
      this.cup ??= new Cup(
        this.cars.map((c) => ({ name: c.name, isPlayer: c.isPlayer, color: c.color })),
        TRACKS.length,
        this.trackIndex,
        TRACKS.length,
      );
      const cup = this.cup;
      window.setTimeout(() => this.state === 'countdown' && this.ui.banner(`КУБОК · ГОНКА ${cup.round + 1}/${cup.rounds}`, 'yellow'), 300);
    }
    this.hud.totalLaps = this.laps;
    this.hud.delta = null;
    if (this.mode === 'elimination') {
      window.setTimeout(() => this.state === 'countdown' && this.ui.banner('ВЫБЫВАНИЕ · ПОСЛЕДНИЙ ВЫЛЕТАЕТ', 'orange'), 300);
    } else if (this.mode === 'drift') {
      window.setTimeout(() => this.state === 'countdown' && this.ui.banner(`ДРИФТ-ВЫЗОВ · ${CHALLENGE_DURATION} С`, 'pink'), 300);
    } else if (solo) {
      const best = this.ghost ? `  ·  РЕКОРД ${formatTime(this.ghost.lapTime)}` : '';
      window.setTimeout(() => this.state === 'countdown' && this.ui.banner(`ЗАЕЗД НА ВРЕМЯ${best}`, 'cyan'), 300);
    }
    this.input.clear();
    const p = this.player;
    this.chase.snap(this.chaseInput(p));
  }

  get player(): RaceCar {
    return this.cars[this.playerSlot];
  }

  get playerIndex(): number {
    return this.playerSlot;
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
    if (this.paused || !this.race || this.replay.takesOver) return;
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
    const playerProgress = race.progress(this.playerSlot);
    for (let i = 0; i < this.cars.length; i++) {
      if (this.elim?.isOut(i)) continue;
      const c = this.cars[i];
      c.prevPos.copy(c.physics.state.position);
      c.prevQuat.copy(c.physics.state.quaternion);
      let controls: VehicleControls;
      if (this.split.active && c.isPlayer) {
        controls = this.split.controls(i, dt, c.physics.state, c.spec, this.states, this.track);
        if (this.state === 'countdown') controls = NO_CONTROLS;
      } else if (c.isPlayer) {
        if (this.state === 'finished' || this.playerAutopilot) {
          if (!this.playerAutopilot) {
            this.playerAutopilot = new BotDriver(this.track, { ...BOT_PROFILES[2], name: 'AUTO' }, 5);
            if (this.pickups) this.playerAutopilot.setPads(this.pickups.padS, this.pickups.padLateral);
          }
          controls = this.playerAutopilot.update(dt, c.physics.state, c.spec, this.states);
        } else {
          controls = this.input.controls(dt);
          this.judgeStart(c, controls);
        }
      } else if (c.bot) {
        controls = this.state === 'countdown' ? NO_CONTROLS : c.bot.update(dt, c.physics.state, c.spec, this.states);
        c.physics.powerScale = (this.state === 'racing' ? rubberBandFactor(race.progress(i), playerProgress, this.track.length) : 1) * this.difficulty.power;
      } else {
        controls = NO_CONTROLS;
      }
      c.physics.step(dt, controls);
      // «нитро только с канистр»: запас растёт лишь от подбора (см. handlePickup), от заноса и слипстрима — нет
      if (c.isPlayer && this.dailyCtl.modifier === 'nitroCans') {
        const st = c.physics.state;
        if (st.nitro > this.dailyNitro) st.nitro = this.dailyNitro;
        else this.dailyNitro = st.nitro;
      }
    }
    resolveCarCollisions(this.physicsList);
    updateSlipstream(this.states, dt);
    this.replay.record(dt);
    if (this.state === 'racing') this.pickups?.update(dt, this.states, this.onPickup);

    // события физики
    this.hitWallThisStep = false;
    for (let i = 0; i < this.cars.length; i++) {
      if (this.elim?.isOut(i)) continue;
      const c = this.cars[i];
      for (const ev of c.physics.events) {
        const near = c.isPlayer || c.physics.state.position.distanceToSquared(player.physics.state.position) < 60 * 60;
        if (ev.type === 'wall') {
          this.effects.hit(i, ev.strength);
          if (ev.strength > 0.08 && near) this.effects.sparksAt(ev.point, c.physics.state.velocity, ev.strength);
          if (c.isPlayer) {
            if (ev.strength > 0.12) {
              this.audio.play('hit');
              vibrate(Math.round(18 + ev.strength * 45));
              this.chase.kick(ev.strength * 0.8);
            }
            this.hitWallThisStep = this.hitWallThisStep || ev.strength > 0.15;
            if (ev.strength > 0.15 && this.state === 'racing') this.stats.wallHits += 1;
          }
        } else if (ev.type === 'car') {
          this.effects.hit(i, ev.strength);
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
    if (this.elim && this.state === 'racing') this.stepElimination(dt, race);
    for (const ev of race.events) {
      if (this.split.active) {
        if (this.split.onRaceEvent(ev)) {
          this.state = 'finished';
          this.finishT = 0;
          this.audio.play('finish');
        }
        continue;
      }
      if (ev.car !== this.playerSlot) continue;
      if (this.timedMode) continue;
      if (ev.type === 'lap') {
        this.onPlayerLap(ev.lapTime);
        this.audio.play('lap');
        if (ev.lap === this.laps - 1) this.audio.setMusicIntensity(1);
        if (ev.lap < this.laps) {
          this.ui.banner(ev.lap === this.laps - 1 ? 'ФИНАЛЬНЫЙ КРУГ' : `КРУГ ${ev.lap + 1}/${this.laps}`, ev.lap === this.laps - 1 ? 'orange' : 'cyan');
        }
        if (this.ghostBeaten) this.ui.popup('РЕКОРД КРУГА', formatTime(ev.lapTime), 'yellow');
        else if (ev.isBest && ev.lap > 1) this.ui.popup('ЛУЧШИЙ КРУГ', formatTime(ev.lapTime), 'yellow');
        this.ghostBeaten = false;
      } else if (ev.type === 'finish') {
        this.state = 'finished';
        this.finishT = 0;
        for (const d of this.drift.flush()) {
          if (d.type === 'comboEnd') this.ui.popup(d.label, `+${d.points.toLocaleString('ru-RU')}`, 'pink');
        }
        this.audio.play('finish');
        if (this.mode === 'timeAttack') this.ui.banner('ФИНИШ', 'cyan');
        else this.ui.banner(ev.position === 1 ? 'ПОБЕДА!' : `ФИНИШ · ${ev.position}-Е МЕСТО`, ev.position === 1 ? 'yellow' : 'pink');
      }
    }

    if (this.state === 'racing') {
      const ps = player.physics.state;
      // трюки: прыжки с трамплинов — очки и немного нитро
      const sev = this.stunts.update(dt, ps);
      for (let k = 0; k < sev.length; k++) {
        const e = sev[k];
        if (e.hard) {
          this.ui.popup('ЖЁСТКАЯ ПОСАДКА', undefined, 'orange');
          continue;
        }
        ps.nitro = Math.min(1, ps.nitro + e.nitro);
        this.drift.total += e.points;
        this.ui.popup(e.perfect ? `${e.label} · PERFECT` : e.label, `+${Math.round(e.points).toLocaleString('ru-RU')}`, e.perfect ? 'yellow' : 'cyan');
        if (e.perfect) this.audio.play('combo');
      }
      this.ghostRec.record(race.standing(this.playerSlot).currentLapTime, ps.position, ps.quaternion, this.lapDistance());
    }

    if (this.state === 'racing') {
      for (const ev of this.drift.update(dt, player.physics.state, this.hitWallThisStep)) {
        if (ev.type === 'comboEnd') {
          this.stats.bestCombo = Math.max(this.stats.bestCombo, ev.points);
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

    const chal = this.challenge;
    if (chal && this.state === 'racing' && chal.update(dt)) {
      this.state = 'finished';
      this.finishT = 0;
      for (const d of this.drift.flush()) {
        if (d.type === 'comboEnd') this.ui.popup(d.label, `+${d.points.toLocaleString('ru-RU')}`, 'pink');
      }
      this.audio.play('finish');
      this.ui.banner('ВРЕМЯ!', 'pink');
    }

    if (this.state === 'finished') {
      this.finishT += dt;
      if (this.finishT > 2.6 && !this.resultsShown) this.showResults();
    }
  }

  private showResults(): void {
    if (!this.race) return;
    this.resultsShown = true;
    this.replay.stopRecording();
    if (this.split.active) {
      this.lastResult = this.split.buildResult(this.race, this.cars, CAR_SPECS[this.selectedCar].id);
      this.uiMode = 'results';
      this.ui.showResults(this.lastResult);
      return;
    }
    const race = this.race;
    const player = race.standing(this.playerSlot);
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
    if (this.elim) this.fillEliminationRows(rows, this.elim, race);
    const playerPos = rows.find((r) => r.isPlayer)?.position ?? player.position;
    const carId = CAR_SPECS[this.selectedCar].id;
    const rec = this.records;
    const time = this.challenge ? this.challenge.duration : this.elim ? (this.elimTimes[this.playerSlot] ?? this.elim.time) : (player.finishTime ?? race.raceTime);
    // рекорды — по трассе и машине; для Sunset Loop учитываем и старые ключи без трассы
    const key = recordKey(this.track.id, carId);
    const legacy = this.track.id === 'sunset' ? carId : null;
    const prevLap = rec.bestLap[key] ?? (legacy ? rec.bestLap[legacy] : undefined);
    const prevRace = rec.bestRace[key] ?? (legacy ? rec.bestRace[legacy] : undefined);
    const newBestLap = !this.timedMode && player.bestLap !== null && (prevLap === undefined || player.bestLap < prevLap);
    // рекорд гонки — только для стандартной дистанции в 3 круга
    const newBestRace = !this.timedMode && this.laps === 3 && (prevRace === undefined || time < prevRace);
    const newBestDrift = this.drift.total > rec.bestDrift;
    if (newBestLap && player.bestLap !== null) rec.bestLap[key] = player.bestLap;
    if (newBestRace) rec.bestRace[key] = time;
    if (newBestDrift) rec.bestDrift = Math.round(this.drift.total);
    rec.races += 1;
    if (playerPos === 1 && this.mode === 'race') rec.wins += 1;
    // дрифт-вызов: рекорд очков по трассе и машине, медаль по порогам трассы
    let challenge: RaceResult['challenge'];
    if (this.mode === 'drift') {
      const score = Math.round(this.drift.total);
      const sub = submitChallengeScore(this.track.id, carId, score);
      challenge = { medal: medalFor(score, this.track.id), thresholds: medalThresholds(this.track.id), previous: sub.previous, isRecord: sub.isRecord };
    }
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
      solo: this.mode === 'timeAttack',
      challenge,
      elimination: this.elim !== null,
      lapTimes: player.lapTimes.slice(),
      cup: this.cup && !this.cup.finished ? this.cup.addRace(rows.map((r) => r.name)) : undefined,
    };
    result.credits = this.garageCtl.awardRace({
      mode: this.mode,
      difficulty: this.settings.difficulty,
      position: playerPos,
      racers: this.cars.length,
      laps: this.laps,
      driftScore: result.driftScore,
      newBestLap,
      newBestRace,
      newBestDrift,
      cupWon: result.cup?.finished === true && result.cup.rows.find((r) => r.isPlayer)?.position === 1,
    });
    this.campaignCtl.finish(result, { position: playerPos, bestLap: player.bestLap, driftScore: result.driftScore });
    this.dailyCtl.finish(result, { position: playerPos, bestLap: player.bestLap, driftScore: result.driftScore, wallHits: this.stats.wallHits });
    this.ui.syncCredits();
    this.lastResult = result;
    this.uiMode = 'results';
    // награды: по итогам гонки
    const cupRow = result.cup?.finished ? result.cup.rows.find((r) => r.isPlayer) : undefined;
    const ach = evaluate(
      {
        mode: this.mode === 'versus' ? 'race' : this.mode,
        difficulty: this.settings.difficulty,
        trackId: this.track.id,
        position: playerPos,
        racers: this.cars.length,
        driftScore: result.driftScore,
        bestCombo: this.stats.bestCombo,
        perfectStart: this.stats.perfectStart,
        wallHits: this.stats.wallHits,
        // «рекорд круга» — только когда прежний рекорд был и побит
        newBestLap: this.stats.ghostRecord || (newBestLap && prevLap !== undefined),
        cupWon: cupRow?.position === 1,
      },
      this.achievements,
    );
    this.achievements = ach.progress;
    saveProgress(ach.progress);
    this.ui.setUnlocked(ach.progress.unlocked);
    this.ui.showResults(result, ach.unlocked);
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
      else if (a === 'reset' && this.state === 'racing') this.respawnAtCheckpoint(this.player, this.playerSlot);
      else if (a === 'camera' && this.cars.length) this.cycleCamera();
      else if (a === 'radio' && this.cars.length) this.cycleRadio();
    }
  }

  private frame(dt: number, alpha: number): void {
    this.handleActions(this.input.consumeActions());

    if (this.replay.takesOver) {
      this.split.syncAspect(false);
      this.replay.frame(dt);
      this.audio.updateEngine(null);
      this.render.render();
      this.replay.afterRender();
      return;
    }

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
        c.model.damage = this.effects.damageLevel(i);
        c.model.update(st, c.roadHeight, this.paused ? 0 : dt);
        c.model.setHeadlights(this.world.headlights, this.settings.quality === 'high');
        c.model.group.position.copy(c.renderPos);
        c.model.group.quaternion.copy(c.renderQuat);
        if (!this.paused) this.effects.updateCar(i, st, dt);
      }
      this.updateGhostModel();
      const p = this.player;
      if (!this.paused) {
        const inp = this.chaseInput(p);
        inp.position = p.renderPos;
        this.chase.update(dt, inp);
      }
      if (this.split.active && (!this.paused || this.state === 'countdown')) {
        const c2 = this.cars[this.split.slots[1]];
        const inp2 = this.chaseInput(c2);
        inp2.position = c2.renderPos;
        this.split.updateCamera2(dt, inp2);
      }
      if (this.replay.photo) this.replay.updatePhoto(dt);
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
    if (player && !this.paused) speedLines = player.nitroActive ? 1 : Math.max(player.slipstream * 0.7, Math.min(0.5, Math.max(0, (Math.abs(player.speed) - 55) / 30)));
    this.effects.setWet(this.world.ambience === 'rain' ? 1 : 0);
    this.effects.update(this.paused ? 0 : dt, this.camera, player ? Math.abs(player.speed) : 0, speedLines);

    this.world.update(this.camera.position);
    if (!this.paused) this.pickupMesh?.update(dt);
    this.render.setNeonBoost(this.world.headlights);
    // гром — с задержкой после вспышки молнии (звук идёт медленнее света)
    const strikes = this.world.lightningStrikes;
    if (strikes !== this.lastStrikes) {
      this.lastStrikes = strikes;
      if (this.cars.length && !this.paused) window.setTimeout(() => this.audio.thunder(0.4 + Math.random() * 0.6), 300 + Math.random() * 2500);
    }

    this.fpsTimer += dt;
    if (this.settings.showFps && this.fpsTimer > 0.5) {
      this.fpsTimer = 0;
      this.ui.setFps(Math.round(this.loop.fps));
    }
    const splitView = this.split.active && !this.replay.photo && this.cars.length > 0;
    this.split.syncAspect(splitView);
    this.split.updateHud(splitView && (this.uiMode === null || this.uiMode === 'pause') && this.state !== 'menu', this.race, this.states, this.laps);
    if (splitView) this.render.renderSplit(this.camera, this.split.camera2);
    else this.render.render();
    this.replay.afterRender();
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
      if (grade === 'perfect') this.stats.perfectStart = true;
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
    const st = race.standing(this.playerSlot);
    // полная горизонтальная скорость: в заносе продольная составляющая падает, а машина — нет
    h.speedKmh = Math.hypot(ps.velocity.x, ps.velocity.z) * 3.6;
    h.nitro = ps.nitro;
    h.nitroActive = ps.nitroActive;
    h.lap = Math.min(this.laps, st.lap + 1);
    h.position = st.position;
    h.lapTime = st.currentLapTime;
    h.lastLap = st.lapTimes.length ? st.lapTimes[st.lapTimes.length - 1] : null;
    h.bestLap = st.bestLap;
    h.raceTime = race.raceTime;
    h.driftTotal = Math.round(this.drift.total);
    h.wrongWay = st.wrongWay && this.state === 'racing';
    const gt = this.ghost && this.state === 'racing' ? this.ghost.timeAtDistance(this.lapDistance()) : null;
    h.delta = gt !== null && st.currentLapTime > 1 ? st.currentLapTime - gt : null;
    // буст: новый — когда boostTime вырос; доля = остаток / полная длительность текущего буста
    if (ps.boostTime > this.boostPrev + 1e-4) this.audio.playBoost(ps.boostPower);
    this.boostPrev = ps.boostTime;
    const boostTotal = this.player.physics.boostDuration;
    h.boost = boostTotal > 0 ? Math.min(1, ps.boostTime / boostTotal) : 0;
    h.boostPower = ps.boostTime > 0 ? ps.boostPower : 0;
    h.slipstream = this.state === 'racing' ? ps.slipstream : 0;
    this.updateChallengeHud(h);
    this.audio.setBoostLevel(this.paused ? 0 : h.boostPower * h.boost);
    const dots = this.dots;
    let nd = 0;
    for (let i = 0; i < this.cars.length; i++) {
      if (this.elim?.isOut(i)) continue;
      const c = this.cars[i];
      let d = dots[nd];
      if (!d) {
        d = { x: 0, z: 0, color: c.color, isPlayer: c.isPlayer };
        dots[nd] = d;
      }
      nd += 1;
      d.x = c.renderPos.x;
      d.z = c.renderPos.z;
      d.color = c.color;
      d.isPlayer = c.isPlayer;
    }
    dots.length = nd;
    this.ui.updateHud(h);
  }

  /** Результаты выбывания: оставшиеся по прогрессу, затем выбывшие с конца; время — момент выбывания */
  private fillEliminationRows(rows: ResultRow[], elim: Elimination, race: RaceManager): void {
    const alive: number[] = [];
    for (let i = 0; i < this.cars.length; i++) if (!elim.isOut(i)) alive.push(i);
    alive.sort((a, b) => race.progress(b) - race.progress(a));
    const order = alive.concat(elim.order.slice().reverse());
    rows.length = 0;
    order.forEach((ci, k) => {
      const c = this.cars[ci];
      rows.push({ position: k + 1, name: c.name, color: c.color, isPlayer: c.isPlayer, time: this.elimTimes[ci] ?? elim.time, projected: false, bestLap: null });
    });
  }

  /** Выбывание: шаг таймера, эффект и надпись, конец гонки */
  private stepElimination(dt: number, race: RaceManager): void {
    const elim = this.elim;
    if (!elim) return;
    const prog = this.elimProgress;
    for (let i = 0; i < this.cars.length; i++) prog[i] = race.progress(i);
    const out = elim.update(dt, prog);
    if (out < 0) return;
    const car = this.cars[out];
    this.elimTimes[out] = elim.time;
    const p = car.physics.state.position;
    for (let k = 0; k < 4; k++) this.effects.sparksAt(p, car.physics.state.velocity, 2);
    car.model.group.visible = false;
    car.physics.frozen = true;
    const li = this.physicsList.indexOf(car.physics);
    if (li >= 0) this.physicsList.splice(li, 1);
    this.audio.play('comboLost');
    if (car.isPlayer) {
      this.ui.banner('ВЫ ВЫБЫЛИ', 'pink');
    } else {
      this.ui.banner(`ВЫБЫЛ: ${car.name}`, 'orange');
    }
    if (elim.over) {
      this.state = 'finished';
      this.finishT = 0;
      if (elim.playerWon) {
        this.audio.play('finish');
        this.ui.banner('ПОБЕДА!', 'yellow');
      }
    }
  }

  /** Место игрока среди оставшихся: 1 + число живых впереди */
  private elimRank(elim: Elimination): number {
    const race = this.race;
    if (!race) return 1;
    const mine = race.progress(this.playerSlot);
    let rank = 1;
    for (let i = 0; i < this.cars.length; i++) if (i !== this.playerSlot && !elim.isOut(i) && race.progress(i) > mine) rank += 1;
    return rank;
  }

  /** Таймер и цель режима в HUD */
  private updateChallengeHud(h: HudData): void {
    const chal = this.challenge;
    if (chal) {
      h.challengeTime = chal.remaining;
      h.challengeLabel = 'ДРИФТ-ВЫЗОВ';
      const goal = nextGoal(this.drift.total, this.track.id);
      h.challengeGoal = goal ? `${goal.medal === 'bronze' ? 'БРОНЗА' : goal.medal === 'silver' ? 'СЕРЕБРО' : 'ЗОЛОТО'} ${goal.points}` : 'ЗОЛОТО ВЗЯТО';
      h.totalRacers = 1;
    } else if (this.elim) {
      const elim = this.elim;
      const rank = elim.over ? elim.playerPlace : this.elimRank(elim);
      h.challengeTime = elim.over ? 0 : elim.timeToNext;
      h.challengeLabel = 'ВЫБЫВАНИЕ ЧЕРЕЗ';
      h.challengeGoal = elim.over ? '' : rank === elim.aliveCount && elim.aliveCount > 1 ? 'ТЫ ПОСЛЕДНИЙ!' : `В ГОНКЕ ${elim.aliveCount}/${elim.count}`;
      h.position = rank;
      h.totalRacers = elim.aliveCount;
    } else {
      h.challengeTime = undefined;
      h.challengeLabel = undefined;
      h.challengeGoal = undefined;
    }
  }

  // ─── Призрак лучшего круга и камера ────────────────────────────────────

  private difficulty = DIFFICULTY.normal;

  private setupGhost(spec: CarSpec): void {
    this.ghostKey = recordKey(this.track.id, spec.id);
    const data = loadGhost(this.ghostKey);
    this.ghost = data ? new GhostPlayer(data) : null;
    this.ghostRec.begin();
    this.ghostBeaten = false;
    // модель призрака видна только в заезде на время (в гонке хватает соперников)
    if (this.mode === 'timeAttack') {
      const m = new CarModel(spec);
      m.setGhost(GHOST_OPACITY);
      m.group.visible = false;
      this.scene.add(m.group);
      this.ghostModel = m;
    }
  }

  /** Метры, пройденные игроком в текущем круге */
  private lapDistance(): number {
    if (!this.race) return 0;
    const st = this.race.standing(this.playerSlot);
    return st.progress - st.lap * this.track.length;
  }

  private onPlayerLap(lapTime: number): void {
    const data = this.ghostRec.finish(lapTime);
    this.ghostRec.begin();
    if (!data) return;
    if (!this.ghost || lapTime < this.ghost.lapTime) {
      this.ghostBeaten = this.ghost !== null;
      if (this.ghostBeaten) this.stats.ghostRecord = true;
      saveGhost(this.ghostKey, data);
      this.ghost = new GhostPlayer(data);
    }
  }

  private updateGhostModel(): void {
    const m = this.ghostModel;
    if (!m) return;
    if (!this.ghost || !this.race || this.state !== 'racing') {
      m.group.visible = false;
      return;
    }
    const t = this.race.standing(this.playerSlot).currentLapTime;
    // вплотную к игроку призрак не рисуем: иначе два кузова мерцают друг в друге
    m.group.visible = this.ghost.sample(t, _gPos, _gQuat) && _gPos.distanceToSquared(this.player.renderPos) > 3.5 * 3.5;
    m.group.position.copy(_gPos);
    m.group.quaternion.copy(_gQuat);
  }

  private cycleCamera(): void {
    const views: CameraView[] = ['far', 'near', 'bumper'];
    const next = views[(views.indexOf(this.chase.view) + 1) % views.length];
    this.chase.view = next;
    this.applySettings({ ...this.settings, cameraView: next }, true);
    this.ui.setSettings(this.settings);
    this.ui.popup(next === 'far' ? 'КАМЕРА: ДАЛЬНЯЯ' : next === 'near' ? 'КАМЕРА: БЛИЖНЯЯ' : 'КАМЕРА: БАМПЕР', undefined, 'cyan');
  }

  /**
   * Для e2e/QA: прогнать симуляцию на `seconds` вперёд без рендера
   * (игрок на автопилоте). Позволяет проверить финиш гонки за секунды.
   */
  debugSimulate(seconds: number): void {
    if (!this.race) return;
    if (!this.playerAutopilot) {
      this.playerAutopilot = new BotDriver(this.track, { ...BOT_PROFILES[0], name: 'AUTO', skill: 0.9 }, 7);
      if (this.pickups) this.playerAutopilot.setPads(this.pickups.padS, this.pickups.padLateral);
    }
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
      lap: this.race ? this.race.standing(this.playerSlot).lap : 0,
      position: this.race ? this.race.standing(this.playerSlot).position : 0,
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
