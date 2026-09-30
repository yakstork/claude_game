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

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const container = document.getElementById('app')!;
  const render = await RenderSystem.create(container, params.get('webgl') === '1');
  const q = params.get('quality');
  const game = new Game(render, {
    autostart: params.get('autostart') === '1',
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
