import { describe, expect, it } from 'vitest';
import { ACH, endAchievements, matchAchievements } from '../../src/engine/achievements';
import { applyResult, baseOdds, isPlayable, oddsFor, setTactic, team } from '../../src/engine/core';
import { clinchStatus, formatChance, forecastColumns, forecastJob, runCountFor, runForecast, storeForecast } from '../../src/engine/forecast';
import { DIFF, aiPenaltyKick, diffOf, easiestDiff, keeperGuess } from '../../src/engine/live';
import { addHofEntry, buildShareText, emptyHof, hofEntry, placementOf, superPoints, superTotal, upsets, validHof } from '../../src/engine/meta';
import { setSeed } from '../../src/engine/rng';
import { allMatches, currentRoundMatches, finalizeDraw, simulateRound, advance } from '../../src/engine/tournament';
import type { PlayableMatch, Tournament } from '../../src/engine/types';
import { cfg, createTournament, playAll, someUsers } from './helpers';

const freeze = (t: Tournament) => JSON.stringify(t);

/** Avança até o primeiro jogo de mata-mata (sorteio já revelado) */
function untilPhase(t: Tournament, stop: (t: Tournament) => boolean): Tournament {
  let guard = 0;
  while (!stop(t) && t.phase !== 'END' && guard++ < 500) {
    if (t.draw) { finalizeDraw(t); continue; }
    simulateRound(t);
    advance(t);
  }
  return t;
}

describe('previsão do torneio (Monte Carlo)', () => {
  it('não altera o torneio de verdade e soma certo', () => {
    setSeed(11);
    const t = createTournament(cfg({}), someUsers(2));
    const before = freeze(t);
    const f = runForecast(t, 300);
    expect(freeze(t)).toBe(before);
    const ti = f.cols.indexOf('Título');
    const sum = (col: number) => Object.values(f.p).reduce((s, row) => s + row[col], 0);
    expect(sum(ti)).toBeCloseTo(1, 2);
    expect(sum(0)).toBeCloseTo(16, 1); // 8 grupos x 2 classificados
    expect(f.n).toBe(300);
    // cenários do próximo jogo: cada simulação cai em exatamente uma classe
    Object.values(f.cond).forEach(c => expect(Object.values(c).reduce((s, v) => s + v![0], 0)).toBe(300));
    // matriz de posições: cada clube ocupa uma posição por simulação
    Object.values(f.pos).forEach(g => Object.values(g).forEach(row => expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2)));
  });

  it('colunas por formato', () => {
    expect(forecastColumns(createTournament(cfg({}), someUsers(1)))).toEqual(['Classificar', 'Quartas de Final', 'Semifinal', 'Final', 'Título']);
    expect(forecastColumns(createTournament(cfg({ initialPhase: 'swiss', totalTeamsSwiss: 16 }), someUsers(1)))).toEqual(['Avançar (3V)', 'Semifinal', 'Final', 'Título']);
    expect(forecastColumns(createTournament(cfg({ initialPhase: 'knockout', totalTeamsKnockout: 16 }), someUsers(1)))).toEqual(['Quartas de Final', 'Semifinal', 'Final', 'Título']);
    expect(forecastColumns(createTournament(cfg({ initialPhase: 'knockout', totalTeamsKnockout: 16, bracketFormat: 'double' }), someUsers(1)))).toEqual(['Grande Final', 'Título']);
    expect(forecastColumns(createTournament(cfg({ groupsCount: 1, teamsPerGroup: 10, advancingPerGroup: 1 }), someUsers(1)))).toEqual(['Título', 'Top 4', 'Posição média']);
  });

  it('com só a final pela frente, o título bate com a chance do jogo (margem de 95%)', () => {
    setSeed(5);
    const t = untilPhase(createTournament(cfg({ initialPhase: 'knockout', totalTeamsKnockout: 8 }), someUsers(1)), x => x.phase === 'F' && !x.draw);
    const m = currentRoundMatches(t)[0];
    const f = runForecast(t, 2000);
    const ti = f.cols.indexOf('Título');
    const p = oddsFor(t, m).advH!;
    const margin = 1.96 * Math.sqrt((p * (1 - p)) / 2000);
    expect(Math.abs(f.p[m.home][ti] - p)).toBeLessThan(margin * 1.5);
  });

  it('nenhum clube vivo e indefinido aparece como 0% ou 100%; os decididos aparecem como ✓ / —', () => {
    setSeed(3);
    const t = untilPhase(createTournament(cfg({}), someUsers(1)), x => x.phase === 'GROUP' && x.round === 4);
    const f = runForecast(t, 300);
    Object.keys(t.teams).forEach(id => f.cols.forEach((_, ci) => {
      const c = formatChance(f, id, ci);
      if (!c.sure) { expect(c.text).not.toBe('0,0%'); expect(c.text).not.toBe('100,0%'); }
      if (c.text === '—') expect(f.dead).toContain(id);
    }));
    // quem a matemática já elimina está marcado como fora
    Object.keys(t.teams).forEach(id => { if (clinchStatus(t, id) === 'out') expect(f.dead).toContain(id); });
  });

  it('o número de simulações se ajusta ao aparelho', () => {
    expect(runCountFor(0.5)).toBe(2000);
    expect(runCountFor(5)).toBe(600);
    expect(runCountFor(30)).toBe(300);
  });

  it('o trabalho em pedaços dá o mesmo total e para no fim', () => {
    setSeed(8);
    const t = createTournament(cfg({ initialPhase: 'swiss', totalTeamsSwiss: 16 }), someUsers(1));
    const job = forecastJob(t, 120);
    let steps = 0;
    while (!job.step(2)) steps++;
    expect(job.done).toBe(120);
    expect(steps).toBeGreaterThan(0);
    storeForecast(t, job.result());
    storeForecast(t, job.result());
    expect(t.mcLog!.length).toBe(1); // mesma etapa: substitui, não acumula
  });

  it('recusa rodar com sorteio pendente (os confrontos sorteados não podem vazar)', () => {
    const t = createTournament(cfg({ initialPhase: 'knockout', totalTeamsKnockout: 8 }), someUsers(1));
    expect(t.draw).not.toBeNull();
    expect(() => runForecast(t, 10)).toThrow();
  });
});

