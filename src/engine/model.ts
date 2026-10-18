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
 * Postura tática: muda o RITMO do jogo, igual para os dois lados (uma regra só, sem bônus escondido).
 * Ofensivo: +30% de gols esperados para os DOIS times; Retranca: −25% para os dois.
 * O efeito sai da matemática de Poisson: o favorito ganha com jogo aberto, o azarão com jogo fechado.
 */
export const PACE: Record<Tactic, number> = { def: 0.75, bal: 1, att: 1.3 };
export const TACTIC_LABEL: Record<Tactic, string> = { def: 'Retranca', bal: 'Equilibrado', att: 'Ofensivo' };
export const TACTIC_ICON: Record<Tactic, string> = { def: '🛡️', bal: '⚖️', att: '⚔️' };

export interface XgInput {
  homeOvr: number;
  awayOvr: number;
  homeAdv: number;               // 0 ou HOME_ADV
  tactics?: Partial<Record<Side, Tactic>>;
}

export function computeXG({ homeOvr, awayOvr, homeAdv, tactics }: XgInput): { xh: number; xa: number } {
  const d = homeOvr - awayOvr;
  const pace = PACE[tactics?.home ?? 'bal'] * PACE[tactics?.away ?? 'bal'];
  const xh = BASE_XG * Math.exp(OVR_K * d) * (1 + homeAdv) * pace;
  const xa = BASE_XG * Math.exp(-OVR_K * d) * (1 - homeAdv) * pace;
  return { xh: clamp(xh, 0.15, 5), xa: clamp(xa, 0.15, 5) };
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

/**
 * Sorteia o resultado. Primeiro as contagens (gols, prorrogação, pênaltis), sempre na mesma ordem;
 * só depois, se timeline = true, os minutos dos gols (uniformes no tempo, como na partida ao vivo).
 * Assim a distribuição dos placares é idêntica com ou sem linha do tempo (o Monte Carlo usa false).
 */
export function simulateMatch(ctx: SimContext, timeline = true): MatchResult {
  const gH = poisson(ctx.xh);
  const gA = poisson(ctx.xa);
  const res: MatchResult = { gH, gA, et: false, penH: null, penA: null };
  let eh = 0, ea = 0;
  let P: Shootout | null = null;
  if (needsWinner(ctx.kind) && gH === gA) {
    if (ctx.kind === 'ko') {
      res.et = true;
      eh = poisson(ctx.xh * ET_FRACTION);
      ea = poisson(ctx.xa * ET_FRACTION);
      res.gH += eh;
      res.gA += ea;
    }
    if (res.gH === res.gA) {
      P = simulateShootout(ctx.homeOvr, ctx.awayOvr);
      res.penH = P.h;
      res.penA = P.a;
    }
  }
  if (timeline) {
    const gm: [number, 0 | 1][] = [];
    for (let i = 0; i < gH; i++) gm.push([1 + Math.floor(rand() * 90), 0]);
    for (let i = 0; i < gA; i++) gm.push([1 + Math.floor(rand() * 90), 1]);
    for (let i = 0; i < eh; i++) gm.push([91 + Math.floor(rand() * 30), 0]);
    for (let i = 0; i < ea; i++) gm.push([91 + Math.floor(rand() * 30), 1]);
    res.gm = gm.sort((a, b) => a[0] - b[0]);
    if (P) res.pk = { f: P.first, h: P.kicks.home.map(Number), a: P.kicks.away.map(Number) };
  }
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

/**
 * Chance exata de o mandante vencer uma disputa já em andamento (recursão memorizada sobre o placar).
 * No estado inicial é igual a shootoutWinProb.
 */
export function penWinFrom(P: Pick<Shootout, 'h' | 'a' | 'hk' | 'ak' | 'first'>, homeOvr: number, awayOvr: number): number {
  const p = penKickProb(homeOvr, awayOvr), q = penKickProb(awayOvr, homeOvr);
  const sd = (p * (1 - q)) / (p * (1 - q) + q * (1 - p));
  const memo = new Map<string, number>();
  const rec = (h: number, a: number, hk: number, ak: number): number => {
    const S = { h, a, hk, ak, first: P.first, kicks: { home: [], away: [] }, userCols: [] } as Shootout;
    if (shootoutOver(S)) return h > a ? 1 : 0;
    if (hk >= 5 && ak >= 5 && hk === ak && h === a) return sd;
    const key = `${h},${a},${hk},${ak}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const v = nextKickerIsHome(S)
      ? p * rec(h + 1, a, hk + 1, ak) + (1 - p) * rec(h, a, hk + 1, ak)
      : q * rec(h, a + 1, hk, ak + 1) + (1 - q) * rec(h, a, hk, ak + 1);
    memo.set(key, v);
    return v;
  };
  return rec(P.h, P.a, P.hk, P.ak);
}

export interface LiveClock {
  min: number;
  hSc: number;
  aSc: number;
  period: 'REG' | 'ET' | 'PEN';
  pen?: Pick<Shootout, 'h' | 'a' | 'hk' | 'ak' | 'first'> | null;
}

/**
 * Chance ao vivo se o resto do jogo fosse simulado: é exatamente o que "Pular para o Fim" sorteia
 * (Poisson no tempo que falta; prorrogação e pênaltis com as mesmas regras). Visão do mandante.
 */
export function liveOdds(ctx: SimContext, s: LiveClock): Odds {
  if (s.period === 'PEN' && s.pen) return { ph: 0, pd: 1, pa: 0, advH: penWinFrom(s.pen, ctx.homeOvr, ctx.awayOvr) };
  if (s.period === 'ET') return matchOdds(ctx, { hSc: s.hSc, aSc: s.aSc, remaining: Math.max(0, 120 - s.min) / 30, period: 'ET' });
  return matchOdds(ctx, { hSc: s.hSc, aSc: s.aSc, remaining: Math.max(0, 90 - s.min) / 90, period: 'REG' });
}

/** Chance do lado escolhido: vitória/empate/derrota e, quando o jogo precisa de vencedor, de avançar */
export function sideOdds(o: Odds, side: Side): { win: number; draw: number; loss: number; adv?: number } {
  const home = side === 'home';
  return {
    win: home ? o.ph : o.pa,
    draw: o.pd,
    loss: home ? o.pa : o.ph,
    adv: o.advH === undefined ? undefined : home ? o.advH : 1 - o.advH
  };
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
