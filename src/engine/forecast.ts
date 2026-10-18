// Previsão do torneio por Monte Carlo: o resto do torneio é jogado N vezes com o mesmo motor do botão Simular.
// Nada aqui altera o torneio de verdade: cada simulação roda numa cópia.
import { PHASE_BY_COUNT, PHASE_LABEL, isUser, team, winnerId } from './core';
import { qualifiedCount } from './config';
import { sortGroupIds } from './groups';
import { clamp } from './math';
import { advance, currentRoundMatches, playedMatches, roundComplete, roundTitle, runToEnd } from './tournament';
import type { Forecast, ForecastLogEntry, Match, Tournament } from './types';

type ColKind = 'qual' | 'ko' | 'gf' | 'title' | 'top4' | 'avg';
interface Col { label: string; kind: ColKind; k?: number }

const isLeague = (t: Tournament): boolean => t.config.initialPhase === 'groups' && qualifiedCount(t.config) === 1;

/** Colunas da tabela de previsão para o formato do torneio */
function columns(t: Tournament): Col[] {
  const c = t.config;
  if (isLeague(t)) return [{ label: 'Título', kind: 'title' }, { label: 'Top 4', kind: 'top4' }, { label: 'Posição média', kind: 'avg' }];
  const cols: Col[] = [];
  if (c.initialPhase !== 'knockout') cols.push({ label: c.initialPhase === 'swiss' ? 'Avançar (3V)' : 'Classificar', kind: 'qual' });
  if (c.bracketFormat === 'double') {
    cols.push({ label: 'Grande Final', kind: 'gf' });
  } else {
    let n = qualifiedCount(c) / 2, k = 1;
    while (n >= 2) { cols.push({ label: PHASE_LABEL[PHASE_BY_COUNT[n]], kind: 'ko', k }); n /= 2; k++; }
  }
  cols.push({ label: 'Título', kind: 'title' });
  return cols;
}

export const forecastColumns = (t: Tournament): string[] => columns(t).map(c => c.label);

/** Progresso do torneio (sem a postura): muda a cada jogo disputado, rodada, fase ou sorteio */
export function progressKey(t: Tournament): string {
  return [t.phase, t.round, playedMatches(t).length, t.swissRounds.length, t.knockout.length, t.bracket ? t.bracket.round : 0,
    t.draw ? `${t.draw.revealed}/${t.draw.pairs.length}` : '-'].join('|');
}

/**
 * Chave do histórico da chance de título: só os resultados conhecidos. "Rodada encerrada" e "próxima rodada"
 * têm os mesmos resultados e ficam numa entrada só (a seta ▲▼ compara resultados diferentes, não ruído).
 */
export const resultsKey = (t: Tournament): string => String(playedMatches(t).length);

/** Chave da previsão: progresso + posturas escolhidas para os jogos do usuário ainda não disputados da rodada */
export function forecastKey(t: Tournament): string {
  const tac = currentRoundMatches(t).filter(m => !m.played && m.tactics && (isUser(t, m.home) || isUser(t, m.away)))
    .map(m => `${m.id}:${m.tactics!.home ?? ''}${m.tactics!.away ?? ''}`).join(',');
  return progressKey(t) + '|' + tac;
}

/** Previsão só faz sentido sem sorteio pendente (os confrontos já sorteados vazariam antes da revelação) */
export const canForecast = (t: Tournament): boolean => t.phase !== 'END' && !t.draw;

/** Quantas simulações cabem em ~3 s no aparelho (mínimo 300, máximo 2000) */
export const runCountFor = (msPerRun: number): number => clamp(Math.floor(3000 / Math.max(msPerRun, 0.01)), 300, 2000);

// ---------- Situações já decididas (sem estimativa) ----------

/**
 * Classificação/eliminação matemática na fase de grupos (condições suficientes, nunca erradas):
 * 'in' se no máximo k−1 rivais ainda podem alcançar os pontos do clube; 'out' se k rivais já estão fora de alcance.
 * k = vagas do grupo (ou outra faixa, como o Top 4 dos pontos corridos).
 */
