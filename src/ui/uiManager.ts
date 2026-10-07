/** UIManager — HUD, меню, экраны (GAME_DESIGN.md §4.5, §6.6). */
import type {
  CarSpec,
  ControlMode,
  CustomBuild,
  HudData,
  MenuAction,
  PopupTone,
  RaceResult,
  Records,
  Settings,
  TouchState,
  TrackInfo,
  UICallbacks,
} from '../core/types';
import { isTouchDevice } from '../core/device';
import { CUSTOM_CAR_ID } from '../core/types';
import './styles.css';
import './polish.css';
import './awards.css';
import './garage.css';
import './campaign.css';
import './daily.css';
import './rival.css';
import './stats.css';
import { StatsScreen } from './stats';
import type { StatsApi } from './stats';
import { DailyScreen } from './daily';
import type { DailyApi } from './daily';
import { CampaignScreen } from './campaign';
import type { CampaignApi } from './campaign';
import { AwardsScreen } from './awards';
import type { AwardItem } from './awards';
import { CustomizeScreen } from './customize';
import { GarageScreen } from './garage';
import type { GarageApi, GarageCarInfo } from './garage';
import { formatCredits } from '../race/career';
import { DEFAULT_BUDGET, DEFAULT_PALETTE, defaultCustomBuild } from './customLogic';
import type { CustomPalette } from './customLogic';
import { el } from './dom';
import { Hud } from './hud';
import { MainMenu, nextRaceMode } from './menu';
import { Nav } from './nav';
import { RotatePrompt } from './rotatePrompt';
import { clampIndex } from './trackLogic';
import { LoadingScreen, PauseScreen, ResultsScreen, SettingsScreen } from './screens';
import { TipsOverlay, shouldAutoShowTips } from './tips';
import { TouchControls } from './touchControls';

export interface UIOptions {
  cars: CarSpec[];
  settings: Settings;
  records: Records;
  callbacks: UICallbacks;
  /** «Своя сборка»: текущие значения (по умолчанию — сборка «по умолчанию» экрана) */
  customBuild?: CustomBuild;
  /** Бюджет очков: сумма трёх слайдеров не больше (по умолчанию 2.0) */
  customBudget?: number;
  /** Разрешённые цвета кузова и неона (hex из палитры игры) */
  customPalette?: CustomPalette;
  /** Трассы для выбора в меню (если больше одной — в меню появляется переключатель) */
  tracks?: TrackInfo[];
  /** Индекс выбранной трассы (по умолчанию 0) */
  trackIndex?: number;
  /** Гараж (карьера): без него кнопки «ГАРАЖ» в меню нет */
  garage?: { api: GarageApi; cars: GarageCarInfo[] };
  /** Кампания: без неё кнопки «КАМПАНИЯ» нет */
  campaign?: CampaignApi;
  /** Вызов дня: без него кнопки «ВЫЗОВ ДНЯ» нет */
  daily?: DailyApi;
  /** Статистика: без неё кнопки «СТАТИСТИКА» нет */
  stats?: StatsApi;
}

type ScreenName = 'none' | 'loading' | 'menu' | 'settings' | 'customize' | 'awards' | 'garage' | 'campaign' | 'daily' | 'stats' | 'hud' | 'pause' | 'results';

/** Режим управления → нужны ли сенсорные кнопки (авто — по типу устройства). */
function modeUsesTouch(mode: ControlMode): boolean {
  return mode === 'touch' || (mode === 'auto' && isTouchDevice());
}

