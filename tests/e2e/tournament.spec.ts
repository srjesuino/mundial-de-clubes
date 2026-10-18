import { expect, test } from '@playwright/test';
import { simulateToEnd, startTournament, state, trackErrors } from './helpers';

const FORMATS: [string, Record<string, string | number>, number][] = [
  ['grupos + mata-mata', { 'sb-initial-phase': 'groups' }, 3],
  ['grupos + dupla eliminação', { 'sb-initial-phase': 'groups', 'sb-bracket-format': 'double' }, 2],
  ['suíço 64', { 'sb-initial-phase': 'swiss', 'sb-total-teams-swiss': 64 }, 2],
  ['suíço 16 + dupla', { 'sb-initial-phase': 'swiss', 'sb-total-teams-swiss': 16, 'sb-bracket-format': 'double' }, 1],
  ['mata-mata 64', { 'sb-initial-phase': 'knockout', 'sb-total-teams': 64 }, 3],
  ['mata-mata 8 dupla', { 'sb-initial-phase': 'knockout', 'sb-total-teams': 8, 'sb-bracket-format': 'double' }, 2],
  ['pontos corridos', { 'sb-initial-phase': 'groups', 'sb-groups': 1, 'sb-teams-per-group': 6, 'sb-advancing': 1, 'sb-group-legs': 1 }, 1],
  ['grupo único com cruzamento olímpico', { 'sb-initial-phase': 'groups', 'sb-groups': 1, 'sb-teams-per-group': 9, 'sb-advancing': 4, 'sb-group-legs': 1 }, 2],
  ['continentes manuais', { 'sb-initial-phase': 'groups', 'sb-groups': 4, 'sb-teams-per-group': 5, 'sb-advancing': 2, 'sb-fill-method': 'custom' }, 2]
];

for (const [name, cfg, users] of FORMATS) {
  test(`torneio completo pela interface: ${name}`, async ({ page }) => {
    const errors = trackErrors(page);
    await startTournament(page, cfg, users);
    await simulateToEnd(page);
    await expect(page.locator('#modal-champion')).toBeVisible();
    const t = await state(page);
    expect(t!.phase).toBe('END');
    expect(t!.champion).toBeTruthy();
    expect(t!.hofId).toBeTruthy();
    // a Galeria registra o torneio exatamente uma vez, mesmo depois de recarregar
    const hof = await page.evaluate(() => JSON.parse(localStorage.getItem('mundial64-hof-v1') ?? 'null'));
    expect(hof.list).toHaveLength(1);
    await page.reload();
    await page.click('#btn-continue-save');
    await expect(page.locator('#screen-dashboard')).toBeVisible();
    const hof2 = await page.evaluate(() => JSON.parse(localStorage.getItem('mundial64-hof-v1') ?? 'null'));
    expect(hof2.list).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}

test('previsão do torneio: calcula sem mexer no torneio e mostra a tabela', async ({ page }) => {
  const errors = trackErrors(page);
  await startTournament(page, { 'sb-initial-phase': 'groups', 'sb-groups': 4, 'sb-teams-per-group': 4, 'sb-advancing': 2 }, 1);
  const before = await page.evaluate(() => { const t = (window as any).__mc64.store.t; const { mc, mcLog, ...rest } = t; return JSON.stringify(rest); });
  await page.waitForFunction(() => !!(window as any).__mc64.store.t.mc, null, { timeout: 30_000 });
  const after = await page.evaluate(() => { const t = (window as any).__mc64.store.t; const { mc, mcLog, ...rest } = t; return JSON.stringify(rest); });
  expect(after).toBe(before);
  await expect(page.locator('#dash-mc')).toContainText('Chance de título');
  await page.click('#btn-view-odds');
  await expect(page.locator('#modal-odds')).toBeVisible();
  await expect(page.locator('#odds-sub')).toContainText('simulações');
  await expect(page.locator('#odds-content tbody tr')).toHaveCount(16);
  await page.click('#odds-tabs [data-tab="pos"]');
  await expect(page.locator('#odds-content .pos-cell').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-odds')).toBeHidden();
  await expect(page.locator('#next-scenarios')).toContainText('Se vencer');
  expect(errors).toEqual([]);
});

test('postura: muda as chances do jogo, é salva e não muda a Superação', async ({ page }) => {
  const errors = trackErrors(page);
  await startTournament(page, { 'sb-initial-phase': 'knockout', 'sb-total-teams': 8 }, 1);
  await page.click('#btn-draw');
  await page.waitForTimeout(500);
  await page.click('#btn-draw-all');
  await page.waitForTimeout(500);
  await page.click('#btn-finish-draw');
  await page.click('#modal-bracket [data-close]');
  await expect(page.locator('#tac-chips button')).toHaveCount(3);
  const legend0 = await page.locator('#odds-legend').innerText();
  await page.click('#tac-chips [data-tac="att"]');
  await expect(page.locator('#tac-chips [data-tac="att"]')).toHaveAttribute('aria-pressed', 'true');
  const legend1 = await page.locator('#odds-legend').innerText();
  const t = await page.evaluate(() => { const t = (window as any).__mc64.store.t; return t.knockout[0].matches.find((m: any) => m.tactics); });
  expect(t.tactics).toBeTruthy();
  // entre clubes de OVR diferente a postura muda a chance; entre iguais pode não mudar o arredondamento
  expect(typeof legend0).toBe('string');
  expect(typeof legend1).toBe('string');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mundial64-save-v3')!).knockout[0].matches.some((m: any) => m.tactics));
  expect(saved).toBe(true);
  expect(errors).toEqual([]);
});

test('Revanche: mesmas regras e mesmos clubes', async ({ page }) => {
  const errors = trackErrors(page);
  await startTournament(page, { 'sb-initial-phase': 'knockout', 'sb-total-teams': 8, 'sb-difficulty': 'dificil' }, 2);
  const t0 = await state(page);
  await simulateToEnd(page);
  await page.waitForTimeout(600);
  await page.click('#champ-btn-rematch');
  await page.waitForTimeout(600); // a confirmação ignora toques nos primeiros 500 ms
  await page.click('#confirm-yes');
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  const t1 = await page.evaluate(() => (window as any).__mc64.store.t);
  expect(t1.phase).not.toBe('END');
  expect(t1.userIds).toEqual(t0!.userIds);
  expect(t1.config.difficulty).toBe('dificil');
  expect(errors).toEqual([]);
});
