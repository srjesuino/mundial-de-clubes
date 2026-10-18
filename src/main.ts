import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-800.css';
import '@fontsource/inter/latin-900.css';
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { initChampion, showChampion } from './ui/champion';
import { installCrestFallback } from './ui/crest';
import { $, hideEl, installClickShield, isShown } from './ui/dom';
import { initDraw } from './ui/draw';
import { onSimulate, onPlay } from './ui/flow';
import { onAfterAdvance } from './ui/hooks';
import { initLive } from './ui/live';
import { openHistory, openAllGroups } from './ui/results';
import { openBracket } from './ui/bracket';
import { confirmNewTournament, initSession } from './ui/session';
import { initSetupScreens } from './ui/setup';
import { initFeatures } from './ui/features';
import { store } from './state/store';

installCrestFallback();
installClickShield();
initSetupScreens();
initDraw();
initLive();
initChampion(confirmNewTournament);

$('btn-simulate-match').onclick = onSimulate;
$('btn-play-match').onclick = onPlay;
$('btn-view-history').onclick = openHistory;
$('btn-view-groups').onclick = openAllGroups;
$('btn-view-bracket').onclick = openBracket;

// Campeão definido ao avançar: tela de comemoração
onAfterAdvance(() => { if (store.t?.phase === 'END') showChampion(true); });

// Botões de fechar: fora do cartão .glass (backdrop-filter prende position:fixed ao cartão)
document.querySelectorAll<HTMLElement>('.modal-close').forEach(b => {
  const modal = b.closest('[id^="modal-"]');
  if (modal && b.parentElement !== modal) modal.prepend(b);
});
document.querySelectorAll<HTMLElement>('[data-close]').forEach(b => {
  b.addEventListener('click', () => hideEl(b.dataset.close!));
});
['modal-groups', 'modal-stats', 'modal-bracket', 'modal-champion'].forEach(id => {
  $(id).addEventListener('click', e => { if (e.target === $(id)) hideEl(id); });
});

// ESC fecha o modal informativo do topo (nunca interrompe partida, sorteio ou avanço de rodada)
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (isShown('modal-confirm')) { hideEl('modal-confirm'); return; }
  for (const id of ['modal-report', 'modal-bracket', 'modal-stats', 'modal-champion', 'modal-groups', 'modal-continent-dist']) {
    const el = document.getElementById(id);
    if (el && isShown(el)) { hideEl(el); return; }
  }
  if (isShown('modal-round-results') && isShown('btn-close-results')) hideEl('modal-round-results');
});

initFeatures();
initSession();

// PWA: atualiza sozinho quando há versão nova publicada
registerSW({ immediate: true });

// Acesso para testes automatizados e depuração no console
(window as unknown as { __mc64: unknown }).__mc64 = { store };