export class UIManager {
  private readonly host: HTMLElement;
  private readonly hud: Hud;
  private readonly loading: LoadingScreen;
  private readonly menu: MainMenu;
  private readonly settings: SettingsScreen;
  private readonly customize: CustomizeScreen;
  private readonly awards: AwardsScreen;
  private readonly garage: GarageScreen | null = null;
  private readonly campaign: CampaignScreen | null = null;
  private readonly daily: DailyScreen | null = null;
  private readonly stats: StatsScreen | null = null;
  private readonly pause: PauseScreen;
  private readonly results: ResultsScreen;
  private readonly tips: TipsOverlay;
  private readonly fpsEl: HTMLElement;
  private readonly touch: TouchControls;
  private readonly rotate: RotatePrompt;
  private readonly portraitMq: MediaQueryList | null;
  private screen: ScreenName = 'none';
  private touchMode = false;
  private controlMode: ControlMode;
  /** Откуда открыты настройки. */
  private settingsFrom: 'menu' | 'pause' = 'menu';
  private cFps = '';

  constructor(
    readonly root: HTMLElement,
    readonly opts: UIOptions,
  ) {
    const cb = opts.callbacks;
    this.controlMode = opts.settings.controlMode;
    this.host = el('div', 'nr-ui', undefined, root);
    const play = (k: 'move' | 'select' | 'back'): void => cb.onUiSound(k);

    this.hud = new Hud(this.host, () => cb.onRadio?.());
    // сенсорные кнопки — над HUD и под экранами меню/паузы
    this.touch = new TouchControls(this.host, {
      onPause: () => {
        if (this.screen === 'hud') cb.onPause();
      },
      onFirstInteraction: () => cb.onFirstInteraction(),
    });
    const tracks = opts.tracks ?? [];
    this.loading = new LoadingScreen(this.host, tracks[clampIndex(opts.trackIndex, tracks.length)]?.name);
    this.menu = new MainMenu(
      this.host,
      opts.cars,
      opts.records,
      // смена трассы в меню: подпись на экране загрузки тоже следует за выбором
      Object.assign(Object.create(cb) as UICallbacks, {
        onSelectTrack: (i: number) => {
          this.loading.setTrack(this.menu.trackName);
          cb.onSelectTrack(i);
        },
      }),
      new Nav(play),
      () => this.openSettings('menu'),
      () => this.showCustomize(),
      tracks,
      opts.trackIndex ?? 0,
      () => this.toggleRaceMode(),
      () => this.tips.show(),
      () => this.openAwards(),
      opts.garage ? () => this.openGarage() : null,
      opts.campaign ? () => this.showCampaign() : null,
      opts.daily ? () => this.showDaily() : null,
      opts.stats ? () => this.showStats() : null,
    );
    if (opts.campaign) this.campaign = new CampaignScreen(this.host, new Nav(play), opts.campaign, () => this.closeCampaign());
    if (opts.daily) this.daily = new DailyScreen(this.host, new Nav(play), opts.daily, () => this.closeDaily());
    if (opts.stats) this.stats = new StatsScreen(this.host, new Nav(play), opts.stats, () => this.closeStats());
    if (opts.garage) {
      this.garage = new GarageScreen(
        this.host,
        new Nav(play),
        opts.garage.cars,
        // листание машин в гараже меняет и выбранную в меню
        Object.assign(Object.create(opts.garage.api) as GarageApi, {
          preview: (i: number) => {
            this.menu.setCar(i, false);
            opts.garage?.api.preview(i);
          },
        }),
        () => this.closeGarage(),
      );
      this.menu.setCredits(formatCredits(opts.garage.api.career().credits));
    }
    this.menu.setMode(opts.settings.raceMode);
    const budget = opts.customBudget ?? DEFAULT_BUDGET;
    const palette = opts.customPalette ?? DEFAULT_PALETTE;
    const defaults = defaultCustomBuild(budget, palette);
    this.customize = new CustomizeScreen(
      this.host,
      new Nav(play),
      cb,
      { build: opts.customBuild ?? defaults, budget, palette, defaults },
      () => this.closeCustomize(),
    );
    this.settings = new SettingsScreen(
      this.host,
      opts.settings,
      new Nav(play),
      Object.assign(Object.create(cb) as UICallbacks, { onSettingsChanged: (s: Settings) => this.handleSettings(s) }),
      () => this.closeSettings(),
      (active) => this.setLayoutPreview(active),
    );
    this.awards = new AwardsScreen(this.host, new Nav(play), () => this.closeAwards());
    this.pause = new PauseScreen(this.host, new Nav(play), cb, () => this.openSettings('pause'));
    this.results = new ResultsScreen(this.host, new Nav(play), opts.cars, cb);
    this.tips = new TipsOverlay(this.host);
    this.fpsEl = el('div', 'fps', '', this.host);
    this.fpsEl.hidden = true;
    this.rotate = new RotatePrompt(this.host);

    this.touch.setLayout(opts.settings.touchSize, opts.settings.touchOpacity);
    this.setTouchMode(modeUsesTouch(this.controlMode));

    // Портрет на сенсорном устройстве → «Поверни телефон»
    let mq: MediaQueryList | null = null;
    try {
      mq = typeof window.matchMedia === 'function' ? window.matchMedia('(orientation: portrait)') : null;
    } catch {
      mq = null;
    }
    this.portraitMq = mq;
    const onOrientation = (): void => this.updateOrientation();
    mq?.addEventListener?.('change', onOrientation);
    window.addEventListener('resize', onOrientation);
    window.addEventListener('orientationchange', onOrientation);
    this.updateOrientation();

    // Первое взаимодействие — разблокировать звук. iOS снимает блокировку AudioContext только
    // в обработчиках отпускания (touchend / click), поэтому вызываем и на нажатии, и на первом
    // отпускании — по одному разу каждое.
    let downDone = false;
    let upDone = false;
    const all: [string, EventListener][] = [];
    const finish = (): void => {
      if (!downDone || !upDone) return;
      for (const [ev, fn] of all) window.removeEventListener(ev, fn, true);
    };
    const onDown: EventListener = () => {
      if (downDone) return;
      downDone = true;
      cb.onFirstInteraction();
      finish();
    };
    const onUp: EventListener = () => {
      if (upDone) return;
      upDone = true;
      downDone = true;
      cb.onFirstInteraction();
      finish();
    };
    all.push(['pointerdown', onDown], ['keydown', onDown], ['pointerup', onUp], ['touchend', onUp], ['click', onUp]);
    for (const [ev, fn] of all) window.addEventListener(ev, fn, true);
  }

