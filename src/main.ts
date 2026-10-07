import { RenderSystem } from './core/renderer';
import { Game } from './core/game';
import type { Quality } from './core/types';

declare global {
  interface Window {
    __neonRush?: {
      game: Game;
      backend: string;
      info: () => ReturnType<Game['debugInfo']>;
    };
  }
}

/** Глобальные мобильные защиты: контекстное меню, жесты масштабирования iOS, двойной тап */
function installMobileGuards(): void {
  const prevent = (e: Event) => e.preventDefault();
  window.addEventListener('contextmenu', prevent);
  // iOS Safari: pinch-zoom через gesture*-события
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, prevent, { passive: false });
  // зум двойным тапом запрещён через touch-action/viewport; dblclick на всякий случай
  document.addEventListener('dblclick', prevent, { passive: false });
  // скролл/зум страницы; внутренняя прокрутка разрешена только в контейнерах .nr-scroll
  document.addEventListener(
    'touchmove',
    (e) => {
      const t = e.target;
      if (t instanceof Element && t.closest('.nr-scroll') && e.touches.length === 1) return;
      if (e.cancelable) e.preventDefault();
    },
    { passive: false },
  );
}

async function boot(): Promise<void> {
  installMobileGuards();
  const params = new URLSearchParams(location.search);
  const container = document.getElementById('app')!;
  const render = await RenderSystem.create(container, params.get('webgl') === '1');
  const q = params.get('quality');
  const game = new Game(render, {
    autostart: params.get('autostart') === '1',
    attract: params.get('attract') !== '0',
    carIndex: Number(params.get('car') ?? 0) || 0,
    quality: q === 'low' || q === 'high' ? (q as Quality) : null,
    showFps: params.get('fps') === '1',
    autopilot: params.get('autopilot') === '1',
    debug: params.has('debug'),
    timeScale: Math.min(8, Math.max(0.1, Number(params.get('timescale') ?? 1) || 1)),
  });
  window.__neonRush = { game, backend: render.backendName, info: () => game.debugInfo() };
  await game.start();
}

boot().catch((err: unknown) => {
  console.error(err);
  const ui = document.getElementById('ui');
  if (ui) {
    ui.style.cssText = 'display:flex;align-items:center;justify-content:center;color:#ff2a6d;font:italic 900 20px "Arial Black",sans-serif;text-align:center;padding:24px';
    ui.textContent = 'Не удалось запустить Neon Rush: браузер не поддерживает WebGPU/WebGL2.';
  }
});
