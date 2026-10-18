import { describe, expect, it } from 'vitest';
import { setSeed } from '../../src/engine/rng';
import {
  PACE, computeXG, liveOdds, matchOdds, newShootout, outcomeProbs, penWinFrom, shootoutOver, recordKick, shootoutWinProb, simulateMatch, simulateShootout,
  type SimContext
} from '../../src/engine/model';
import type { Tactic } from '../../src/engine/types';
import type { MatchKind } from '../../src/engine/types';

const N = 60000;

function empirical(kind: MatchKind, homeOvr: number, awayOvr: number) {
  const { xh, xa } = computeXG({ homeOvr, awayOvr, homeAdv: 0 });
  const ctx = { kind, xh, xa, homeOvr, awayOvr };
  let h = 0, d = 0, a = 0, adv = 0;
  for (let i = 0; i < N; i++) {
    const r = simulateMatch(ctx);
    if (r.gH > r.gA) h++; else if (r.gH < r.gA) a++; else d++;
    const homeWins = r.gH !== r.gA ? r.gH > r.gA : (r.penH ?? 0) > (r.penA ?? 0);
    if (homeWins) adv++;
  }
  return { ctx, ph: h / N, pd: d / N, pa: a / N, adv: adv / N };
}

describe('as probabilidades mostradas batem com o simulador', () => {
  for (const [h, a] of [[85, 85], [90, 78], [70, 88]]) {
    it(`grupo ${h} x ${a}: vitória/empate/derrota`, () => {
      setSeed(h * 1000 + a);
      const e = empirical('group', h, a);
      const o = matchOdds(e.ctx);
      expect(Math.abs(o.ph - e.ph)).toBeLessThan(0.012);
      expect(Math.abs(o.pd - e.pd)).toBeLessThan(0.012);
      expect(Math.abs(o.pa - e.pa)).toBeLessThan(0.012);
    });
    it(`mata-mata ${h} x ${a}: chance de avançar (prorrogação + pênaltis)`, () => {
      setSeed(h * 77 + a);
      const e = empirical('ko', h, a);
      expect(Math.abs(matchOdds(e.ctx).advH! - e.adv)).toBeLessThan(0.012);
    });
    it(`suíço ${h} x ${a}: chance de vencer (empate vai direto aos pênaltis)`, () => {
      setSeed(h * 31 + a);
      const e = empirical('swiss', h, a);
      expect(Math.abs(matchOdds(e.ctx).advH! - e.adv)).toBeLessThan(0.012);
    });
  }

  it('probabilidade ao vivo com placar e tempo restante', () => {
    setSeed(9);
    const { xh, xa } = computeXG({ homeOvr: 80, awayOvr: 84, homeAdv: 0 });
    const ctx = { kind: 'group' as const, xh, xa, homeOvr: 80, awayOvr: 84 };
    // vencendo por 1 a 0 com 30 minutos restantes
    const o = matchOdds(ctx, { hSc: 1, aSc: 0, remaining: 30 / 90 });
    let win = 0;
    for (let i = 0; i < N; i++) {
      const r = simulateMatch({ ...ctx, xh: xh * 30 / 90, xa: xa * 30 / 90 });
      if (1 + r.gH > r.gA) win++;
    }
    expect(Math.abs(o.ph - win / N)).toBeLessThan(0.012);
  });

  it('disputa de pênaltis: fórmula exata = simulação', () => {
    setSeed(5);
    for (const [h, a] of [[93, 65], [80, 80], [75, 88]]) {
      let w = 0;
      for (let i = 0; i < N; i++) { const P = simulateShootout(h, a); if (P.h > P.a) w++; }
      expect(Math.abs(shootoutWinProb(h, a) - w / N)).toBeLessThan(0.012);
    }
  });
});