  // ── экраны ────────────────────────────────────────────────────────────────

  showLoading(text: string): void {
    this.loading.setText(text);
    this.hud.clearTransient();
    this.setScreen('loading');
  }

  /** Выбрать машину в меню без уведомления (синхронизация с игрой) */
  setSelectedCar(i: number): void {
    this.menu.setCar(i, false);
  }

  /** Выбрать трассу в меню без уведомления (синхронизация с игрой): подпись под логотипом и рекорды. */
  setTrackIndex(i: number): void {
    this.menu.setTrack(i, false);
    this.loading.setTrack(this.menu.trackName);
  }

  /** Главное меню на экране без оверлеев (можно запускать демо-гонку) */
  get canAttract(): boolean {
    return this.screen === 'menu' && !this.tips.visible;
  }

  /** Демо-гонка на фоне: меню полупрозрачно */
  setAttractLook(on: boolean): void {
    this.host.classList.toggle('attract', on);
  }

  showMainMenu(): void {
    this.hud.clearTransient();
    this.menu.nav.reset(MainMenu.DEFAULT_FOCUS);
    this.setScreen('menu');
    if (shouldAutoShowTips()) this.tips.show();
    // синхронизируем 3D-превью с выбранной в меню машиной
    this.opts.callbacks.onPreviewCar(this.menu.index);
  }

  showRaceHud(outline: { x: number; z: number }[]): void {
    this.hud.reset(outline);
    this.touch.reset();
    this.setScreen('hud');
    // гонка началась в портрете на телефоне: сразу на паузу (после возврата кода вызывающего)
    if (this.rotate.shown) this.pauseForPortrait();
  }