export function clinchStatus(t: Tournament, id: string, k = t.config.advancingPerGroup): 'in' | 'out' | null {
  if (t.phase !== 'GROUP') return null;
  const x = t.teams[id];
  const g = x?.group;
  if (!g || !t.groups[g]) return null;
  if (k >= t.groups[g].length) return 'in'; // a faixa cobre o grupo inteiro
  const ms = t.schedule[g].flat();
  const rem = (j: string) => ms.filter(m => !m.played && (m.home === j || m.away === j)).length;
  const others = t.groups[g].filter(j => j !== id);
  const threats = others.filter(j => team(t, j).p + 3 * rem(j) >= x.p).length;
  if (threats <= k - 1) return 'in';
  const above = others.filter(j => team(t, j).p > x.p + 3 * rem(id)).length;
  if (above >= k) return 'out';
  return null;
}

/** O que já está decidido para cada clube e coluna, lido do estado (avançando a rodada se ela terminou) */
function decided(t: Tournament, cols: Col[]): Record<string, string> {
  const D: Tournament = JSON.parse(JSON.stringify(t, (k, v) => (k === 'mc' || k === 'mcLog' ? undefined : v)));
  D.live = null;
  if (D.phase !== 'END' && !D.draw && roundComplete(D)) advance(D);
  const ids = Object.keys(D.teams);
  const league = isLeague(t);
  const out = (id: string) => D.teams[id].out !== null && D.champion !== id;
  const inStage = (k: number): Set<string> => {
    const s = new Set<string>();
    D.knockout[k]?.matches.forEach(m => { s.add(m.home); s.add(m.away); });
    if (D.draw && D.draw.phase !== 'DE' && D.knockout.length === k) D.draw.pairs.flat().forEach(id => s.add(id));
    return s;
  };
  const qual = new Set<string>();
  if (D.knockout.length || (D.draw && D.draw.phase !== 'DE')) inStage(0).forEach(id => qual.add(id));
  D.bracket?.nodes.filter(n => n.round === 1).forEach(n => { if (n.home) qual.add(n.home); if (n.away) qual.add(n.away); });
  if (D.draw?.phase === 'DE') D.draw.pairs.flat().forEach(id => qual.add(id));
  ids.forEach(id => { if (D.teams[id].status === 'advanced') qual.add(id); });
  const gf = new Set<string>();
  D.bracket?.nodes.filter(n => n.isGF1).forEach(n => { if (n.home) gf.add(n.home); if (n.away) gf.add(n.away); });
  // Pontos corridos: posição final quando acabou; antes disso, a matemática dos pontos (título e Top 4)
  const leagueOrder = league && D.phase === 'END' ? sortGroupIds(D, Object.keys(D.groups)[0]) : null;
  const leagueMark = (id: string, k: number): string => {
    if (leagueOrder) return leagueOrder.indexOf(id) < k ? '1' : '0';
    const c = clinchStatus(t, id, k);
    return c === 'in' ? '1' : c === 'out' ? '0' : '.';
  };
  const groupClinch = (id: string) => (t.phase === 'GROUP' && !league ? clinchStatus(t, id) : null);
  const mark = (id: string, c: Col): string => {
    if (league) return c.kind === 'title' ? leagueMark(id, 1) : c.kind === 'top4' ? leagueMark(id, 4) : '.';
    const gc = groupClinch(id);
    let reached = false;
    if (c.kind === 'title') reached = D.champion === id;
    else if (c.kind === 'qual') reached = qual.has(id) || gc === 'in';
    else if (c.kind === 'gf') reached = gf.has(id) || D.champion === id;
    else if (c.kind === 'ko') reached = inStage(c.k!).has(id);
    if (reached) return '1';
    if (out(id) || gc === 'out') return '0';
    return '.';
  };
  const known: Record<string, string> = {};
  ids.forEach(id => {
    const row = cols.map(c => mark(id, c)).join('');
    if (/[01]/.test(row)) known[id] = row;
  });
  return known;
}

