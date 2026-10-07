import { expect, test, type Page } from '@playwright/test';

/** Smoke: каждый режим стартует, едет несколько секунд, ставится на паузу — без ошибок консоли. */
const MODES = ['race', 'cup', 'timeAttack', 'drift', 'elimination', 'versus'] as const;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

test('все режимы и кампания стартуют без ошибок консоли', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await page.goto('/?quality=low');
  await page.waitForFunction(() => window.__neonRush?.info().state === 'menu', null, { timeout: 60_000 });

  for (const mode of MODES) {
    await page.evaluate((m) => {
      const g = window.__neonRush!.game;
      g.applySettings({ ...g.settings, raceMode: m, laps: 1 }, false);
      g.startRace(0);
    }, mode);
    await page.waitForFunction(() => window.__neonRush!.info().state === 'countdown', null, { timeout: 20_000 });
    await page.evaluate(() => window.__neonRush!.game.debugSimulate(8));
    expect(await page.evaluate(() => window.__neonRush!.info().state), mode).toBe('racing');
    await page.evaluate(() => window.__neonRush!.game.pause());
    await page.waitForFunction(() => window.__neonRush!.info().paused, null, { timeout: 10_000 });
    await page.evaluate(() => window.__neonRush!.game.resume());
    await page.evaluate(() => window.__neonRush!.game.enterMenu());
    await page.waitForFunction(() => window.__neonRush!.info().state === 'menu', null, { timeout: 10_000 });
  }

  // кампания: первое событие
  await page.evaluate(() => {
    const g = window.__neonRush!.game as unknown as { campaignCtl: { start(id: string): void } };
    g.campaignCtl.start('c1e1');
  });
  await page.waitForFunction(() => window.__neonRush!.info().state === 'countdown', null, { timeout: 20_000 });
  await page.evaluate(() => window.__neonRush!.game.debugSimulate(8));
  await page.evaluate(() => window.__neonRush!.game.enterMenu());

  expect(errors).toEqual([]);
});
