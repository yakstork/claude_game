/**
 * Игровой цикл: фиксированный шаг симуляции (120 Гц) + рендер каждый кадр.
 */
export const FIXED_DT = 1 / 120;
const MAX_FRAME = 0.1;
const MAX_STEPS = 12;

export interface LoopHandlers {
  /** Фиксированный шаг симуляции */
  step(dt: number): void;
  /** Кадр: frameDt — реальное время кадра (с), alpha — доля до следующего шага */
  frame(frameDt: number, alpha: number): void;
}

export class GameLoop {
  private acc = 0;
  private last = -1;
  private running = false;
  /** FPS за последние ~0.5 с */
  fps = 60;
  private fpsFrames = 0;
  private fpsTime = 0;
  /** Масштаб времени симуляции (1 — норма) */
  timeScale = 1;

  constructor(
    private readonly handlers: LoopHandlers,
    private readonly schedule: (cb: ((t: number) => void) | null) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = -1;
    this.schedule((t) => this.tick(t));
  }

  stop(): void {
    this.running = false;
    this.schedule(null);
  }

  private tick(timeMs: number): void {
    const t = timeMs / 1000;
    if (this.last < 0) this.last = t;
    const realDt = Math.max(0, t - this.last);
    const frameDt = Math.min(MAX_FRAME, realDt);
    this.last = t;
    // FPS — по окну 0.5 с реального (не ограниченного) времени
    this.fpsFrames++;
    this.fpsTime += realDt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    this.acc += frameDt * this.timeScale;
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < MAX_STEPS) {
      this.handlers.step(FIXED_DT);
      this.acc -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) this.acc = 0;
    this.handlers.frame(frameDt, this.acc / FIXED_DT);
  }
}
