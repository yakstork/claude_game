import { describe, expect, it } from 'vitest';
import {
  RIVALS_KEY,
  chooseRival,
  emptyRivals,
  headToHead,
  loadRivals,
  radioLine,
  recordRace,
  saveRivals,
  type RivalRow,
} from '../../src/race/rivals';
import { BOT_PROFILES } from '../../src/vehicle/specs';

const names = ['NOVA', 'BLAZE', 'ECHO', 'RONIN', 'KITE'];

/** Итог гонки: игрок на месте p, боты — по порядку в order на остальных местах */
function rows(playerPos: number, order: string[]): RivalRow[] {
  const out: RivalRow[] = [{ name: 'ВЫ', position: playerPos, isPlayer: true }];
  let pos = 1;
  for (const n of order) {
    if (pos === playerPos) pos++;
    out.push({ name: n, position: pos++, isPlayer: false });
  }
  return out;
}

describe('соперник', () => {
  it('без истории выбирается первый бот; потом — ближайший по результатам', () => {
    const d = emptyRivals();
    expect(chooseRival(d, names)).toBe('NOVA');
    // игрок стабильно 3-й: ECHO всегда 3-й/4-й рядом, NOVA и BLAZE впереди на 1–2 места
    for (let i = 0; i < 3; i++) {
      recordRace(d, rows(3, ['NOVA', 'BLAZE', 'ECHO', 'RONIN', 'KITE']));
      recordRace(d, rows(4, ['NOVA', 'BLAZE', 'ECHO', 'RONIN', 'KITE']));
    }
    expect(chooseRival(d, names)).toBe('ECHO');
  });

  it('счёт личных встреч считается по местам', () => {
    const d = emptyRivals();
    recordRace(d, rows(1, ['NOVA', 'BLAZE', 'ECHO', 'RONIN', 'KITE']));
    recordRace(d, rows(4, ['NOVA', 'BLAZE', 'ECHO', 'RONIN', 'KITE']));
    expect(headToHead(d, 'NOVA')).toEqual({ you: 1, bot: 1 });
    expect(headToHead(d, 'KITE')).toEqual({ you: 2, bot: 0 });
    expect(headToHead(d, 'НЕТ')).toEqual({ you: 0, bot: 0 });
  });

  it('сохранение в neonrush.rivals.v1 и устойчивость к мусору', () => {
    const store = new Map<string, string>();
    const st = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const d = emptyRivals();
    recordRace(d, rows(2, ['NOVA', 'BLAZE', 'ECHO', 'RONIN', 'KITE']));
    d.rival = 'NOVA';
    saveRivals(d, st);
    expect(RIVALS_KEY).toBe('neonrush.rivals.v1');
    expect(loadRivals(st)).toEqual(d);
    store.set(RIVALS_KEY, '[1,{');
    expect(loadRivals(st)).toEqual(emptyRivals());
    store.set(RIVALS_KEY, JSON.stringify({ bots: { X: { diff: 'a', n: null, you: -5 } }, rival: 5 }));
    expect(loadRivals(st).bots.X).toEqual({ diff: 0, n: 0, you: 0, bot: 0 });
  });
});

describe('реплики-«рации»', () => {
  const bad = /(^|[^а-яё])(хуй|хуе|пизд|бля|ебан|ебат|сука|гонд)/i;
  it('детерминированы, не пусты, короткие и без мата', () => {
    for (const kind of ['botPassed', 'playerPassed', 'finalLap'] as const) {
      for (const trait of [undefined, ...BOT_PROFILES.map((b) => b.trait)]) {
        for (let seed = 0; seed < 30; seed++) {
          const a = radioLine(kind, trait, seed);
          expect(a).toBe(radioLine(kind, trait, seed));
          expect(a.length).toBeGreaterThan(3);
          expect(a.length).toBeLessThan(50);
          expect(a).not.toMatch(bad);
        }
      }
    }
  });
});

describe('характеры ботов', () => {
  it('у пяти ботов — пять разных характеров', () => {
    const traits = BOT_PROFILES.map((b) => b.trait);
    expect(new Set(traits).size).toBe(5);
    expect(new Set(traits)).toEqual(new Set(['aggressor', 'clean', 'drifter', 'nitro', 'cunning']));
  });
});
