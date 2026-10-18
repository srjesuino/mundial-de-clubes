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

async function toKo(page: import('@playwright/test').Page) {
  await startTournament(page, { 'sb-initial-phase': 'knockout', 'sb-total-teams': 8 }, 1);
  await tap(page, '#btn-draw');
  await tap(page, '#btn-draw-all');
  await tap(page, '#btn-finish-draw');
  await page.click('#modal-bracket [data-close]');
  await page.waitForTimeout(300);
}

test('sorteio pelo teclado: Enter repetido em "Sortear Confronto" revela confronto após confronto', async ({ page }) => {
  const errors = trackErrors(page);
  await startTournament(page, { 'sb-initial-phase': 'knockout', 'sb-total-teams': 8 }, 1);
  await page.focus('#btn-draw');
  await page.keyboard.press('Enter');
  await expect(page.locator('#screen-draw')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('#btn-draw-next')).toBeFocused();
  for (let i = 1; i <= 4; i++) {
    await page.keyboard.press('Enter');
    await page.waitForFunction(n => ((window as any).__mc64.store.t.draw?.revealed ?? 99) >= n, i, { timeout: 5000 });
    await page.waitForTimeout(150);
  }
  await expect(page.locator('#btn-finish-draw')).toBeFocused();
  expect(errors).toEqual([]);
});

test('depois de Avançar Rodada o foco fica num controle do painel, não some', async ({ page }) => {
  const errors = trackErrors(page);
  await startTournament(page, { 'sb-initial-phase': 'groups' }, 1);
  await page.focus('#btn-simulate-match');
  await page.keyboard.press('Enter');
  await expect(page.locator('#round-ticker')).toBeVisible();
  await page.waitForTimeout(450);
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-round-results')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(600);
  await expect(page.locator('#btn-advance-round')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#modal-round-results')).toBeHidden();
  await page.waitForTimeout(100);
  const active = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  expect(active).not.toBe('BODY');
  expect(errors).toEqual([]);
});

test('disputa de pênaltis: o botão de Preferências some de verdade', async ({ page }) => {
  const errors = trackErrors(page);
  await toKo(page);
  // força empate até os pênaltis: gols impossíveis
  await page.evaluate(() => { const t = (window as any).__mc64.store.t; Object.values<any>(t.teams).forEach(x => { x.ovr = 80; }); });
  await page.click('#btn-play-match');
  await page.waitForTimeout(800);
  // .hidden precisa valer sobre os estilos dos botões de ícone (era o defeito: o botão "escondido" continuava na tela)
  const hiddenDisplay = await page.evaluate(() => {
    const b = document.getElementById('btn-live-settings')!;
    b.classList.add('hidden');
    const d = getComputedStyle(b).display;
    b.classList.remove('hidden');
    return d;
  });
  expect(hiddenDisplay).toBe('none');
  for (let i = 0; i < 40; i++) {
    const st = await page.evaluate(() => (window as any).__mc64.store.t.live?.period);
    if (st === 'PEN') break;
    if (await page.locator('#btn-finish-match').isVisible()) break;
    if (await page.locator('#minigame-overlay').isVisible()) { await page.waitForTimeout(1500); continue; }
    await page.keyboard.press('p');
    await page.waitForTimeout(400);
  }
  const period = await page.evaluate(() => (window as any).__mc64.store.t.live?.period);
  if (period === 'PEN') {
    const display = await page.evaluate(() => getComputedStyle(document.getElementById('btn-live-settings')!).display);
    expect(display).toBe('none');
  }
  expect(errors).toEqual([]);
});

test('depois de um lance, o foco volta ao cartão da partida (Enter não pula o jogo)', async ({ page }) => {
  const errors = trackErrors(page);
  await toKo(page);
  await page.click('#btn-play-match');
  await page.waitForTimeout(800);
  await page.focus('#btn-skip-match');
  await page.waitForSelector('#minigame-overlay:not(.hidden)', { timeout: 60_000 });
  // responde ao lance pelo teclado
  const isPen = await page.evaluate(() => !!document.getElementById('pen-grid'));
  await page.keyboard.press(isPen ? 'w' : '1');
  await page.keyboard.press('Space');
  await page.waitForSelector('#minigame-overlay.hidden', { state: 'attached', timeout: 10_000 });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => document.activeElement?.id)).not.toBe('btn-skip-match');
  expect(errors).toEqual([]);
});
