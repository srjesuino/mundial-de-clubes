import { expect, test } from '@playwright/test';
import { playLiveWithKeyboard, startTournament, state, tap, trackErrors } from './helpers';

async function toFirstKoMatch(page: import('@playwright/test').Page) {
  await tap(page, '#btn-draw');
  await tap(page, '#btn-draw-all');
  await tap(page, '#btn-finish-draw');
  await page.click('#modal-bracket [data-close]');
  await page.waitForTimeout(300);
}

test('partida ao vivo jogada só pelo teclado: registra lances, gols por minuto e o resumo', async ({ page }) => {
  const errors = trackErrors(page);
  await startTournament(page, { 'sb-initial-phase': 'knockout', 'sb-total-teams': 8 }, 1);
  await toFirstKoMatch(page);
  await page.click('#btn-play-match');
  await expect(page.locator('#screen-match')).toBeVisible();
  await expect(page.locator('#wp-svg path').first()).toBeAttached();
  await page.waitForTimeout(700);
  // postura ofensiva pelo teclado (com um lance aberto a tecla é do minigame, então espera ele fechar)
  await expect(async () => {
    await page.waitForFunction(() => document.getElementById('minigame-overlay')!.classList.contains('hidden'));
    await page.keyboard.press('o');
    await expect(page.locator('#live-tac [data-tac="att"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 300 });
  }).toPass({ timeout: 20_000 });
  await playLiveWithKeyboard(page);
  const m = await page.evaluate(() => {
    const t = (window as any).__mc64.store.t;
    return t.knockout[0].matches.find((x: any) => t.userIds.includes(x.home) || t.userIds.includes(x.away));
  });
  expect(m.played).toBe(true);
  expect(m.res.live).toBeTruthy();
  expect(m.res.gm.length).toBe(m.res.gH + m.res.gA);
  expect(m.tactics).toBeTruthy();
  await expect(page.locator('#match-events')).toContainText('Ficha do jogo');
  await page.waitForTimeout(800);
  await page.click('#btn-finish-match');
  if (await page.locator('#round-ticker').isVisible()) await tap(page, '#tk-skip', 300);
  await expect(page.locator('#modal-round-results')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  // relatório da partida: abre ao tocar no jogo
  await page.locator(`#rr-list [data-report="${m.id}"]`).click();
  await expect(page.locator('#modal-report')).toBeVisible();
  await expect(page.locator('#report-content')).toContainText('Jogada ao vivo');
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-report')).toBeHidden();
  const skill = await page.evaluate(() => (window as any).__mc64.store.t.skill);
  if (skill) expect(skill.att.n + skill.def.n + skill.penS.n + skill.penD.n).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('recarregar no meio da partida: o simulador conclui pelo placar salvo, sem registro de jogo ao vivo', async ({ page }) => {
  const errors = trackErrors(page);
  await startTournament(page, { 'sb-initial-phase': 'knockout', 'sb-total-teams': 8 }, 1);
  await toFirstKoMatch(page);
  await page.click('#btn-play-match');
  await page.waitForFunction(() => { const t = (window as any).__mc64.store.t; return t.live && t.live.min >= 10; }, null, { timeout: 30_000 });
  await page.reload();
  await page.click('#btn-continue-save');
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  const t = await state(page);
  expect(t!.live).toBeNull();
  const m = await page.evaluate(() => {
    const t = (window as any).__mc64.store.t;
    return t.knockout[0].matches.find((x: any) => t.userIds.includes(x.home) || t.userIds.includes(x.away));
  });
  expect(m.played).toBe(true);
  expect(m.res.live).toBeUndefined();
  expect(errors).toEqual([]);
});

test('Preferências abertas no meio do jogo seguram o relógio', async ({ page }) => {
  const errors = trackErrors(page);
  await startTournament(page, { 'sb-initial-phase': 'knockout', 'sb-total-teams': 8 }, 1);
  await toFirstKoMatch(page);
  await page.click('#btn-play-match');
  await page.waitForTimeout(900);
  // espera não haver minigame aberto para alcançar o rodapé
  await page.waitForFunction(() => document.getElementById('minigame-overlay')!.classList.contains('hidden'));
  await page.click('#btn-live-settings');
  await expect(page.locator('#modal-settings')).toBeVisible();
  const m1 = await page.evaluate(() => (window as any).__mc64.store.t.live?.min);
  await page.waitForTimeout(1500);
  const m2 = await page.evaluate(() => (window as any).__mc64.store.t.live?.min);
  expect(m2).toBe(m1);
  await expect(page.locator('#set-difficulty')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.waitForFunction(m => (window as any).__mc64.store.t.live?.min > m, m1, { timeout: 10_000 });
  expect(errors).toEqual([]);
});
