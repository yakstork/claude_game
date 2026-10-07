/**
 * Мобильная версия: эмуляция телефонов (альбомная ориентация, касания).
 * Браузер — Chromium (WebKit в среде нет), поэтому берём от профилей устройств
 * только вьюпорт, UA, isMobile/hasTouch и плотность пикселей.
 */
import { devices, expect, test, type Page } from '@playwright/test';

type Info = { state: string; uiMode: string | null; paused: boolean; speedKmh: number; touchMode: boolean; quality: string };

const phones = [
  { name: 'iPhone 13, альбомная', device: devices['iPhone 13 landscape'] },
  { name: 'Pixel 7, альбомная', device: devices['Pixel 7 landscape'] },
];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    else if (m.type() === 'warning' && /GL_INVALID|WebGL:/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

const info = (page: Page) => page.evaluate(() => window.__neonRush!.info() as unknown as Info);

async function center(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`нет элемента ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

for (const phone of phones) {
  test.describe(phone.name, () => {
    const { defaultBrowserType: _browser, ...emulation } = phone.device;
    void _browser;
    test.use(emulation);

    test('меню касанием, старт, мультитач газ+руль+дрифт, пауза, поворот в портрет', async ({ page, context }) => {
      const errors = collectErrors(page);
      await page.goto('/?attract=0');
      await page.waitForFunction(() => window.__neonRush?.info().state === 'menu', null, { timeout: 90_000 });

      let i = await info(page);
      expect(i.touchMode).toBe(true);
      expect(i.quality).toBe('low');

      // нет прокрутки страницы
      const scroll = await page.evaluate(() => ({
        w: document.documentElement.scrollWidth - innerWidth,
        h: document.documentElement.scrollHeight - innerHeight,
      }));
      expect(scroll.w).toBeLessThanOrEqual(0);
      expect(scroll.h).toBeLessThanOrEqual(0);

      // выбор машины касанием
      await page.getByRole('button', { name: 'Следующая машина' }).tap();
      await page.waitForFunction(() => window.__neonRush!.game.selectedCar === 1, null, { timeout: 30_000 });

      // старт гонки касанием
      await page.getByText('ГОНКА', { exact: true }).first().tap();
      await page.waitForFunction(() => window.__neonRush!.info().state === 'countdown', null, { timeout: 20_000 });
      await expect(page.locator('.nr-tc-btn.tc-gas')).toBeVisible();
      await page.waitForFunction(() => window.__neonRush!.info().state === 'racing', null, { timeout: 90_000 });

      // мультитач: три пальца одновременно — газ, руль вправо, дрифт
      const gas = await center(page, '.nr-tc-btn.tc-gas');
      const right = await center(page, '.nr-tc-btn.tc-right');
      const drift = await center(page, '.nr-tc-btn.tc-drift');
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
          { x: gas.x, y: gas.y, id: 1 },
          { x: right.x, y: right.y, id: 2 },
          { x: drift.x, y: drift.y, id: 3 },
        ],
      });
      const held = await page.evaluate(() => ({ ...window.__neonRush!.game.ui.touchState }));
      expect(held.throttle && held.right && held.drift).toBe(true);
      expect(held.left || held.brake).toBe(false);
      const ctl = await page.evaluate(() => {
        const c = window.__neonRush!.game.input.controls(0.5);
        return { throttle: c.throttle, steer: c.steer, handbrake: c.handbrake };
      });
      expect(ctl.throttle).toBe(1);
      expect(ctl.steer).toBeGreaterThan(0.9);
      expect(ctl.handbrake).toBe(true);
      // держим газ — машина разгоняется
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: gas.x, y: gas.y, id: 4 }] });
      await page.waitForFunction(() => window.__neonRush!.info().speedKmh > 8, null, { timeout: 60_000 });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const released = await page.evaluate(() => ({ ...window.__neonRush!.game.ui.touchState }));
      expect(Object.values(released).some(Boolean)).toBe(false);

      // пауза кнопкой и продолжение
      await page.locator('.nr-tc-pause').tap();
      await page.waitForFunction(() => window.__neonRush!.info().paused, null, { timeout: 10_000 });
      await page.getByText('Продолжить', { exact: false }).first().tap();
      await page.waitForFunction(() => !window.__neonRush!.info().paused, null, { timeout: 10_000 });

      // поворот в портрет — подсказка и автопауза
      const vp = page.viewportSize()!;
      await page.setViewportSize({ width: vp.height, height: vp.width });
      await expect(page.locator('.nr-rotate')).toBeVisible();
      await page.waitForFunction(() => window.__neonRush!.info().paused, null, { timeout: 10_000 });
      await page.setViewportSize(vp);
      await expect(page.locator('.nr-rotate')).toBeHidden();

      i = await info(page);
      expect(i.paused).toBe(true);
      expect(errors).toEqual([]);
    });
  });
}