  showPause(): void {
    this.pause.nav.reset(0);
    this.setScreen('pause');
  }

  hidePause(): void {
    if (this.screen === 'pause' || (this.screen === 'settings' && this.settingsFrom === 'pause')) {
      this.setScreen('hud');
    }
  }

  /** newAwardIds — id только что открытых наград (плашки «НОВАЯ НАГРАДА»; названия берутся из списка наград). */
  showResults(r: RaceResult, newAwardIds: readonly string[] = []): void {
    this.hud.clearTransient();
    this.results.show(
      r,
      this.menu.hasTrackChoice ? this.menu.trackName : undefined,
      newAwardIds.map((id) => this.awards.find(id)?.title).filter((t): t is string => t !== undefined),
    );
    this.setScreen('results');
  }

  /** Корневой слой UI (для оверлеев повтора и фоторежима) */
  get layer(): HTMLElement {
    return this.host;
  }

  /** Вернуть экран результатов без пересборки (после повтора) */
  restoreResults(): void {
    this.setScreen('results');
  }

  /** Открыть настройки (из меню или паузы). */
  showSettings(): void {
    this.openSettings(this.screen === 'pause' ? 'pause' : 'menu');
  }

  /** Экран «Своя сборка» (из меню; выбирает машину-конструктор, если открыта другая). Во время гонки — игнорируется. */
  showCustomize(): void {
    if (this.screen === 'hud' || this.screen === 'pause' || this.screen === 'settings') return;
    const idx = this.opts.cars.findIndex((c) => c.id === CUSTOM_CAR_ID);
    if (idx < 0) return;
    if (this.menu.index !== idx) this.menu.setCar(idx, true);
    this.customize.onShown();
    this.setScreen('customize');
  }

  /** Список наград (порядок и тексты — из игры; флаг `unlocked` в элементах учитывается). */
  setAchievements(list: readonly AwardItem[]): void {
    this.awards.setList(list);
  }

  /** Какие награды открыты (полный набор id). */
  setUnlocked(ids: readonly string[]): void {
    this.awards.setUnlocked(ids);
  }

  /** Экран «НАГРАДЫ»; list (необязательно) — заменить список перед показом. Из гонки/паузы игнорируется. */
  showAchievements(list?: readonly AwardItem[]): void {
    if (list) this.awards.setList(list);
    this.openAwards();
  }

  private openAwards(): void {
    if (this.screen !== 'menu') return;
    this.awards.onShown();
    this.setScreen('awards');
  }

  /** Карта кампании (из меню или с экрана результатов). */
  showCampaign(): void {
    if ((this.screen !== 'menu' && this.screen !== 'results') || !this.campaign) return;
    this.campaign.onShown();
    this.setScreen('campaign');
  }

  /** «Вызов дня» (из меню). */
  showDaily(): void {
    if (this.screen !== 'menu' || !this.daily) return;
    this.daily.onShown();
    this.setScreen('daily');
  }

  /** «Статистика» (из меню). */
  showStats(): void {
    if (this.screen !== 'menu' || !this.stats) return;
    this.stats.onShown();
    this.setScreen('stats');
  }

  private closeStats(): void {
    if (this.screen !== 'stats') return;
    this.menu.nav.reset(MainMenu.DEFAULT_FOCUS);
    this.setScreen('menu');
  }

  private closeDaily(): void {
    if (this.screen !== 'daily') return;
    this.menu.nav.reset(MainMenu.DEFAULT_FOCUS);
    this.setScreen('menu');
  }

  private closeCampaign(): void {
    if (this.screen !== 'campaign') return;
    this.menu.nav.reset(MainMenu.DEFAULT_FOCUS);
    this.setScreen('menu');
  }

