// Versão nova publicada (service worker). Regras:
// - nenhuma aba recarrega sozinha no meio de algo: só no setup intocado (sem torneio, sem clubes escolhidos, sem janela);
// - fora isso aparece o ⟳ no topo, e o jogador escolhe a hora;
// - se outra aba ativou a versão nova, esta só avisa (o código antigo continua funcionando até recarregar).
import { Workbox } from 'workbox-window';
import { ALL_TEAMS } from '../data/teams';
import { store } from '../state/store';
import { $, askConfirm, isShown, showEl, toast } from './dom';
import { on } from './hooks';
import { liveRunning } from './live';
import { topLayer } from './overlays';
import { saveSetupDraft, setupUntouched } from './setup';

const BASE = import.meta.env.BASE_URL;
let wb: Workbox | null = null;
let reg: ServiceWorkerRegistration | undefined;
let hasUpdate = false;          // existe versão nova (esperando, ou já ativada por outra aba)
let changedUnderUs = false;     // outra aba ativou a versão nova; esta roda o código antigo
let reloadWanted = false;       // esta aba pediu a troca: recarrega quando o controle mudar
let prompted = false;
let startedControlled = false;
/** já havia um service worker ativo quando a página abriu (então uma troca de controle é atualização, não 1ª instalação) */
let hadActive = false;
let lastTry = 0;
/** download dos escudos em andamento (cancelado antes de trocar de versão) */
let warmAbort: AbortController | null = null;
let updating = false;

const busy = (): boolean => liveRunning() || ['screen-match', 'screen-draw', 'round-ticker', 'minigame-overlay'].some(id => isShown(id));

/** Nada a perder: tela de regras intocada, sem torneio, sem clubes escolhidos e sem nenhuma janela aberta */
const pristine = (): boolean => !store.t && isShown('screen-sandbox-config') && setupUntouched() && !topLayer() && !busy();

/** dá para guardar as regras em edição durante o recarregamento? */
const canKeepSetup = (): boolean => {
  try { sessionStorage.setItem('mc64-probe', '1'); sessionStorage.removeItem('mc64-probe'); return true; } catch { return false; }
};

const promptText = (): string => (store.t
  ? 'Versão nova disponível: toque em ⟳ no topo para atualizar quando quiser (o torneio continua salvo).'
  : canKeepSetup()
    ? 'Versão nova disponível: toque em ⟳ no topo para atualizar (as regras e os clubes escolhidos são mantidos).'
    : 'Versão nova disponível: toque em ⟳ no topo para atualizar.');

function prompt(msg = promptText()): void {
  showEl('btn-update');
  if (prompted) return;
  prompted = true;
  toast(msg, 6000);
}

/** Troca para a versão nova nesta aba (só chamado quando é seguro aqui) */
async function activate(auto = false): Promise<void> {
  // trava contra recarregar em loop se algo der errado na troca (sessionStorage, ou memória se bloqueado)
  const KEY = 'mc64-update-tried';
  let last = lastTry;
  try { last = Math.max(last, Number(sessionStorage.getItem(KEY) ?? 0)); } catch { /* usa a memória */ }
  if (auto && Date.now() - last < 30_000) { prompt(); return; }
  lastTry = Date.now();
  try { sessionStorage.setItem(KEY, String(lastTry)); } catch { if (auto) { prompt(); return; } }
  if (!store.t && !saveSetupDraft() && !setupUntouched()) {
    // sem como guardar o rascunho: o jogador decide se perde as regras em edição
    if (auto) { prompt(); return; }
    askConfirm('Atualizar agora?', 'Este navegador não deixa guardar as regras e os clubes escolhidos durante a atualização: eles voltam ao padrão.', () => { void swap(); }, 'Atualizar');
    return;
  }
  await swap();
}