describe('classificação matemática (exata)', () => {
  it('nunca erra: quem foi marcado como classificado se classifica e quem foi marcado como eliminado cai', () => {
    for (let s = 1; s <= 25; s++) {
      setSeed(s * 13);
      const t = createTournament(cfg({ groupsCount: 4, teamsPerGroup: 4, advancingPerGroup: 2, groupLegs: 2 }), someUsers(1));
      const marks: Record<string, 'in' | 'out'> = {};
      while (t.phase === 'GROUP') {
        Object.keys(t.teams).forEach(id => { const c = clinchStatus(t, id); if (c && !marks[id]) marks[id] = c; });
        simulateRound(t);
        advance(t);
      }
      Object.entries(marks).forEach(([id, c]) => {
        const out = team(t, id).out;
        if (c === 'in') expect(out?.startsWith('Fase de Grupos') ?? false).toBe(false);
        else expect(out?.startsWith('Fase de Grupos')).toBe(true);
      });
    }
  });
});

describe('Superação, colocação e resumo', () => {
  it('a postura escolhida não muda a Superação', () => {
    setSeed(21);
    const t = createTournament(cfg({}), someUsers(1));
    const me = t.userIds[0];
    const m = currentRoundMatches(t).find(x => x.home === me || x.away === me)!;
    const b0 = baseOdds(t, m);
    setTactic(t, m, m.home === me ? 'home' : 'away', 'att');
    expect(baseOdds(t, m)).toEqual(b0);
    applyResult(t, m, m.home === me ? { gH: 1, gA: 0, et: false, penH: null, penA: null } : { gH: 0, gA: 1, et: false, penH: null, penA: null });
    const pts = superPoints(t, m, me);
    const p = m.home === me ? b0.ph : b0.pa;
    expect(pts).toBe(Math.round(100 * Math.log2(1 / p)));
  });

  it('colocação final e resumo compartilhável', () => {
    setSeed(4);
    const t = playAll(createTournament(cfg({}), someUsers(3)));
    expect(placementOf(t, t.champion!).rank).toBe(1000);
    expect(placementOf(t, t.runnerUp!).rank).toBe(999);
    const txt = buildShareText(t);
    expect(txt.length).toBeLessThanOrEqual(900);
    expect(txt).toContain('Resultados gerados pelo simulador; não são jogos reais.');
    expect(txt).toContain('Campeão: ' + team(t, t.champion!).name);
    t.userIds.forEach(id => expect(superTotal(t, id)).toBeGreaterThanOrEqual(0));
    upsets(t).forEach((u, i, arr) => { expect(u.p).toBeLessThan(0.35); if (i) expect(u.p).toBeGreaterThanOrEqual(arr[i - 1].p); });
    const h = addHofEntry(emptyHof(), hofEntry(t, 1700000000000));
    expect(validHof(JSON.parse(JSON.stringify(h)))).toBe(true);
    expect(h.titles[t.champion!].t).toBe(1);
  });
});

