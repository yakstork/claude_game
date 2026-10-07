/**
 * Визуальный урон машин (физику не затрагивает). Удары о стены и машины копят урон 0..1;
 * средний урон — искры и мерцание неона, сильный — дым из-под капота и трещина-глитч emissive.
 * Чистая логика, без рендера и DOM; без аллокаций в update.
 */

/** Порог среднего урона (искры, мерцающий неон) */
export const DAMAGE_MID = 0.3;
/** Порог сильного урона (дым, трещина) */
export const DAMAGE_HIGH = 0.65;
/** Удары слабее этого порога урона не копят */
const MIN_STRENGTH = 0.08;
/** Сколько урона даёт удар силой 1 */
const HIT_GAIN = 0.5;
/** Слабые касания не чаще, чем раз в столько секунд (стена-скольжение шлёт события каждый шаг) */
const HIT_COOLDOWN = 0.12;

export class CarDamage {
  /** Накопленный урон 0..1 */
  level = 0;
  private cooldown = 0;

  /** Удар (strength — сила события физики 0..~1). Возвращает приращение урона. */
  hit(strength: number): number {
    if (strength < MIN_STRENGTH || this.cooldown > 0) return 0;
    this.cooldown = HIT_COOLDOWN;
    const add = Math.min(1 - this.level, strength * HIT_GAIN);
    this.level += add;
    return add;
  }

  update(dt: number): void {
    if (this.cooldown > 0) this.cooldown -= dt;
  }

  reset(): void {
    this.level = 0;
    this.cooldown = 0;
  }

  get mid(): boolean {
    return this.level >= DAMAGE_MID;
  }

  get heavy(): boolean {
    return this.level >= DAMAGE_HIGH;
  }
}

/** Коэффициент неона 0.15..1: на среднем уроне — случайные провалы, на сильном — чаще и глубже. t — время, с. */
export function neonFlicker(level: number, t: number): number {
  if (level < DAMAGE_MID) return 1;
  const k = Math.min(1, (level - DAMAGE_MID) / (1 - DAMAGE_MID));
  // детерминированный «шум» из синусов разных частот
  const n = Math.sin(t * 37.1) * Math.sin(t * 11.3 + 1.7) + Math.sin(t * 71.9 + 0.4) * 0.5;
  const cut = 0.55 - k * 0.3;
  return n > cut ? 0.15 + (1 - k) * 0.3 : 1;
}

/** Искр в секунду от повреждённой машины (0 ниже среднего урона) */
export function sparkRate(level: number): number {
  if (level < DAMAGE_MID) return 0;
  return 1.5 + (level - DAMAGE_MID) * 6;
}

/** Частиц дыма в секунду (0 ниже сильного урона) */
export function smokeRate(level: number): number {
  if (level < DAMAGE_HIGH) return 0;
  return 8 + (level - DAMAGE_HIGH) * 40;
}
