import { describe, expect, it } from 'vitest';
import {
  CAREER_KEY,
  COLOR_PRICE,
  MAX_LEVEL,
  applyUpgrades,
  award,
  buyColor,
  buyNumberSlot,
  buyStripe,
  selectNumber,
  selectStripe,
  NUMBER_PRICE,
  STRIPE_PRICE,
  buyUpgrade,
  computeReward,
  emptyCareer,
  levelsOf,
  loadCareer,
  multipliersFor,
  sanitizeCareer,
  saveCareer,
  selectColor,
  upgradePrice,
  type RewardInput,
  type StorageLike,
} from '../../src/race/career';
import { HANDLING_DEFAULTS } from '../../src/vehicle/handling';
import { CUSTOM_PALETTE } from '../../src/vehicle/specs';

function mem(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const base: RewardInput = {
  mode: 'race', difficulty: 'normal', position: 1, racers: 6, laps: 3, driftScore: 0,
  newBestLap: false, newBestRace: false, newBestDrift: false, cupWon: false,
};

describe('цены', () => {
  it('растут с уровнем и ограничены 1..5', () => {
    for (const b of ['engine', 'grip', 'nitro'] as const) {
      let prev = 0;
      for (let l = 1; l <= MAX_LEVEL; l++) {
        const p = upgradePrice(b, l)!;
        expect(p).toBeGreaterThan(prev);
        prev = p;
      }
      expect(upgradePrice(b, 0)).toBeNull();
      expect(upgradePrice(b, MAX_LEVEL + 1)).toBeNull();
    }
  });
});

describe('награда', () => {
  it('победа лучше 4-го места, сложность умножает', () => {
    const w = computeReward(base).total;
    const p4 = computeReward({ ...base, position: 4 }).total;
    const p6 = computeReward({ ...base, position: 6 }).total;
    expect(w).toBeGreaterThan(p4);
    expect(p4).toBeGreaterThan(p6);
    expect(computeReward({ ...base, difficulty: 'hard' }).total).toBeGreaterThan(w);
    expect(computeReward({ ...base, difficulty: 'easy' }).total).toBeLessThan(w);
  });
  it('дрифт, рекорды и кубок прибавляют; итог равен сумме строк', () => {
    const r = computeReward({ ...base, driftScore: 8000, newBestLap: true, newBestRace: true, newBestDrift: true, cupWon: true, stunts: 3 });
    expect(r.total).toBe(r.lines.reduce((s, l) => s + l.value, 0));
    expect(r.total).toBeGreaterThan(computeReward(base).total + 300);
  });
  it('заезд на время без бонуса за место; 1 круг платит меньше', () => {
    const ta = computeReward({ ...base, mode: 'timeAttack', racers: 1 });
    expect(ta.lines.some((l) => l.label.includes('МЕСТО'))).toBe(false);
    expect(computeReward({ ...base, laps: 1 }).total).toBeLessThan(computeReward(base).total);
  });
  it('начисление', () => {
    const c = emptyCareer();
    const r = computeReward(base);
    award(c, r);
    expect(c.credits).toBe(r.total);
    expect(c.earned).toBe(r.total);
  });
});

describe('покупки', () => {
  it('улучшение: нехватка, успех, максимум', () => {
    const c = emptyCareer();
    expect(buyUpgrade(c, 'razor', 'engine')).toBe('poor');
    c.credits = 100000;
    for (let i = 0; i < MAX_LEVEL; i++) expect(buyUpgrade(c, 'razor', 'engine')).toBe('ok');
    expect(buyUpgrade(c, 'razor', 'engine')).toBe('maxed');
    expect(levelsOf(c, 'razor').engine).toBe(MAX_LEVEL);
    expect(levelsOf(c, 'grizzly').engine).toBe(0);
    let spent = 0;
    for (let l = 1; l <= MAX_LEVEL; l++) spent += upgradePrice('engine', l)!;
    expect(c.credits).toBe(100000 - spent);
  });
  it('цвета: покупка из палитры, повтор, выбор', () => {
    const c = emptyCareer();
    const col = CUSTOM_PALETTE.body[2];
    expect(buyColor(c, 'body', 0x123456)).toBe('invalid');
    expect(buyColor(c, 'body', col)).toBe('poor');
    c.credits = 1000;
    expect(buyColor(c, 'body', col)).toBe('ok');
    expect(c.credits).toBe(1000 - COLOR_PRICE.body);
    expect(buyColor(c, 'body', col)).toBe('owned');
    const factory = CUSTOM_PALETTE.body[0];
    expect(selectColor(c, 'razor', 'body', CUSTOM_PALETTE.body[3], factory)).toBe(false);
    expect(selectColor(c, 'razor', 'body', col, factory)).toBe(true);
    expect(c.cars.razor.body).toBe(col);
    expect(selectColor(c, 'razor', 'body', factory, factory)).toBe(true);
    expect(c.cars.razor.body).toBeNull();
  });
});

describe('эффекты', () => {
  it('нулевые уровни ничего не меняют, максимум — не более +8%', () => {
    const h = HANDLING_DEFAULTS.razor;
    const same = applyUpgrades(h, { engine: 0, grip: 0, nitro: 0 });
    expect(same).toEqual(h);
    const up = applyUpgrades(h, { engine: 5, grip: 5, nitro: 5 });
    expect(up).not.toBe(h);
    expect(up.maxSpeed / h.maxSpeed).toBeGreaterThan(1);
    for (const k of Object.keys(h) as (keyof typeof h)[]) {
      const ratio = up[k] / h[k];
      expect(ratio).toBeGreaterThanOrEqual(1 / 1.081);
      expect(ratio).toBeLessThanOrEqual(1.081);
    }
    expect(up.nitroUse).toBeLessThan(h.nitroUse);
    expect(up.grip).toBeGreaterThan(h.grip);
  });
  it('множители монотонны и устойчивы к мусору', () => {
    expect(multipliersFor({ engine: 2, grip: 0, nitro: 0 }).acceleration).toBeLessThan(multipliersFor({ engine: 3, grip: 0, nitro: 0 }).acceleration);
    expect(multipliersFor({ engine: NaN, grip: 99, nitro: -4 })).toEqual(multipliersFor({ engine: 0, grip: 5, nitro: 0 }));
  });
});

describe('сохранение', () => {
  it('круговой обмен', () => {
    const s = mem();
    const c = emptyCareer();
    c.credits = 500;
    c.owned.neon.push(CUSTOM_PALETTE.neon[1]);
    buyUpgrade(c, 'razor', 'grip');
    saveCareer(c, s);
    expect(s.data.has(CAREER_KEY)).toBe(true);
    expect(loadCareer(s)).toEqual(c);
  });
  it('мусор и битый JSON дают пустую карьеру', () => {
    const s = mem();
    s.setItem(CAREER_KEY, '{oops');
    expect(loadCareer(s)).toEqual(emptyCareer());
    expect(sanitizeCareer(null)).toEqual(emptyCareer());
    expect(sanitizeCareer(42)).toEqual(emptyCareer());
  });
  it('валидация: границы, чужие цвета, неизвестные поля', () => {
    const c = sanitizeCareer({
      credits: -5, earned: 'x',
      owned: { body: [CUSTOM_PALETTE.body[0], 12345, CUSTOM_PALETTE.body[0]], neon: 'no' },
      cars: { razor: { levels: { engine: 99, grip: -2, nitro: 2.7 }, body: CUSTOM_PALETTE.body[0], neon: CUSTOM_PALETTE.neon[0] }, bad: 7 },
    });
    expect(c.credits).toBe(0);
    expect(c.earned).toBe(0);
    expect(c.owned.body).toEqual([CUSTOM_PALETTE.body[0]]);
    expect(c.owned.neon).toEqual([]);
    expect(c.cars.razor.levels).toEqual({ engine: MAX_LEVEL, grip: 0, nitro: 2 });
    expect(c.cars.razor.body).toBe(CUSTOM_PALETTE.body[0]);
    expect(c.cars.razor.neon).toBeNull();
    expect(c.cars.bad).toBeUndefined();
  });
  it('без хранилища не падает', () => {
    expect(loadCareer(null)).toEqual(emptyCareer());
    expect(() => saveCareer(emptyCareer(), null)).not.toThrow();
  });
});

describe('ливрея: полоса и номер', () => {
  it('полоса: покупка, выбор только купленной, 0 — без полосы', () => {
    const c = emptyCareer();
    expect(buyStripe(c, 0)).toBe('invalid');
    expect(buyStripe(c, 2)).toBe('poor');
    c.credits = 1000;
    expect(buyStripe(c, 2)).toBe('ok');
    expect(c.credits).toBe(1000 - STRIPE_PRICE);
    expect(buyStripe(c, 2)).toBe('owned');
    expect(selectStripe(c, 'razor', 1)).toBe(false);
    expect(selectStripe(c, 'razor', 2)).toBe(true);
    expect(c.cars.razor.stripe).toBe(2);
    expect(selectStripe(c, 'razor', 0)).toBe(true);
    expect(c.cars.razor.stripe).toBe(0);
  });
  it('номер: нужен купленный слот, диапазон 0..99, слот per-car', () => {
    const c = emptyCareer();
    c.credits = 500;
    expect(selectNumber(c, 'razor', 7)).toBe(false);
    expect(buyNumberSlot(c, 'razor')).toBe('ok');
    expect(c.credits).toBe(500 - NUMBER_PRICE);
    expect(buyNumberSlot(c, 'razor')).toBe('owned');
    expect(selectNumber(c, 'razor', 100)).toBe(false);
    expect(selectNumber(c, 'razor', 7)).toBe(true);
    expect(selectNumber(c, 'grizzly', 7)).toBe(false);
    expect(selectNumber(c, 'razor', null)).toBe(true);
    expect(c.cars.razor.number).toBeNull();
  });
  it('сохранение ливреи и миграция старого формата без потери данных', () => {
    const s = mem();
    const c = emptyCareer();
    c.credits = 900;
    buyStripe(c, 3);
    selectStripe(c, 'photon', 3);
    buyNumberSlot(c, 'photon');
    selectNumber(c, 'photon', 42);
    saveCareer(c, s);
    expect(loadCareer(s)).toEqual(c);
    // старое сохранение (до ливреи): нет stripe/number/owned.stripes
    s.setItem(
      CAREER_KEY,
      JSON.stringify({ credits: 321, earned: 999, cars: { razor: { levels: { engine: 3, grip: 1, nitro: 0 }, body: CUSTOM_PALETTE.body[1], neon: null } }, owned: { body: [CUSTOM_PALETTE.body[1]], neon: [] } }),
    );
    const old = loadCareer(s);
    expect(old.credits).toBe(321);
    expect(old.earned).toBe(999);
    expect(old.cars.razor.levels).toEqual({ engine: 3, grip: 1, nitro: 0 });
    expect(old.cars.razor.body).toBe(CUSTOM_PALETTE.body[1]);
    expect(old.cars.razor.stripe).toBe(0);
    expect(old.cars.razor.number).toBeNull();
    expect(old.owned.stripes).toEqual([]);
  });
  it('валидация: неизвестная полоса и номер без слота отбрасываются', () => {
    const c = sanitizeCareer({ credits: 1, owned: { stripes: [1, 9, 'x'] }, cars: { razor: { stripe: 2, number: 5, numberOwned: false }, volt: { stripe: 1, number: 12, numberOwned: true } } });
    expect(c.owned.stripes).toEqual([1]);
    expect(c.cars.razor.stripe).toBe(0);
    expect(c.cars.razor.number).toBeNull();
    expect(c.cars.volt.stripe).toBe(1);
    expect(c.cars.volt.number).toBe(12);
  });
});
