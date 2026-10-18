// Novo torneio, continuar torneio salvo e torneio interrompido
import { PHASE_LABEL, hasPens, resolveInterruptedLive, team, winnerId } from '../engine';
import type { PlayableMatch } from '../engine/types';
import { clearSave, hasRawSave, loadGame, saveGame, store } from '../state/store';
import { $, askConfirm, hideEl, showEl, toast } from './dom';
import { enterDashboard } from './dashboard';
import { clearDrawTimers } from './draw';
import { resetFlow } from './flow';
import { discardLive } from './live';
import { refreshConfigUI, resetSelection } from './setup';

export function resetToConfig(): void {
  discardLive();
  clearDrawTimers();
  resetFlow();
  store.t = null;
  clearSave();
  resetSelection();
  ['screen-dashboard', 'screen-match', 'screen-draw', 'screen-select', 'div-confirm-teams', 'modal-champion', 'modal-stats', 'modal-bracket',
    'modal-round-results', 'modal-groups', 'modal-side', 'modal-continent-dist', 'modal-report', 'saved-game-banner'].forEach(id => { if (document.getElementById(id)) hideEl(id); });
  $('screen-select').classList.remove('flex-1');
  $('confetti-layer').innerHTML = '';
  showEl('screen-sandbox-config');
  $('screen-sandbox-config').classList.add('flex-1');
  refreshConfigUI();
  window.scrollTo(0, 0);
}

export function confirmNewTournament(): void {
  askConfirm('Começar um novo torneio?', 'O torneio atual será apagado deste navegador.', resetToConfig, 'Novo Torneio');
}

function toastInterrupted(m: PlayableMatch | null): void {
  if (!m || !m.res) return;
  const t = store.t!;
  const r = m.res;
  const pens = hasPens(r) ? ` (pên. ${r.penH}-${r.penA})` : '';
  const w = r.gH !== r.gA || hasPens(r) ? ` Vitória do ${team(t, winnerId(m)).name}.` : '';
  toast(`A partida interrompida foi concluída pelo simulador a partir do placar salvo: ${team(t, m.home).name} ${r.gH} x ${r.gA} ${team(t, m.away).name}${pens}.${w}`, 6000);
}

function initSavedBanner(): void {
  const had = hasRawSave();
  const saved = loadGame();
  if (!saved) {
    hideEl('saved-game-banner');
    if (had) toast('Um torneio salvo estava corrompido e foi descartado.');
    return;
  }
  const names = saved.userIds.map(id => saved.teams[id]?.name).filter(Boolean).join(', ');
  const phase = saved.phase === 'END' ? `encerrado (campeão: ${saved.teams[saved.champion!].name})`
    : saved.phase === 'GROUP' ? `fase de grupos, rodada ${saved.round + 1}`
      : saved.phase === 'SWISS' ? `sistema suíço, rodada ${saved.round + 1}`
        : saved.phase === 'DE' ? 'dupla eliminação' : PHASE_LABEL[saved.phase];
  $('saved-game-info').textContent = `${names} · ${phase}`;
  showEl('saved-game-banner');
}

export function initSession(): void {
  $('btn-new-tournament').onclick = confirmNewTournament;
  $('btn-continue-save').onclick = () => {
    const saved = loadGame();
    if (!saved) { hideEl('saved-game-banner'); toast('Não foi possível carregar o torneio salvo.'); return; }
    try {
      store.t = saved;
      store.cfg = { ...saved.config };
      store.selectedIds = [...saved.userIds];
      const lm = resolveInterruptedLive(saved);
      saveGame();
      enterDashboard();
      toastInterrupted(lm);
    } catch {
      resetToConfig();
      toast('O torneio salvo estava corrompido e foi descartado. Comece um novo torneio.', 4000);
    }
  };
  $('btn-discard-save').onclick = () => {
    askConfirm('Descartar o torneio salvo?', 'Essa ação não pode ser desfeita.', () => { clearSave(); hideEl('saved-game-banner'); }, 'Descartar');
  };
  initSavedBanner();
}
