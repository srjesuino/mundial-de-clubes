import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-800.css';
import '@fontsource/inter/latin-900.css';
import './styles.css';
import { initChampion, showChampion } from './ui/champion';
import { installCrestFallback } from './ui/crest';
import { $, hideEl, installClickShield } from './ui/dom';
import { initDraw } from './ui/draw';
import { onSimulate, onPlay } from './ui/flow';
import { initForecast } from './ui/forecast';
import { initHall, recordTournamentEnd } from './ui/hall';
import { onAfterAdvance } from './ui/hooks';
import { initKeys } from './ui/keys';
import { initOverlays } from './ui/overlays';
import { initLive } from './ui/live';
import { initReport } from './ui/report';
import { openHistory, openAllGroups } from './ui/results';
import { openBracket } from './ui/bracket';
import { confirmNewTournament, initSession, rematch } from './ui/session';
import { initSettings } from './ui/settings';
import { initSetupScreens } from './ui/setup';
import { initSound } from './ui/sound';
import { initTactics } from './ui/tactics';
import { initTicker } from './ui/ticker';
import { initUpdates } from './ui/update';
import { store } from './state/store';

installCrestFallback();
installClickShield();
initSound();
initSettings();
initSetupScreens();
initDraw();
initLive();
initTicker();
initReport();
initTactics();
initForecast();
initHall(rematch);
initChampion(confirmNewTournament);
initKeys();
initOverlays();

$('btn-simulate-match').onclick = onSimulate;
$('btn-play-match').onclick = onPlay;
$('btn-view-history').onclick = openHistory;
$('btn-view-groups').onclick = openAllGroups;
$('btn-view-bracket').onclick = openBracket;

// Campeão definido ao avançar: grava na Galeria (uma vez) e abre a comemoração
onAfterAdvance(() => {
  if (store.t?.phase !== 'END') return;
  recordTournamentEnd();
  showChampion(true);
});

// Botões de fechar: fora do cartão .glass (backdrop-filter prende position:fixed ao cartão)
document.querySelectorAll<HTMLElement>('.modal-close').forEach(b => {
  const modal = b.closest('[id^="modal-"]');
  if (modal && b.parentElement !== modal) modal.prepend(b);
});
document.querySelectorAll<HTMLElement>('[data-close]').forEach(b => {
  b.addEventListener('click', () => hideEl(b.dataset.close!));
});
// Clique fora do cartão fecha as janelas informativas
['modal-groups', 'modal-stats', 'modal-bracket', 'modal-champion', 'modal-odds', 'modal-share', 'modal-report'].forEach(id => {
  $(id).addEventListener('click', e => { if (e.target === $(id)) hideEl(id); });
});

initSession();

// PWA: versão nova entra num momento seguro
initUpdates();

// Acesso para testes automatizados e depuração no console
(window as unknown as { __mc64: unknown }).__mc64 = { store };
