import { describe, expect, it } from 'vitest';
import { setSeed } from '../../src/engine/rng';
import { totalTeamsFor, validateConfig } from '../../src/engine/config';
import { isDecided, loserId, winnerId } from '../../src/engine/core';
import { allMatches, playedMatches } from '../../src/engine/tournament';
import { sortGroupIds } from '../../src/engine/groups';
import type { Config, Tournament } from '../../src/engine/types';
import { cfg, createTournament, playAll, someUsers } from './helpers';

const FORMATS: [string, Partial<Config>][] = [
  ['grupos 8x4 top2 ida e volta', {}],
  ['grupos 8x4 top2 turno único aleatório', { groupLegs: 1, drawType: 'random' }],
  ['grupos 16x4 top1', { groupsCount: 16, advancingPerGroup: 1, groupLegs: 1 }],
  ['grupos 4x5 top2 (folgas)', { groupsCount: 4, teamsPerGroup: 5 }],
  ['grupos 2x9 top4', { groupsCount: 2, teamsPerGroup: 9, advancingPerGroup: 4, groupLegs: 1 }],
  ['grupo único 1x8 top4 (olímpico)', { groupsCount: 1, teamsPerGroup: 8, advancingPerGroup: 4 }],
  ['pontos corridos 1x6 top1', { groupsCount: 1, teamsPerGroup: 6, advancingPerGroup: 1 }],
  ['grupos 16x4 top2', { groupsCount: 16, advancingPerGroup: 2, groupLegs: 1 }],
  ['grupos 2x3 top1 (final direta)', { groupsCount: 2, teamsPerGroup: 3, advancingPerGroup: 1, groupLegs: 1 }],
  ['suíço 16', { initialPhase: 'swiss', totalTeamsSwiss: 16 }],
  ['suíço 32', { initialPhase: 'swiss', totalTeamsSwiss: 32 }],
  ['suíço 64', { initialPhase: 'swiss', totalTeamsSwiss: 64 }],
  ['mata-mata 8', { initialPhase: 'knockout', totalTeamsKnockout: 8 }],
  ['mata-mata 16 aleatório', { initialPhase: 'knockout', totalTeamsKnockout: 16, drawType: 'random' }],
  ['mata-mata 64', { initialPhase: 'knockout', totalTeamsKnockout: 64 }]
];

function checkGroupInvariants(t: Tournament): void {
  for (const g of Object.keys(t.groups)) {
    const ids = t.groups[g];
    const n = ids.length;
    const legs = t.config.groupLegs;
    const ms = t.schedule[g].flat();
    // cada par se enfrenta 'legs' vezes, com mando invertido no returno
    expect(ms.length).toBe((n * (n - 1) / 2) * legs);
    for (const id of ids) {
      const T = t.teams[id];
      expect(T.w + T.d + T.l).toBe((n - 1) * legs);
      expect(T.p).toBe(3 * T.w + T.d);
      const mine = ms.filter(m => m.home === id || m.away === id);
      const gf = mine.reduce((s, m) => s + (m.home === id ? m.res!.gH : m.res!.gA), 0);
      const ga = mine.reduce((s, m) => s + (m.home === id ? m.res!.gA : m.res!.gH), 0);
      expect(T.gf).toBe(gf);
      expect(T.ga).toBe(ga);
    }
    // ninguém joga duas vezes na mesma rodada
    t.schedule[g].forEach(r => {
      const seen = r.flatMap(m => [m.home, m.away]);
      expect(new Set(seen).size).toBe(seen.length);
    });
    // classificação respeita pontos > saldo > gols pró
    const order = sortGroupIds(t, g).map(id => t.teams[id]);
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1], b = order[i];
      expect(a.p > b.p || (a.p === b.p && (a.gd > b.gd || (a.gd === b.gd && a.gf >= b.gf)))).toBe(true);
    }
  }
}