  private openGarage(): void {
    if (this.screen !== 'menu' || !this.garage) return;
    this.garage.onShown(this.menu.index);
    this.setScreen('garage');
  }

  private closeGarage(): void {
    if (this.screen !== 'garage' || !this.garage) return;
    this.syncCredits();
    this.menu.nav.reset(MainMenu.DEFAULT_FOCUS);
    this.setScreen('menu');
  }

  /** Обновить баланс в меню (и в гараже) из карьеры */
  syncCredits(): void {
    const g = this.opts.garage;
    if (!g) return;
    this.menu.setCredits(formatCredits(g.api.career().credits));
    this.garage?.refresh();
  }

  private closeAwards(): void {
    if (this.screen !== 'awards') return;
    this.menu.nav.reset(MainMenu.DEFAULT_FOCUS);
    this.setScreen('menu');
  }

  /** Обновить значения «своей сборки» извне (без onCustomBuildChanged). */
  setCustomBuild(b: CustomBuild): void {
    this.customize.setBuild(b);
  }

  /** Новые stats/цвета машины (4-я машина меняется вместе со сборкой): перерисовать панель меню. */
  updateCarSpec(index: number, spec: CarSpec): void {
    this.menu.updateCarSpec(index, spec);
  }

  /** Скрыть все экраны и HUD. */
  hideAll(): void {
    this.hud.clearTransient();
    this.setScreen('none');
  }

  private openSettings(from: 'menu' | 'pause'): void {
    this.settingsFrom = from;
    this.settings.nav.reset(0);
    this.settings.onShown();
    this.setScreen('settings');
  }

  private closeSettings(): void {
    if (this.screen !== 'settings') return;
    if (this.settingsFrom === 'pause') {
      this.pause.nav.reset(0);
      this.setScreen('pause');
    } else {
      this.menu.nav.reset(MainMenu.DEFAULT_FOCUS);
      this.setScreen('menu');
    }
  }

  private closeCustomize(): void {
    if (this.screen !== 'customize') return;
    this.menu.nav.reset(MainMenu.DEFAULT_FOCUS);
    this.setScreen('menu');
  }

  private setScreen(s: ScreenName): void {
    this.screen = s;
    const fromPause = s === 'settings' && this.settingsFrom === 'pause';
    const hudVisible = s === 'hud' || s === 'pause' || fromPause;
    const wasHidden = this.hud.el.hidden;
    this.hud.el.hidden = !hudVisible;
    this.loading.el.hidden = s !== 'loading';
    this.menu.el.hidden = s !== 'menu';
    this.settings.el.hidden = s !== 'settings';
    this.customize.el.hidden = s !== 'customize';
    this.awards.el.hidden = s !== 'awards';
    if (this.garage) this.garage.el.hidden = s !== 'garage';
    if (this.campaign) this.campaign.el.hidden = s !== 'campaign';
    if (this.daily) this.daily.el.hidden = s !== 'daily';
    if (this.stats) this.stats.el.hidden = s !== 'stats';
    this.settings.el.classList.toggle('over-hud', fromPause);
    this.pause.el.hidden = s !== 'pause';
    this.results.el.hidden = s !== 'results';
    if (hudVisible && wasHidden) this.hud.onShown();
    // предпросмотр кнопок живёт только на экране настроек
    if (s !== 'settings') this.setLayoutPreview(false);
    this.applyTouchVisibility();
  }

  // ── сенсорный режим ───────────────────────────────────────────────────────

  /** Живое состояние сенсорных кнопок — его читает InputManager. */
  get touchState(): TouchState {
    return this.touch.state;
  }

  /**
   * Включить/выключить сенсорный режим: кнопки на экране во время гонки, компактный HUD,
   * подсказка управления про кнопки. Вызывать при старте и при смене Settings.controlMode.
   */
  setTouchMode(enabled: boolean): void {
    if (this.touchMode === enabled) return;
    this.touchMode = enabled;
    this.host.classList.toggle('nr-touch-mode', enabled);
    this.menu.setTouchHint(enabled);
    this.applyTouchVisibility();
    // раскладка HUD изменилась — пересчитать разрешение мини-карты
    if (!this.hud.el.hidden) this.hud.onShown();
  }

