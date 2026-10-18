// Conquistas: desbloqueio (uma vez só, guardado fora do torneio) e a faixa de aviso nas telas de resultado
import { ACH, endAchievements, matchAchievements } from '../engine/achievements';
import type { PlayableMatch, Tournament } from '../engine/types';
import { unlockAch } from '../state/meta';
import { escapeHtml } from './dom';

const pending: { k: string; detail: string }[] = [];

/** Desbloqueia e guarda para avisar; devolve true se era nova */
export function grantAch(k: string, detail: string): boolean {
  const isNew = unlockAch(k, detail);
  if (isNew) pending.push({ k, detail });
  return isNew;
}

export const achDef = (k: string) => ACH.find(a => a.k === k);

/** Confere os jogos do usuário ainda não verificados (simulados, ao vivo ou interrompidos) */
export function checkMatches(t: Tournament, ms: PlayableMatch[]): void {
  ms.forEach(m => {
    if (!m.played || m.achk || !(t.userIds.includes(m.home) || t.userIds.includes(m.away))) return;
    matchAchievements(t, m).forEach(u => grantAch(u.k, u.detail));
    m.achk = 1;
  });
}

export function checkEnd(t: Tournament): void {
  endAchievements(t).forEach(u => grantAch(u.k, u.detail));
}

/** Faixa "Conquista desbloqueada" (esvazia a fila) */
export function takeAchStrip(): string {
  if (!pending.length) return '';
  const items = pending.splice(0).map(p => {
    const d = achDef(p.k);
    return `<div class="flex items-start gap-2"><span class="text-xl leading-none">${d?.icon ?? '🏅'}</span><div class="min-w-0"><p class="font-black text-amber-200 text-sm">Conquista desbloqueada: ${escapeHtml(d?.t ?? p.k)}</p><p class="text-[11px] text-amber-100/70">${escapeHtml(p.detail)}</p></div></div>`;
  }).join('');
  return `<div class="bg-amber-900/30 border border-amber-500/40 rounded-xl p-3 flex flex-col gap-2 text-left">${items}</div>`;
}
