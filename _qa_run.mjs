import { chromium } from '@playwright/test';
const B = 'http://localhost:4191';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const res = [];
const log = (k, v) => { res.push([k, v]); console.log(k, JSON.stringify(v)); };
async function mk(url, name) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { const t = m.text(); if (m.type()==='error' || (m.type()==='warning' && /GL_INVALID|WebGL|GL ERROR/i.test(t))) errs.push(m.type()+': '+t.slice(0,200)); });
  page.on('pageerror', e => errs.push('pageerror: ' + e));
  await page.addInitScript(() => {
    window.__pad = { connected: true, mapping: 'standard', id: 'fake', index: 0, axes: [0,0,0,0], buttons: Array.from({length:17},()=>({pressed:false,value:0})) };
    navigator.getGamepads = () => [window.__pad, null, null, null];
  });
  await page.goto(B + url);
  await page.waitForFunction(() => window.__neonRush?.info().state, null, { timeout: 90000 });
  return { page, errs, name };
}
const st = p => p.evaluate(() => window.__neonRush.info());
const waitState = (p, s) => p.waitForFunction(s => window.__neonRush.info().state === s, s, { timeout: 90000 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const padBtn = (p, i, v) => p.evaluate(([i, v]) => { window.__pad.buttons[i] = { pressed: v, value: v ? 1 : 0 }; }, [i, v]);

// (a) gamepad
{
  const { page, errs } = await mk('/?autostart=1&car=1&quality=low');
  await waitState(page, 'racing');
  await padBtn(page, 1, true); await sleep(4000);
  const s1 = await page.evaluate(() => ({ paused: window.__neonRush.info().paused, nitro: window.__neonRush.game.input.controls().nitro }));
  log('a.B held', s1);
  await padBtn(page, 1, false); await sleep(1500);
  await padBtn(page, 9, true); await sleep(1500); await padBtn(page, 9, false);
  await page.waitForFunction(() => window.__neonRush.info().paused, null, { timeout: 20000 });
  log('a.Start paused', (await st(page)).paused);
  // (c) Esc from pause -> settings
  await page.evaluate(() => window.__neonRush.game.input.clear?.());
  await page.keyboard.press('Escape'); // unpause
  await page.waitForFunction(() => !window.__neonRush.info().paused, null, { timeout: 20000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__neonRush.info().paused, null, { timeout: 20000 });
  await page.locator('span:visible', { hasText: /^НАСТРОЙКИ$/ }).first().click();
  await sleep(1000);
  const vis = await page.locator('.screen-title:visible').allTextContents();
  log('c.settings open from pause (visible NАСТРОЙКИ titles)', vis);
  await page.keyboard.press('Escape'); await sleep(1500);
  const after = await page.evaluate(() => ({ paused: window.__neonRush.info().paused, ui: window.__neonRush.info().uiMode, titles: [...document.querySelectorAll('.screen-title')].filter(e=>e.offsetParent).map(e=>e.textContent) }));
  log('c.after Esc in settings (from pause)', after);
  log('a.errors', errs);
  await page.context().close();
}
// (c) from menu, (d) menu screenshot, (b) low quality menu + toggling
for (const q of ['low', 'high']) {
  const { page, errs } = await mk('/?quality=' + q);
  await waitState(page, 'menu'); await sleep(2500);
  await page.screenshot({ path: `/tmp/qa-neon2/menu-${q}.png` });
  await page.locator('span:visible', { hasText: /^НАСТРОЙКИ$/ }).first().click(); await sleep(800);
  log(`c.menu ${q} settings opened`, await page.evaluate(() => [...document.querySelectorAll('.screen-title')].filter(e=>e.offsetParent).map(e=>e.textContent)));
  await page.keyboard.press('Escape'); await sleep(1000);
  log(`c.menu ${q} after Esc`, await page.evaluate(() => [...document.querySelectorAll('.screen-title')].filter(e=>e.offsetParent).map(e=>e.textContent)));
  // toggle
  for (const qq of ['high','low','high','low']) { await page.evaluate(q => window.__neonRush.game.applySettings({ ...window.__neonRush.game.settings, quality: q }, false), qq); await sleep(1200); }
  await page.evaluate(() => window.__neonRush.game.startRace(0));
  await waitState(page, 'racing');
  for (const qq of ['high','low','high','low']) { await page.evaluate(q => window.__neonRush.game.applySettings({ ...window.__neonRush.game.settings, quality: q }, false), qq); await sleep(1500); }
  log(`b.errors start=${q}`, errs);
  await page.context().close();
}
// (g) drift flush
{
  const { page, errs } = await mk('/?autostart=1&car=0&quality=low');
  await waitState(page, 'racing');
  const r = await page.evaluate(() => {
    const g = window.__neonRush.game;
    g.drift.update = () => []; // отключаем штатное обновление, остаётся только flush на финише
    g.drift.combo.active = true; g.drift.combo.points = 1000; g.drift.combo.multiplier = 3;
    const before = g.drift.total;
    g.debugSimulate(400);
    return { before, total: g.drift.total, result: window.__neonRush.info().result?.driftScore ?? null, state: window.__neonRush.info().state };
  });
  log('d.drift flush', r);
  log('d.errors', errs);
  await page.context().close();
}
await browser.close();
