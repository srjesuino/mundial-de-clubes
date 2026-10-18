import { declareChampion, loserId, team, winnerId } from './core';
import type { DENode, Tournament } from './types';

/** Chave fixa de dupla eliminação para N = 4..64 */
export function buildDoubleBracket(t: Tournament, pairs: [string, string][]): void {
  const N = pairs.length * 2;
  const U = Math.log2(N);
  const LRC = 2 * (U - 1);
  const node = (id: string, bracket: DENode['bracket'], label: string): DENode => ({
    id, bracket, label, stage: label, kind: 'ko', home: null, away: null, nextW: null, nextL: null,
    played: false, propagated: false, res: null, round: 0
  });
  const ur: DENode[][] = [], lr: DENode[][] = [];

  for (let r = 0; r < U; r++) {
    ur[r] = [];
    const count = N / 2 ** (r + 1);
    const label = r === U - 1 ? 'Final da Upper' : `Upper · Rodada ${r + 1}`;
    for (let m = 0; m < count; m++) ur[r].push(node(`UR${r + 1}-${m + 1}`, 'upper', label));
  }
  for (let r = 0; r < LRC; r++) {
    lr[r] = [];
    const count = N / 2 ** (Math.floor(r / 2) + 2);
    const label = r === LRC - 1 ? 'Final da Lower' : `Lower · Rodada ${r + 1}`;
    for (let m = 0; m < count; m++) lr[r].push(node(`LR${r + 1}-${m + 1}`, 'lower', label));
  }

  // Upper: vencedor sobe; perdedor cai para a lower, do lado da subárvore irmã (sem revanche imediata)
  for (let r = 0; r < U - 1; r++) {
    for (let m = 0; m < ur[r].length; m++) {
      ur[r][m].nextW = ur[r + 1][Math.floor(m / 2)].id;
      ur[r][m].nextL = r === 0 ? lr[0][Math.floor(m / 2)].id : lr[2 * r - 1][m ^ 1].id;
    }
  }
  ur[U - 1][0].nextL = lr[LRC - 1][0].id;

  // Lower: rodadas "menores" mantêm o índice; as que recebem quedas da upper juntam de 2 em 2
  for (let r = 0; r < LRC - 1; r++) {
    for (let m = 0; m < lr[r].length; m++) {
      lr[r][m].nextW = (r % 2 === 0 ? lr[r + 1][m] : lr[r + 1][Math.floor(m / 2)]).id;
    }
  }

  const gf1: DENode = { ...node('GF1', 'final', 'Grande Final'), isGF1: true, nextW: 'GF2' };
  const gf2: DENode = { ...node('GF2', 'final', 'Grande Final · Reset'), isGF2: true };
  ur[U - 1][0].nextW = gf1.id;
  lr[LRC - 1][0].nextW = gf1.id;

  const nodes = [...ur.flat(), ...lr.flat(), gf1, gf2];
  pairs.forEach(([a, b], i) => { ur[0][i].home = a; ur[0][i].away = b; ur[0][i].round = 1; });

  // Cada jogo acontece depois de todos os jogos que o alimentam
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of nodes) {
      if (n.round) continue;
      const src = nodes.filter(s => s.nextW === n.id || s.nextL === n.id);
      if (src.length && src.every(s => s.round)) {
        n.round = Math.max(...src.map(s => s.round)) + 1;
        changed = true;
      }
    }
  }
  t.bracket = { nodes, round: 1 };
}

export const deNode = (t: Tournament, id: string): DENode => {
  const n = t.bracket?.nodes.find(x => x.id === id);
  if (!n) throw new Error(`Nó de chave desconhecido: ${id}`);
  return n;
};

function propagateDE(t: Tournament, n: DENode): void {
  n.propagated = true;
  const w = winnerId(n), l = loserId(n);
  team(t, l).dl++;
  if (n.isGF1) {
    if (w === n.home) {
      // "invicto" só sem derrota no torneio todo (grupos ou suíço antes da chave contam), a mesma regra da conquista
      team(t, l).out = 'Grande Final';
      declareChampion(t, w, l, team(t, w).st.d === 0 ? 'Campeão invicto na Grande Final' : 'Campeão na Grande Final, sem perder na chave');
      return;
    }
    // Campeão da lower venceu: os dois têm uma derrota → jogo de "reset"
    const g2 = deNode(t, 'GF2');
    g2.home = n.home;
    g2.away = n.away;
    return;
  }
  if (n.isGF2) { team(t, l).out = 'Grande Final (Reset)'; declareChampion(t, w, l, 'Campeão após o reset da Grande Final'); return; }

  const place = (target: DENode, id: string) => {
    if (target.isGF1) { if (n.bracket === 'upper') target.home = id; else target.away = id; return; }
    if (!target.home) target.home = id; else target.away = id;
  };
  if (n.nextW) place(deNode(t, n.nextW), w);
  if (n.nextL) place(deNode(t, n.nextL), l);
  else team(t, l).out = `${n.label} (2ª derrota)`;
}

export function advanceDE(t: Tournament): void {
  const B = t.bracket!;
  const cur = B.nodes.filter(n => n.round === B.round && n.home && n.away);
  for (const n of cur) {
    if (!n.propagated) propagateDE(t, n);
    if (t.phase === 'END') return;
  }
  const next = B.nodes.filter(n => !n.played && n.home && n.away).map(n => n.round);
  if (next.length) B.round = Math.min(...next);
}