describe('modelo de gols', () => {
  it('jogo equilibrado: ~2,6 gols por jogo e 0 x 0 possível', () => {
    setSeed(1);
    const { xh, xa } = computeXG({ homeOvr: 85, awayOvr: 85, homeAdv: 0 });
    let goals = 0, zero = 0;
    for (let i = 0; i < N; i++) {
      const r = simulateMatch({ kind: 'group', xh, xa, homeOvr: 85, awayOvr: 85 });
      goals += r.gH + r.gA;
      if (r.gH + r.gA === 0) zero++;
    }
    expect(goals / N).toBeGreaterThan(2.45);
    expect(goals / N).toBeLessThan(2.75);
    expect(zero / N).toBeGreaterThan(0.05);
  });

  it('táticas: retranca reduz gols dos dois lados e aumenta empates; ofensivo faz o contrário', () => {
    const base = computeXG({ homeOvr: 82, awayOvr: 82, homeAdv: 0 });
    const def = computeXG({ homeOvr: 82, awayOvr: 82, homeAdv: 0, tactics: { home: 'def' } });
    const att = computeXG({ homeOvr: 82, awayOvr: 82, homeAdv: 0, tactics: { home: 'att' } });
    expect(def.xh + def.xa).toBeLessThan(base.xh + base.xa);
    expect(att.xh + att.xa).toBeGreaterThan(base.xh + base.xa);
    expect(outcomeProbs(def.xh, def.xa).pd).toBeGreaterThan(outcomeProbs(base.xh, base.xa).pd);
    expect(outcomeProbs(att.xh, att.xa).pd).toBeLessThan(outcomeProbs(base.xh, base.xa).pd);
    expect(PACE.bal).toBe(1);
  });

  it('regras da disputa: encerra cedo quando decidida e segue em morte súbita', () => {
    const P = newShootout();
    P.first = 'home';
    // 3 x 0 depois de 3 cobranças cada: o visitante não alcança mais
    for (let i = 0; i < 3; i++) { recordKick(P, true, true); recordKick(P, false, false); }
    expect(shootoutOver(P)).toBe(true);
    const Q = newShootout();
    for (let i = 0; i < 5; i++) { recordKick(Q, true, true); recordKick(Q, false, true); }
    expect(shootoutOver(Q)).toBe(false);          // 5 x 5: morte súbita
    recordKick(Q, true, true);
    expect(shootoutOver(Q)).toBe(false);          // visitante ainda bate
    recordKick(Q, false, false);
    expect(shootoutOver(Q)).toBe(true);
  });
});

const TACS: Tactic[] = ['def', 'bal', 'att'];
const ctxFor = (kind: 'group' | 'swiss' | 'ko', d: number, home: Tactic): SimContext => {
  const { xh, xa } = computeXG({ homeOvr: 80 + d, awayOvr: 80, homeAdv: 0, tactics: { home } });
  return { kind, xh, xa, homeOvr: 80 + d, awayOvr: 80 };
};
const r1 = (x: number) => Math.round(x * 1000) / 10;

describe('postura tática: ritmo simétrico (números de aceitação do painel)', () => {
  it('mata-mata OVR +8: 70,4 / 72,8 / 75,3% · OVR −8: 29,6 / 27,2 / 24,7%', () => {
    expect(TACS.map(v => r1(matchOdds(ctxFor('ko', 8, v)).advH!))).toEqual([70.4, 72.8, 75.3]);
    expect(TACS.map(v => r1(matchOdds(ctxFor('ko', -8, v)).advH!))).toEqual([29.6, 27.2, 24.7]);
  });

  it('grupo entre iguais: V/E/D 34/31/34, 37/26/37, 39/23/39 · pontos esperados a −8: 0,85 / 0,80 / 0,73', () => {
    const pctRow = (o: { ph: number; pd: number; pa: number }) => [o.ph, o.pd, o.pa].map(x => Math.round(x * 100));
    expect(TACS.map(v => pctRow(matchOdds(ctxFor('group', 0, v))))).toEqual([[34, 31, 34], [37, 26, 37], [39, 23, 39]]);
    const xpts = TACS.map(v => { const o = matchOdds(ctxFor('group', -8, v)); return Math.round((3 * o.ph + o.pd) * 100) / 100; });
    expect(xpts).toEqual([0.85, 0.8, 0.73]);
  });

  it('nenhuma postura domina: o favorito prefere jogo aberto e o azarão, fechado', () => {
    const fav = TACS.map(v => matchOdds(ctxFor('ko', 8, v)).advH!);
    const dog = TACS.map(v => matchOdds(ctxFor('ko', -8, v)).advH!);
    expect(fav[2]).toBeGreaterThan(fav[1]);
    expect(fav[1]).toBeGreaterThan(fav[0]);
    expect(dog[0]).toBeGreaterThan(dog[1]);
    expect(dog[1]).toBeGreaterThan(dog[2]);
  });

  it('ao vivo, mata-mata entre iguais com 20 minutos restantes: 0x1 → 8,9 / 11,1 / 13,5% · 1x0 → 91,1 / 88,9 / 86,5%', () => {
    const at = (v: Tactic, hSc: number, aSc: number) => r1(liveOdds(ctxFor('ko', 0, v), { min: 70, hSc, aSc, period: 'REG' }).advH!);
    expect(TACS.map(v => at(v, 0, 1))).toEqual([8.9, 11.1, 13.5]);
    expect(TACS.map(v => at(v, 1, 0))).toEqual([91.1, 88.9, 86.5]);
  });
});

