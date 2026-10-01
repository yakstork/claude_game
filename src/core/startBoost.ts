/**
 * Стартовый буст: нажатие газа точно на «GO» даёт короткий рывок.
 * Чистая логика (без DOM): судья смотрит на фронт нажатия газа относительно момента старта.
 *  - нажал в окне ±PERFECT вокруг GO → «идеальный»;
 *  - в окне ±GOOD → «хороший» (рывок слабее);
 *  - зажал газ раньше окна и держит → «рано» (без рывка);
 *  - не нажал до GOOD после GO → без рывка, молча.
 */
export type StartGrade = 'perfect' | 'good' | 'early' | 'late';

export const START_PERFECT = 0.1;
export const START_GOOD = 0.25;

/** Рывок по оценке: [секунды, сила] для VehiclePhysics.applyBoost */
export const START_BOOST: Record<'perfect' | 'good', readonly [number, number]> = {
  perfect: [0.6, 0.5],
  good: [0.45, 0.3],
};

export class StartBoostJudge {
  private prevDown = true; // газ, зажатый до начала отсчёта, — не «нажатие»
  private pressT: number | null = null;
  private done = false;

  reset(): void {
    this.prevDown = true;
    this.pressT = null;
    this.done = false;
  }

  /**
   * Каждый шаг: down — газ нажат, t — время относительно GO (до старта < 0).
   * Возвращает оценку один раз за старт, иначе null.
   */
  update(down: boolean, t: number): StartGrade | null {
    if (this.done) return null;
    if (down && !this.prevDown) this.pressT = t;
    if (!down) this.pressT = null;
    this.prevDown = down;
    if (t < 0) return null;
    if (down && this.pressT === null) {
      // держал газ с самого начала отсчёта
      this.done = true;
      return 'early';
    }
    if (this.pressT !== null) {
      this.done = true;
      const off = Math.abs(this.pressT);
      if (off <= START_PERFECT) return 'perfect';
      if (off <= START_GOOD) return 'good';
      return this.pressT < 0 ? 'early' : 'late';
    }
    if (t > START_GOOD) {
      this.done = true;
      return 'late';
    }
    return null;
  }
}
