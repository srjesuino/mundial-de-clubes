import { expect, test } from '@playwright/test';

// Build do GitHub Pages (BASE=/mundial-de-clubes/) com service worker ativo
const ROOT = 'http://localhost:4174/mundial-de-clubes/';

async function controlled(page: import('@playwright/test').Page) {
  await page.goto(ROOT);
  await page.waitForFunction(() => !!(window as any).__mc64);
  // clientsClaim: a 1ª visita já fica sob o service worker
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20_000 });
}

test('sub-caminho do Pages: tudo carrega de /mundial-de-clubes/ e o service worker assume a 1ª visita', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', r => { const u = new URL(r.url()); if (u.host === 'localhost:4174' && !u.pathname.startsWith('/mundial-de-clubes/')) outside.push(u.pathname); });
  await controlled(page);
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope);
  expect(scope).toBe(ROOT);
  expect(outside).toEqual([]);
});

test('offline: a raiz abre com qualquer query; caminhos mais fundos não viram uma página quebrada', async ({ page, context }) => {
  await controlled(page);
  await page.reload(); // garante o precache completo em uso
  await context.setOffline(true);
  for (const url of [ROOT, ROOT + '?ref=whatsapp', ROOT + 'index.html?x=1']) {
    await page.goto(url);
    await page.waitForFunction(() => !!(window as any).__mc64, null, { timeout: 10_000 });
  }
  const deep = await page.goto(ROOT + 'jogo/').then(() => 'loaded', () => 'failed');
  if (deep === 'loaded') expect(await page.evaluate(() => !!(window as any).__mc64)).toBe(false);
  await context.setOffline(false);
});

test('offline: dá para começar e simular uma rodada sem internet', async ({ page, context }) => {
  await controlled(page);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__mc64);
  await page.click('#btn-start-sandbox');
  await page.locator('#teams-grid button').first().click();
  await page.click('#btn-confirm-teams');
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await page.waitForTimeout(750);
  await page.click('#btn-simulate-match');
  await expect(page.locator('#round-ticker:not(.hidden), #modal-round-results:not(.hidden)')).toHaveCount(1, { timeout: 10_000 });
  await context.setOffline(false);
});

test('escudos: o que a 1ª visita não guardou é baixado na visita seguinte', async ({ page, context }) => {
  const { ALL_TEAMS } = await import('../../src/data/teams');
  const total = new Set(ALL_TEAMS.map(t => t.logo)).size;
  // 1ª visita sem o servidor de escudos (rede caiu): nada vai para o cache
  let up = false;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await context.route('https://tmssl.akamaized.net/**', route => (up
    ? route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: png })
    : route.abort()));
  await controlled(page);
  const count = () => page.evaluate(async () => (await (await caches.open('escudos-v2')).keys()).length);
  await page.waitForTimeout(1500);
  expect(await count()).toBe(0);
  // volta a rede: ao abrir de novo, completa os escudos sozinho
  up = true;
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__mc64);
  await expect.poll(count, { timeout: 20_000 }).toBe(total);
});
