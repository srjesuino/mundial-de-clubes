import { describe, expect, it } from 'vitest';
import { setSeed } from '../../src/engine/rng';
import {
  TACTICS, computeXG, matchOdds, newShootout, outcomeProbs, shootoutOver, recordKick, shootoutWinProb, simulateMatch, simulateShootout
} from '../../src/engine/model';
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
    expect(TACTICS.bal.own).toBe(1);
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
