// Preferências do jogador (som, animações, velocidade...). Ficam fora do save do torneio:
// "Novo Torneio" e "Descartar" não mexem nelas.
export const PREFS_KEY = 'mundial64-prefs-v1';

export type MotionPref = 'auto' | 'reduced' | 'full';
export interface Prefs {
  sound: boolean;
  vol: number;
  haptics: boolean;
  motion: MotionPref;
  ticker: boolean;
  speed: 1 | 2 | 4;
  sr: boolean;
}

export const PREF_DEF: Prefs = { sound: true, vol: 0.5, haptics: true, motion: 'auto', ticker: true, speed: 1, sr: true };

/** Lê e valida campo a campo; qualquer coisa estranha volta ao padrão */
export function parsePrefs(raw: unknown): Prefs {
  const p: Prefs = { ...PREF_DEF };
  if (!raw || typeof raw !== 'object') return p;
  const r = raw as Record<string, unknown>;
  (['sound', 'haptics', 'ticker', 'sr'] as const).forEach(k => { if (typeof r[k] === 'boolean') p[k] = r[k] as boolean; });
  if (typeof r.vol === 'number' && Number.isFinite(r.vol) && r.vol >= 0 && r.vol <= 1) p.vol = r.vol;
  if (r.motion === 'auto' || r.motion === 'reduced' || r.motion === 'full') p.motion = r.motion;
  if (r.speed === 1 || r.speed === 2 || r.speed === 4) p.speed = r.speed;
  return p;
}

function loadPrefs(): Prefs {
  try { return parsePrefs(JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null')); } catch { return { ...PREF_DEF }; }
}

/** Objeto vivo: se o armazenamento falhar, as preferências continuam valendo nesta sessão */
export const prefs: Prefs = loadPrefs();

export function savePrefs(): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* armazenamento indisponível */ }
}

const listeners: (() => void)[] = [];
export const onPrefsChange = (fn: () => void): void => { listeners.push(fn); };

export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]): void {
  prefs[k] = v;
  savePrefs();
  listeners.forEach(fn => fn());
}

/** Animações completas? (preferência do jogo; em 'auto', a do sistema) */
export function motionOK(): boolean {
  if (prefs.motion === 'full') return true;
  if (prefs.motion === 'reduced') return false;
  try { return !window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return true; }
}
