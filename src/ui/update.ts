// Versão nova publicada: entra só num momento seguro (nunca no meio de uma partida, sorteio ou plantão).
import { registerSW } from 'virtual:pwa-register';
import { store } from '../state/store';
import { $, isShown, showEl, toast } from './dom';
import { on } from './hooks';
import { liveRunning } from './live';

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
let waiting = false;

const busy = (): boolean => liveRunning() || ['screen-match', 'screen-draw', 'round-ticker', 'minigame-overlay'].some(id => isShown(id));

function apply(): void {
  if (!waiting || !updateSW || busy()) return;
  void updateSW(true); // ativa a versão nova e recarrega (o torneio já está salvo)
}

export function initUpdates(): void {
  if (!('serviceWorker' in navigator)) return;
  try {
    updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        waiting = true;
        showEl('btn-update');
        // sem torneio aberto, não há nada a interromper
        if (!store.t) apply();
        else toast('Versão nova disponível: toque em ⟳ no topo para atualizar (o torneio continua salvo).', 6000);
      },
      onOfflineReady() { toast('Pronto: dá para jogar mesmo sem internet.'); }
    });
  } catch { updateSW = null; }
  $('btn-update').onclick = () => {
    if (busy()) { toast('Termine a partida (ou o sorteio) antes de atualizar.'); return; }
    apply();
  };
  // voltar para a tela de regras é um momento seguro
  on('newTournament', () => window.setTimeout(() => { if (!store.t) apply(); }, 0));
  // escudos: o cache antigo guardava respostas opacas (cada uma conta ~7 MB da cota do site)
  try { void caches?.delete('escudos'); } catch { /* sem Cache API */ }
}