describe('probabilidade ao vivo', () => {
  it('no minuto 0 e 0 x 0 é igual à do pré-jogo', () => {
    for (const kind of ['group', 'swiss', 'ko'] as const) {
      for (const d of [-12, 0, 7]) {
        const ctx = ctxFor(kind, d, 'bal');
        const a = matchOdds(ctx), b = liveOdds(ctx, { min: 0, hSc: 0, aSc: 0, period: 'REG' });
        expect(Math.abs(a.ph - b.ph)).toBeLessThan(1e-12);
        expect(Math.abs(a.pd - b.pd)).toBeLessThan(1e-12);
        if (a.advH !== undefined) expect(Math.abs(a.advH - b.advH!)).toBeLessThan(1e-12);
      }
    }
  });

  it('pênaltis em andamento: igual à fórmula no início e à simulação no meio da disputa', () => {
    const start = { h: 0, a: 0, hk: 0, ak: 0, first: 'home' as const };
    expect(penWinFrom(start, 80, 80)).toBeCloseTo(0.5, 6);
    expect(penWinFrom(start, 93, 65)).toBeCloseTo(0.740102, 6);
    expect(penWinFrom(start, 93, 65)).toBeCloseTo(shootoutWinProb(93, 65), 10);
    const mid = { h: 2, a: 3, hk: 3, ak: 3, first: 'home' as const };
    expect(Math.round(penWinFrom(mid, 85, 80) * 1e4) / 1e4).toBe(0.1704);
    setSeed(77);
    let w = 0;
    const M = 100000;
    for (let i = 0; i < M; i++) {
      const P = { ...newShootout(), ...mid, kicks: { home: [], away: [] } };
      simulateShootout(85, 80, P);
      if (P.h > P.a) w++;
    }
    expect(Math.abs(w / M - 0.1704)).toBeLessThan(0.006);
  });
});

describe('linha do tempo dos gols não muda nenhuma distribuição', () => {
  it('com a mesma semente, o placar é idêntico com e sem minutos', () => {
    for (const kind of ['group', 'swiss', 'ko'] as const) {
      const ctx = ctxFor(kind, 3, 'bal');
      for (let s = 1; s <= 3000; s++) {
        setSeed(s);
        const a = simulateMatch(ctx, true);
        setSeed(s);
        const b = simulateMatch(ctx, false);
        expect([a.gH, a.gA, a.et, a.penH, a.penA]).toEqual([b.gH, b.gA, b.et, b.penH, b.penA]);
        expect(a.gm!.length).toBe(a.gH + a.gA);
        expect(b.gm).toBeUndefined();
        a.gm!.forEach(([min]) => { expect(min).toBeGreaterThanOrEqual(1); expect(min).toBeLessThanOrEqual(a.et ? 120 : 90); });
        if (a.penH !== null) expect(a.pk!.h.reduce((x, y) => x + y, 0)).toBe(a.penH);
      }
    }
  });
});
