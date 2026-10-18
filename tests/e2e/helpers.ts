import { expect, type Page } from '@playwright/test';

export interface Tour {
  phase: string;
  draw: unknown;
  champion: string | null;
  teams: Record<string, { name: string; st: { j: number } }>;
  userIds: string[];
  live: unknown;
  hofId?: string;
  mc?: { n: number; cols: string[] };
}

/** Coleta erros de página/console para falhar o teste no fim */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', d => { errors.push('dialog: ' + d.message()); void d.accept(); });
  return errors;
}

export const state = (page: Page) => page.evaluate(() => (window as unknown as { __mc64: { store: { t: unknown } } }).__mc64.store.t) as Promise<Tour | null>;

export async function setConfig(page: Page, cfg: Record<string, string | number>): Promise<void> {
  for (const [id, v] of Object.entries(cfg)) {
    await page.evaluate(([id, v]) => {
      const el = document.getElementById(id) as HTMLInputElement;
      el.value = v;
      el.dispatchEvent(new Event('change'));
      el.dispatchEvent(new Event('input'));
    }, [id, String(v)]);
  }
}

/** Abre o app, configura e começa um torneio com `users` clubes */
export async function startTournament(page: Page, cfg: Record<string, string | number>, users = 1): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { __mc64?: unknown }).__mc64);
  await setConfig(page, cfg);
  await page.click('#btn-start-sandbox');
  await expect(page.locator('#screen-select')).toBeVisible();
  const btns = page.locator('#teams-grid button');
  const n = await btns.count();
  for (let i = 0; i < users; i++) await btns.nth((i * 7) % n).click();
  await page.click('#btn-confirm-teams');
  if (cfg['sb-fill-method'] === 'custom') {
    await page.click('#btn-auto-continents');
    await page.click('#btn-start-modal-tourney');
  }
  await expect(page.locator('#screen-dashboard')).toBeVisible();
  await page.waitForTimeout(750); // proteção contra duplo clique após troca de tela
}

/** Clica e espera passar a proteção contra duplo clique da tela seguinte */
export async function tap(page: Page, sel: string, wait = 550): Promise<void> {
  await page.locator(sel).click();
  await page.waitForTimeout(wait);
}

/** Simula o torneio inteiro pelos botões (sorteios, plantão e avanço de rodada) */
export async function simulateToEnd(page: Page, maxSteps = 400): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    const t = await state(page);
    if (!t || t.phase === 'END') return;
    if (await page.locator('#btn-draw').isVisible()) {
      await tap(page, '#btn-draw');
      await tap(page, '#btn-draw-all');
      await tap(page, '#btn-finish-draw');
      await page.click('#modal-bracket [data-close]');
      continue;
    }
    await expect(page.locator('#btn-simulate-match')).toBeVisible();
    await tap(page, '#btn-simulate-match', 450);
    if (await page.locator('#round-ticker').isVisible()) await tap(page, '#tk-skip', 100);
    await expect(page.locator('#btn-advance-round')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(550); // a janela de resultados ignora toques nos primeiros 450 ms
    await tap(page, '#btn-advance-round');
  }
  throw new Error('O torneio não terminou');
}

/** Joga a partida ao vivo aberta até o fim usando só o teclado */
export async function playLiveWithKeyboard(page: Page): Promise<void> {
  await page.keyboard.press('4');
  for (let i = 0; i < 2000; i++) {
    if (await page.locator('#btn-finish-match').isVisible()) return;
    if (await page.locator('#minigame-overlay').isVisible()) {
      const mode = await page.evaluate(() => (document.getElementById('pen-grid') ? 'pen' : document.querySelector('#mg-targets button[aria-label="Bola"]') ? 'ball' : document.querySelector('#mg-targets button') ? 'att' : 'wait'));
      if (mode === 'pen') await page.keyboard.press(['q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'c'][i % 9]);
      else if (mode === 'ball') await page.keyboard.press('Space');
      else if (mode === 'att') await page.keyboard.press(String(1 + (i % 4)));
      await page.waitForTimeout(120);
      continue;
    }
    await page.waitForTimeout(100);
  }
  throw new Error('A partida não terminou');
}
