import { chunkPairs } from './math';
import { PHASE_BY_COUNT, PHASE_LABEL, declareChampion, loserId, mkMatch, team, winnerId } from './core';
import { buildDoubleBracket } from './double';
import { shuffle } from './rng';
import type { Tournament } from './types';

/** Pote 1 (melhor metade do ranking) x Pote 2 (pior metade), respeitando restrições quando possível */
export function seededPairs<T>(ranked: T[], forbid: ((a: T, b: T) => boolean) | null): [T, T][] {
  const half = ranked.length / 2;
  const pot1 = shuffle(ranked.slice(0, half));
  const pot2 = ranked.slice(half);
  let steps = 0;
  function bt(i: number, rest: T[]): [T, T][] | null {
    if (i === pot1.length) return [];
    for (const b of shuffle(rest)) {
      if (++steps > 50000) return null;
      if (forbid && forbid(pot1[i], b)) continue;
      const r = bt(i + 1, rest.filter(x => x !== b));
      if (r) return [[pot1[i], b], ...r];
    }
    return null;
  }
  const res = bt(0, pot2);
  if (res) return res;
  if (!forbid) { const p2 = shuffle(pot2); return pot1.map((a, i) => [a, p2[i]] as [T, T]); }
  // Restrições impossíveis de cumprir todas: a melhor de várias tentativas gulosas (menos conflitos)
  let best: [T, T][] = [];
  let bestCost = Infinity;
  for (let k = 0; k < 60 && bestCost > 0; k++) {
    const rest = shuffle(pot2);
    let cost = 0;
    const out = shuffle(pot1).map(a => {
      let j = rest.findIndex(b => !forbid(a, b));
      if (j < 0) { j = 0; cost++; }
      return [a, rest.splice(j, 1)[0]] as [T, T];
    });
    if (cost < bestCost) { bestCost = cost; best = out; }
  }
  return best;
}

/** Posições padrão de cabeças de chave: para 4 jogos → [0, 3, 1, 2] (1º e 2º em metades opostas) */
export function bracketSeedOrder(n: number): number[] {
  let cur = [0];
  while (cur.length < n) {
    const len = cur.length * 2;
    cur = cur.flatMap(x => [x, len - 1 - x]);
  }
  return cur;
}

/**
 * Na dupla eliminação os jogos 2k e 2k+1 se cruzam logo depois (upper e lower):
 * reordena para que times do mesmo grupo (ou que já se enfrentaram) não caiam nessa vizinhança.
 */
export function orderPairsForBracket(pairs: [string, string][], conflict: ((a: string, b: string) => boolean) | null): [string, string][] {
  if (!conflict || pairs.length < 4) return pairs;
  const clash = (p: [string, string], q: [string, string]) => p.some(a => q.some(b => conflict(a, b)));
  let steps = 0;
  function bt(rest: [string, string][]): [string, string][] | null {
    if (!rest.length) return [];
    const [p, ...others] = rest;
    for (const q of others) {
      if (++steps > 20000) return null;
      if (clash(p, q)) continue;
      const r = bt(others.filter(x => x !== q));
      if (r) return [p, q, ...r];
    }
    return null;
  }
  return bt(shuffle(pairs)) ?? pairs;
}

export function startKnockoutStage(t: Tournament, ids: string[], pairs: [string, string][], note: string, conflict: ((a: string, b: string) => boolean) | null = null): void {
  if (t.config.bracketFormat === 'double') {
    t.phase = 'DE';
    t.draw = { phase: 'DE', title: 'Sorteio do Chaveamento', note: `${note} · Dupla eliminação: só cai quem perder duas vezes`, pairs: orderPairsForBracket(pairs, conflict), revealed: 0 };
  } else {
    const ph = PHASE_BY_COUNT[ids.length];
    t.phase = ph;
    t.draw = { phase: ph, title: 'Sorteio: ' + PHASE_LABEL[ph], note, pairs, revealed: 0 };
  }
}

export function setupDirectKnockout(t: Tournament, ids: string[]): void {
  if (t.config.drawType === 'potted') {
    const ranked = shuffle(ids).sort((a, b) => team(t, b).ovr - team(t, a).ovr);
    startKnockoutStage(t, ids, seededPairs(ranked, null), 'Cabeças de chave por OVR: os favoritos não se cruzam na primeira fase');
  } else {
    startKnockoutStage(t, ids, chunkPairs(shuffle(ids)), 'Sorteio livre: qualquer confronto é possível');
  }
}

/** Todos os confrontos do sorteio revelados: cria a rodada (ou a chave fixa da dupla eliminação) */
export function finalizeDraw(t: Tournament): void {
  const D = t.draw;
  if (!D) return;
  if (D.phase === 'DE') buildDoubleBracket(t, D.pairs);
  else {
    const label = PHASE_LABEL[D.phase];
    t.knockout.push({ phase: D.phase, label, matches: D.pairs.map(([a, b]) => mkMatch(t, a, b, 'ko', label)) });
  }
  t.draw = null;
}

export function advanceSingle(t: Tournament): void {
  const last = t.knockout[t.knockout.length - 1];
  const winners = last.matches.map(winnerId);
  last.matches.forEach(m => { team(t, loserId(m)).out = `${last.label} (para ${team(t, winnerId(m)).name})`; });
  if (winners.length === 1) {
    declareChampion(t, winners[0], loserId(last.matches[0]), 'Campeão na Final');
    return;
  }
  const ph = PHASE_BY_COUNT[winners.length];
  t.phase = ph;
  t.draw = { phase: ph, title: 'Sorteio: ' + PHASE_LABEL[ph], note: 'Sorteio livre: qualquer confronto é possível', pairs: chunkPairs(shuffle(winners)), revealed: 0 };
}
