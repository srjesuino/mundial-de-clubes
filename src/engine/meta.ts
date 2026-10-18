// Índice de Superação, colocação final, zebras, resumo para compartilhar e entrada da Galeria de Campeões.
// Tudo é derivado do estado do torneio e das probabilidades do próprio motor (posturas neutras).
import { baseOdds, isDecided, team, winnerId } from './core';
import { describeConfig, qualifiedCount } from './config';
import { sortGroupIds } from './groups';
import { DIFF, easiestDiff } from './live';
import { hasPens, sideOdds } from './model';
import { lastDecisiveMatch, playedMatches, roundTitle } from './tournament';
import type { Difficulty, PlayableMatch, Skill, Stats, Tournament } from './types';

const sideOf = (m: PlayableMatch, id: string): 'home' | 'away' => (m.home === id ? 'home' : 'away');

/** Chance (antes do jogo, posturas neutras) do resultado que o clube conseguiu; null = não pontua */
export function achievedChance(t: Tournament, m: PlayableMatch, id: string): number | null {
  if (!m.res || (m.home !== id && m.away !== id)) return null;
  const o = sideOdds(baseOdds(t, m), sideOf(m, id));
  if (m.kind === 'group') {
    const mine = m.home === id ? m.res.gH : m.res.gA, theirs = m.home === id ? m.res.gA : m.res.gH;
    if (mine > theirs) return o.win;
    if (mine === theirs) return o.win + o.draw;
    return null;
  }
  return isDecided(m) && winnerId(m) === id ? o.adv ?? null : null;
}

/** Pontos de Superação de um jogo: 100 × log2(1/p), onde p é a chance de ir tão bem quanto foi */
export function superPoints(t: Tournament, m: PlayableMatch, id: string): number {
  const p = achievedChance(t, m, id);
  return p === null || p <= 0 ? 0 : Math.round(100 * Math.log2(1 / p));
}

export const clubMatches = (t: Tournament, id: string): PlayableMatch[] => playedMatches(t).filter(m => m.home === id || m.away === id);

export const superTotal = (t: Tournament, id: string): number => clubMatches(t, id).reduce((s, m) => s + superPoints(t, m, id), 0);

/** "1 em N": a chance de ir tão bem em cada um destes jogos, um a um */
export const superOneIn = (score: number): number => Math.max(1, Math.round(2 ** (score / 100)));

export interface Placement { rank: number; label: string }

/** Colocação comparável entre torneios (maior = melhor), funciona em saves antigos */
export function placementOf(t: Tournament, id: string): Placement {
  if (t.champion === id) return { rank: 1000, label: 'Campeão' };
  if (t.runnerUp === id) return { rank: 999, label: 'Vice-campeão' };
  if (t.bracket) {
    const ns = t.bracket.nodes.filter(n => n.played && (n.home === id || n.away === id));
    if (ns.length) {
      const best = ns.reduce((a, b) => (b.round > a.round ? b : a));
      return { rank: 500 + best.round, label: best.label };
    }
  }
  for (let k = t.knockout.length - 1; k >= 0; k--) {
    if (t.knockout[k].matches.some(m => m.home === id || m.away === id)) return { rank: 100 + 10 * k, label: t.knockout[k].label };
  }
  const x = team(t, id);
  if (x.group && t.groups[x.group]) {
    const pos = sortGroupIds(t, x.group).indexOf(id) + 1;
    return { rank: 50 - pos, label: qualifiedCount(t.config) === 1 ? `${pos}º nos pontos corridos` : `${pos}º do Grupo ${x.group}` };
  }
  return { rank: 20 + x.sw, label: `Sistema Suíço (${x.sw}-${x.sl})` };
}

export interface Upset { m: PlayableMatch; p: number }

/** Zebras: vencedor que tinha menos de 35% de chance pelo motor (posturas neutras), da maior para a menor */
export function upsets(t: Tournament, limit = 0.35): Upset[] {
  return playedMatches(t)
    .filter(isDecided)
    .map(m => {
      const w = winnerId(m);
      const o = sideOdds(baseOdds(t, m), sideOf(m, w));
      return { m, p: m.kind === 'group' ? o.win : o.adv ?? o.win };
    })
    .filter(u => u.p < limit)
    .sort((a, b) => a.p - b.p);
}

export const biggestUpset = (t: Tournament): Upset | null => upsets(t)[0] ?? null;

export const pctBR = (p: number, digits = 0): string => (p * 100).toFixed(digits).replace('.', ',') + '%';

/** Placar curto: "Flamengo 2 x 1 Benfica (prorr., pên. 4-3)" */
export function scoreLine(t: Tournament, m: PlayableMatch): string {
  const r = m.res!;
  const extra = hasPens(r) ? ` (${r.et ? 'prorr., ' : ''}pên. ${r.penH}-${r.penA})` : r.et ? ' (prorr.)' : '';
  return `${team(t, m.home).name} ${r.gH} x ${r.gA} ${team(t, m.away).name}${extra}`;
}

/** Dificuldade a registrar: a mais fácil usada nos jogos ao vivo (senão a configurada) */
export const recordDiff = (t: Tournament): Difficulty => easiestDiff(t.diffUsed, t.config.difficulty ?? 'normal');

function resultSquare(m: PlayableMatch, id: string): string {
  const r = m.res!;
  const mine = m.home === id ? r.gH : r.gA, theirs = m.home === id ? r.gA : r.gH;
  // pênaltis contam como empate, como na campanha
  return mine > theirs ? '🟩' : mine < theirs ? '🟥' : '🟨';
}

