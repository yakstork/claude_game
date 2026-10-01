import { describe, expect, it } from 'vitest';
import { GameLoop } from '../../src/core/loop';

/** Прогоняет цикл на виртуальном экране с частотой hz в течение seconds, возвращает FPS рендера */
function renderedFps(hz: number, maxFps: number, seconds = 2): { fps: number; simTime: number } {
  let cb: ((t: number) => void) | null = null;
  let frames = 0;
  let sim = 0;
  const loop = new GameLoop(
    {
      step: (dt) => {
        sim += dt;
      },
      frame: () => {
        frames++;
      },
    },
    (c) => {
      cb = c;
    },
  );
  loop.maxFps = maxFps;
  loop.start();
  const dtMs = 1000 / hz;
  for (let i = 0; i <= hz * seconds; i++) {
    // небольшой джиттер ±0.3 мс, как у настоящего rAF
    const jitter = (((i * 7919) % 7) - 3) * 0.1;
    cb!(i * dtMs + jitter);
  }
  return { fps: frames / seconds, simTime: sim };
}

describe('GameLoop: ограничение FPS', () => {
  it('без ограничения рисует каждый кадр экрана', () => {
    expect(renderedFps(144, 0).fps).toBeGreaterThan(142);
  });

  it('потолок 120: на 60 и 120 Гц кадры не теряются', () => {
    expect(renderedFps(60, 120).fps).toBeGreaterThan(59);
    expect(renderedFps(120, 120).fps).toBeGreaterThan(118);
  });

  it('потолок 120: на 144/165/240 Гц — около 120, не каждый второй кадр', () => {
    for (const hz of [144, 165, 240]) {
      const { fps } = renderedFps(hz, 120);
      expect(fps, `${hz} Гц`).toBeGreaterThan(110);
      expect(fps, `${hz} Гц`).toBeLessThanOrEqual(121);
    }
  });

  it('симуляция идёт в реальном времени независимо от потолка', () => {
    const { simTime } = renderedFps(165, 120, 2);
    expect(simTime).toBeGreaterThan(1.95);
    expect(simTime).toBeLessThan(2.05);
  });
});
