import { chunkPairs } from './math';
import { mkMatch, team } from './core';
import { shuffle } from './rng';
import type { Match, Tournament } from './types';

export function setupSwiss(t: Tournament): void {
  t.phase = 'SWISS';
  t.round = 0;
  t.swissRounds = [];
  generateSwissRound(t);
}

/** Emparelha uma lista evitando revanches (backtracking com limite de passos) */
export function pairAvoiding<T>(list: T[], forbid: (a: T, b: T) => boolean): [T, T][] {
  let steps = 0;
  function bt(rest: T[]): [T, T][] | null {
    if (rest.length === 0) return [];
    const [a, ...others] = rest;
    for (const b of others) {
      if (++steps > 20000) return null;
      if (forbid(a, b)) continue;
      const r = bt(others.filter(x => x !== b));
      if (r) return [[a, b], ...r];
    }
    return null;
  }
  return bt(list) ?? chunkPairs(list);
}

/** Uma rodada: só se cruzam times com a mesma campanha (V-D), sem revanche quando possível */
export function generateSwissRound(t: Tournament): void {
  const n = t.swissRounds.length + 1;
  const active = Object.values(t.teams).filter(x => x.status === 'playing');
  const pools: Record<string, string[]> = {};
  active.forEach(x => { (pools[`${x.sw}-${x.sl}`] ??= []).push(x.id); });
  const recs = Object.keys(pools).sort((a, b) => {
    const [aw, al] = a.split('-').map(Number), [bw, bl] = b.split('-').map(Number);
    return (bw - bl) - (aw - al) || bw - aw;
  });
  const matches: Match[] = [];
  let carry: string | null = null;
  recs.forEach(rec => {
    const list = shuffle(pools[rec]);
    if (carry) { list.unshift(carry); carry = null; }
    if (list.length % 2) carry = list.pop()!;
    pairAvoiding(list, (a, b) => team(t, a).opp.includes(b)).forEach(([a, b]) => {
      matches.push(mkMatch(t, a, b, 'swiss', `Suíço · Rodada ${n} · Pote ${rec}`));
      team(t, a).opp.push(b);
      team(t, b).opp.push(a);
    });
  });
  t.swissRounds.push(matches);
}
