// Estado da aplicação + salvamento local (por navegador)
import { PHASE_LABEL } from '../engine/core';
import type { Config, Tournament } from '../engine/types';

export const SAVE_KEY = 'mundial64-save-v3';

export const store: {
  t: Tournament | null;
  cfg: Config | null;
  selectedIds: string[];
} = { t: null, cfg: null, selectedIds: [] };

/** Atalho para o torneio em andamento (só chamar quando há um) */
export function T(): Tournament {
  if (!store.t) throw new Error('Nenhum torneio em andamento');
  return store.t;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

export function validSave(s: unknown): s is Tournament {
  if (!isObj(s) || s.v !== 3) return false;
  const c = s.config;
  if (!isObj(c) || !['groups', 'swiss', 'knockout'].includes(c.initialPhase as string)) return false;
  const teams = s.teams, userIds = s.userIds;
  if (!isObj(teams) || !Array.isArray(userIds) || !userIds.length || !userIds.every(id => isObj(teams[id as string]))) return false;
  if (!Object.values(teams).every(x => isObj(x) && isObj(x.st) && typeof x.name === 'string' && Array.isArray(x.form) && Array.isArray(x.opp))) return false;
  const groups = s.groups, schedule = s.schedule;
  if (!isObj(groups) || !isObj(schedule) || !Array.isArray(s.swissRounds) || !Array.isArray(s.knockout)) return false;
  if (!Object.keys(groups).every(g => Array.isArray(groups[g]) && Array.isArray(schedule[g]))) return false;
  if (!['GROUP', 'SWISS', 'DE', 'END', ...Object.keys(PHASE_LABEL)].includes(s.phase as string)) return false;
  if (!Number.isInteger(s.round) || (s.round as number) < 0 || !Number.isInteger(s.seq)) return false;
  if (s.phase === 'END' && !isObj(teams[s.champion as string])) return false;
  const d = s.draw;
  if (d !== null && !(isObj(d) && Array.isArray(d.pairs) && Number.isInteger(d.revealed))) return false;
  if (s.phase === 'DE' && !d && !(isObj(s.bracket) && Array.isArray(s.bracket.nodes))) return false;
  return true;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isNumArr = (x: unknown): boolean => Array.isArray(x) && x.every(isNum);

/** Previsão guardada válida no formato atual (senão é descartada e recalculada) */
function validForecast(mc: unknown): boolean {
  if (!isObj(mc)) return false;
  const { key, n, label, cols, p, cond, pos, known } = mc;
  if (typeof key !== 'string' || !isNum(n) || typeof label !== 'string') return false;
  if (!Array.isArray(cols) || !cols.every(c => typeof c === 'string')) return false;
  if (!isObj(p) || !Object.values(p).every(r => isNumArr(r) && (r as number[]).length === cols.length)) return false;
  if (!isObj(cond) || !Object.values(cond).every(c => isObj(c) && Object.values(c).every(v => isNumArr(v) && (v as number[]).length === 2))) return false;
  if (!isObj(pos) || !Object.values(pos).every(g => isObj(g) && Object.values(g).every(isNumArr))) return false;
  if (!isObj(known) || !Object.values(known).every(k => typeof k === 'string' && k.length === cols.length)) return false;
  return true;
}

const validLogEntry = (e: unknown): boolean =>
  isObj(e) && typeof e.k === 'string' && typeof e.label === 'string' && isNum(e.n) && isObj(e.t) && Object.values(e.t).every(isNum);

const validSkill = (s: unknown): boolean =>
  isObj(s) && (['att', 'def', 'penS', 'penD'] as const).every(k => isObj(s[k]) && isNum((s[k] as Record<string, unknown>).n) && isNum((s[k] as Record<string, unknown>).g));

const SIDES = ['home', 'away'];
const TACS = ['def', 'bal', 'att'];
const DIFFS = ['facil', 'normal', 'dificil', 'lenda'];
const isPair = (x: unknown): boolean => isNumArr(x) && (x as number[]).length === 2;

function validLiveRecord(lv: unknown): boolean {
  if (!isObj(lv)) return false;
  if (lv.s !== undefined && !SIDES.includes(lv.s as string)) return false;
  if (!DIFFS.includes(lv.d as string) || !isNum(lv.md) || (lv.sk !== 0 && lv.sk !== 1)) return false;
  if (lv.sp !== undefined && lv.sp !== 0 && lv.sp !== 1) return false;
  if (!isPair(lv.ps) || !isPair(lv.pd)) return false;
  return (lv.at === undefined || isPair(lv.at)) && (lv.df === undefined || isPair(lv.df));
}

/**
 * Campos extras de cada jogo (minutos dos gols, pênaltis, registro ao vivo, postura) que não estiverem no formato
 * atual são removidos: o placar continua valendo. Ex.: versões anteriores gravavam "live: true".
 */
function sanitizeMatch(m: unknown): void {
  if (!isObj(m)) return;
  if (m.tactics !== undefined && !(isObj(m.tactics) && Object.entries(m.tactics).every(([k, v]) => SIDES.includes(k) && TACS.includes(v as string)))) delete m.tactics;
  const r = m.res;
  if (!isObj(r)) return;
  if (r.live !== undefined && !validLiveRecord(r.live)) delete r.live;
  if (r.gm !== undefined && !(Array.isArray(r.gm) && r.gm.every(g => isPair(g) && ((g as number[])[1] === 0 || (g as number[])[1] === 1)))) delete r.gm;
  if (r.pk !== undefined && !(isObj(r.pk) && SIDES.includes(r.pk.f as string) && isNumArr(r.pk.h) && isNumArr(r.pk.a))) delete r.pk;
}

/** Campos opcionais (previsão, recordes, extras dos jogos) malformados são descartados em vez de invalidar o torneio */
export function sanitize(s: Tournament): Tournament {
  const o = s as unknown as Record<string, unknown>;
  Object.values(s.schedule).forEach(rs => Array.isArray(rs) && rs.forEach(r => Array.isArray(r) && r.forEach(sanitizeMatch)));
  s.swissRounds.forEach(r => Array.isArray(r) && r.forEach(sanitizeMatch));
  s.knockout.forEach(k => isObj(k) && Array.isArray(k.matches) && k.matches.forEach(sanitizeMatch));
  if (isObj(s.bracket) && Array.isArray(s.bracket.nodes)) s.bracket.nodes.forEach(sanitizeMatch);
  if (o.mc !== undefined && !validForecast(o.mc)) delete o.mc;
  if (o.mcLog !== undefined) {
    if (!Array.isArray(o.mcLog)) delete o.mcLog;
    // entradas de versões antigas (chave que não é o número de jogos disputados) quebrariam a seta ▲▼
    else o.mcLog = o.mcLog.filter(e => validLogEntry(e) && /^\d+$/.test((e as { k: string }).k));
  }
  if (o.diffUsed !== undefined && !(Array.isArray(o.diffUsed) && o.diffUsed.every(d => ['facil', 'normal', 'dificil', 'lenda'].includes(d as string)))) delete o.diffUsed;
  if (o.skill !== undefined && !validSkill(o.skill)) delete o.skill;
  return s;
}

export function saveGame(): void {
  if (!store.t) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(store.t)); } catch { /* armazenamento indisponível */ }
}

/** Lê o save; um save corrompido ou de outra versão é descartado em vez de travar a página */
export function loadGame(): Tournament | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const s: unknown = JSON.parse(raw);
    if (validSave(s)) return sanitize(s);
  } catch { /* JSON inválido */ }
  clearSave();
  return null;
}

export function hasRawSave(): boolean {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}

export function clearSave(): void {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignora */ }
}
