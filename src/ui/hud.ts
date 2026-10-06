/**
 * Гоночный HUD (GAME_DESIGN.md §4.5). DOM создаётся один раз в конструкторе;
 * update() вызывается каждый кадр и трогает только textContent/style/classList
 * у готовых элементов — и только при изменении значения.
 */
import type { HudData, PopupTone } from '../core/types';
import { el, restartAnim, svgEl } from './dom';
import {
  comboScale,
  formatScore,
  formatSpeed,
  formatDelta,
  formatTime,
  SPEEDO_MAX_KMH,
  speedFraction,
} from './format';
import { Minimap } from './minimap';
import { quantize01 } from './trackLogic';

const MAX_POPUPS = 3;
const POPUP_MS = 1700;
const BANNER_MS = 2100;

// Геометрия дуги спидометра: 240°, от 150° до 390° по часовой (координаты SVG).
const CX = 120;
const CY = 110;
const R = 90;
const A0 = 150;
const A1 = 390;

function polar(angleDeg: number, r: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [CX + Math.cos(a) * r, CY + Math.sin(a) * r];
}

export class Hud {
  readonly el: HTMLElement;
  private readonly minimap: Minimap;

  // элементы
  private readonly posNum: HTMLElement;
  private readonly posPanel: HTMLElement;
  private readonly deltaEl: HTMLElement;
  private cDelta = '';
  private readonly slipEl: HTMLElement;
  private cSlip = -1;
  private readonly posTotal: HTMLElement;
  private readonly driftTotalEl: HTMLElement;
  private readonly lapLabel: HTMLElement;
  private readonly lapCur: HTMLElement;
  private readonly lapBest: HTMLElement;
  private readonly lapLast: HTMLElement;
  private readonly raceTime: HTMLElement;
  private readonly speedo: HTMLElement;
  private readonly speedArc: SVGPathElement;
  private readonly speedNum: HTMLElement;
  private readonly nitroFill: HTMLElement;
  private readonly nitroText: HTMLElement;
  private readonly boostEl: HTMLElement;
  private readonly boostFill: HTMLElement;
  private readonly combo: HTMLElement;
  private readonly comboPts: HTMLElement;
  private readonly comboMult: HTMLElement;
  private readonly wrongWay: HTMLElement;
  private readonly popups: HTMLElement;
  private readonly bannerSlot: HTMLElement;
  private readonly countdown: HTMLElement;
  private readonly mapCanvas: HTMLCanvasElement;

  // кэш прошлых значений
  private cPos = -1;
  private cTotal = -1;
  private cDriftTotal = -1;
  private cLap = -1;
  private cLaps = -1;
  private cLapTime = '';
  private cBest = '';
  private cLast = '';
  private cRace = '';
  private cSpeed = '';
  private cArc = -1;
  private cNitro = -1;
  private cNitroState = -1;
  private cBoostOn = false;
  private cBoost = -1;
  private cBoostPower = -1;
  private cComboOn = false;
  private cComboPts = -1;
  private cComboMult = -1;
  private cWrong = false;

  private bannerTimer = 0;
  private readonly popupTimers = new Map<HTMLElement, number>();
  private countdownKey = '';