describe('conquistas', () => {
  const fakeWin = (t: Tournament, m: PlayableMatch, me: string, live = false) => {
    const home = m.home === me;
    applyResult(t, m, { gH: home ? 5 : 0, gA: home ? 0 : 5, et: false, penH: null, penA: null, ...(live ? { live: { d: 'normal', md: 2, sk: 0, ps: [0, 0], pd: [0, 0] } } : {}) });
  };

  it('jogo simulado nunca dá conquista de habilidade; ao vivo dá', () => {
    setSeed(2);
    const t = createTournament(cfg({}), someUsers(2));
    const [a, b] = t.userIds;
    const ms = currentRoundMatches(t);
    const ma = ms.find(x => x.home === a || x.away === a)!;
    const mb = ms.find(x => (x.home === b || x.away === b) && x !== ma)!;
    fakeWin(t, ma, a);
    const ks = matchAchievements(t, ma).map(u => u.k);
    expect(ks).toContain('rout');
    expect(ks).not.toContain('comeback');
    fakeWin(t, mb, b, true);
    expect(matchAchievements(t, mb).map(u => u.k)).toContain('comeback');
  });

  it('as chaves das conquistas são únicas e o fim do torneio só premia o que aconteceu', () => {
    expect(new Set(ACH.map(a => a.k)).size).toBe(ACH.length);
    setSeed(9);
    const t = playAll(createTournament(cfg({ initialPhase: 'knockout', totalTeamsKnockout: 64 }), someUsers(1)));
    const ks = endAchievements(t).map(u => u.k);
    expect(ks).toContain('max64');
    expect(ks.includes('champ')).toBe(t.champion === t.userIds[0]);
    expect(ks).not.toContain('all_live');
    allMatches(t).filter(isPlayable).forEach(m => matchAchievements(t, m).forEach(u => expect(['giant_killer', 'miracle', 'rout']).toContain(u.k)));
  });
});

describe('dificuldade dos minigames', () => {
  it('Normal mantém exatamente os valores calibrados', () => {
    expect(DIFF.normal).toMatchObject({ win: 1, aimGoal: 0.75, keeperGoal: 0.2, lateGoal: 0.1, touchedGoal: 0.35, missedGoal: 0.9, learn: 0.2, rel: 0, penShootMs: 5000, penDefMs: 3500, gloves: 3 });
    expect(diffOf(undefined)).toBe(DIFF.normal);
    expect(easiestDiff(['lenda', 'dificil'])).toBe('dificil');
    expect(easiestDiff([], 'lenda')).toBe('lenda');
  });

  it('a dica do batedor nunca fica abaixo de 45% de confiabilidade, em nenhum nível', () => {
    for (const lv of Object.values(DIFF)) for (let d = -30; d <= 30; d += 3) expect(aiPenaltyKick(80 + d, 80, lv.rel).reliability).toBeGreaterThanOrEqual(0.45);
  });

  it('o goleiro aprende mais nos níveis difíceis', () => {
    setSeed(1);
    const hit = (learn: number) => { let n = 0; for (let i = 0; i < 20000; i++) if (keeperGuess([0, 0, 0], learn) === 0) n++; return n / 20000; };
    expect(hit(DIFF.lenda.learn)).toBeGreaterThan(hit(DIFF.facil.learn) + 0.1);
  });
});
