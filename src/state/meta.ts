// Dados que sobrevivem aos torneios: Galeria de Campeões e conquistas. Nunca são apagados por "Novo Torneio".
import { addHofEntry, emptyHof, validHof, type Hof, type HofEntry } from '../engine/meta';

export const META = { hof: 'mundial64-hof-v1', ach: 'mundial64-ach-v1' } as const;

export interface AchStore { v: 1; got: Record<string, { at: number; detail: string }> }
const emptyAch = (): AchStore => ({ v: 1, got: {} });
const validAch = (x: unknown): x is AchStore =>
  !!x && typeof x === 'object' && (x as AchStore).v === 1 && !!(x as AchStore).got && typeof (x as AchStore).got === 'object';

/** Cópia em memória: com o armazenamento bloqueado, a galeria vale ao menos nesta sessão */
const mem: Partial<Record<string, unknown>> = {};
let warned = false;
let onFail: (() => void) | null = null;
export const onMetaSaveFail = (fn: () => void): void => { onFail = fn; };

function metaLoad<T>(key: string, valid: (x: unknown) => x is T, make: () => T): T {
  if (mem[key]) return mem[key] as T;
  let v: T = make();
  try {
    const raw = localStorage.getItem(key);
    if (raw) { const x: unknown = JSON.parse(raw); if (valid(x)) v = x; }
  } catch { /* armazenamento indisponível ou corrompido */ }
  mem[key] = v;
  return v;
}

function metaSave(key: string): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(mem[key]));
    return true;
  } catch {
    if (!warned) { warned = true; onFail?.(); }
    return false;
  }
}

export const hof = (): Hof => metaLoad(META.hof, validHof, emptyHof);
export const achStore = (): AchStore => metaLoad(META.ach, validAch, emptyAch);

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
