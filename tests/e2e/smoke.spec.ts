import { expect, test } from '@playwright/test';

test('игра загружается без ошибок в консоли', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => !!window.__neonRush, null, { timeout: 30_000 });
  await expect(page.locator('#app canvas')).toBeVisible();
  await page.waitForTimeout(1500);
  const backend = await page.evaluate(() => (window.__neonRush as { backend: string }).backend);
  console.log('backend:', backend);
  expect(errors).toEqual([]);
});