/** Situações decididas para as colunas do formato (no fim do torneio, todas) */
export const decidedNow = (t: Tournament): Record<string, string> => decided(t, columns(t));

// ---------- Simulações ----------

interface CondRef { id: string; mid: string; g: string | null; round: number; side: 'home' | 'away' }

export interface ForecastJob {
  key: string;
  /** simulações previstas (definidas depois de cronometrar as 10 primeiras) */
  total: number;
  done: number;
  /** roda simulações por até budgetMs; devolve true quando terminou */
  step(budgetMs: number): boolean;
  result(): Forecast;
}

/** Cria o trabalho de previsão. n fixo (testes) ou automático pelo tempo de cada simulação. */
export function forecastJob(t: Tournament, n?: number, now: () => number = () => performance.now()): ForecastJob {
  if (!canForecast(t)) throw new Error('Previsão indisponível com sorteio pendente ou torneio encerrado.');
  const cols = columns(t);
  const ids = Object.keys(t.teams);
  const league = isLeague(t);
  const groups = t.phase === 'GROUP' ? Object.keys(t.groups) : [];
  // Cópia base sem a linha do tempo dos jogos (só pesa e não muda nada no resultado)
  const baseJson = JSON.stringify(t, (k, v) => (['gm', 'pk', 'mc', 'mcLog', 'live'].includes(k) ? undefined : v));
  const cnt: Record<string, number[]> = Object.fromEntries(ids.map(id => [id, cols.map(() => 0)]));
  const pos: Record<string, Record<string, number[]>> = {};
  groups.forEach(g => { pos[g] = Object.fromEntries(t.groups[g].map(id => [id, t.groups[g].map(() => 0)])); });
  const refs: CondRef[] = [];
  if (t.phase === 'GROUP' || t.phase === 'SWISS') {
    currentRoundMatches(t).forEach(m => {
      if (m.played) return;
      (['home', 'away'] as const).forEach(side => {
        const id = m[side];
        if (isUser(t, id)) refs.push({ id, mid: m.id, g: t.phase === 'GROUP' ? team(t, id).group : null, round: t.round, side });
      });
    });
  }
  const cond: Forecast['cond'] = {};
  refs.forEach(r => { cond[r.id] = t.phase === 'SWISS' ? { V: [0, 0], D: [0, 0] } : { V: [0, 0], E: [0, 0], D: [0, 0] }; });

  const qualifiedIn = (F: Tournament): Set<string> => {
    const s = new Set<string>();
    F.knockout[0]?.matches.forEach(m => { s.add(m.home); s.add(m.away); });
    F.bracket?.nodes.filter(x => x.round === 1).forEach(x => { if (x.home) s.add(x.home); if (x.away) s.add(x.away); });
    return s;
  };

  const tally = (F: Tournament): void => {
    const qual = qualifiedIn(F);
    const leagueOrder = league ? sortGroupIds(F, Object.keys(F.groups)[0]) : null;
    const gf = new Set<string>();
    F.bracket?.nodes.filter(x => x.isGF1).forEach(x => { if (x.home) gf.add(x.home); if (x.away) gf.add(x.away); });
    cols.forEach((c, ci) => {
      if (c.kind === 'title') { if (F.champion) cnt[F.champion][ci]++; return; }
      if (c.kind === 'qual') { qual.forEach(id => { cnt[id][ci]++; }); return; }
      if (c.kind === 'gf') { gf.forEach(id => { cnt[id][ci]++; }); return; }
      if (c.kind === 'ko') { F.knockout[c.k!]?.matches.forEach(m => { cnt[m.home][ci]++; cnt[m.away][ci]++; }); return; }
      if (c.kind === 'top4') { leagueOrder!.slice(0, 4).forEach(id => { cnt[id][ci]++; }); return; }
      if (c.kind === 'avg') leagueOrder!.forEach((id, i) => { cnt[id][ci] += i + 1; });
    });
    groups.forEach(g => sortGroupIds(F, g).forEach((id, i) => { pos[g][id][i]++; }));
    refs.forEach(r => {
      const list: Match[] | undefined = r.g ? F.schedule[r.g]?.[r.round] : F.swissRounds[r.round];
      const m = list?.find(x => x.id === r.mid);
      if (!m || !m.res) return;
      const mine = r.side === 'home' ? m.res.gH : m.res.gA, theirs = r.side === 'home' ? m.res.gA : m.res.gH;
      const cls = m.kind === 'group' ? (mine > theirs ? 'V' : mine < theirs ? 'D' : 'E') : winnerId(m) === r.id ? 'V' : 'D';
      const ok = league ? F.champion === r.id : qual.has(r.id);
      const cell = cond[r.id][cls]!;
      cell[0]++;
      if (ok) cell[1]++;
    });
  };

  const runOne = () => {
    const F: Tournament = JSON.parse(baseJson);
    F.live = null;
    runToEnd(F, false);
    tally(F);
  };

  let timed = 0;
  let timedMs = 0;
  const job: ForecastJob = {
    key: forecastKey(t),
    total: n ?? 2000,
    done: 0,
    step(budgetMs: number): boolean {
      const t0 = now();
      while (job.done < job.total && now() - t0 < budgetMs) {
        const s = now();
        runOne();
        job.done++;
        if (n === undefined && timed < 10) {
          timedMs += now() - s;
          timed++;
          if (timed === 10) job.total = Math.max(job.done, runCountFor(timedMs / 10));
        }
      }
      return job.done >= job.total;
    },
    result(): Forecast {
      const N = Math.max(1, job.done);
      const p: Forecast['p'] = {};
      ids.forEach(id => { p[id] = cnt[id].map(v => Math.round((v / N) * 1e4) / 1e4); });
      const posOut: Forecast['pos'] = {};
      groups.forEach(g => {
        posOut[g] = {};
        Object.keys(pos[g]).forEach(id => { posOut[g][id] = pos[g][id].map(v => Math.round((v / N) * 1e4) / 1e4); });
      });
      return { key: job.key, n: job.done, label: roundTitle(t), cols: cols.map(c => c.label), p, cond, pos: posOut, known: decided(t, cols) };
    }
  };
  return job;
}

