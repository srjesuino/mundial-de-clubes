// Fluxo de uma rodada: simular, jogar ao vivo, plantão da rodada, resultados e avanço
import { isUser, isUserMatch, winnerId } from '../engine/core';
import { maxGroupRounds } from '../engine/groups';
import { advance, currentRoundMatches, roundTitle, simulateRound } from '../engine/tournament';
import type { DENode, PlayableMatch } from '../engine/types';
import { prefs } from '../state/prefs';
import { T, saveGame } from '../state/store';
import { checkMatches } from './ach';
import { shielded } from './dom';
import { updateDashboard } from './dashboard';
import { afterAdvance } from './hooks';
import { chooseSide, closeMatchScreen, startLive } from './live';
import { showRoundResults } from './results';
import { playRoundTicker } from './ticker';

let playQueue: PlayableMatch[] = [];
let liveRoundMatches: PlayableMatch[] = [];

export function resetFlow(): void {
  playQueue = [];
  liveRoundMatches = [];
}

function advanceButtonLabel(): string {
  const t = T();
  if (t.phase === 'GROUP') return t.round + 1 >= maxGroupRounds(t) ? 'Encerrar Fase de Grupos →' : 'Avançar Rodada →';
  if (t.phase === 'SWISS') return Object.values(t.teams).some(x => x.status === 'playing') ? 'Avançar Rodada →' : 'Ir para o Mata-Mata →';
  const ms = currentRoundMatches(t);
  if (t.phase === 'DE') return ms.some(n => (n as DENode).isGF2 || ((n as DENode).isGF1 && n.played && winnerId(n) === n.home)) ? '🏆 Ver Campeão' : 'Avançar →';
  return ms.length === 1 ? '🏆 Ver Campeão' : 'Ir para o Sorteio →';
}

/** Simula o que falta da rodada e mostra o plantão (se ligado) e depois os resultados */
function finishRound(ms: PlayableMatch[], cameFromLive = false): void {
  const t = T();
  const fresh = ms.filter(m => !m.played);
  simulateRound(t);
  checkMatches(t, ms);
  saveGame();
  updateDashboard();
  const title = `Resultados · ${roundTitle(t)}`;
  const show = () => showRoundResults(ms, title, { label: advanceButtonLabel(), run: advanceLogic });
  if (prefs.ticker && (fresh.length || cameFromLive)) playRoundTicker(ms, roundTitle(t), show);
  else show();
}

export function onSimulate(): void {
  if (shielded()) return;
  const ms = currentRoundMatches(T());
  if (!ms.length) return;
  finishRound(ms);
}

export function onPlay(): void {
  if (shielded()) return;
  const t = T();
  liveRoundMatches = currentRoundMatches(t);
  playQueue = liveRoundMatches.filter(m => !m.played && isUserMatch(t, m));
  if (!playQueue.length) { finishRound(liveRoundMatches); return; }
  playNextUserMatch();
}

function playNextUserMatch(): void {
  const t = T();
  const m = playQueue.shift();
  if (!m) { closeMatchScreen(); finishRound(liveRoundMatches, true); return; }
  if (m.played) { playNextUserMatch(); return; }
  if (isUser(t, m.home) && isUser(t, m.away)) chooseSide(m, side => startLive(m, side));
  else startLive(m, isUser(t, m.home) ? 'home' : 'away');
}

/** Usado pela tela da partida ao vivo para seguir para o próximo jogo do usuário ou para os resultados */
export const liveFlow = {
  hasMoreUserMatches: (): boolean => playQueue.some(x => !x.played),
  next: (): void => {
    if (playQueue.some(x => !x.played)) playNextUserMatch();
    else { closeMatchScreen(); finishRound(liveRoundMatches, true); }
  }
};

export function advanceLogic(): void {
  const t = T();
  if (!advance(t)) { updateDashboard(); return; }
  afterAdvance();
  saveGame();
  updateDashboard();
}
