// Pontos de extensão do painel (táticas, previsão do torneio etc.) — preenchidos pelas funcionalidades novas
import type { PlayableMatch } from '../engine/types';

type Extra = (m: PlayableMatch | null) => void;
const extras: Extra[] = [];
export const registerDashboardExtra = (fn: Extra): void => { extras.push(fn); };
/** Cada extra é independente: um erro num deles não pode travar o painel nem o fluxo da rodada */
export const renderDashboardExtras = (m: PlayableMatch | null): void => extras.forEach(fn => {
  try { fn(m); } catch (e) { console.error('Extra do painel falhou', e); }
});
