import { expect, test } from '@playwright/test';
import { startTournament, state, tap, trackErrors } from './helpers';

test('janela aberta prende o foco: Tab + Enter não aciona botões escondidos atrás dela', async ({ page }) => {
  const errors = trackErrors(page);
  await startTournament(page, { 'sb-initial-phase': 'groups' }, 1);
  const played0 = await page.evaluate(() => JSON.stringify((window as any).__mc64.store.t).length);
  await page.click('#btn-settings');
  await expect(page.locator('#modal-settings')).toBeVisible();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => !!document.activeElement?.closest('#modal-settings') || document.activeElement === document.body);
    expect(inside).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-settings')).toBeHidden();
  await expect(page.locator('#btn-settings')).toBeFocused();
  const t = await state(page);
  expect(Object.values(t!.teams).every(x => x.st.j === 0)).toBe(true);
  expect(played0).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('Preferências no meio da partida: Tab nunca chega ao "Pular para o Fim"', async ({ page }) => {
  const errors = trackErrors(page);
  await startTournament(page, { 'sb-initial-phase': 'knockout', 'sb-total-teams': 8 }, 1);
  await tap(page, '#btn-draw');
  await tap(page, '#btn-draw-all');
  await tap(page, '#btn-finish-draw');
  await page.click('#modal-bracket [data-close]');
  await page.waitForTimeout(300);
  await page.click('#btn-play-match');
  await page.waitForTimeout(900);
  await page.waitForFunction(() => document.getElementById('minigame-overlay')!.classList.contains('hidden'));
  await page.click('#btn-live-settings');
  await expect(page.locator('#modal-settings')).toBeVisible();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.id)).not.toBe('btn-skip-match');
  }
  await page.keyboard.press('Enter');
  const live = await page.evaluate(() => (window as any).__mc64.store.t.live);
  expect(live).not.toBeNull();
  expect(live.min).toBeLessThan(90);
  expect(errors).toEqual([]);
});

test('plantão: Espaço no botão 2x acelera em vez de pular', async ({ page }) => {
  const errors = trackErrors(page);
  await startTournament(page, { 'sb-initial-phase': 'groups' }, 1);
  await page.click('#btn-simulate-match');
  await expect(page.locator('#round-ticker')).toBeVisible();
  await page.waitForTimeout(400);
  await page.focus('#tk-fast');
  await page.keyboard.press('Space');
  await expect(page.locator('#tk-fast')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#round-ticker')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-round-results')).toBeVisible({ timeout: 5000 });
  expect(errors).toEqual([]);
});
