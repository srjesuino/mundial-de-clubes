import { mkMatch, team } from './core';
import { shuffle } from './rng';
import type { Match, Tournament } from './types';

export function setupGroups(t: Tournament, ids: string[]): void {
  const c = t.config;
  const G = c.groupsCount, N = c.teamsPerGroup;
  const names = 'ABCDEFGHIJKLMNOP'.slice(0, G).split('');
  names.forEach(g => { t.groups[g] = []; });

  if (c.drawType === 'potted') {
    // Potes por OVR; dentro de cada pote, evita (quando possível) dois clubes do mesmo país no grupo
    const sorted = shuffle(ids).sort((a, b) => team(t, b).ovr - team(t, a).ovr);
    for (let p = 0; p < N; p++) assignPotSpreadingCountries(t, sorted.slice(p * G, (p + 1) * G), names);
  } else {
    shuffle(ids).forEach((id, i) => t.groups[names[Math.floor(i / N)]].push(id));
  }

  names.forEach(g => {
    t.groups[g].forEach(id => { team(t, id).group = g; });
    t.schedule[g] = generateRoundRobin(t, t.groups[g], g);
  });
  t.phase = 'GROUP';
  t.round = 0;
}

function assignPotSpreadingCountries(t: Tournament, pot: string[], names: string[]): void {
  let best: [string, string][] = [];
  let bestCost = Infinity;
  for (let attempt = 0; attempt < 60 && bestCost > 0; attempt++) {
    const free = shuffle(names);
    const plan: [string, string][] = [];
    let cost = 0;
    shuffle(pot).forEach(id => {
      const country = team(t, id).country;
      let bi = 0, bc = Infinity;
      free.forEach((g, i) => {
        const same = t.groups[g].filter(x => team(t, x).country === country).length
          + plan.filter(([pid, pg]) => pg === g && team(t, pid).country === country).length;
        if (same < bc) { bc = same; bi = i; }
      });
      plan.push([id, free[bi]]);
      cost += bc;
      free.splice(bi, 1);
    });
    if (cost < bestCost) { bestCost = cost; best = plan; }
  }
  best.forEach(([id, g]) => t.groups[g].push(id));
}

/** Método do círculo (round-robin); com número ímpar um time folga por rodada */
export function generateRoundRobin(t: Tournament, ids: string[], g: string): Match[][] {
  const teams: (string | null)[] = [...ids];
  if (teams.length % 2 !== 0) teams.push(null);
  const n = teams.length;
  const rounds: [string, string][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const ms: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const home = teams[i], away = teams[n - 1 - i];
      if (home === null || away === null) continue;
      ms.push(i === 0 && r % 2 !== 0 ? [away, home] : [home, away]);
    }
    rounds.push(ms);
    teams.splice(1, 0, teams.pop()!);
  }
  const all = t.config.groupLegs === 2 ? rounds.concat(rounds.map(ms => ms.map(([h, a]) => [a, h] as [string, string]))) : rounds;
  return all.map((ms, ri) => ms.map(([h, a]) => mkMatch(t, h, a, 'group', `Grupo ${g} · Rodada ${ri + 1}`)));
}

/** Critérios: pontos, saldo, gols pró; persistindo, confronto direto entre os empatados; depois vitórias e sorteio */
export function sortGroupIds(t: Tournament, g: string): string[] {
  const T = (id: string) => team(t, id);
  const ids = [...t.groups[g]];
  const base = (a: string, b: string) => T(b).p - T(a).p || T(b).gd - T(a).gd || T(b).gf - T(a).gf;
  ids.sort(base);
  const played = t.schedule[g].flat().filter(m => m.played);
  const out: string[] = [];
  for (let i = 0; i < ids.length;) {
    let j = i + 1;
    while (j < ids.length && base(ids[i], ids[j]) === 0) j++;
    const tied = ids.slice(i, j);
    if (tied.length > 1) {
      const h: Record<string, { p: number; gd: number; gf: number }> = {};
      tied.forEach(id => { h[id] = { p: 0, gd: 0, gf: 0 }; });
      played.forEach(m => {
        if (!h[m.home] || !h[m.away] || !m.res) return;
        const r = m.res;
        h[m.home].gf += r.gH; h[m.away].gf += r.gA;
        h[m.home].gd += r.gH - r.gA; h[m.away].gd += r.gA - r.gH;
        if (r.gH > r.gA) h[m.home].p += 3; else if (r.gA > r.gH) h[m.away].p += 3; else { h[m.home].p++; h[m.away].p++; }
      });
      tied.sort((a, b) => h[b].p - h[a].p || h[b].gd - h[a].gd || h[b].gf - h[a].gf || T(b).w - T(a).w || T(a).tb - T(b).tb);
    }
    out.push(...tied);
    i = j;
  }
  return out;
}

export interface Qualifier { id: string; pos: number; g: string }

/** Classificados (e marca a eliminação dos demais), ordenados por posição e campanha */
export function groupQualifiers(t: Tournament): Qualifier[] {
  const k = t.config.advancingPerGroup;
  const q: Qualifier[] = [];
  Object.keys(t.groups).forEach(g => {
    sortGroupIds(t, g).forEach((id, i) => {
      if (i < k) q.push({ id, pos: i + 1, g });
      else team(t, id).out = `Fase de Grupos (${i + 1}º do Grupo ${g})`;
    });
  });
  const T = (id: string) => team(t, id);
  q.sort((a, b) => a.pos - b.pos || T(b.id).p - T(a.id).p || T(b.id).gd - T(a.id).gd || T(b.id).gf - T(a.id).gf || T(a.id).tb - T(b.id).tb);
  return q;
}

export const maxGroupRounds = (t: Tournament): number => Math.max(0, ...Object.values(t.schedule).map(r => r.length));