function checkFinal(t: Tournament): void {
  expect(t.phase).toBe('END');
  expect(t.champion).toBeTruthy();
  expect(t.teams[t.champion!].out).toBeNull();
  // todos os jogos criados foram disputados (exceto o GF2 que não foi necessário)
  allMatches(t).forEach(m => {
    if (!m.played) expect('isGF2' in m && m.isGF2 && !m.home).toBe(true);
  });
  // estatística geral bate com os jogos
  const ms = playedMatches(t);
  const goals = ms.reduce((s, m) => s + m.res!.gH + m.res!.gA, 0);
  const teams = Object.values(t.teams);
  expect(teams.reduce((s, x) => s + x.st.gp, 0)).toBe(goals);
  expect(teams.reduce((s, x) => s + x.st.gc, 0)).toBe(goals);
  expect(teams.reduce((s, x) => s + x.st.j, 0)).toBe(2 * ms.length);
  // jogos que exigem vencedor sempre têm um
  ms.forEach(m => { if (m.kind !== 'group') expect(isDecided(m)).toBe(true); });
  // todo mundo, menos o campeão, tem um rótulo de onde caiu (exceto pontos corridos sem rótulo para nenhum)
  teams.forEach(x => { if (x.id !== t.champion) expect(x.out).toBeTruthy(); });
  if (t.runnerUp) expect(t.teams[t.runnerUp].out).toBe('Vice-campeão');
}

function checkSwiss(t: Tournament): void {
  if (!t.swissRounds.length) return;
  const teams = Object.values(t.teams);
  teams.forEach(x => {
    expect(x.sw === 3 || x.sl === 3).toBe(true);
    expect(x.sw + x.sl).toBeLessThanOrEqual(5);
  });
  expect(teams.filter(x => x.status === 'advanced').length).toBe(teams.length / 2);
  t.swissRounds.forEach(r => r.forEach(m => {
    // só se cruzam times com a mesma campanha naquela rodada: verificado pela etiqueta do pote
    expect(m.stage).toMatch(/Pote \d-\d/);
  }));
  // sem revanches
  const pairs = t.swissRounds.flat().map(m => [m.home, m.away].sort().join('|'));
  expect(new Set(pairs).size).toBe(pairs.length);
}

function checkSingleElim(t: Tournament): void {
  for (let i = 1; i < t.knockout.length; i++) {
    const prevWinners = new Set(t.knockout[i - 1].matches.map(winnerId));
    const now = t.knockout[i].matches.flatMap(m => [m.home, m.away]);
    expect(now.length).toBe(prevWinners.size);
    now.forEach(id => expect(prevWinners.has(id)).toBe(true));
  }
}

function checkDouble(t: Tournament): void {
  if (!t.bracket) return;
  const losses: Record<string, number> = {};
  const played = t.bracket.nodes.filter(n => n.played);
  let lastLossRound: Record<string, number> = {};
  played.sort((a, b) => a.round - b.round).forEach(n => {
    [n.home!, n.away!].forEach(id => {
      // ninguém joga depois da 2ª derrota
      expect(losses[id] ?? 0).toBeLessThan(2);
      if ((losses[id] ?? 0) === 1) expect(lastLossRound[id]).toBeLessThan(n.round);
    });
    const l = loserId(n);
    losses[l] = (losses[l] ?? 0) + 1;
    lastLossRound[l] = n.round;
  });
  const inBracket = new Set(t.bracket.nodes.flatMap(n => [n.home, n.away]).filter(Boolean));
  Object.values(t.teams).forEach(x => {
    expect(x.dl).toBe(losses[x.id] ?? 0);
    if (!inBracket.has(x.id)) return;
    if (x.id === t.champion) expect(x.dl).toBeLessThanOrEqual(1);
    else expect(x.dl).toBe(2);
  });
  const gf1 = t.bracket.nodes.find(n => n.isGF1)!;
  const gf2 = t.bracket.nodes.find(n => n.isGF2)!;
  // GF2 só existe se o campeão da lower venceu a GF1
  expect(gf2.played).toBe(winnerId(gf1) === gf1.away);
}

