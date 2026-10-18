import { getContinentByCountry } from '../data/teams';
import { HOME_ADV, computeXG, simulateMatch, matchOdds, type Odds, type SimContext } from './model';
import { rand } from './rng';
import type { ClubBase, DENode, Match, MatchKind, MatchResult, PlayableMatch, TeamState, Tournament } from './types';

export const PHASE_LABEL = {
  R64: '32-avos de Final', R32: '16-avos de Final', R16: 'Oitavas de Final', QF: 'Quartas de Final', SF: 'Semifinal', F: 'Final'
} as const;
export const PHASE_BY_COUNT: Record<number, keyof typeof PHASE_LABEL> = { 64: 'R64', 32: 'R32', 16: 'R16', 8: 'QF', 4: 'SF', 2: 'F' };

export const team = (t: Tournament, id: string): TeamState => {
  const x = t.teams[id];
  if (!x) throw new Error(`Clube desconhecido: ${id}`);
  return x;
};
export const isUser = (t: Tournament, id: string | null): boolean => !!id && t.userIds.includes(id);
export const isUserMatch = (t: Tournament, m: { home: string | null; away: string | null }): boolean => isUser(t, m.home) || isUser(t, m.away);
export const isPlayable = (m: Match | DENode): m is PlayableMatch => !!m.home && !!m.away;

export function mkMatch(t: Tournament, home: string, away: string, kind: MatchKind, stage: string): Match {
  return { id: 'M' + ++t.seq, home, away, kind, stage, played: false, res: null };
}

export function makeTeamState(base: ClubBase): TeamState {
  return {
    ...base,
    conf: getContinentByCountry(base.country),
    group: null, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, form: [],
    sw: 0, sl: 0, status: 'playing', opp: [],
    dl: 0,
    st: { j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0 },
    tb: rand(),
    out: null
  };
}

/** Mando de campo só existe na fase de grupos em ida e volta; o resto é campo neutro */
export const homeAdvantage = (t: Tournament, m: { kind: MatchKind }): number =>
  m.kind === 'group' && t.config.groupLegs === 2 ? HOME_ADV : 0;

/** Táticas efetivas do jogo: a escolhida no jogo ou a padrão do clube do usuário; NPCs jogam equilibrado */
export function effectiveTactics(t: Tournament, m: PlayableMatch): PlayableMatch['tactics'] {
  const pick = (side: 'home' | 'away') => m.tactics?.[side] ?? (isUser(t, m[side]) ? t.tactics?.[m[side]] : undefined) ?? 'bal';
  return { home: pick('home'), away: pick('away') };
}

export function simContext(t: Tournament, m: PlayableMatch): SimContext {
  const H = team(t, m.home), A = team(t, m.away);
  const { xh, xa } = computeXG({ homeOvr: H.ovr, awayOvr: A.ovr, homeAdv: homeAdvantage(t, m), tactics: effectiveTactics(t, m) });
  return { kind: m.kind, xh, xa, homeOvr: H.ovr, awayOvr: A.ovr };
}

export const oddsFor = (t: Tournament, m: PlayableMatch): Odds => matchOdds(simContext(t, m));

export function simulateResult(t: Tournament, m: PlayableMatch): MatchResult {
  return simulateMatch(simContext(t, m));
}

export function winnerId(m: { home: string | null; away: string | null; res: MatchResult | null }): string {
  const r = m.res!;
  if (r.gH !== r.gA) return (r.gH > r.gA ? m.home : m.away)!;
  return ((r.penH ?? 0) > (r.penA ?? 0) ? m.home : m.away)!;
}
export const loserId = (m: { home: string | null; away: string | null; res: MatchResult | null }): string =>
  winnerId(m) === m.home ? m.away! : m.home!;
export const isDecided = (m: { res: MatchResult | null; played: boolean }): boolean =>
  m.played && !!m.res && (m.res.gH !== m.res.gA || (m.res.penH !== null && m.res.penH !== undefined));

/** Aplica um resultado (simulado ou da partida ao vivo) no estado */
export function applyResult(t: Tournament, m: PlayableMatch, res: MatchResult): void {
  if (m.played) return;
  m.played = true;
  m.res = res;
  m.tactics = effectiveTactics(t, m);
  const H = team(t, m.home), A = team(t, m.away);

  // Campanha geral (decisão por pênaltis conta como empate, como nas estatísticas oficiais)
  ([[H, res.gH, res.gA], [A, res.gA, res.gH]] as const).forEach(([T, f, a]) => {
    T.st.j++; T.st.gp += f; T.st.gc += a;
    if (f > a) T.st.v++; else if (f < a) T.st.d++; else T.st.e++;
  });

  if (m.kind === 'group') {
    H.gf += res.gH; H.ga += res.gA; H.gd = H.gf - H.ga;
    A.gf += res.gA; A.ga += res.gH; A.gd = A.gf - A.ga;
    if (res.gH > res.gA) { H.w++; H.p += 3; A.l++; H.form.push('V'); A.form.push('D'); }
    else if (res.gA > res.gH) { A.w++; A.p += 3; H.l++; H.form.push('D'); A.form.push('V'); }
    else { H.d++; A.d++; H.p++; A.p++; H.form.push('E'); A.form.push('E'); }
  } else if (m.kind === 'swiss') {
    H.gf += res.gH; H.ga += res.gA; H.gd = H.gf - H.ga;
    A.gf += res.gA; A.ga += res.gH; A.gd = A.gf - A.ga;
    const W = team(t, winnerId(m)), L = team(t, loserId(m));
    W.sw++; L.sl++;
    if (W.sw >= 3) W.status = 'advanced';
    if (L.sl >= 3) { L.status = 'eliminated'; L.out = `Sistema Suíço (${L.sw}-${L.sl})`; }
  }
}

export function declareChampion(t: Tournament, w: string, r: string | null, note: string): void {
  t.phase = 'END';
  t.champion = w;
  t.runnerUp = r;
  t.championNote = note;
  t.draw = null;
  team(t, w).out = null;
  if (r) team(t, r).out = 'Vice-campeão';
}
