/** Маленькие помощники для построения DOM. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
  parent?: HTMLElement | SVGElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  parent?: Element,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs)) e.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(e);
  return e;
}

/** Перезапуск CSS-анимации на элементе (не для горячего пути). */
export function restartAnim(e: HTMLElement, cls: string): void {
  e.classList.remove(cls);
  void e.offsetWidth;
  e.classList.add(cls);
}

// ─── Касания: тап без «призрачных» кликов ──────────────────────────────────
// Глобальный защитник main.ts гасит touchend быстрее 320 мс после предыдущего — вместе с ним
// пропадает и синтетический click, так что частые тапы по кнопкам терялись бы. Поэтому тач-тап
// обрабатывается по pointerup, а следующий за ним синтетический click игнорируется.

/** Время последнего pointerup не от мыши (тач/перо), мс performance.now(). */
let lastTouchUpAt = -1e9;
let touchTracking = false;
const GHOST_CLICK_MS = 550;
const TAP_SLOP_PX = 14;

function trackTouchUps(): void {
  if (touchTracking || typeof window === 'undefined') return;
  touchTracking = true;
  window.addEventListener(
    'pointerup',
    (e) => {
      if (e.pointerType !== 'mouse') lastTouchUpAt = performance.now();
    },
    true,
  );
}

/** Клик, который по времени относится к только что завершённому касанию (ghost click). */
export function isGhostClick(): boolean {
  return performance.now() - lastTouchUpAt < GHOST_CLICK_MS;
}

/**
 * Нажатие на элемент: мышь — по click, касание/перо — по pointerup (если палец не ушёл
 * дальше ~14 px и pointerdown был на этом же элементе). Повторный синтетический click не срабатывает.
 * viaClick — всегда срабатывать по click (для действий, требующих жеста браузера).
 */
export function onTap(target: HTMLElement, fn: () => void, viaClick = false): void {
  trackTouchUps();
  let downId = -1;
  let sx = 0;
  let sy = 0;
  let pressedHere = false;
  target.addEventListener('pointerdown', (e) => {
    pressedHere = true;
    if (e.pointerType === 'mouse') return;
    downId = e.pointerId;
    sx = e.clientX;
    sy = e.clientY;
  });
  target.addEventListener('pointerup', (e) => {
    if (viaClick || e.pointerType === 'mouse' || e.pointerId !== downId) return;
    downId = -1;
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > TAP_SLOP_PX) return;
    fn();
  });
  target.addEventListener('pointercancel', () => {
    downId = -1;
    pressedHere = false;
  });
  target.addEventListener('click', () => {
    const mine = pressedHere;
    pressedHere = false;
    // viaClick: действие требует «настоящего» жеста (полноэкранный режим) — берём сам click,
    // но призрачный (без нажатия на этом элементе, сразу после чужого касания) отбрасываем
    if (viaClick ? !mine && isGhostClick() : isGhostClick()) return;
    fn();
  });
}

/** Треугольная стрелка (SVG inline — эмодзи-глифы ◀ ▶ на iOS рисуются цветными). */
export function arrowIcon(dir: 'left' | 'right', parent?: HTMLElement): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 24 24', class: 'icon-arrow', 'aria-hidden': 'true' }, parent);
  svgEl('polygon', { points: dir === 'left' ? '17,3 5,12 17,21' : '7,3 19,12 7,21', fill: 'currentColor' }, svg);
  return svg;
}
