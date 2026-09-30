import { expect, test, type Page } from '@playwright/test';

type Info = {
  state: string;
  uiMode: string | null;
  paused: boolean;
  speedKmh: number;
  lap: number;
  backend: string;
  result: { playerPosition: number; rows: unknown[] } | null;
};

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    // ошибки WebGL Chrome пишет предупреждениями
    else if (m.type() === 'warning' && /GL_INVALID|WebGL:/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

const info = (page: Page) => page.evaluate(() => window.__neonRush!.info() as unknown as Info);

test('меню загружается, гонка стартует и машина едет, пауза работает', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__neonRush?.info().state === 'menu', null, { timeout: 60_000 });
  await expect(page.locator('#app canvas')).toBeVisible();
  await expect(page.locator('.logo-title >> visible=true').first()).toBeVisible();
  await expect(page.getByText('ГОНКА', { exact: false }).first()).toBeVisible();

  // Enter — «Гонка»
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__neonRush?.info().state === 'countdown', null, { timeout: 20_000 });
  await page.waitForFunction(() => window.__neonRush?.info().state === 'racing', null, { timeout: 60_000 });

  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => window.__neonRush!.info().speedKmh > 20, null, { timeout: 30_000 });
  await page.keyboard.up('KeyW');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__neonRush!.info().paused, null, { timeout: 10_000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__neonRush!.info().paused, null, { timeout: 10_000 });

  const i = await info(page);
  console.log('backend:', i.backend);
  expect(errors).toEqual([]);
});

test('гонка проходится до финиша и показывает результаты', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?autostart=1&car=2&quality=low');
  await page.waitForFunction(() => window.__neonRush?.info().state === 'countdown', null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__neonRush?.info().state === 'racing', null, { timeout: 60_000 });
  await page.evaluate(() => window.__neonRush!.game.debugSimulate(400));
  await page.waitForFunction(() => window.__neonRush!.info().uiMode === 'results', null, { timeout: 20_000 });
  const i = await info(page);
  expect(i.state).toBe('finished');
  expect(i.result?.rows.length).toBe(6);
  await expect(page.getByText('Ещё раз', { exact: false }).first()).toBeVisible();
  const records = await page.evaluate(() => localStorage.getItem('neonrush.records.v1'));
  expect(records).toContain('"races":1');
  expect(errors).toEqual([]);
});
