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
 * Cópia em memória: com o armazenamento bloqueado, a galeria vale ao menos nesta sessão.
 * Enquanto o armazenamento funciona, cada leitura relê o que está salvo (outra aba pode ter gravado).
 */
const mem: Partial<Record<string, unknown>> = {};
const unsaved = new Set<string>();
let warned = false;
let onFail: (() => void) | null = null;
export const onMetaSaveFail = (fn: () => void): void => { onFail = fn; };

function metaLoad<T>(key: string, parse: (x: unknown) => T | null, make: () => T): T {
  if (unsaved.has(key) && mem[key]) return mem[key] as T; // a última gravação falhou: a memória é a versão mais nova
  let v: T | null = null;
  try {
    const raw = localStorage.getItem(key);
    v = raw ? parse(JSON.parse(raw)) : make();
  } catch { v = null; }
  if (v === null) v = (mem[key] as T | undefined) ?? make();
  mem[key] = v;
  return v;
}

function metaSave(key: string): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(mem[key]));
    unsaved.delete(key);
    return true;
  } catch {
    unsaved.add(key);
    if (!warned) { warned = true; onFail?.(); }
    return false;
  }
}

export const hof = (): Hof => metaLoad(META.hof, normalizeHof, emptyHof);
export const achStore = (): AchStore => metaLoad(META.ach, parseAch, emptyAch);

export function recordHof(e: HofEntry): void {
  addHofEntry(hof(), e);
  metaSave(META.hof);
}

export function clearHof(): void {
  mem[META.hof] = emptyHof();
  metaSave(META.hof);
}

/** Desbloqueia uma conquista (idempotente). Devolve true se ela é nova. */
export function unlockAch(k: string, detail: string): boolean {
  const s = achStore();
  if (s.got[k]) return false;
  s.got[k] = { at: Date.now(), detail };
  metaSave(META.ach);
  return true;
}
