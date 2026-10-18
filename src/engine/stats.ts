// Estatísticas do torneio calculadas só a partir dos jogos disputados
import { isDecided, team, winnerId } from './core';
import { hasPens } from './model';
import { playedMatches } from './tournament';
import type { PlayableMatch, TeamState, Tournament } from './types';

export interface TournamentStats {
  matches: PlayableMatch[];
  goals: number;
  pens: number;
  extraTimes: number;
  homeWins: number;
  draws: number;
  biggest: PlayableMatch | null;
  wildest: PlayableMatch | null;
  upsets: PlayableMatch[];
  attack: TeamState[];
  defense: TeamState[];
  wins: TeamState[];
}

const goalsOf = (m: PlayableMatch) => m.res!.gH + m.res!.gA;
const margin = (m: PlayableMatch) => Math.abs(m.res!.gH - m.res!.gA);

export function tournamentStats(t: Tournament, top = 5): TournamentStats {
  const ms = playedMatches(t);
  const ovrGap = (m: PlayableMatch) => Math.abs(team(t, m.home).ovr - team(t, m.away).ovr);
  const upsets = ms.filter(m => {
    if (!isDecided(m) || ovrGap(m) < 6) return false;
    const w = team(t, winnerId(m));
    return w.ovr < Math.max(team(t, m.home).ovr, team(t, m.away).ovr);
  }).sort((a, b) => ovrGap(b) - ovrGap(a));
  const teams = Object.values(t.teams).filter(x => x.st.j > 0);
  return {
    matches: ms,
    goals: ms.reduce((s, m) => s + goalsOf(m), 0),
    pens: ms.filter(m => hasPens(m.res)).length,
    extraTimes: ms.filter(m => m.res!.et).length,
    homeWins: ms.filter(m => m.res!.gH > m.res!.gA).length,
    draws: ms.filter(m => m.res!.gH === m.res!.gA).length,
    biggest: [...ms].sort((a, b) => margin(b) - margin(a) || goalsOf(b) - goalsOf(a))[0] ?? null,
    wildest: [...ms].sort((a, b) => goalsOf(b) - goalsOf(a))[0] ?? null,
    upsets,
    attack: [...teams].sort((a, b) => b.st.gp - a.st.gp || a.st.j - b.st.j).slice(0, top),
    defense: teams.filter(x => x.st.j >= 2).sort((a, b) => a.st.gc / a.st.j - b.st.gc / b.st.j || b.st.j - a.st.j).slice(0, top),
    wins: [...teams].sort((a, b) => b.st.v - a.st.v || b.st.gp - a.st.gp).slice(0, top)
  };
}

/** Jogos de mata-mata do campeão (o caminho até o título) */
export function championPath(t: Tournament): PlayableMatch[] {
  if (!t.champion) return [];
  return playedMatches(t).filter(m => m.kind === 'ko' && (m.home === t.champion || m.away === t.champion));
}