/** Resumo de texto (≈700 caracteres) só com fatos do estado + aviso de que é simulação */
export function buildShareText(t: Tournament): string {
  const lines: string[] = [];
  const done = t.phase === 'END';
  lines.push('🏆 Mundial de Clubes 64 (simulação)' + (done ? '' : ' · em andamento · ' + roundTitle(t)));
  if (done && t.champion) {
    const C = team(t, t.champion);
    lines.push(`Campeão: ${C.name} (OVR ${C.ovr})${t.runnerUp ? ' · Vice: ' + team(t, t.runnerUp).name : ''}`);
  }
  const fmt = describeConfig(t.config);
  lines.push(`Formato: ${fmt.ok ? fmt.text : '—'} · minigames: ${DIFF[recordDiff(t)].label}`);
  const f = done ? lastDecisiveMatch(t) : null;
  if (f && f.res) lines.push(`Final: ${scoreLine(t, f)}`);
  t.userIds.slice(0, 8).forEach(id => {
    const x = team(t, id);
    const status = t.champion === id ? 'Campeão 🏆' : x.out ?? 'segue vivo: ' + placementOf(t, id).label;
    const squares = clubMatches(t, id).map(m => resultSquare(m, id)).join('');
    lines.push(`• ${x.name} — ${status}${squares ? ' ' + squares : ''} · Superação ${superTotal(t, id)}`);
  });
  const u = biggestUpset(t);
  if (u) lines.push(`Maior zebra: ${scoreLine(t, u.m)} (o motor dava ${pctBR(u.p)})`);
  lines.push('Resultados gerados pelo simulador; não são jogos reais.');
  let txt = lines.join('\n');
  // limite de tamanho: corta linhas de clubes do fim antes do aviso
  while (txt.length > 900 && lines.length > 4) {
    lines.splice(lines.length - 2, 1);
    txt = lines.join('\n');
  }
  return txt;
}

// ---------- Galeria de Campeões ----------

export interface ClubSnap { id: string; name: string; country: string; ovr: number }
export interface HofUser extends ClubSnap, Placement { st: Stats; sup: number; live: number }
export interface HofEntry {
  id: string;
  at: number;
  fmt: string;
  diff: Difficulty;
  n: number;
  champ: ClubSnap;
  vice: ClubSnap | null;
  note: string | null;
  final: { stage: string; score: string } | null;
  users: HofUser[];
  skill?: Skill;
  share: string;
}
export interface Hof { v: 1; list: HofEntry[]; titles: Record<string, { name: string; t: number; f: number }> }

export const emptyHof = (): Hof => ({ v: 1, list: [], titles: {} });

const snap = (t: Tournament, id: string): ClubSnap => {
  const x = team(t, id);
  return { id: x.id, name: x.name, country: x.country, ovr: x.ovr };
};

export function hofEntry(t: Tournament, now = Date.now()): HofEntry {
  const f = qualifiedCount(t.config) === 1 && t.config.initialPhase === 'groups' ? null : lastDecisiveMatch(t);
  const fmt = describeConfig(t.config);
  return {
    id: 'H' + now.toString(36),
    at: now,
    fmt: fmt.ok ? fmt.text : '',
    diff: recordDiff(t),
    n: Object.keys(t.teams).length,
    champ: snap(t, t.champion!),
    vice: t.runnerUp ? snap(t, t.runnerUp) : null,
    note: t.championNote,
    final: f && f.res ? { stage: f.stage, score: scoreLine(t, f) } : null,
    users: t.userIds.map(id => ({
      ...snap(t, id), ...placementOf(t, id), st: { ...team(t, id).st }, sup: superTotal(t, id),
      live: clubMatches(t, id).filter(m => m.res?.live).length
    })),
    skill: t.skill ? JSON.parse(JSON.stringify(t.skill)) : undefined,
    share: buildShareText(t)
  };
}

/** Acrescenta a entrada (as 200 mais recentes) e atualiza o placar de títulos, que sobrevive à poda */
export function addHofEntry(h: Hof, e: HofEntry): Hof {
  h.list.push(e);
  if (h.list.length > 200) h.list.splice(0, h.list.length - 200);
  const bump = (c: ClubSnap, title: boolean) => {
    const r = (h.titles[c.id] ??= { name: c.name, t: 0, f: 0 });
    r.name = c.name;
    r.f++;
    if (title) r.t++;
  };
  bump(e.champ, true);
  if (e.vice) bump(e.vice, false);
  return h;
}

export function validHof(x: unknown): x is Hof {
  if (!x || typeof x !== 'object') return false;
  const h = x as Record<string, unknown>;
  return h.v === 1 && Array.isArray(h.list) && !!h.titles && typeof h.titles === 'object'
    && h.list.every(e => !!e && typeof e === 'object' && typeof (e as HofEntry).id === 'string' && !!(e as HofEntry).champ && Array.isArray((e as HofEntry).users));
}

// ---------- Aproveitamento nos minigames ----------

export const emptySkill = (): Skill => ({ att: { n: 0, g: 0 }, def: { n: 0, g: 0 }, penS: { n: 0, g: 0, e: 0 }, penD: { n: 0, g: 0, e: 0 } });

/** Conta um lance decidido num minigame (nunca lances simulados, pulados ou interrompidos) */
export function bumpSkill(t: Tournament, kind: keyof Skill, goal: boolean, expected = 0): void {
  const s = (t.skill ??= emptySkill());
  const c = s[kind] as { n: number; g: number; e?: number };
  c.n++;
  if (goal) c.g++;
  if (kind === 'penS' || kind === 'penD') c.e = Math.round(((c.e ?? 0) + expected) * 1000) / 1000;
}