  /** Размер (0.7..1.5) и прозрачность (0.2..1) сенсорных кнопок — из Settings. */
  setTouchLayout(size: number, opacity: number): void {
    this.touch.setLayout(size, opacity);
  }

  private applyTouchVisibility(): void {
    // сенсорное устройство в режиме «Клавиатура и геймпад»: в гонке остаётся только кнопка паузы
    const pauseOnly = !this.touchMode && isTouchDevice();
    const show = (this.touchMode || pauseOnly) && this.screen === 'hud' && !this.rotate.shown;
    this.touch.setPauseOnly(pauseOnly);
    this.host.classList.toggle('nr-pause-only', pauseOnly);
    this.touch.setVisible(show);
    if (!show) this.touch.reset();
  }

  /** Предпросмотр кнопок, пока палец на слайдере размера/прозрачности в настройках. */
  private setLayoutPreview(active: boolean): void {
    this.touch.setPreview(active);
    this.settings.el.classList.toggle('previewing', active);
  }

  private toggleRaceMode(): void {
    const cur = this.settings.value;
    const next: Settings = { ...cur, raceMode: nextRaceMode(cur.raceMode) };
    this.settings.setSettings(next);
    this.opts.callbacks.onUiSound('move');
    this.handleSettings(next);
  }

  private handleSettings(s: Settings): void {
    this.menu.setMode(s.raceMode);
    this.controlMode = s.controlMode;
    this.touch.setLayout(s.touchSize, s.touchOpacity);
    this.setTouchMode(modeUsesTouch(s.controlMode));
    this.updateOrientation();
    this.opts.callbacks.onSettingsChanged(s);
  }

  /** Подсказка «Поверни телефон» нужна: сенсорное управление + портретная ориентация. */
  private updateOrientation(): void {
    const portrait = this.portraitMq ? this.portraitMq.matches : window.innerHeight > window.innerWidth;
    // явный выбор «Клавиатура и геймпад» подсказку отключает
    const touchUi = this.controlMode === 'touch' || (this.controlMode === 'auto' && isTouchDevice());
    const need = touchUi && portrait;
    const was = this.rotate.shown;
    this.rotate.setShown(need);
    if (need && !was) {
      this.touch.reset();
      // идёт гонка и пауза не открыта — ставим на паузу
      if (this.screen === 'hud') this.opts.callbacks.onPause();
    }
    this.applyTouchVisibility();
  }

  private pauseForPortrait(): void {
    // не внутри вызова игры (showRaceHud идёт из startRace) — после его завершения
    queueMicrotask(() => {
      if (this.screen === 'hud' && this.rotate.shown) this.opts.callbacks.onPause();
    });
  }

  private activeNav(): Nav | null {
    switch (this.screen) {
      case 'menu':
        return this.menu.nav;
      case 'settings':
        return this.settings.nav;
      case 'customize':
        return this.customize.nav;
      case 'awards':
        return this.awards.nav;
      case 'garage':
        return this.garage?.nav ?? null;
      case 'campaign':
        return this.campaign?.nav ?? null;
      case 'daily':
        return this.daily?.nav ?? null;
      case 'stats':
        return this.stats?.nav ?? null;
      case 'pause':
        return this.pause.nav;
      case 'results':
        return this.results.nav;
      default:
        return null;
    }
  }

  // ── ввод (клавиатура/геймпад) ─────────────────────────────────────────────

