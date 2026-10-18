// Versão nova publicada (service worker). Regras:
// - nenhuma aba recarrega sozinha no meio de algo: só no setup intocado (sem torneio, sem clubes escolhidos, sem janela);
// - fora isso aparece o ⟳ no topo, e o jogador escolhe a hora;
// - se outra aba ativou a versão nova, esta só avisa (o código antigo continua funcionando até recarregar).
import { Workbox } from 'workbox-window';
import { ALL_TEAMS } from '../data/teams';
import { store } from '../state/store';
import { $, isShown, showEl, toast } from './dom';
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

const busy = (): boolean => liveRunning() || ['screen-match', 'screen-draw', 'round-ticker', 'minigame-overlay'].some(id => isShown(id));

/** Nada a perder: tela de regras intocada, sem torneio, sem clubes escolhidos e sem nenhuma janela aberta */
const pristine = (): boolean => !store.t && isShown('screen-sandbox-config') && setupUntouched() && !topLayer() && !busy();

const promptText = (): string => (store.t
  ? 'Versão nova disponível: toque em ⟳ no topo para atualizar quando quiser (o torneio continua salvo).'
  : 'Versão nova disponível: toque em ⟳ no topo para atualizar (as regras e os clubes escolhidos são mantidos).');

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
  if (!store.t) saveSetupDraft();
  // daqui até recarregar, nada pode começar (uma partida iniciada agora seria cortada)
  const app = document.getElementById('app');
  if (app) app.inert = true;
  toast('Atualizando…', 4000);
  const reload = () => window.location.reload();
  const r = reg ?? await navigator.serviceWorker.getRegistration().catch(() => undefined);
  if (changedUnderUs || !r?.waiting) { reload(); return; }
  reloadWanted = true;
  r.waiting.postMessage({ type: 'SKIP_WAITING' });
  // se o controle não mudar (página que o service worker não controla), recarrega mesmo assim
  window.setTimeout(reload, 3000);
}

/** 1ª instalação: guarda os escudos de todos os clubes para jogar offline */
function warmCrests(): void {
  const urls = [...new Set(ALL_TEAMS.map(t => t.logo).filter(u => u.startsWith('https://')))];
  let i = 0;
  const next = (): void => {
    const batch = urls.slice(i, i + 8);
    i += 8;
    if (!batch.length) return;
    void Promise.all(batch.map(u => fetch(u, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' }).catch(() => undefined))).then(next);
  };
  next();
}

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
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadWanted) { window.location.reload(); return; }
    if (!startedControlled && !hadActive) {
      // primeira instalação de verdade: o service worker assumiu esta página (sem recarregar)
      startedControlled = true;
      warmCrests();
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
