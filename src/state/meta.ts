// Dados que sobrevivem aos torneios: Galeria de Campeões e conquistas. Nunca são apagados por "Novo Torneio".
import { addHofEntry, emptyHof, normalizeHof, type Hof, type HofEntry } from '../engine/meta';

export const META = { hof: 'mundial64-hof-v1', ach: 'mundial64-ach-v1' } as const;

export interface AchStore { v: 1; got: Record<string, { at: number; detail: string }> }
const emptyAch = (): AchStore => ({ v: 1, got: {} });
function parseAch(x: unknown): AchStore | null {
  if (!x || typeof x !== 'object' || (x as AchStore).v !== 1 || !(x as AchStore).got || typeof (x as AchStore).got !== 'object') return null;
  const got: AchStore['got'] = {};
  Object.entries((x as AchStore).got).forEach(([k, v]) => {
    if (v && typeof v === 'object' && typeof v.at === 'number' && typeof v.detail === 'string') got[k] = { at: v.at, detail: v.detail };
  });
  return { v: 1, got };
}

/**
 * Cada leitura relê o que está salvo (outra aba pode ter gravado) e junta o que esta aba ainda não conseguiu gravar.
 * Com o armazenamento bloqueado, a cópia em memória vale ao menos nesta sessão.
 */
let memHof: Hof | null = null;
let memAch: AchStore | null = null;
const pendingHof: HofEntry[] = [];
const pendingAch: AchStore['got'] = {};
let hofCleared = false;
let warned = false;
let onFail: (() => void) | null = null;
export const onMetaSaveFail = (fn: () => void): void => { onFail = fn; };

/** undefined = armazenamento indisponível; null = vazio ou ilegível */
function read<T>(key: string, parse: (x: unknown) => T | null): T | null | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try { return parse(JSON.parse(raw)); } catch { return null; }
  } catch { return undefined; }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    if (!warned) { warned = true; onFail?.(); }
    return false;
  }
}

export function hof(): Hof {
  const stored = read(META.hof, normalizeHof);
  if (stored === undefined) return (memHof ??= emptyHof());
  const h = hofCleared || !stored ? emptyHof() : stored;
  pendingHof.forEach(e => { if (!h.list.some(x => x.id === e.id)) addHofEntry(h, e); });
  return (memHof = h);
}

export function achStore(): AchStore {
  const stored = read(META.ach, parseAch);
  if (stored === undefined) return (memAch ??= emptyAch());
  const s = stored ?? emptyAch();
  Object.entries(pendingAch).forEach(([k, v]) => { if (!s.got[k]) s.got[k] = v; });
  return (memAch = s);
}

export function recordHof(e: HofEntry): void {
  const h = hof();
  if (h.list.some(x => x.id === e.id)) return;
  addHofEntry(h, e);
  pendingHof.push(e);
  if (write(META.hof, h)) { pendingHof.length = 0; hofCleared = false; }
}

export function clearHof(): void {
  pendingHof.length = 0;
  hofCleared = true;
  memHof = emptyHof();
  if (write(META.hof, memHof)) hofCleared = false;
}

/** Desbloqueia uma conquista (idempotente). Devolve true se ela é nova. */
export function unlockAch(k: string, detail: string): boolean {
  const s = achStore();
  if (s.got[k]) return false;
  s.got[k] = { at: Date.now(), detail };
  pendingAch[k] = s.got[k];
  if (write(META.ach, s)) Object.keys(pendingAch).forEach(x => delete pendingAch[x]);
  return true;
}
