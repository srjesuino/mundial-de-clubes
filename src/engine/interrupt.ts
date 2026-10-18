// Partida ao vivo interrompida (página recarregada): o simulador termina o jogo a partir do placar salvo,
// para que um jogo que estava sendo perdido não possa ser "rejogado".
import { applyResult, isPlayable, simContext, team } from './core';
import { diffOf } from './live';
import { newShootout, needsWinner, penKickProb, recordKick, shootoutOver, simulateShootout } from './model';
import { poisson, rand } from './rng';
import { allMatches } from './tournament';
import type { MatchResult, PlayableMatch, Tournament } from './types';

export function resolveInterruptedLive(t: Tournament): PlayableMatch | null {
  const lv = t.live;
  t.live = null;
  if (!lv) return null;
  const m = allMatches(t).find(x => x.id === lv.id);
  if (!m || m.played || !isPlayable(m)) return null;
  const { xh, xa, homeOvr, awayOvr } = simContext(t, m);
  let gH = Math.max(0, lv.hSc | 0), gA = Math.max(0, lv.aSc | 0), et = !!lv.et, min = lv.min | 0, period = lv.period;
  // lance aberto no momento do recarregamento conta como "não reagiu"
  if (lv.chance && period !== 'PEN') {
    const D = diffOf(t.config.difficulty);
    const goal = rand() < (lv.chance.userAttacks ? D.lateGoal : D.missedGoal);
    if (goal) { if (lv.chance.home) gH++; else gA++; }
  }
  if (period === 'REG') {
    const f = Math.max(0, 90 - min) / 90;
    gH += poisson(xh * f);
    gA += poisson(xa * f);
    if (gH === gA && m.kind === 'ko') { et = true; period = 'ET'; min = 90; }
  }
  if (period === 'ET') {
    const f = Math.max(0, 120 - min) / 90;
    gH += poisson(xh * f);
    gA += poisson(xa * f);
  }
  // sem LiveRecord: partida interrompida não conta para recordes nem conquistas de habilidade
  const res: MatchResult = { gH, gA, et, penH: null, penA: null };
  if (gH === gA && needsWinner(m.kind)) {
    const P = period === 'PEN' && lv.pen && Number.isInteger(lv.pen.hk) ? lv.pen : newShootout();
    if (period === 'PEN' && lv.kick && !shootoutOver(P)) {
      // cobrança que estava aberta: batedor do usuário hesitou; goleiro do usuário ficou parado
      const att = team(t, lv.kick.home ? m.home : m.away), def = team(t, lv.kick.home ? m.away : m.home);
      recordKick(P, lv.kick.home, lv.kick.userAttacks ? false : rand() < penKickProb(att.ovr, def.ovr));
    }
    simulateShootout(homeOvr, awayOvr, P);
    res.penH = P.h;
    res.penA = P.a;
  }
  applyResult(t, m, res);
  return m;
}
