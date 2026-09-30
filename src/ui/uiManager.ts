/** UIManager — HUD, меню, экраны (GAME_DESIGN.md §4.5, §6.6). */
import type {
  CarSpec,
  ControlMode,
  HudData,
  MenuAction,
  PopupTone,
  RaceResult,
  Records,
  Settings,
  TouchState,
  UICallbacks,
} from '../core/types';
import { isTouchDevice } from '../core/device';
import './styles.css';
import { el } from './dom';
import { Hud } from './hud';
import { MainMenu } from './menu';
import { Nav } from './nav';
import { RotatePrompt } from './rotatePrompt';
import { LoadingScreen, PauseScreen, ResultsScreen, SettingsScreen } from './screens';
import { TouchControls } from './touchControls';

export interface UIOptions {
  cars: CarSpec[];
  settings: Settings;
  records: Records;
  callbacks: UICallbacks;
}

type ScreenName = 'none' | 'loading' | 'menu' | 'settings' | 'hud' | 'pause' | 'results';

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
  private readonly pause: PauseScreen;
  private readonly results: ResultsScreen;
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

    this.hud = new Hud(this.host);
    // сенсорные кнопки — над HUD и под экранами меню/паузы
    this.touch = new TouchControls(this.host, {
      onPause: () => {
        if (this.screen === 'hud') cb.onPause();
      },
      onFirstInteraction: () => cb.onFirstInteraction(),
    });
    this.loading = new LoadingScreen(this.host);
    this.menu = new MainMenu(
      this.host,
      opts.cars,
      opts.records,
      cb,
      new Nav(play),
      () => this.openSettings('menu'),
    );
    this.settings = new SettingsScreen(
      this.host,
      opts.settings,
      new Nav(play),
      Object.assign(Object.create(cb) as UICallbacks, { onSettingsChanged: (s: Settings) => this.handleSettings(s) }),
      () => this.closeSettings(),
      (active) => this.setLayoutPreview(active),
    );
    this.pause = new PauseScreen(this.host, new Nav(play), cb, () => this.openSettings('pause'));
    this.results = new ResultsScreen(this.host, new Nav(play), opts.cars, cb);
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

  showMainMenu(): void {
    this.hud.clearTransient();
    this.menu.nav.reset(0);
    this.setScreen('menu');
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

  showResults(r: RaceResult): void {
    this.hud.clearTransient();
    this.results.show(r);
    this.setScreen('results');
  }

  /** Открыть настройки (из меню или паузы). */
  showSettings(): void {
    this.openSettings(this.screen === 'pause' ? 'pause' : 'menu');
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
      this.menu.nav.reset(0);
      this.setScreen('menu');
    }
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
    const show = this.touchMode && this.screen === 'hud' && !this.rotate.shown;
    this.touch.setVisible(show);
    if (!show) this.touch.reset();
  }

  /** Предпросмотр кнопок, пока палец на слайдере размера/прозрачности в настройках. */
  private setLayoutPreview(active: boolean): void {
    this.touch.setPreview(active);
    this.settings.el.classList.toggle('previewing', active);
  }

  private handleSettings(s: Settings): void {
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
    const nav = this.activeNav();
    if (!nav) return;
    const cb = this.opts.callbacks;
    switch (a) {
      case 'up':
        nav.move(-1);
        break;
      case 'down':
        nav.move(1);
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
        } else if (this.screen === 'pause') {
          cb.onUiSound('back');
          cb.onResume();
        }
        break;
      case 'pause':
        if (this.screen === 'settings') {
          cb.onUiSound('back');
          this.closeSettings();
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

  // ── данные ────────────────────────────────────────────────────────────────

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
