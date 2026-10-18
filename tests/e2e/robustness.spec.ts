import { expect, test } from '@playwright/test';
import { simulateToEnd, startTournament, trackErrors } from './helpers';

test('com o armazenamento bloqueado, o jogo roda nas preferências padrão e a galeria vale na sessão', async ({ page }) => {
  await page.addInitScript(() => {
    const boom = () => { throw new Error('bloqueado'); };
    Storage.prototype.getItem = boom;
    Storage.prototype.setItem = boom;
    Storage.prototype.removeItem = boom;
  });
  const errors = trackErrors(page);
  await startTournament(page, { 'sb-initial-phase': 'knockout', 'sb-total-teams': 8 }, 1);
  await simulateToEnd(page);
  await expect(page.locator('#modal-champion')).toBeVisible();
  await page.click('#champ-btn-hall');
  await expect(page.locator('#modal-hall')).toBeVisible();
  await expect(page.locator('#hall-content')).toContainText('OVR');
  expect(errors).toEqual([]);
});

test('Novo Torneio mantém as preferências; teclas não disparam enquanto se digita', async ({ page }) => {
  const errors = trackErrors(page);
  await startTournament(page, { 'sb-initial-phase': 'knockout', 'sb-total-teams': 8 }, 1);
  await page.click('#btn-settings');
  await page.click('#settings-rows [data-toggle="ticker"]');
  await page.click('#settings-rows [data-seg="speed"][data-v="4"]');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.click('#btn-new-tournament');
  await page.waitForTimeout(600); // a confirmação ignora toques nos primeiros 500 ms
  await page.click('#confirm-yes');
  await expect(page.locator('#screen-sandbox-config')).toBeVisible();
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('mundial64-prefs-v1')!));
  expect(prefs.ticker).toBe(false);
  expect(prefs.speed).toBe(4);
  // digitar "m" na busca de clubes não liga/desliga o som
  await page.click('#btn-start-sandbox');
  const before = await page.locator('#btn-sound').getAttribute('aria-pressed');
  await page.fill('#search-team', 'm');
  await page.locator('#search-team').press('m');
  expect(await page.locator('#btn-sound').getAttribute('aria-pressed')).toBe(before);
  expect(errors).toEqual([]);
});

test('save corrompido é descartado com aviso @phone', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('mundial64-save-v3', '{"v":3,"config":{}}'));
  await page.reload();
  await expect(page.locator('#toast')).toContainText('corrompido');
  await expect(page.locator('#saved-game-banner')).toBeHidden();
  expect(errors).toEqual([]);
});

test('celular 390px: sem rolagem horizontal no painel, na partida e no plantão @phone', async ({ page }) => {
  const errors = trackErrors(page);
  await startTournament(page, { 'sb-initial-phase': 'groups' }, 2);
  const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(await noHScroll()).toBe(true);
  await page.click('#btn-simulate-match');
  await expect(page.locator('#round-ticker')).toBeVisible();
  expect(await page.locator('#tk-list .tk-row').count()).toBeLessThanOrEqual(8);
  expect(await noHScroll()).toBe(true);
  await page.waitForTimeout(400);
  await page.click('#tk-skip');
  await expect(page.locator('#modal-round-results')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await page.click('#btn-advance-round');
  await page.waitForTimeout(700);
  await page.click('#btn-play-match');
  await expect(page.locator('#screen-match')).toBeVisible();
  expect(await noHScroll()).toBe(true);
  const box = await page.locator('#match-events').boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(40);
  expect(errors).toEqual([]);
});
