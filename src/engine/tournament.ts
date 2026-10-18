import { ALL_TEAMS, getContinentByCountry } from '../data/teams';
import { PHASE_LABEL, applyResult, declareChampion, isPlayable, makeTeamState, simulateResult, team, winnerId } from './core';
import { totalTeamsFor } from './config';
import { advanceDE } from './double';
import { groupQualifiers, maxGroupRounds, setupGroups, sortGroupIds } from './groups';
import { advanceSingle, bracketSeedOrder, finalizeDraw, seededPairs, setupDirectKnockout, startKnockoutStage } from './knockout';
import { shuffle } from './rng';
import { generateSwissRound, setupSwiss } from './swiss';
import type { ClubBase, Confederation, Config, DENode, Match, PlayableMatch, Tournament } from './types';

/** Monta a lista de participantes: clubes do usuário + NPCs (aleatórios ou por confederação) */
export function buildTournamentPool(
  total: number, userIds: string[], slots: Partial<Record<Confederation, number>> | null, catalog: ClubBase[] = ALL_TEAMS
): ClubBase[] {
  const userBases = userIds.map(id => catalog.find(c => c.id === id)).filter((c): c is ClubBase => !!c);
  const needed = Math.max(0, total - userBases.length);
  const pool = shuffle(catalog.filter(c => !userIds.includes(c.id)));
  const npcs: ClubBase[] = [];
  if (slots) {
    const left = { ...slots };
    pool.forEach(c => {
      const conf = getContinentByCountry(c.country);
      if ((left[conf] ?? 0) > 0 && npcs.length < needed) { npcs.push(c); left[conf] = (left[conf] ?? 0) - 1; }
    });
  }
  // Completa (ou preenche tudo, no modo aleatório) sem nunca passar do tamanho do torneio
  pool.forEach(c => { if (npcs.length < needed && !npcs.includes(c)) npcs.push(c); });
  return [...userBases, ...npcs].slice(0, total);
}

export function createTournament(
  config: Config, userIds: string[], slots: Partial<Record<Confederation, number>> | null = null, catalog: ClubBase[] = ALL_TEAMS
): Tournament {
  const total = totalTeamsFor(config);
  if (!userIds.length) throw new Error('Escolha pelo menos um clube.');
  if (userIds.length > total) throw new Error(`O torneio tem ${total} vagas, mas ${userIds.length} clubes foram escolhidos.`);
  const missing = userIds.find(id => !catalog.some(c => c.id === id));
  if (missing) throw new Error(`Clube desconhecido: ${missing}`);
  const bases = buildTournamentPool(total, userIds, slots, catalog);
  const t: Tournament = {
    v: 3, config: { ...config }, userIds: [...userIds], activeId: userIds[0],
    teams: {}, phase: 'GROUP', round: 0, seq: 0,
    groups: {}, schedule: {}, swissRounds: [], knockout: [], bracket: null, draw: null,
    champion: null, runnerUp: null, championNote: null, live: null,
    tactics: Object.fromEntries(userIds.map(id => [id, 'bal' as const])),
    oddsHistory: []
  };
  bases.forEach(b => { t.teams[b.id] = makeTeamState(b); });
  const ids = bases.map(b => b.id);
  if (config.initialPhase === 'groups') setupGroups(t, ids);
  else if (config.initialPhase === 'swiss') setupSwiss(t);
  else setupDirectKnockout(t, ids);
  return t;
}

/** Jogos da rodada/etapa atual (vazio enquanto há sorteio pendente ou no fim) */
export function currentRoundMatches(t: Tournament): PlayableMatch[] {
  if (t.phase === 'GROUP') return Object.keys(t.schedule).flatMap(g => t.schedule[g][t.round] ?? []);
  if (t.phase === 'SWISS') return t.swissRounds[t.round] ?? [];
  if (t.draw || t.phase === 'END') return [];
  if (t.phase === 'DE') return t.bracket ? t.bracket.nodes.filter((n): n is DENode & PlayableMatch => n.round === t.bracket!.round && isPlayable(n)) : [];
  const k = t.knockout[t.knockout.length - 1];
  return k && k.phase === t.phase ? k.matches : [];
}

export const roundComplete = (t: Tournament): boolean => {
  const ms = currentRoundMatches(t);
  return ms.length > 0 && ms.every(m => m.played);
};

export function roundTitle(t: Tournament): string {
  if (t.phase === 'GROUP') return `Fase de Grupos · Rodada ${t.round + 1}/${maxGroupRounds(t)}`;
  if (t.phase === 'SWISS') return `Sistema Suíço · Rodada ${t.round + 1}`;
  if (t.phase === 'DE') return `Dupla Eliminação · Etapa ${t.bracket ? t.bracket.round : 1}`;
  if (t.phase === 'END') return 'Fim de Torneio';
  return PHASE_LABEL[t.phase];
}