async function swap(): Promise<void> {
  updating = true;
  // daqui até recarregar, nada pode começar (uma partida iniciada agora seria cortada)
  const app = document.getElementById('app');
  if (app) app.inert = true;
  toast('Atualizando…', 15_000);
  // downloads pendentes seguram a versão antiga ativa: para os escudos (o resto fica para depois)
  warmAbort?.abort();
  const reload = () => window.location.reload();
  const r = reg ?? await navigator.serviceWorker.getRegistration().catch(() => undefined);
  if (changedUnderUs || !r?.waiting) { reload(); return; }
  reloadWanted = true;
  r.waiting.postMessage({ type: 'SKIP_WAITING' });
  // recarrega quando o controle mudar (controllerchange). Rede de segurança: uma página sem service worker
  // recarrega logo; com service worker, espera a ativação (até 15 s) para não voltar para a versão antiga
  const t0 = Date.now();
  const check = (): void => {
    if (!navigator.serviceWorker.controller || !r.waiting || Date.now() - t0 > 15_000) { reload(); return; }
    window.setTimeout(check, 1000);
  };
  window.setTimeout(check, 3000);
}

/** Guarda os escudos de todos os clubes para jogar offline. Baixa só os que faltam no cache,
 *  então uma 1ª visita curta (ou interrompida) termina na próxima vez que o jogo abrir. */
async function warmCrests(): Promise<void> {
  if (warmAbort || updating || !navigator.onLine || !('caches' in window)) return;
  const ctl = new AbortController();
  warmAbort = ctl;
  try {
    const urls = [...new Set(ALL_TEAMS.map(t => t.logo).filter(u => u.startsWith('https://')).map(u => new URL(u).href))];
    const have = new Set((await (await caches.open('escudos-v2')).keys()).map(r => r.url));
    const missing = urls.filter(u => !have.has(u));
    for (let i = 0; i < missing.length && !ctl.signal.aborted; i += 8) {
      await Promise.all(missing.slice(i, i + 8).map(u =>
        fetch(u, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal }).catch(() => undefined)));
    }
  } catch { /* sem Cache API */ } finally {
    if (warmAbort === ctl) warmAbort = null;
  }
}

/** escudos que faltam, sem atrapalhar a abertura do jogo */
const warmLater = (): void => {
  const go = () => { void warmCrests(); };
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(go, { timeout: 8000 }); else setTimeout(go, 3000);
};

function onUpdateFound(): void {
  if (hasUpdate && !pristine()) return; // já avisado
  hasUpdate = true;
  if (pristine()) { void activate(true); return; }
  prompt();
}

export function initUpdates(): void {
  if (!('serviceWorker' in navigator)) return;
  startedControlled = !!navigator.serviceWorker.controller;
  void navigator.serviceWorker.getRegistration().then(r => { hadActive = !!r?.active; }).catch(() => undefined);
  // visitas seguintes: completa os escudos que a 1ª visita não chegou a guardar
  if (startedControlled) warmLater();
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadWanted) { window.location.reload(); return; }
    if (!startedControlled && !hadActive) {
      // primeira instalação de verdade: o service worker assumiu esta página (sem recarregar)
      startedControlled = true;
      void warmCrests();
      toast('Pronto: dá para jogar mesmo sem internet.');
      return;
    }
    startedControlled = true;
    // outra aba ativou a versão nova: nunca recarrega sozinha (pode haver partida em andamento)
    changedUnderUs = true;
    hasUpdate = true;
    if (pristine()) { void activate(true); return; }
    prompt('Versão nova ativada em outra aba: toque em ⟳ no topo para recarregar quando quiser.');
  });
  try {
    wb = new Workbox(`${BASE}sw.js`, { scope: BASE });
    wb.addEventListener('waiting', onUpdateFound);
    wb.register().then(r => {
      reg = r;
      // sessões longas: procura versão nova de hora em hora
      window.setInterval(() => { void r?.update().catch(() => undefined); }, 60 * 60 * 1000);
    }).catch(() => undefined);
  } catch { wb = null; }

  $('btn-update').onclick = () => {
    if (busy()) { toast('Termine a partida (ou o sorteio) antes de atualizar.'); return; }
    void activate();
  };
  // voltar para a tela de regras sem nada escolhido é um momento seguro
  on('newTournament', () => window.setTimeout(() => { if (hasUpdate && pristine()) void activate(true); }, 0));
  // escudos: o cache antigo guardava respostas opacas (cada uma conta ~7 MB da cota do site)
  try { void caches?.delete('escudos'); } catch { /* sem Cache API */ }
}
