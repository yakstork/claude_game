import { describe, expect, it } from 'vitest';
import { CarDamage, DAMAGE_HIGH, DAMAGE_MID, neonFlicker, smokeRate, sparkRate } from '../../src/vehicle/damage';

describe('визуальный урон', () => {
  it('слабые касания не копят урон, сильные копят и не превышают 1', () => {
    const d = new CarDamage();
    expect(d.hit(0.03)).toBe(0);
    expect(d.level).toBe(0);
    for (let i = 0; i < 40; i++) {
      d.hit(0.6);
      d.update(0.2);
    }
    expect(d.level).toBeLessThanOrEqual(1);
    expect(d.level).toBeGreaterThan(0.99);
  });

  it('частые события одного касания гасятся кулдауном', () => {
    const d = new CarDamage();
    d.hit(0.5);
    const a = d.level;
    d.hit(0.5);
    expect(d.level).toBe(a);
    d.update(0.2);
    d.hit(0.5);
    expect(d.level).toBeGreaterThan(a);
  });

  it('пороги: искры и неон со среднего урона, дым с сильного', () => {
    expect(sparkRate(DAMAGE_MID - 0.01)).toBe(0);
    expect(sparkRate(DAMAGE_MID)).toBeGreaterThan(0);
    expect(smokeRate(DAMAGE_HIGH - 0.01)).toBe(0);
    expect(smokeRate(DAMAGE_HIGH)).toBeGreaterThan(0);
    let dips = 0;
    for (let t = 0; t < 10; t += 0.01) {
      expect(neonFlicker(DAMAGE_MID - 0.01, t)).toBe(1);
      if (neonFlicker(0.9, t) < 1) dips++;
    }
    expect(dips).toBeGreaterThan(20);
    expect(dips).toBeLessThan(900);
  });

  it('reset обнуляет урон', () => {
    const d = new CarDamage();
    d.hit(1);
    expect(d.mid).toBe(true);
    d.reset();
    expect(d.level).toBe(0);
    expect(d.heavy).toBe(false);
  });
});
