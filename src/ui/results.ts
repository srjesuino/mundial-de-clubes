// Modal de resultados da rodada, histórico completo e classificação de todos os grupos
import { isUser, isUserMatch, team } from '../engine/core';
import { superPoints } from '../engine/meta';
import type { PlayableMatch } from '../engine/types';
import { T } from '../state/store';
import { takeAchStrip } from './ach';
import { $, escapeHtml, fmtBR, hideEl, setHidden, shieldClicks, shielded, showEl, toast } from './dom';
import { emit } from './hooks';
import { resultCard } from './render';
import { renderGroupTable } from './dashboard';

let roundAdvanceLock = false;

export function showRoundResults(matches: PlayableMatch[], title: string, onAdvance: { label: string; run: () => void } | null, showFilter = false): void {
  showEl('modal-round-results');
  $('modal-round-results').scrollTop = 0;
  $('rr-list').scrollTop = 0;
  shieldClicks(450);
  $('rr-title').textContent = title;
  $('rr-subtitle').textContent = onAdvance ? 'Todos os jogos desta rodada (os seus aparecem primeiro). Toque num jogo para ver o relatório.' : '';
  setHidden('history-filter', !showFilter);
  const btnAdv = $('btn-advance-round');
  const btnClose = $('btn-close-results');
  if (onAdvance) {
    btnAdv.textContent = onAdvance.label;
    showEl(btnAdv);
    hideEl(btnClose);
    roundAdvanceLock = false;
    btnAdv.onclick = () => {
      if (roundAdvanceLock || shielded()) return;
      roundAdvanceLock = true;
      shieldClicks();
      hideEl('modal-round-results');
      onAdvance.run();
    };
  } else {
    hideEl(btnAdv);
    showEl(btnClose);
    btnClose.onclick = () => hideEl('modal-round-results');
  }
  const t = T();
  const sorted = onAdvance ? [...matches].sort((a, b) => Number(isUserMatch(t, b)) - Number(isUserMatch(t, a))) : matches;
  renderMatchList(sorted, onAdvance ? takeAchStrip() : '');
  // o botão principal da janela recebe o foco (Enter avança; a proteção contra toque duplo continua valendo)
  (onAdvance ? btnAdv : btnClose).focus({ preventScroll: true });
  if (onAdvance) emit('roundResults');
}

/** Selo "+152" de Superação nos jogos dos clubes do usuário */
function superBadge(m: PlayableMatch): string {
  const t = T();
  if (!m.played) return '';
  return (['home', 'away'] as const).filter(s => isUser(t, m[s])).map(s => {
    const pts = superPoints(t, m, m[s]);
    return pts > 0 ? `<span class="text-[10px] font-black text-amber-300 bg-amber-900/30 border border-amber-500/30 rounded px-1.5" title="Superação de ${escapeHtml(team(t, m[s]).name)}">+${fmtBR(pts)}</span>` : '';
  }).join('');
}

export function renderMatchList(matches: PlayableMatch[], top = ''): void {
  $('rr-list').innerHTML = top + (matches.map(m => resultCard(m, true, superBadge(m))).join('') || '<p class="text-center text-slate-500">Nenhuma partida.</p>');
}

function historySections(): { key: string; matches: PlayableMatch[] }[] {
  const t = T();
  const sec: { key: string; matches: PlayableMatch[] }[] = [];
  Object.keys(t.groups).forEach(g => {
    const arr = t.schedule[g].flat().filter(m => m.played);
    if (arr.length) sec.push({ key: `Grupo ${g}`, matches: arr.slice().reverse() });
  });
  t.swissRounds.forEach((r, i) => {
    const arr = r.filter(m => m.played);
    if (arr.length) sec.push({ key: `Suíço · Rodada ${i + 1}`, matches: arr });
  });
  t.knockout.forEach(k => {
    const arr = k.matches.filter(m => m.played);
    if (arr.length) sec.push({ key: k.label, matches: arr });
  });
  if (t.bracket) {
    const rounds = [...new Set(t.bracket.nodes.filter(n => n.played).map(n => n.round))].sort((a, b) => a - b);
    rounds.forEach(r => sec.push({ key: `Dupla Eliminação · Etapa ${r}`, matches: t.bracket!.nodes.filter(n => n.played && n.round === r) as PlayableMatch[] }));
  }
  return sec;
}

export function openHistory(): void {
  const sec = historySections();
  if (!sec.length) { toast('Nenhuma partida concluída ainda!'); return; }
  const t = T();
  const sel = $<HTMLSelectElement>('history-filter');
  sel.innerHTML = sec.map((s, i) => `<option value="${i}">${escapeHtml(s.key)}</option>`).join('');
  let initial = sec.length - 1;
  const g = t.teams[t.activeId]?.group;
  if (t.phase === 'GROUP' && g) {
    const gi = sec.findIndex(s => s.key === `Grupo ${g}`);
    if (gi > -1) initial = gi;
  }
  sel.value = String(initial);
  sel.onchange = () => renderMatchList(sec[parseInt(sel.value, 10)].matches);
  showRoundResults(sec[initial].matches, 'Histórico Completo', null, true);
  $('rr-subtitle').textContent = 'Selecione o grupo ou fase · toque num jogo para ver o relatório';
}

export function openAllGroups(): void {
  const t = T();
  const grid = $('all-groups-grid');
  grid.innerHTML = '';
  Object.keys(t.groups).forEach(g => {
    const box = document.createElement('div');
    box.className = 'bg-slate-800/50 p-4 rounded-xl border border-slate-700';
    box.innerHTML = `<h4 class="font-black text-center mb-3 text-emerald-400">Grupo ${g}</h4>
      <div class="table-scroll"><table class="w-full text-xs"><thead><tr class="text-slate-500 border-b border-slate-700/50"><th class="pb-2 text-left pl-2 sticky-col bg-slate-800">Clube</th><th class="pb-2">PTS</th><th class="pb-2">J</th><th class="pb-2">SG</th></tr></thead><tbody></tbody></table></div>`;
    grid.appendChild(box);
    renderGroupTable(g, box.querySelector('tbody')!, true);
  });
  showEl('modal-groups');
  $('modal-groups').scrollTop = 0;
}