function advanceGroups(t: Tournament): void {
  t.round++;
  if (t.round < maxGroupRounds(t)) return;
  const q = groupQualifiers(t);
  if (q.length === 1) {
    // Pontos corridos: grupo único com Top 1
    const order = sortGroupIds(t, Object.keys(t.groups)[0]);
    order.slice(1).forEach((id, i) => { team(t, id).out = `Pontos corridos (${i + 2}º lugar)`; });
    declareChampion(t, order[0], order[1] ?? null, 'Campeão por pontos corridos');
    return;
  }
  if (q.length === 2) {
    startKnockoutStage(t, q.map(x => x.id), [[q[0].id, q[1].id]], 'Os dois classificados decidem o título');
    return;
  }
  if (Object.keys(t.groups).length === 1) {
    const olympic: [string, string][] = [];
    for (let i = 0; i < q.length / 2; i++) olympic.push([q[i].id, q[q.length - 1 - i].id]);
    const pairs = bracketSeedOrder(olympic.length).map(i => olympic[i]);
    startKnockoutStage(t, q.map(x => x.id), pairs, 'Cruzamento olímpico: 1º x último classificado, 2º x penúltimo... (1º e 2º só se cruzam na decisão)');
    return;
  }
  const pairs = seededPairs(q, (a, b) => a.g === b.g).map(([a, b]) => [a.id, b.id] as [string, string]);
  startKnockoutStage(t, q.map(x => x.id), pairs, 'Cabeças de chave = melhores campanhas · times do mesmo grupo não se cruzam',
    (a, b) => team(t, a).group === team(t, b).group);
}

function advanceSwiss(t: Tournament): void {
  t.round++;
  if (Object.values(t.teams).some(x => x.status === 'playing')) { generateSwissRound(t); return; }
  const adv = Object.values(t.teams).filter(x => x.status === 'advanced')
    .sort((a, b) => a.sl - b.sl || b.gd - a.gd || b.gf - a.gf || a.tb - b.tb).map(x => x.id);
  const pairs = seededPairs(adv, (a, b) => team(t, a).opp.includes(b));
  startKnockoutStage(t, adv, pairs, 'Cabeças de chave = melhores campanhas no Suíço · sem revanches do Suíço quando possível',
    (a, b) => team(t, a).opp.includes(b));
}

/** Avança para a próxima rodada/fase se a atual terminou. Devolve true se avançou. */
export function advance(t: Tournament): boolean {
  if (!roundComplete(t)) return false;
  if (t.phase === 'GROUP') advanceGroups(t);
  else if (t.phase === 'SWISS') advanceSwiss(t);
  else if (t.phase === 'DE') advanceDE(t);
  else advanceSingle(t);
  return true;
}

/** Simula todos os jogos ainda não disputados da rodada atual */
export function simulateRound(t: Tournament): PlayableMatch[] {
  const ms = currentRoundMatches(t);
  ms.forEach(m => { if (!m.played) applyResult(t, m, simulateResult(t, m)); });
  return ms;
}

export { finalizeDraw };

/** Joga o resto do torneio NUMA CÓPIA do estado com o mesmo motor e devolve o estado final */
export function simulateRemainder(state: Tournament): Tournament {
  const t = structuredClone(state);
  t.live = null;
  let guard = 0;
  while (t.phase !== 'END' && guard++ < 5000) {
    if (t.draw) { finalizeDraw(t); continue; }
    if (!currentRoundMatches(t).length) break;
    simulateRound(t);
    advance(t);
  }
  return t;
}

/** Todos os jogos do torneio (disputados ou não) */
export function allMatches(t: Tournament): (Match | DENode)[] {
  const arr: (Match | DENode)[] = [];
  Object.values(t.schedule).forEach(rs => rs.forEach(r => arr.push(...r)));
  t.swissRounds.forEach(r => arr.push(...r));
  t.knockout.forEach(k => arr.push(...k.matches));
  if (t.bracket) arr.push(...t.bracket.nodes);
  return arr;
}

export const playedMatches = (t: Tournament): PlayableMatch[] =>
  allMatches(t).filter((m): m is PlayableMatch => m.played && isPlayable(m));

export function lastDecisiveMatch(t: Tournament): PlayableMatch | null {
  if (t.bracket) {
    const g2 = t.bracket.nodes.find(n => n.isGF2);
    const g1 = t.bracket.nodes.find(n => n.isGF1);
    const m = g2 && g2.played ? g2 : g1;
    return m && isPlayable(m) ? m : null;
  }
  const k = t.knockout[t.knockout.length - 1];
  return k ? k.matches[0] : null;
}

export { winnerId };
