/** Экран «СТАТИСТИКА»: неоновые плитки и сброс с подтверждением. */
import type { StatTile } from '../race/playerStats';
import { el } from './dom';
import { Nav } from './nav';
import { makeButton } from './screens';

export interface StatsApi {
  tiles(): StatTile[];
  /** Сбросить всю статистику */
  reset(): void;
  sound(kind: 'move' | 'select' | 'back'): void;
}

export class StatsScreen {
  readonly el: HTMLElement;
  readonly nav: Nav;
  private readonly grid: HTMLElement;
  private readonly resetBtn: HTMLElement;
  private readonly resetLabel: HTMLElement;
  private confirming = false;

  constructor(
    parent: HTMLElement,
    nav: Nav,
    private readonly api: StatsApi,
    onBack: () => void,
  ) {
    this.nav = nav;
    const root = el('div', 'screen stats', undefined, parent);
    root.hidden = true;
    this.el = root;
    const wrap = el('div', 'glow sts-wrap', undefined, root);
    const panel = el('div', 'panel magenta sts-panel', undefined, wrap);
    el('div', 'screen-title sts-title', 'СТАТИСТИКА', panel);
    this.grid = el('div', 'sts-grid', undefined, panel);
    const acts = el('div', 'sts-actions', undefined, panel);
    this.resetBtn = makeButton(acts, 'СБРОС');
    this.resetLabel = this.resetBtn.querySelector('span') as HTMLElement;
    const back = makeButton(acts, 'НАЗАД', 'big');
    nav.add({ el: back, activate: onBack });
    nav.add({ el: this.resetBtn, activate: () => this.onReset() });
  }

  onShown(): void {
    this.setConfirm(false);
    this.nav.reset(0);
    this.render();
  }

  /** Любое действие вне кнопки сброса снимает запрос подтверждения */
  syncFocus(): void {
    if (this.confirming && this.nav.index !== 1) this.setConfirm(false);
  }

  private setConfirm(on: boolean): void {
    this.confirming = on;
    this.resetBtn.classList.toggle('danger', on);
    this.resetLabel.textContent = on ? 'ТОЧНО СБРОСИТЬ? НАЖМИ ЕЩЁ РАЗ' : 'СБРОС';
  }

  private onReset(): void {
    if (!this.confirming) {
      this.setConfirm(true);
      this.api.sound('select');
      return;
    }
    this.api.reset();
    this.setConfirm(false);
    this.render();
  }

  render(): void {
    const tiles = this.api.tiles();
    this.grid.replaceChildren();
    tiles.forEach((t, i) => {
      const tile = el('div', `sts-tile tone-${t.tone || 'none'}${i >= 8 ? ' wide' : ''}`, undefined, this.grid);
      el('div', 'sts-label', t.label, tile);
      el('div', 'sts-value', t.value, tile);
    });
  }
}
