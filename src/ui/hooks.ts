// Pequeno barramento de eventos entre as telas (evita importações circulares entre módulos de interface)
type Ev = 'advance' | 'liveStart' | 'liveEnd' | 'dashboard' | 'roundResults' | 'drawFinalized' | 'newTournament';
const subs: Partial<Record<Ev, (() => void)[]>> = {};
export const on = (ev: Ev, fn: () => void): void => { (subs[ev] ??= []).push(fn); };
export const emit = (ev: Ev): void => { subs[ev]?.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); };

/** Compatibilidade com o código existente */
export const onAfterAdvance = (fn: () => void): void => on('advance', fn);
export const afterAdvance = (): void => emit('advance');
