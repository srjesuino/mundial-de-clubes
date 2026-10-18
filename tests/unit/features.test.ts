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
      if (c.text === '—') expect(f.known[id][ci]).toBe('0');
    }));
    // quem a matemática já elimina está marcado como fora; quem já garantiu, como garantido
    Object.keys(t.teams).forEach(id => {
      const c = clinchStatus(t, id);
      if (c === 'out') expect(f.known[id]).toMatch(/^0+$/);
      if (c === 'in') expect(f.known[id][0]).toBe('1');
    });
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

describe('correções da previsão (revisão)', () => {
  it('a chave muda de "rodada encerrada" para "próxima rodada" (os cenários são recalculados)', async () => {
    const { forecastKey, resultsKey } = await import('../../src/engine/forecast');
    setSeed(31);
    const t = createTournament(cfg({}), someUsers(1));
    simulateRound(t);
    const k1 = forecastKey(t), r1 = resultsKey(t);
    advance(t);
    expect(forecastKey(t)).not.toBe(k1);
    expect(resultsKey(t)).toBe(r1); // mesmos resultados: uma entrada só no histórico
    const f = runForecast(t, 200);
    expect(Object.keys(f.cond)).toContain(t.userIds[0]);
  });

  it('pontos corridos encerrados: Top 4 e título decididos, sem "—" para quem ficou entre os 4', () => {
    setSeed(12);
    const t = createTournament(cfg({ groupsCount: 1, teamsPerGroup: 6, advancingPerGroup: 1, groupLegs: 1 }), someUsers(1));
    while (!(t.round === 4 && t.phase === 'GROUP')) { simulateRound(t); advance(t); }
    simulateRound(t); // última rodada disputada, ainda sem avançar
    const f = runForecast(t, 100);
    const order = Object.keys(t.teams).sort((a, b) => f.p[a][2] - f.p[b][2]);
    order.forEach((id, i) => {
      expect(formatChance(f, id, 0).text).toBe(i === 0 ? '✓' : '—');
      expect(formatChance(f, id, 1).text).toBe(i < 4 ? '✓' : '—');
    });
  });

  it('save com previsão de formato antigo ou quebrada: descarta só a previsão', async () => {
    const { sanitize, validSave } = await import('../../src/state/store');
    setSeed(2);
    const t = createTournament(cfg({}), someUsers(1));
    const broken = JSON.parse(JSON.stringify(t));
    broken.mc = { key: 'x', n: 10, label: 'y', cols: ['Título'], p: { a: [0.1] }, cond: {}, pos: {}, dead: [], got: {} };
    broken.mcLog = [{ k: '0', label: 'a', n: 1, t: { a: 0.1 } }, { label: 'sem t' }];
    expect(validSave(broken)).toBe(true);
    const s = sanitize(broken);
    expect(s.mc).toBeUndefined();
    expect(s.mcLog).toHaveLength(1);
    const good = JSON.parse(JSON.stringify(t));
    good.mc = runForecast(t, 50);
    expect(sanitize(good).mc).toBeDefined();
  });
});

