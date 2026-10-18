// Novo torneio, continuar torneio salvo e torneio interrompido
import { PHASE_LABEL, hasPens, resolveInterruptedLive, team, winnerId } from '../engine';
import type { PlayableMatch } from '../engine/types';
import { clearSave, hasRawSave, loadGame, onSaveProblem, saveGame, store, watchOtherTabs } from '../state/store';
import { $, askConfirm, hideEl, isShown, showEl, toast } from './dom';
import { enterDashboard } from './dashboard';
import { clearDrawTimers } from './draw';
import { resetFlow } from './flow';
import { emit } from './hooks';
import { recordTournamentEnd } from './hall';
import { discardLive, holdLive, liveElsewhere } from './live';
import { refreshConfigUI, resetSelection, startTournament } from './setup';
import { stopBed } from './sound';

/** Fecha partida, sorteio, janelas e o torneio atual (as preferências e a galeria ficam) */
function teardown(): void {
  emit('newTournament');
  discardLive();
  stopBed();
  clearDrawTimers();
  resetFlow();
  store.t = null;
  clearSave();
  ['screen-dashboard', 'screen-match', 'screen-draw', 'screen-select', 'div-confirm-teams', 'modal-champion', 'modal-stats', 'modal-bracket',
    'modal-round-results', 'modal-groups', 'modal-side', 'modal-continent-dist', 'modal-report', 'modal-odds', 'modal-hall', 'modal-share',
    'modal-settings', 'round-ticker', 'minigame-overlay', 'saved-game-banner'].forEach(id => { if (document.getElementById(id)) hideEl(id); });
  $('screen-select').classList.remove('flex-1');
  $('confetti-layer').innerHTML = '';
}

export function resetToConfig(): void {
  teardown();
  resetSelection();
  showEl('screen-sandbox-config');
  $('screen-sandbox-config').classList.add('flex-1');
  refreshConfigUI();
  window.scrollTo(0, 0);
  $('sandbox-title').focus({ preventScroll: true });
}

/** Revanche: mesmas regras, mesmos clubes do usuário e a mesma distribuição por continente; o resto é refeito */
export function rematch(): void {
  const t = store.t;
  if (!t) return;
  recordTournamentEnd();
  const config = { ...t.config };
  const ids = [...t.userIds];
  const slots = t.slots ?? null;
  teardown();
  store.cfg = config;
  store.selectedIds = ids;
  $('screen-sandbox-config').classList.remove('flex-1');
  hideEl('screen-sandbox-config');
  startTournament(slots);
  if (!store.t) resetToConfig();
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

/** Avisos de gravação: outra aba mudou o torneio, ou o armazenamento encheu */
function initSaveProblems(): void {
  onSaveProblem(p => {
    const note = document.getElementById('save-note');
    if (p === 'stale') {
      holdLive(true);
      showEl('modal-stale');
      return;
    }
    if (p === 'quota') {
      toast('Não foi possível salvar o torneio: o armazenamento deste navegador está cheio. Apagar a galeria libera espaço.', 7000);
      if (note) { note.textContent = '⚠️ O progresso NÃO está sendo salvo: o armazenamento do navegador está cheio.'; note.className = 'text-[11px] text-amber-300 text-center font-bold'; }
      return;
    }
    if (note) { note.textContent = '💾 O progresso é salvo automaticamente neste navegador.'; note.className = 'text-[11px] text-slate-500 text-center'; }
  });
  $('btn-stale-reload').onclick = () => window.location.reload();
  // sem torneio aberto nesta aba: só atualiza o aviso de "torneio salvo encontrado"
  watchOtherTabs(() => { if (isShown('screen-sandbox-config')) initSavedBanner(); });
}

export function initSession(): void {
  initSaveProblems();
  $('btn-new-tournament').onclick = confirmNewTournament;
  $('btn-continue-save').onclick = async () => {
    const peek = loadGame();
    if (!peek) { hideEl('saved-game-banner'); toast('Não foi possível carregar o torneio salvo.'); return; }
    // a partida salva está sendo jogada agora em outra aba: não a encerra pelo simulador
    if (peek.live && await liveElsewhere(peek.live.id, peek.tid)) {
      toast('Essa partida está sendo jogada agora em outra aba. Termine lá (ou feche aquela aba) e tente de novo.', 6000);
      return;
    }
    const saved = loadGame();
    if (!saved) { hideEl('saved-game-banner'); toast('Não foi possível carregar o torneio salvo.'); return; }
    try {
      store.t = saved;
      store.cfg = { ...saved.config };
      store.selectedIds = [...saved.userIds];
      const lm = resolveInterruptedLive(saved);
      saveGame();
      recordTournamentEnd();
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
