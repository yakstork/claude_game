import { RenderSystem } from './core/renderer';
import { Game } from './core/game';

declare global {
  interface Window {
    __neonRush?: unknown;
  }
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const container = document.getElementById('app')!;
  const render = await RenderSystem.create(container, params.get('webgl') === '1');
  const game = new Game(render);
  window.__neonRush = { game, backend: render.backendName };
  game.start();
}

boot().catch((err: unknown) => {
  console.error(err);
  const ui = document.getElementById('ui');
  if (ui) ui.textContent = 'Не удалось запустить игру: ваш браузер не поддерживает WebGPU/WebGL2.';
});