describe('correções da galeria, conquistas e saves (revisão)', () => {
  const live = (over: Record<string, unknown> = {}) => ({ s: 'home', d: 'normal', md: 0, sk: 0, ps: [0, 0], pd: [0, 0], ...over }) as never;

  it('save de versão anterior com "live: true" vira jogo simulado em vez de travar a rodada', async () => {
    const { sanitize } = await import('../../src/state/store');
    setSeed(14);
    const t = createTournament(cfg({}), someUsers(1));
    simulateRound(t);
    const old = JSON.parse(JSON.stringify(t));
    const m = old.schedule.A[0][0];
    m.res.live = true;
    m.res.gm = 'x';
    m.tactics = { home: 'turbo' };
    sanitize(old);
    expect(m.res.live).toBeUndefined();
    expect(m.res.gm).toBeUndefined();
    expect(m.tactics).toBeUndefined();
    expect(() => matchAchievements(old, m)).not.toThrow();
  });

  it('Virada vai só para o clube que o usuário controlou num jogo entre dois clubes seus', () => {
    setSeed(6);
    const t = createTournament(cfg({ initialPhase: 'knockout', totalTeamsKnockout: 8 }), someUsers(8));
    finalizeDraw(t);
    const m = currentRoundMatches(t)[0];
    applyResult(t, m, { gH: 0, gA: 3, et: false, penH: null, penA: null, live: live({ s: 'home', md: 3 }) });
    // o usuário controlou o mandante, que perdeu: a vitória do visitante (máquina) não é "Virada"
    expect(matchAchievements(t, m).map(u => u.k)).not.toContain('comeback');
  });

  it('Mão na massa e Lenda exigem jogos ao vivo sem pular; Sangue frio não vale com cobranças simuladas', () => {
    setSeed(9);
    const t = createTournament(cfg({ initialPhase: 'knockout', totalTeamsKnockout: 8, difficulty: 'lenda' }), someUsers(1));
    const me = t.userIds[0];
    t.diffUsed = ['lenda'];
    let guard = 0;
    while (t.phase !== 'END' && guard++ < 50) {
      if (t.draw) { finalizeDraw(t); continue; }
      currentRoundMatches(t).forEach(m => {
        if (m.played) return;
        const side = m.home === me ? 'home' : m.away === me ? 'away' : null;
        if (!side) { applyResult(t, m, { gH: 1, gA: 0, et: false, penH: null, penA: null }); return; }
        applyResult(t, m, { gH: side === 'home' ? 2 : 0, gA: side === 'home' ? 0 : 2, et: false, penH: null, penA: null, live: live({ s: side, sk: 1 }) });
      });
      advance(t);
    }
    expect(t.champion).toBe(me);
    const ks = endAchievements(t).map(u => u.k);
    expect(ks).toContain('champ');
    expect(ks).not.toContain('all_live');
    expect(ks).not.toContain('legend');
    const pk = createTournament(cfg({ initialPhase: 'knockout', totalTeamsKnockout: 8 }), someUsers(1));
    finalizeDraw(pk);
    const m = currentRoundMatches(pk).find(x => x.home === pk.userIds[0] || x.away === pk.userIds[0])!;
    const side = m.home === pk.userIds[0] ? 'home' : 'away';
    applyResult(pk, m, { gH: 1, gA: 1, et: true, penH: side === 'home' ? 5 : 6, penA: side === 'home' ? 6 : 5, live: live({ s: side, ps: [5, 5], sp: 1 }) });
    expect(matchAchievements(pk, m).map(u => u.k)).not.toContain('ice');
  });

  it('colocação comparável entre formatos: pela posição final', () => {
    setSeed(3);
    const a = playAll(createTournament(cfg({ initialPhase: 'knockout', totalTeamsKnockout: 64 }), someUsers(1)));
    const b = playAll(createTournament(cfg({ initialPhase: 'knockout', totalTeamsKnockout: 8, bracketFormat: 'double' }), someUsers(1)));
    const sfLoser = a.knockout.find(k => k.phase === 'SF')!.matches.map(m => (m.res!.gH !== m.res!.gA ? (m.res!.gH > m.res!.gA ? m.away : m.home) : (m.res!.penH! > m.res!.penA! ? m.away : m.home)))[0];
    expect(placementOf(a, sfLoser).rank).toBe(998);
    expect(placementOf(a, sfLoser).label).toContain('3º–4º de 64');
    // ninguém fora da final passa do vice; quem caiu cedo na dupla eliminação fica abaixo de um semifinalista
    Object.keys(b.teams).filter(id => id !== b.champion && id !== b.runnerUp).forEach(id => {
      expect(placementOf(b, id).rank).toBeLessThan(999);
    });
    const ranks = Object.keys(b.teams).map(id => placementOf(b, id).rank).sort((x, y) => y - x);
    expect(ranks[0]).toBe(1000);
    expect(ranks[ranks.length - 1]).toBeGreaterThanOrEqual(1001 - 8);
  });

  it('galeria guardada com entrada quebrada: descarta só a entrada', async () => {
    const { normalizeHof } = await import('../../src/engine/meta');
    setSeed(4);
    const t = playAll(createTournament(cfg({ initialPhase: 'knockout', totalTeamsKnockout: 8 }), someUsers(1)));
    const good = hofEntry(t, 1);
    const h = normalizeHof({ v: 1, list: [good, { ...good, id: 'H2', users: [{ id: 'x' }] }], titles: { a: null, b: { name: 'B', t: 1, f: 1 } } })!;
    expect(h.list).toHaveLength(1);
    expect(Object.keys(h.titles)).toEqual(['b']);
  });
});

describe('correções da segunda revisão', () => {
  it('pontos corridos com até 4 clubes: Top 4 garantido desde o início', () => {
    setSeed(1);
    const t = createTournament(cfg({ groupsCount: 1, teamsPerGroup: 4, advancingPerGroup: 1, groupLegs: 2 }), someUsers(1));
    simulateRound(t);
    advance(t);
    const f = runForecast(t, 100);
    Object.keys(t.teams).forEach(id => expect(formatChance(f, id, 1).text).toBe('✓'));
  });

  it('no fim do torneio, tudo está decidido', async () => {
    const { decidedNow } = await import('../../src/engine/forecast');
    setSeed(7);
    const t = playAll(createTournament(cfg({}), someUsers(1)));
    const k = decidedNow(t);
    Object.keys(t.teams).forEach(id => expect(k[id]).toMatch(/^[01]+$/));
    expect(k[t.champion!]).toMatch(/1$/);
  });

  it('histórico de versão antiga (chave que não é número de jogos) é descartado', async () => {
    const { sanitize } = await import('../../src/state/store');
    setSeed(2);
    const t = JSON.parse(JSON.stringify(createTournament(cfg({}), someUsers(1))));
    t.mcLog = [{ k: 'GROUP|0|0|0|0|-', label: 'a', n: 1, t: {} }, { k: '16', label: 'b', n: 1, t: {} }];
    expect(sanitize(t).mcLog!.map(e => e.k)).toEqual(['16']);
  });

  it('galeria com escala antiga de colocação é convertida', async () => {
    const { normalizeHof } = await import('../../src/engine/meta');
    setSeed(4);
    const t = playAll(createTournament(cfg({ initialPhase: 'knockout', totalTeamsKnockout: 64 }), someUsers(1)));
    const e = hofEntry(t, 1) as unknown as Record<string, unknown>;
    delete e.rv;
    (e.users as { rank: number; label: string }[])[0] = { ...(e.users as never[])[0] as object, rank: 140, label: 'Semifinal' } as never;
    const h = normalizeHof({ v: 1, list: [e], titles: {} })!;
    expect(h.list[0].users[0].rank).toBe(998);
  });
});
