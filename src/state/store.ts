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

/** Campos opcionais (previsão, recordes) malformados são descartados em vez de invalidar o torneio */
function sanitize(s: Tournament): Tournament {
  const o = s as unknown as Record<string, unknown>;
  if (o.mc !== undefined && !(isObj(o.mc) && Array.isArray((o.mc as Record<string, unknown>).cols) && isObj((o.mc as Record<string, unknown>).p))) delete o.mc;
  if (o.mcLog !== undefined && !Array.isArray(o.mcLog)) delete o.mcLog;
  if (o.diffUsed !== undefined && !Array.isArray(o.diffUsed)) delete o.diffUsed;
  if (o.skill !== undefined && !isObj(o.skill)) delete o.skill;
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
