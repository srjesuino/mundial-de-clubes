import { PHASE_LABEL, isDecided, isUser, team, winnerId } from '../engine/core';
import { hasPens } from '../engine/model';
import type { DENode, Match } from '../engine/types';
import { T } from '../state/store';
import { logoImg } from './crest';
import { $, escapeHtml, showEl } from './dom';
import { neutralOrder } from './render';

function bracketMatchNode(m: Match | DENode): HTMLElement {
  const t = T();
  const box = document.createElement(m.played ? 'button' : 'div');
  if (m.played) box.dataset.report = m.id;
  const user = isUser(t, m.home) || isUser(t, m.away);
  box.className = `bracket-match shadow-lg text-left w-full ${user ? 'is-user' : ''} ${m.played ? 'hover:border-slate-500 transition' : ''}`;
  const H = m.home ? team(t, m.home) : null, A = m.away ? team(t, m.away) : null;
  const w = isDecided(m) ? winnerId(m) : null;
  const cls = (id: string | null) => (!m.played ? 'text-white' : w === id ? 'winner' : 'loser');
  const sc = (side: 'h' | 'a') => {
    if (!m.played || !m.res) return '-';
    const g = side === 'h' ? m.res.gH : m.res.gA;
    const p = hasPens(m.res) ? ` <span class="text-[10px] text-amber-300">(${side === 'h' ? m.res.penH : m.res.penA})</span>` : '';
    return `${g}${p}`;
  };
  const name = (x: typeof H, fallback: string) => (x ? escapeHtml(x.name) : fallback);
  box.innerHTML = `
    <div class="bracket-team ${cls(m.home)}"><div class="flex items-center gap-2 min-w-0">${logoImg(H, 'w-4 h-4 shrink-0')} <span class="truncate w-28">${name(H, 'A definir')}</span></div> <span class="tabular-nums">${sc('h')}</span></div>
    <div class="bracket-team ${cls(m.away)}"><div class="flex items-center gap-2 min-w-0">${logoImg(A, 'w-4 h-4 shrink-0')} <span class="truncate w-28">${name(A, 'A definir')}</span></div> <span class="tabular-nums">${sc('a')}</span></div>
    ${m.played && m.res?.et && !hasPens(m.res) ? '<div class="text-[10px] text-amber-300 text-center pb-1">prorrogação</div>' : ''}`;
  return box;
}

function bracketColumn(title: string, matches: (Match | DENode)[], note = ''): HTMLElement {
  const col = document.createElement('div');
  col.className = 'flex flex-col min-w-[230px] border-r border-slate-700/50 pr-6 last:border-0';
  col.innerHTML = `<div class="text-center font-bold text-slate-500 mb-4 tracking-widest text-xs uppercase">${title}</div>`;
  const inner = document.createElement('div');
  inner.className = 'flex-1 flex flex-col justify-around gap-2';
  matches.forEach(m => inner.appendChild(bracketMatchNode(m)));
  if (note) inner.insertAdjacentHTML('beforeend', `<p class="text-[11px] text-slate-500 text-center">${note}</p>`);
  col.appendChild(inner);
  return col;
}

export function renderBracket(): void {
  const t = T();
  const container = $('bracket-container');
  container.innerHTML = '';
  if (t.bracket) {
    const wrapper = document.createElement('div');
    wrapper.className = 'flex flex-col gap-8';
    ([
      { b: 'upper', title: 'Upper Bracket', cls: 'text-emerald-400 border-emerald-900/50' },
      { b: 'lower', title: 'Lower Bracket', cls: 'text-red-400 border-red-900/50' },
      { b: 'final', title: 'Grande Final', cls: 'text-yellow-400 border-yellow-900/50' }
    ] as const).forEach(sec => {
      const block = document.createElement('div');
      block.innerHTML = `<h3 class="text-xl font-bold ${sec.cls} mb-4 border-b pb-2">${sec.title}</h3>`;
      const row = document.createElement('div');
      row.className = 'flex gap-6 pb-4';
      const nodes = t.bracket!.nodes.filter(n => n.bracket === sec.b);
      [...new Set(nodes.map(n => n.label))].forEach(label => {
        const ms = nodes.filter(n => n.label === label);
        const note = ms[0].isGF2 && !ms[0].home ? (t.phase === 'END' ? 'Não foi necessária' : 'Só acontece se o campeão da Lower vencer a 1ª final') : '';
        row.appendChild(bracketColumn(label, ms, note));
      });
      block.appendChild(row);
      wrapper.appendChild(block);
    });
    container.appendChild(wrapper);
    return;
  }
  t.knockout.forEach(k => container.appendChild(bracketColumn(k.label, k.matches)));
  if (t.draw) {
    const col = document.createElement('div');
    col.className = 'flex flex-col min-w-[230px] gap-2';
    col.innerHTML = `<div class="text-center font-bold text-fuchsia-400 mb-4 tracking-widest text-xs uppercase">${t.draw.phase === 'DE' ? 'Dupla Eliminação' : PHASE_LABEL[t.draw.phase]} · sorteio pendente</div>` +
      neutralOrder(t.draw.pairs.flat()).map(id => `<div class="bracket-match px-3 py-2 flex items-center gap-2 text-sm">${logoImg(team(t, id), 'w-4 h-4')}<span class="truncate">${escapeHtml(team(t, id).name)}</span></div>`).join('');
    container.appendChild(col);
  }
  if (t.phase === 'END' && t.champion) {
    const C = team(t, t.champion);
    const col = document.createElement('div');
    col.className = 'flex flex-col justify-center items-center min-w-[200px] gap-2';
    col.innerHTML = `<div class="text-5xl">🏆</div>${logoImg(C, 'tm-logo')}<div class="font-black text-yellow-400 text-center">${escapeHtml(C.name)}</div>`;
    container.appendChild(col);
  }
  if (!container.children.length) container.innerHTML = '<p class="text-slate-500">O mata-mata ainda não começou.</p>';
}

export function openBracket(): void {
  renderBracket();
  showEl('modal-bracket');
}
