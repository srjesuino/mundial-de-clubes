// Pontos de extensão do painel (táticas, previsão do torneio etc.) — preenchidos pelas funcionalidades novas
import type { PlayableMatch } from '../engine/types';

type Extra = (m: PlayableMatch | null) => void;
const extras: Extra[] = [];
export const registerDashboardExtra = (fn: Extra): void => { extras.push(fn); };
export const renderDashboardExtras = (m: PlayableMatch | null): void => extras.forEach(fn => fn(m));
