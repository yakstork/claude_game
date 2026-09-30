/** UIManager — HUD, меню, экраны (GAME_DESIGN.md §4.5, §6.6). */
import type { CarSpec, HudData, MenuAction, PopupTone, RaceResult, Records, Settings, UICallbacks } from '../core/types';
import './styles.css';
import { el } from './dom';
import { Hud } from './hud';
import { MainMenu } from './menu';
import { Nav } from './nav';
import { LoadingScreen, PauseScreen, ResultsScreen, SettingsScreen } from './screens';

export interface UIOptions {
  cars: CarSpec[];
  settings: Settings;
  records: Records;
  callbacks: UICallbacks;
}

type ScreenName = 'none' | 'loading' | 'menu' | 'settings' | 'hud' | 'pause' | 'results';

export class UIManager {
  private readonly host: HTMLElement;
  private readonly hud: Hud;
  private readonly loading: LoadingScreen;
  private readonly menu: MainMenu;
  private readonly settings: SettingsScreen;
  private readonly pause: PauseScreen;
  private readonly results: ResultsScreen;
  private readonly fpsEl: HTMLElement;
  private screen: ScreenName = 'none';
  /** Откуда открыты настройки. */
  private settingsFrom: 'menu' | 'pause' = 'menu';
  private cFps = '';

  constructor(
    readonly root: HTMLElement,
    readonly opts: UIOptions,
  ) {
    const cb = opts.callbacks;
    this.host = el('div', 'nr-ui', undefined, root);
    const play = (k: 'move' | 'select' | 'back'): void => cb.onUiSound(k);

    this.hud = new Hud(this.host);
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
      cb,
      () => this.closeSettings(),
    );
    this.pause = new PauseScreen(this.host, new Nav(play), cb, () => this.openSettings('pause'));
    this.results = new ResultsScreen(this.host, new Nav(play), opts.cars, cb);
    this.fpsEl = el('div', 'fps', '', this.host);
    this.fpsEl.hidden = true;

    // Первое взаимодействие — разблокировать звук (один раз).
    const first = (): void => {
      window.removeEventListener('pointerdown', first, true);
      window.removeEventListener('keydown', first, true);
      cb.onFirstInteraction();
    };
    window.addEventListener('pointerdown', first, true);
    window.addEventListener('keydown', first, true);
  }

  // ── экраны ────────────────────────────────────────────────────────────────

  showLoading(text: string): void {
    this.loading.setText(text);
    this.hud.clearTransient();
    this.setScreen('loading');
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
    this.setScreen('hud');
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