  constructor(parent: HTMLElement) {
    const root = el('div', 'screen hud', undefined, parent);
    root.hidden = true;
    this.el = root;

    // ── позиция (слева сверху)
    const pos = el('div', 'panel hud-pos', undefined, root);
    el('div', 'hud-label', 'ПОЗ', pos);
    const posRow = el('div', 'hud-pos-row', undefined, pos);
    this.posNum = el('span', 'hud-pos-num', '1', posRow);
    this.posTotal = el('span', 'hud-pos-total', '/6', posRow);
    const dRow = el('div', 'hud-drift-row', undefined, pos);
    el('span', 'hud-label', 'ДРИФТ', dRow);
    this.driftTotalEl = el('span', 'hud-drift-total', '0', dRow);

    // ── круг и таймеры (справа сверху)
    const lap = el('div', 'panel cyan hud-lap', undefined, root);
    this.lapLabel = el('div', 'hud-lap-title', 'КРУГ 1/3', lap);
    this.lapCur = el('div', 'hud-lap-cur', formatTime(null), lap);
    // разница с лучшим кругом (призраком) в той же точке трассы
    this.deltaEl = el('div', 'hud-delta', '', lap);
    this.deltaEl.hidden = true;
    this.posPanel = pos;
    this.slipEl = el('div', 'hud-slip', 'СЛИПСТРИМ', root);
    const rows = el('div', 'hud-lap-rows', undefined, lap);
    el('span', 'hud-label', 'ЛУЧШИЙ', rows);
    this.lapBest = el('span', 'hud-time best', formatTime(null), rows);
    el('span', 'hud-label', 'ПОСЛЕДНИЙ', rows);
    this.lapLast = el('span', 'hud-time', formatTime(null), rows);
    el('span', 'hud-label', 'ВСЕГО', rows);
    this.raceTime = el('span', 'hud-time', formatTime(0), rows);

    // ── центральная колонка сверху: баннер → комбо → попапы. Flex-колонка с
    // зарезервированной высотой слотов гарантирует, что зоны не пересекаются
    // ни на каком размере окна (все размеры — в em от вьюпорта).
    const centerCol = el('div', 'hud-center', undefined, root);
    this.bannerSlot = el('div', 'hud-banner-slot', undefined, centerCol);
    const comboSlot = el('div', 'hud-combo-slot', undefined, centerCol);
    this.combo = el('div', 'hud-combo', undefined, comboSlot);
    this.comboPts = el('span', 'hud-combo-pts', '+0', this.combo);
    this.comboMult = el('span', 'hud-combo-mult', 'x1', this.combo);
    this.popups = el('div', 'hud-popups', undefined, centerCol);

    // ── плашка «не туда», отсчёт
    this.wrongWay = el('div', 'hud-wrong', 'НЕ ТУДА!', root);
    this.countdown = el('div', 'hud-countdown', undefined, root);

    // ── спидометр (центр снизу)
    this.speedo = el('div', 'hud-speedo', undefined, root);
    const svg = svgEl('svg', { viewBox: '0 0 240 172', class: 'speedo-svg' }, this.speedo);
    const defs = svgEl('defs', {}, svg);
    const grad = svgEl('linearGradient', { id: 'nr-speed-grad', gradientUnits: 'userSpaceOnUse', x1: 30, y1: 0, x2: 210, y2: 0 }, defs);
    svgEl('stop', { offset: 0, 'stop-color': '#05d9e8' }, grad);
    svgEl('stop', { offset: 1, 'stop-color': '#ff2a6d' }, grad);
    const [x0, y0] = polar(A0, R);
    const [x1, y1] = polar(A1, R);
    const d = `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
    svgEl('path', { d, class: 'speedo-track', pathLength: 100 }, svg);
    this.speedArc = svgEl('path', { d, class: 'speedo-arc', pathLength: 100, 'stroke-dasharray': '0 100' }, svg);
    // деления каждые 40 км/ч, подписи каждые 80
    const steps = SPEEDO_MAX_KMH / 40;
    for (let i = 0; i <= steps; i++) {
      const ang = A0 + ((A1 - A0) * i) / steps;
      const major = i % 2 === 0;
      const [ax, ay] = polar(ang, R - 13);
      const [bx, by] = polar(ang, R - (major ? 22 : 19));
      svgEl('line', { x1: ax, y1: ay, x2: bx, y2: by, class: major ? 'speedo-tick major' : 'speedo-tick' }, svg);
      if (major) {
        const [tx, ty] = polar(ang, R + 14);
        const t = svgEl('text', { x: tx, y: ty + 3.5, class: 'speedo-tick-label', 'text-anchor': 'middle' }, svg);
        t.textContent = String(i * 40);
      }
    }
    const center = el('div', 'speedo-center', undefined, this.speedo);
    this.speedNum = el('div', 'speedo-num', '0', center);
    el('div', 'speedo-unit', 'КМ/Ч', center);
    const nitro = el('div', 'nitro', undefined, this.speedo);
    el('div', 'nitro-glow', undefined, nitro);
    const bar = el('div', 'nitro-bar', undefined, nitro);
    this.nitroFill = el('div', 'nitro-fill', undefined, bar);
    this.nitroText = el('div', 'nitro-text', 'NITRO', bar);
    // ускорение (бонус за дрифт / старт): полоска над спидометром, видна только пока boost > 0
    this.boostEl = el('div', 'boost', undefined, this.speedo);
    this.boostEl.hidden = true;
    el('div', 'boost-glow', undefined, this.boostEl);
    const boostBar = el('div', 'boost-bar', undefined, this.boostEl);
    this.boostFill = el('div', 'boost-fill', undefined, boostBar);
    el('div', 'boost-text', 'BOOST', boostBar);

    // ── мини-карта (справа снизу)
    const map = el('div', 'panel hud-map', undefined, root);
    this.mapCanvas = el('canvas', 'hud-map-canvas', undefined, map);
    this.minimap = new Minimap(this.mapCanvas);
    window.addEventListener('resize', () => {
      if (!this.el.hidden) this.minimap.resize();
    });
  }

  /** Сброс состояния при показе HUD (новая гонка). */
  reset(outline: { x: number; z: number }[]): void {
    this.cPos = this.cTotal = this.cDriftTotal = this.cLap = this.cLaps = -1;
    this.cLapTime = this.cBest = this.cLast = this.cRace = this.cSpeed = '';
    this.cArc = this.cNitro = this.cNitroState = this.cComboPts = this.cComboMult = -1;
    this.cBoost = this.cBoostPower = -1;
    this.cBoostOn = false;
    this.boostEl.hidden = true;
    this.cComboOn = false;
    this.cWrong = false;
    this.combo.classList.remove('on');
    this.wrongWay.classList.remove('on');
    this.speedo.classList.remove('nitro-ready', 'nitro-active');
    this.clearTransient();
    this.minimap.setOutline(outline);
  }

  /** Убирает попапы, баннер и отсчёт. */
  clearTransient(): void {
    this.popups.replaceChildren();
    for (const t of this.popupTimers.values()) window.clearTimeout(t);
    this.popupTimers.clear();
    window.clearTimeout(this.bannerTimer);
    this.bannerSlot.replaceChildren();
    this.setCountdown(null);
  }

  /** Вызывается после показа корня: пересчитать разрешение мини-карты. */
  onShown(): void {
    this.minimap.resize();
  }

  // ── каждый кадр ──────────────────────────────────────────────────────────

  update(d: HudData): void {
    const dl = d.delta === null ? '' : formatDelta(d.delta);
    if (dl !== this.cDelta) {
      this.cDelta = dl;
      this.deltaEl.hidden = dl === '';
      this.deltaEl.textContent = dl;
      this.deltaEl.classList.toggle('ahead', d.delta !== null && d.delta < 0);
    }
    this.posPanel.classList.toggle('solo', d.totalRacers <= 1);
    const slip = Math.round(d.slipstream * 10) / 10;
    if (slip !== this.cSlip) {
      this.cSlip = slip;
      this.slipEl.classList.toggle('on', slip >= 0.3);
      this.slipEl.style.opacity = slip >= 0.3 ? String(0.4 + slip * 0.6) : '';
    }
    if (d.position !== this.cPos) {
      this.cPos = d.position;
      this.posNum.textContent = String(d.position);
    }
    if (d.totalRacers !== this.cTotal) {
      this.cTotal = d.totalRacers;
      this.posTotal.textContent = `/${d.totalRacers}`;
    }
    const dt = Math.round(d.driftTotal);
    if (dt !== this.cDriftTotal) {
      this.cDriftTotal = dt;
      this.driftTotalEl.textContent = formatScore(dt);
    }
    if (d.lap !== this.cLap || d.totalLaps !== this.cLaps) {
      this.cLap = d.lap;
      this.cLaps = d.totalLaps;
      this.lapLabel.textContent = `КРУГ ${d.lap}/${d.totalLaps}`;
    }
    const cur = formatTime(d.lapTime);
    if (cur !== this.cLapTime) {
      this.cLapTime = cur;
      this.lapCur.textContent = cur;
    }
    const best = formatTime(d.bestLap);
    if (best !== this.cBest) {
      this.cBest = best;
      this.lapBest.textContent = best;
    }
    const last = formatTime(d.lastLap);
    if (last !== this.cLast) {
      this.cLast = last;
      this.lapLast.textContent = last;
    }
    const race = formatTime(d.raceTime);
    if (race !== this.cRace) {
      this.cRace = race;
      this.raceTime.textContent = race;
    }

    // спидометр
    const spd = formatSpeed(d.speedKmh);
    if (spd !== this.cSpeed) {
      this.cSpeed = spd;
      this.speedNum.textContent = spd;
    }
    const arc = Math.round(speedFraction(d.speedKmh) * 200) / 2; // шаг 0.5% дуги
    if (arc !== this.cArc) {
      this.cArc = arc;
      this.speedArc.setAttribute('stroke-dasharray', `${arc} 100`);
    }

    // нитро
    const nq = Math.round(Math.min(1, Math.max(0, d.nitro)) * 200) / 200;
    if (nq !== this.cNitro) {
      this.cNitro = nq;
      this.nitroFill.style.transform = `scaleX(${nq})`;
    }
    const state = d.nitroActive ? 2 : d.nitro >= 0.999 ? 1 : 0;
    if (state !== this.cNitroState) {
      this.cNitroState = state;
      this.speedo.classList.toggle('nitro-ready', state === 1);
      this.speedo.classList.toggle('nitro-active', state === 2);
      this.nitroText.textContent = state === 1 ? 'NITRO READY' : 'NITRO';
    }

    // ускорение: полоска убывает с boost (шаг 0.5%), интенсивность свечения/пульса — от boostPower (шаг 5%)
    const boostOn = d.boost > 0;
    if (boostOn !== this.cBoostOn) {
      this.cBoostOn = boostOn;
      this.boostEl.hidden = !boostOn;
    }
    if (boostOn) {
      const bq = quantize01(d.boost, 200);
      if (bq !== this.cBoost) {
        this.cBoost = bq;
        this.boostFill.style.transform = `scaleX(${bq})`;
      }
      const pq = quantize01(d.boostPower, 20);
      if (pq !== this.cBoostPower) {
        this.cBoostPower = pq;
        this.boostEl.style.setProperty('--bp', String(pq));
      }
    }

    // комбо
    const on = d.drift.active;
    if (on !== this.cComboOn) {
      this.cComboOn = on;
      this.combo.classList.toggle('on', on);
    }
    if (on) {
      const pts = Math.round(d.drift.points);
      if (pts !== this.cComboPts) {
        this.cComboPts = pts;
        this.comboPts.textContent = `+${formatScore(pts)}`;
      }
      const mult = Math.round(d.drift.multiplier * 10) / 10;
      if (mult !== this.cComboMult) {
        this.cComboMult = mult;
        this.comboMult.textContent = `x${mult}`;
        this.combo.style.setProperty('--s', comboScale(mult).toFixed(3));
      }
    }

    if (d.wrongWay !== this.cWrong) {
      this.cWrong = d.wrongWay;
      this.wrongWay.classList.toggle('on', d.wrongWay);
    }

    this.minimap.draw(d.minimap);
  }

  // ── события (не каждый кадр) ─────────────────────────────────────────────

  popup(text: string, sub?: string, tone: PopupTone = 'pink'): void {
    while (this.popups.childElementCount >= MAX_POPUPS) {
      const first = this.popups.firstElementChild as HTMLElement | null;
      if (!first) break;
      this.removePopup(first);
    }
    const p = el('div', `popup tone-${tone}`, undefined, this.popups);
    el('div', 'popup-text', text, p);
    if (sub) el('div', 'popup-sub', sub, p);
    const t = window.setTimeout(() => this.removePopup(p), POPUP_MS);
    this.popupTimers.set(p, t);
  }

  private removePopup(p: HTMLElement): void {
    const t = this.popupTimers.get(p);
    if (t !== undefined) window.clearTimeout(t);
    this.popupTimers.delete(p);
    p.remove();
  }

  banner(text: string, tone: PopupTone = 'pink'): void {
    window.clearTimeout(this.bannerTimer);
    this.bannerSlot.replaceChildren();
    const b = el('div', `banner tone-${tone}`, undefined, this.bannerSlot);
    el('span', 'banner-text', text, b);
    this.bannerTimer = window.setTimeout(() => b.remove(), BANNER_MS);
  }

  setCountdown(v: 3 | 2 | 1 | 'GO' | null): void {
    if (v === null) {
      this.countdownKey = '';
      this.countdown.className = 'hud-countdown';
      this.countdown.textContent = '';
      return;
    }
    const key = String(v);
    if (key === this.countdownKey) return;
    this.countdownKey = key;
    this.countdown.textContent = key;
    this.countdown.className = v === 'GO' ? 'hud-countdown go' : 'hud-countdown num';
    restartAnim(this.countdown, 'anim');
  }
}
