// Peças de interface reutilizadas em várias telas (linhas de jogo, placares, campanha)
import { isDecided, isUserMatch, team, winnerId } from '../engine/core';
import { hasPens } from '../engine/model';
import type { PlayableMatch, Stats, TeamState } from '../engine/types';
import { T } from '../state/store';
import { logoImg } from './crest';
import { escapeHtml } from './dom';

export const scoreText = (m: PlayableMatch): string => (m.played && m.res ? `${m.res.gH} - ${m.res.gA}` : 'x');

export function extraText(m: PlayableMatch): string {
  if (!m.played || !m.res) return '';
  const r = m.res;
  if (hasPens(r)) return `${r.et ? 'prorr. · ' : ''}pên. ${r.penH}-${r.penA}`;
  if (r.et) return 'na prorrogação';
  return '';
}

/** Linha compacta de um jogo (clicável para abrir o relatório quando já foi disputado) */
export function miniMatchRow(m: PlayableMatch): string {
  const t = T();
  const H = team(t, m.home), A = team(t, m.away);
  const user = isUserMatch(t, m);
  const w = isDecided(m) ? winnerId(m) : null;
  const ex = extraText(m);
  const tag = m.played ? 'button' : 'div';
  return `<${tag} ${m.played ? `data-report="${m.id}" aria-label="Relatório: ${escapeHtml(H.name)} x ${escapeHtml(A.name)}"` : ''} class="w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-left ${user ? 'bg-emerald-900/25 border border-emerald-500/40' : 'bg-slate-900/50 border border-slate-700/50'} ${m.played ? 'hover:border-slate-500 transition' : ''}">
      <div class="flex items-center gap-2 justify-end flex-1 min-w-0"><span class="truncate ${w === m.home ? 'text-emerald-400 font-bold' : 'text-slate-200'}">${escapeHtml(H.name)}</span>${logoImg(H, 'w-5 h-5 object-contain shrink-0')}</div>
      <div class="text-center shrink-0 px-1 min-w-[3.5rem]"><div class="font-black text-white tabular-nums">${scoreText(m)}</div>${ex ? `<div class="text-[10px] text-amber-300 whitespace-nowrap">${ex}</div>` : ''}</div>
      <div class="flex items-center gap-2 flex-1 min-w-0">${logoImg(A, 'w-5 h-5 object-contain shrink-0')}<span class="truncate ${w === m.away ? 'text-emerald-400 font-bold' : 'text-slate-200'}">${escapeHtml(A.name)}</span></div>
    </${tag}>`;
}

/** Cartão grande de resultado (modal de resultados e histórico) */
export function resultCard(m: PlayableMatch, showStage: boolean): string {
  const t = T();
  const H = team(t, m.home), A = team(t, m.away);
  const hSc = m.played && m.res ? m.res.gH : '-';
  const aSc = m.played && m.res ? m.res.gA : '-';
  const w = isDecided(m) ? winnerId(m) : null;
  const hw = w === m.home ? 'text-emerald-400 font-bold' : 'text-slate-300';
  const aw = w === m.away ? 'text-emerald-400 font-bold' : 'text-slate-300';
  const ex = extraText(m);
  return `
    <button ${m.played ? `data-report="${m.id}"` : 'disabled'} class="match-result-card w-full text-left rounded-xl p-3 md:p-4 ${isUserMatch(t, m) ? 'border-emerald-500/50 bg-emerald-900/20' : ''} ${m.played ? 'hover:border-slate-500 transition' : ''}">
      ${showStage ? `<div class="text-[10px] uppercase tracking-widest text-slate-500 font-bold text-center mb-2">${escapeHtml(m.stage)}</div>` : ''}
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 md:gap-3 flex-1 justify-end text-right min-w-0">
          <span class="${hw} text-xs md:text-sm truncate">${escapeHtml(H.name)}</span>
          ${logoImg(H, 'w-6 h-6 md:w-8 md:h-8 object-contain shrink-0')}
        </div>
        <div class="shrink-0 px-1 md:px-2 text-center flex flex-col items-center">
          <div class="flex justify-center items-center gap-1 md:gap-2">
            <span class="text-white font-black text-base md:text-2xl bg-slate-800 px-1.5 md:px-3 py-1 rounded tabular-nums">${hSc}</span>
            <span class="text-slate-600">-</span>
            <span class="text-white font-black text-base md:text-2xl bg-slate-800 px-1.5 md:px-3 py-1 rounded tabular-nums">${aSc}</span>
          </div>
          ${ex ? `<span class="text-[10px] md:text-xs text-amber-300 font-bold mt-1 whitespace-nowrap">${ex}</span>` : ''}
        </div>
        <div class="flex items-center gap-2 md:gap-3 flex-1 justify-start text-left min-w-0">
          ${logoImg(A, 'w-6 h-6 md:w-8 md:h-8 object-contain shrink-0')}
          <span class="${aw} text-xs md:text-sm truncate">${escapeHtml(A.name)}</span>
        </div>
      </div>
    </button>`;
}

export function campaignTiles(s: Stats): string {
  return ([['J', s.j], ['V', s.v], ['E', s.e], ['D', s.d], ['GP', s.gp], ['GC', s.gc]] as const).map(([k, v]) =>
    `<div class="bg-slate-900/70 rounded-lg py-2 border border-slate-700/60"><div class="text-[10px] text-slate-500 font-bold">${k}</div><div class="font-black text-white tabular-nums">${v}</div></div>`).join('');
}

export function formDots(form: TeamState['form']): string {
  const color = { V: 'bg-emerald-600', E: 'bg-slate-500', D: 'bg-red-600' } as const;
  return form.slice(-5).map(f => `<span class="form-dot ${color[f]}">${f}</span>`).join(' ');
}

export const neutralOrder = (ids: string[]): string[] =>
  ids.slice().sort((a, b) => team(T(), b).ovr - team(T(), a).ovr || team(T(), a).name.localeCompare(team(T(), b).name));
