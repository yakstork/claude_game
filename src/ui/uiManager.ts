/** UIManager — HUD, меню, экраны (GAME_DESIGN.md §4.5, §6.6). ЗАГЛУШКА: реализует ui-audio-engineer. */
import type { CarSpec, HudData, MenuAction, PopupTone, RaceResult, Records, Settings, UICallbacks } from '../core/types';

export interface UIOptions {
  cars: CarSpec[];
  settings: Settings;
  records: Records;
  callbacks: UICallbacks;
}

export class UIManager {
  constructor(
    readonly root: HTMLElement,
    readonly opts: UIOptions,
  ) {}

  showLoading(_text: string): void {}
  showMainMenu(): void {}
  showRaceHud(_outline: { x: number; z: number }[]): void {}
  showPause(): void {}
  hidePause(): void {}
  showResults(_r: RaceResult): void {}
  updateHud(_d: HudData): void {}
  setCountdown(_v: 3 | 2 | 1 | 'GO' | null): void {}
  popup(_text: string, _sub?: string, _tone?: PopupTone): void {}
  banner(_text: string, _tone?: PopupTone): void {}
  handleAction(_a: MenuAction): void {}
  setRecords(_r: Records): void {}
  setFps(_fps: number | null): void {}
}