describe('invariantes do torneio', () => {
  for (const [name, over] of FORMATS) {
    for (const format of ['single', 'double'] as const) {
      const c = cfg({ ...over, bracketFormat: format });
      if (validateConfig(c)) continue;
      it(`${name} · ${format === 'single' ? 'eliminação simples' : 'dupla eliminação'}`, () => {
        for (let seed = 1; seed <= 25; seed++) {
          setSeed(seed * 7919);
          const users = someUsers(Math.min(1 + (seed % 8), totalTeamsFor(c)), seed % 40);
          const t = createTournament(c, users);
          // clubes do usuário estão no torneio
          users.forEach(id => expect(t.teams[id]).toBeTruthy());
          playAll(t);
          checkFinal(t);
          if (c.initialPhase === 'groups') checkGroupInvariants(t);
          checkSwiss(t);
          checkSingleElim(t);
          checkDouble(t);
        }
      });
    }
  }
});

describe('sorteios', () => {
  it('primeira fase do mata-mata nunca cruza times do mesmo grupo (8 grupos)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      setSeed(seed);
      const t = createTournament(cfg({ groupLegs: 1 }), someUsers(1));
      playAll(t, tt => {
        if (tt.phase === 'GROUP' && tt.round === 2 && tt.draw === null) {
          // ainda não; o sorteio aparece depois de avançar
        }
      });
      const first = t.knockout[0].matches;
      first.forEach(m => expect(t.teams[m.home].group).not.toBe(t.teams[m.away].group));
    }
  });

  it('dupla eliminação após 8 grupos: 1ª rodada da lower sem colegas de grupo', () => {
    for (let seed = 1; seed <= 150; seed++) {
      setSeed(seed);
      const t = createTournament(cfg({ groupLegs: 1, bracketFormat: 'double' }), someUsers(1));
      playAll(t);
      t.bracket!.nodes.filter(n => n.id.startsWith('LR1-')).forEach(n => {
        expect(t.teams[n.home!].group).not.toBe(t.teams[n.away!].group);
      });
    }
  });

  it('sorteio potted dos grupos: exatamente um time de cada pote por grupo', () => {
    // catálogo com OVRs distintos para os potes ficarem bem definidos
    const catalog = Array.from({ length: 32 }, (_, i) => ({ id: `c${i}`, name: `Clube ${i}`, country: ['BRA', 'ENG', 'ESP', 'ARG'][i % 4], ovr: 60 + i, logo: '', isElite: false }));
    for (let seed = 1; seed <= 80; seed++) {
      setSeed(seed);
      const t = createTournament(cfg({}), ['c0'], null, catalog);
      for (const g of Object.keys(t.groups)) {
        const pots = t.groups[g].map(id => Math.floor((91 - t.teams[id].ovr) / 8)).sort();
        expect(pots).toEqual([0, 1, 2, 3]);
      }
    }
  });

  it('recusa o mesmo clube escolhido duas vezes', () => {
    const [a] = someUsers(1);
    expect(() => createTournament(cfg({}), [a, a])).toThrow(/mais de uma vez/);
  });

  it('dupla eliminação: "invicto" só para quem não perdeu no torneio todo', () => {
    const seen = { yes: 0, no: 0 };
    for (let seed = 1; seed <= 120; seed++) {
      setSeed(seed * 31);
      const t = createTournament(cfg({ initialPhase: 'swiss', totalTeamsSwiss: 16, bracketFormat: 'double' }), someUsers(1));
      playAll(t);
      const gf1 = t.bracket!.nodes.find(n => n.isGF1)!;
      if (winnerId(gf1) !== gf1.home) continue;
      const lost = t.teams[t.champion!].st.d > 0;
      expect(/invicto/.test(t.championNote ?? '')).toBe(!lost);
      if (lost) seen.no++; else seen.yes++;
    }
    expect(seen.no).toBeGreaterThan(0);
    expect(seen.yes).toBeGreaterThan(0);
  });

  it('recusa mais clubes do usuário do que vagas', () => {
    expect(() => createTournament(cfg({ groupsCount: 1, teamsPerGroup: 3, advancingPerGroup: 1 }), someUsers(4))).toThrow(/vagas/);
  });
});

describe('reprodutibilidade', () => {
  it('mesma semente → mesmo campeão e mesmos placares', () => {
    const run = () => { setSeed(42); const t = createTournament(cfg({}), someUsers(3)); playAll(t); return JSON.stringify(playedMatches(t).map(m => [m.home, m.away, m.res!.gH, m.res!.gA, m.res!.penH])); };
    expect(run()).toBe(run());
  });
});
