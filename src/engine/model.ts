// Modelo de partida: gols ~ Poisson; a força relativa vem do OVR.
// Tudo que é mostrado ao jogador (probabilidades, xG) sai destas mesmas funções.
import { clamp, poisPmf, binomPmf } from './math';
import { poisson, rand } from './rng';
import type { MatchKind, MatchResult, Shootout, Side, Tactic } from './types';

export const BASE_XG = 1.3;     // gols esperados de cada time num jogo equilibrado
export const OVR_K = 0.042;     // peso de cada ponto de OVR de diferença
export const HOME_ADV = 0.1;    // mando de campo (só em grupos de ida e volta)
export const ET_FRACTION = 1 / 3; // prorrogação = 30 de 90 minutos

/**
 * Postura tática: muda o ritmo do jogo, não a qualidade dos times.
 * own = multiplica o xG do próprio time; opp = multiplica o xG do adversário.
 */
export const TACTICS: Record<Tactic, { label: string; own: number; opp: number; hint: string }> = {
  def: { label: 'Retranca', own: 0.78, opp: 0.72, hint: 'Jogo fechado: menos gols dos dois lados, mais empates' },
  bal: { label: 'Equilibrado', own: 1, opp: 1, hint: 'Sem alterar o ritmo' },
  att: { label: 'Ofensivo', own: 1.18, opp: 1.15, hint: 'Jogo aberto: mais gols dos dois lados' }
};

export interface XgInput {
  homeOvr: number;
  awayOvr: number;
  homeAdv: number;               // 0 ou HOME_ADV
  tactics?: Partial<Record<Side, Tactic>>;
}

export function computeXG({ homeOvr, awayOvr, homeAdv, tactics }: XgInput): { xh: number; xa: number } {
  const d = homeOvr - awayOvr;
  let xh = BASE_XG * Math.exp(OVR_K * d) * (1 + homeAdv);
  let xa = BASE_XG * Math.exp(-OVR_K * d) * (1 - homeAdv);
  const th = TACTICS[tactics?.home ?? 'bal'];
  const ta = TACTICS[tactics?.away ?? 'bal'];
  xh *= th.own * ta.opp;
  xa *= ta.own * th.opp;
  return { xh: clamp(xh, 0.12, 5.5), xa: clamp(xa, 0.12, 5.5) };
}

export const needsWinner = (kind: MatchKind): boolean => kind !== 'group';
export const hasPens = (r: MatchResult | null | undefined): r is MatchResult & { penH: number; penA: number } =>
  !!r && r.penH !== null && r.penH !== undefined;

// ---------- Pênaltis ----------
/** Probabilidade de converter um pênalti (batedor x goleiro): quase um cara ou coroa, com leve peso do OVR */
export function penKickProb(attOvr: number, defOvr: number): number {
  return clamp(0.76 + (attOvr - defOvr) * 0.0025, 0.68, 0.84);
}

export function newShootout(): Shootout {
  return { h: 0, a: 0, hk: 0, ak: 0, first: rand() < 0.5 ? 'home' : 'away', kicks: { home: [], away: [] }, userCols: [] };
}

export function nextKickerIsHome(P: Shootout): boolean {
  return ((P.hk + P.ak) % 2 === 0) === (P.first === 'home');
}

/** Regras oficiais: 5 cobranças alternadas com encerramento antecipado, depois morte súbita */
export function shootoutOver(P: Shootout): boolean {
  if (P.hk < 5 || P.ak < 5) {
    const hRem = 5 - P.hk;
    const aRem = 5 - P.ak;
    return P.h > P.a + aRem || P.a > P.h + hRem;
  }
  return P.hk === P.ak && P.h !== P.a;
}

export function recordKick(P: Shootout, home: boolean, goal: boolean): void {
  if (home) { P.hk++; if (goal) P.h++; P.kicks.home.push(goal); }
  else { P.ak++; if (goal) P.a++; P.kicks.away.push(goal); }
}

export function simulateShootout(homeOvr: number, awayOvr: number, P: Shootout = newShootout()): Shootout {
  let guard = 0;
  while (!shootoutOver(P) && guard++ < 400) {
    const home = nextKickerIsHome(P);
    const prob = home ? penKickProb(homeOvr, awayOvr) : penKickProb(awayOvr, homeOvr);
    recordKick(P, home, rand() < prob);
  }
  return P;
}

/** Chance exata de o mandante vencer a disputa (5 cobranças binomiais + morte súbita) */
export function shootoutWinProb(homeOvr: number, awayOvr: number): number {
  const p = penKickProb(homeOvr, awayOvr);
  const q = penKickProb(awayOvr, homeOvr);
  let win5 = 0;
  let tie5 = 0;
  for (let i = 0; i <= 5; i++) {
    for (let j = 0; j <= 5; j++) {
      const pr = binomPmf(i, 5, p) * binomPmf(j, 5, q);
      if (i > j) win5 += pr;
      else if (i === j) tie5 += pr;
    }
  }
  const sd = (p * (1 - q)) / (p * (1 - q) + q * (1 - p));
  return win5 + tie5 * sd;
}