  handleAction(a: MenuAction): void {
    if (this.rotate.shown) return;
    if (this.tips.visible) {
      this.tips.hide();
      this.opts.callbacks.onUiSound('back');
      return;
    }
    const nav = this.activeNav();
    if (!nav) return;
    const cb = this.opts.callbacks;
    switch (a) {
      case 'up':
        if (this.screen === 'awards') this.awards.scrollBy(-1);
        else nav.move(-1);
        this.campaign?.syncFocus();
        this.stats?.syncFocus();
        break;
      case 'down':
        if (this.screen === 'awards') this.awards.scrollBy(1);
        else nav.move(1);
        this.campaign?.syncFocus();
        this.stats?.syncFocus();
        break;
      case 'left':
      case 'right': {
        const dir = a === 'left' ? -1 : 1;
        if (nav.adjust(dir)) break;
        // в горизонтальном ряду кнопок (результаты) стрелки двигают фокус
        if (this.screen === 'results') nav.move(dir);
        break;
      }
      case 'confirm':
        nav.activate();
        break;
      case 'back':
        if (this.screen === 'settings') {
          cb.onUiSound('back');
          this.closeSettings();
        } else if (this.screen === 'customize') {
          cb.onUiSound('back');
          this.closeCustomize();
        } else if (this.screen === 'awards') {
          cb.onUiSound('back');
          this.closeAwards();
        } else if (this.screen === 'garage') {
          cb.onUiSound('back');
          this.closeGarage();
        } else if (this.screen === 'campaign') {
          cb.onUiSound('back');
          this.closeCampaign();
        } else if (this.screen === 'daily') {
          cb.onUiSound('back');
          this.closeDaily();
        } else if (this.screen === 'stats') {
          cb.onUiSound('back');
          this.closeStats();
        } else if (this.screen === 'pause') {
          cb.onUiSound('back');
          cb.onResume();
        }
        break;
      case 'pause':
        if (this.screen === 'settings') {
          cb.onUiSound('back');
          this.closeSettings();
        } else if (this.screen === 'customize') {
          cb.onUiSound('back');
          this.closeCustomize();
        } else if (this.screen === 'awards') {
          cb.onUiSound('back');
          this.closeAwards();
        } else if (this.screen === 'garage') {
          cb.onUiSound('back');
          this.closeGarage();
        } else if (this.screen === 'campaign') {
          cb.onUiSound('back');
          this.closeCampaign();
        } else if (this.screen === 'daily') {
          cb.onUiSound('back');
          this.closeDaily();
        } else if (this.screen === 'stats') {
          cb.onUiSound('back');
          this.closeStats();
        } else if (this.screen === 'pause') {
          cb.onUiSound('back');
          cb.onResume();
        }
        break;
      case 'reset':
        break;
    }
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  updateHud(d: HudData): void {
    this.hud.update(d);
    this.touch.setNitro(d.nitro, d.nitroActive);
  }

  setCountdown(v: 3 | 2 | 1 | 'GO' | null): void {
    this.hud.setCountdown(v);
  }

  popup(text: string, sub?: string, tone: PopupTone = 'pink'): void {
    this.hud.popup(text, sub, tone);
  }

  banner(text: string, tone: PopupTone = 'pink'): void {
    this.hud.banner(text, tone);
  }

  /** Реплика соперника по «рации» (2 с) */
  radio(who: string, text: string): void {
    this.hud.radio(who, text);
  }

  // ── данные ────────────────────────────────────────────────────────────────

  setSettings(s: Settings): void {
    this.settings.setSettings(s);
  }

  /** Название станции в HUD */
  setRadio(label: string): void {
    this.hud.setRadio(label);
  }

  setRecords(r: Records): void {
    this.menu.setRecords(r);
  }

  setFps(fps: number | null): void {
    if (fps === null) {
      if (this.cFps !== '') {
        this.cFps = '';
        this.fpsEl.hidden = true;
      }
      return;
    }
    const t = `${Math.round(fps)} FPS`;
    if (t === this.cFps) return;
    this.cFps = t;
    this.fpsEl.textContent = t;
    this.fpsEl.hidden = false;
  }
}
