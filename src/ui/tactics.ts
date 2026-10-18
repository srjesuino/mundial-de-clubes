// Postura antes do jogo (no painel) e o aproveitamento medido nos minigames
import { isUser, oddsFor, setTactic } from '../engine/core';
import { CHANCE_CONV } from '../engine/live';
import { TACTIC_ICON, TACTIC_LABEL, sideOdds } from '../engine/model';
import type { PlayableMatch, Tactic } from '../engine/types';
import { T, saveGame } from '../state/store';
import { $, escapeHtml, fmtBR, setHidden } from './dom';
import { renderOdds } from './dashboard';
import { registerDashboardExtra } from './extras';

const TACS: Tactic[] = ['def', 'bal', 'att'];

function renderChips(m: PlayableMatch): void {
  const t = T();
  const wrap = $('next-match-odds');
  let box = document.getElementById('tac-chips');
  const side = m.home === t.activeId ? 'home' : m.away === t.activeId ? 'away' : null;
  if (!side || m.played) { box?.remove(); document.getElementById('tac-hint')?.remove(); return; }
  if (!box) {
    box = document.createElement('div');
    box.id = 'tac-chips';
    box.className = 'grid grid-cols-3 gap-1.5 mb-3';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-label', 'Postura para este jogo');
    wrap.prepend(box);
  }
  const cur = m.tactics?.[side] ?? 'bal';
  box.innerHTML = TACS.map(v => {
    const o = sideOdds(oddsFor(t, m, { ...m.tactics, [side]: v }), side);
    const key = o.adv !== undefined ? `${m.kind === 'ko' ? 'avança' : 'vence'} ${Math.round(o.adv * 100)}%` : `pts esp. ${fmtBR(3 * o.win + o.draw, 2)}`;
    const on = v === cur;
    return `<button type="button" data-tac="${v}" aria-pressed="${on}" class="min-h-[44px] rounded-lg border text-[11px] leading-tight px-1 py-1 transition ${on ? 'bg-emerald-700/70 border-emerald-400 text-white' : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'}">
      <span class="block font-black">${TACTIC_ICON[v]} ${TACTIC_LABEL[v]}</span><span class="block tabular-nums">${key}</span></button>`;
  }).join('');
  box.querySelectorAll<HTMLButtonElement>('button').forEach(b => {
    b.onclick = () => {
      if (!setTactic(T(), m, side, b.dataset.tac as Tactic)) return;
      const hadFocus = document.activeElement === b;
      saveGame();
      renderOdds(m);
      renderChips(m);
      if (hadFocus) document.querySelector<HTMLElement>(`#tac-chips [data-tac="${b.dataset.tac}"]`)?.focus({ preventScroll: true });
      document.dispatchEvent(new CustomEvent('mc64:tactic'));
    };
  });
  let hint = document.getElementById('tac-hint');
  if (!hint) {
    hint = document.createElement('p');
    hint.id = 'tac-hint';
    hint.className = 'text-[10px] text-slate-500 mt-1';
    $('odds-legend').after(hint);
  }
  const other = side === 'home' ? 'away' : 'home';
  const otherNote = isUser(t, m[other])
    ? ` Postura do outro clube seu: ${TACTIC_LABEL[m.tactics?.[other] ?? 'bal']} (troque no seletor de clube).`
    : '';
  hint.textContent = 'Ofensivo: +30% de gols esperados para os DOIS lados; Retranca: −25%. Favorito ganha com jogo aberto, azarão com jogo fechado. Clubes do computador jogam Equilibrado.' + otherNote;
}

const pctOf = (g: number, n: number) => (n ? Math.round((g / n) * 100) + '%' : '—');

/** "Seu aproveitamento ao vivo" contado lance a lance, contra a conversão do simulador */
export function skillHtml(): string {
  const s = T().skill;
  if (!s || s.att.n + s.def.n + s.penS.n + s.penD.n === 0) return '';
  const small = (n: number) => (n < 10 ? ' (amostra pequena)' : '');
  const parts: string[] = [];
  if (s.att.n + s.def.n >= 1) {
    parts.push(`Seu aproveitamento ao vivo: finalizou ${s.att.g}/${s.att.n} (${pctOf(s.att.g, s.att.n)})${small(s.att.n)} · sofreu ${s.def.g}/${s.def.n} (${pctOf(s.def.g, s.def.n)})${small(s.def.n)} · no simulador: ${Math.round(CHANCE_CONV * 100)}% e ${Math.round(CHANCE_CONV * 100)}%`);
  }
  if (s.penS.n + s.penD.n >= 1) {
    const pen: string[] = [];
    if (s.penS.n) pen.push(`converteu ${s.penS.g}/${s.penS.n} (o motor esperava ${fmtBR(s.penS.e, 1)})${small(s.penS.n)}`);
    if (s.penD.n) pen.push(`no gol, não entraram ${s.penD.n - s.penD.g}/${s.penD.n} (o motor esperava ${fmtBR(s.penD.n - s.penD.e, 1)})${small(s.penD.n)}`);
    parts.push('Pênaltis: ' + pen.join(' · '));
  }
  return parts.map(p => `<p>${escapeHtml(p)}</p>`).join('');
}

export function initTactics(): void {
  registerDashboardExtra(m => {
    if (m) renderChips(m);
    else { document.getElementById('tac-chips')?.remove(); document.getElementById('tac-hint')?.remove(); }
    const sk = skillHtml();
    const el = $('next-skill');
    el.innerHTML = sk;
    setHidden(el, !sk || !m);
  });
}