/** Versão síncrona (testes e scripts): n simulações */
export function runForecast(t: Tournament, n: number): Forecast {
  const job = forecastJob(t, n);
  job.step(Infinity);
  return job.result();
}

/** Guarda a previsão e a chance de título dos clubes do usuário (uma entrada por estágio do torneio) */
export function storeForecast(t: Tournament, f: Forecast): void {
  t.mc = f;
  const ti = f.cols.indexOf('Título');
  const entry: ForecastLogEntry = {
    k: resultsKey(t),
    label: f.label,
    n: f.n,
    t: Object.fromEntries(t.userIds.map(id => [id, ti >= 0 ? (f.p[id]?.[ti] ?? 0) : 0]))
  };
  const log = (t.mcLog ??= []);
  if (log.length && log[log.length - 1].k === entry.k) log[log.length - 1] = entry;
  else log.push(entry);
  if (log.length > 64) log.splice(0, log.length - 64);
}

/** Como mostrar uma probabilidade da tabela: decidido (✓/—), estimado com 1 casa, ou os limites '<0,1%'/'>99,9%' */
export function formatChance(f: Forecast, id: string, col: number): { text: string; sure: boolean; p: number } {
  const p = f.p[id]?.[col] ?? 0;
  const k = f.known?.[id]?.[col];
  if (k === '1') return { text: '✓', sure: true, p: 1 };
  if (k === '0') return { text: '—', sure: true, p: 0 };
  const v = Math.round(p * 1000) / 10;
  if (p <= 0 || v <= 0) return { text: '<0,1%', sure: false, p };
  if (p >= 1 || v >= 100) return { text: '>99,9%', sure: false, p };
  return { text: v.toFixed(1).replace('.', ',') + '%', sure: false, p };
}

/** Margem de erro (95%) de uma probabilidade estimada com N simulações, em pontos percentuais */
export const marginPP = (p: number, n: number): number => 196 * Math.sqrt((p * (1 - p)) / Math.max(1, n));