// ---------- Simulação de um jogo ----------
export interface SimContext { kind: MatchKind; xh: number; xa: number; homeOvr: number; awayOvr: number }

/** Minutos dos gols espalhados ao acaso no intervalo (só para o relatório da partida) */
function goalMinutes(n: number, from: number, to: number): number[] {
  return Array.from({ length: n }, () => from + 1 + Math.floor(rand() * (to - from))).sort((a, b) => a - b);
}

export function simulateMatch(ctx: SimContext): MatchResult {
  const gH = poisson(ctx.xh);
  const gA = poisson(ctx.xa);
  const res: MatchResult = { gH, gA, et: false, penH: null, penA: null };
  const events: [number, 0 | 1, 0 | 1][] = [
    ...goalMinutes(gH, 0, 90).map(m => [m, 0, 1] as [number, 0, 1]),
    ...goalMinutes(gA, 0, 90).map(m => [m, 1, 1] as [number, 1, 1])
  ];
  if (needsWinner(ctx.kind) && res.gH === res.gA) {
    if (ctx.kind === 'ko') {
      res.et = true;
      const eh = poisson(ctx.xh * ET_FRACTION);
      const ea = poisson(ctx.xa * ET_FRACTION);
      res.gH += eh;
      res.gA += ea;
      events.push(...goalMinutes(eh, 90, 120).map(m => [m, 0, 1] as [number, 0, 1]), ...goalMinutes(ea, 90, 120).map(m => [m, 1, 1] as [number, 1, 1]));
    }
    if (res.gH === res.gA) {
      const P = simulateShootout(ctx.homeOvr, ctx.awayOvr);
      res.penH = P.h;
      res.penA = P.a;
    }
  }
  res.events = events.sort((a, b) => a[0] - b[0]);
  return res;
}

// ---------- Probabilidades analíticas ----------
export interface Outcome { ph: number; pd: number; pa: number }

/** P(vitória/empate/derrota) com λ dados e um placar de partida já existente */
export function outcomeProbs(xh: number, xa: number, lead = 0): Outcome {
  let ph = 0, pd = 0, pa = 0;
  for (let i = 0; i <= 14; i++) {
    const pi = poisPmf(i, xh);
    for (let j = 0; j <= 14; j++) {
      const p = pi * poisPmf(j, xa);
      const diff = lead + i - j;
      if (diff > 0) ph += p; else if (diff < 0) pa += p; else pd += p;
    }
  }
  const s = ph + pd + pa;
  return { ph: ph / s, pd: pd / s, pa: pa / s };
}

/** Chance de o mandante avançar quando o jogo empata (prorrogação se 'ko', depois pênaltis) */
export function tieBreakWinProb(kind: MatchKind, xh: number, xa: number, homeOvr: number, awayOvr: number): number {
  const pen = shootoutWinProb(homeOvr, awayOvr);
  if (kind !== 'ko') return pen;
  const et = outcomeProbs(xh * ET_FRACTION, xa * ET_FRACTION);
  return et.ph + et.pd * pen;
}

export interface Odds { ph: number; pd: number; pa: number; advH?: number }

/** Probabilidades antes do jogo (ou durante: placar atual e fração restante do tempo normal) */
export function matchOdds(ctx: SimContext, state?: { hSc: number; aSc: number; remaining: number; period?: 'REG' | 'ET' }): Odds {
  const rem = state ? Math.max(0, state.remaining) : 1;
  const lead = state ? state.hSc - state.aSc : 0;
  if (state?.period === 'ET') {
    // Durante a prorrogação: só o que falta dela; empate → pênaltis
    const o = outcomeProbs(ctx.xh * rem * ET_FRACTION, ctx.xa * rem * ET_FRACTION, lead);
    const pen = shootoutWinProb(ctx.homeOvr, ctx.awayOvr);
    return { ...o, advH: o.ph + o.pd * pen };
  }
  const o = outcomeProbs(ctx.xh * rem, ctx.xa * rem, lead);
  if (!needsWinner(ctx.kind)) return o;
  return { ...o, advH: o.ph + o.pd * tieBreakWinProb(ctx.kind, ctx.xh, ctx.xa, ctx.homeOvr, ctx.awayOvr) };
}

/** Placar mais provável (para o relatório da partida) */
export function mostLikelyScore(xh: number, xa: number): { h: number; a: number; p: number } {
  let best = { h: 0, a: 0, p: 0 };
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const p = poisPmf(i, xh) * poisPmf(j, xa);
      if (p > best.p) best = { h: i, a: j, p };
    }
  }
  return best;
}

/** Probabilidade de um placar exato no tempo normal */
export const scoreProb = (xh: number, xa: number, h: number, a: number): number => poisPmf(h, xh) * poisPmf(a, xa);

/** Pontos esperados (3/1/0) no tempo normal */
export function expectedPoints(xh: number, xa: number): { home: number; away: number } {
  const o = outcomeProbs(xh, xa);
  return { home: 3 * o.ph + o.pd, away: 3 * o.pa + o.pd };
}
