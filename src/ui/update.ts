// Versão nova publicada (service worker). Regras:
// - nenhuma aba recarrega sozinha no meio de algo: só no setup intocado (sem torneio, sem clubes escolhidos, sem janela);
// - fora isso aparece o ⟳ no topo, e o jogador escolhe a hora;
// - se outra aba ativou a versão nova, esta só avisa (o código antigo continua funcionando até recarregar).
import { Workbox } from 'workbox-window';
import { store } from '../state/store';
import { $, isShown, showEl, toast } from './dom';
import { on } from './hooks';
import { liveRunning } from './live';
import { topLayer } from './overlays';

const BASE = import.meta.env.BASE_URL;
let wb: Workbox | null = null;
let reg: ServiceWorkerRegistration | undefined;
let hasUpdate = false;          // existe versão nova (esperando, ou já ativada por outra aba)
let changedUnderUs = false;     // outra aba ativou a versão nova; esta roda o código antigo
let reloadWanted = false;       // esta aba pediu a troca: recarrega quando o controle mudar
let prompted = false;
let startedControlled = false;

const busy = (): boolean => liveRunning() || ['screen-match', 'screen-draw', 'round-ticker', 'minigame-overlay'].some(id => isShown(id));

/** Nada a perder: tela de regras, sem torneio, sem clubes escolhidos e sem nenhuma janela aberta */
const pristine = (): boolean => !store.t && !store.selectedIds.length && isShown('screen-sandbox-config') && !topLayer() && !busy();

function prompt(msg: string): void {
  showEl('btn-update');
  if (prompted) return;
  prompted = true;
  toast(msg, 6000);
}

/** Troca para a versão nova nesta aba (só chamado quando é seguro aqui) */
async function activate(auto = false): Promise<void> {
  // trava contra recarregar em loop se algo der errado na troca
  const KEY = 'mc64-update-tried';
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (auto && Date.now() - last < 30_000) { prompt('Versão nova disponível: toque em ⟳ no topo para atualizar.'); return; }
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { if (auto) return; }
  const r = reg ?? await navigator.serviceWorker.getRegistration().catch(() => undefined);
  if (changedUnderUs || !r?.waiting) { window.location.reload(); return; }
  reloadWanted = true;
  r.waiting.postMessage({ type: 'SKIP_WAITING' });
  // se o controle não mudar (página que o service worker não controla), recarrega mesmo assim
  window.setTimeout(() => window.location.reload(), 3000);
}

function onUpdateFound(): void {
  if (hasUpdate && !pristine()) return; // já avisado
  hasUpdate = true;
  if (pristine()) { void activate(true); return; }
  prompt('Versão nova disponível: toque em ⟳ no topo para atualizar quando quiser (o torneio continua salvo).');
}

export function initUpdates(): void {
  if (!('serviceWorker' in navigator)) return;
  startedControlled = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!startedControlled) {
      // primeira instalação: o service worker assumiu esta página (sem recarregar)
      startedControlled = true;
      toast('Pronto: dá para jogar mesmo sem internet.');
      return;
    }
    if (reloadWanted) { window.location.reload(); return; }
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
