// Painel principal do torneio
import { PHASE_LABEL, isUser, isUserMatch, oddsFor, team } from '../engine/core';
import { qualifiedCount } from '../engine/config';
import { sortGroupIds } from '../engine/groups';
import { currentRoundMatches, lastDecisiveMatch, roundTitle } from '../engine/tournament';
import type { DENode, PlayableMatch, TeamState } from '../engine/types';
import { T, saveGame } from '../state/store';
import { logoImg, setLogo } from './crest';
import { $, escapeHtml, hideEl, pct, setHidden, shieldClicks, showEl } from './dom';
import { campaignTiles, formDots, miniMatchRow, neutralOrder } from './render';
import { renderDashboardExtras } from './extras';

export function enterDashboard(): void {
  shieldClicks(700);
  window.scrollTo(0, 0);
  ['screen-sandbox-config', 'screen-select', 'div-confirm-teams'].forEach(hideEl);
  $('screen-sandbox-config').classList.remove('flex-1');
  showEl('screen-dashboard');
  setupDashboardTabs();
  updateDashboard();
}

function setupDashboardTabs(): void {
  const t = T();
  const sel = $<HTMLSelectElement>('dash-team-select');
  sel.innerHTML = t.userIds.map(id => `<option value="${id}">${escapeHtml(team(t, id).name)}</option>`).join('');
  if (!t.userIds.includes(t.activeId)) t.activeId = t.userIds[0];
  sel.value = t.activeId;
  sel.onchange = () => {
    t.activeId = sel.value;
    saveGame();
    updateDashboard();
  };
}

export function teamFate(x: TeamState): string | null {
  const t = T();
  if (t.champion === x.id) return '🏆 Campeão!';
  if (x.out) return 'Eliminado: ' + x.out;
  return null;
}

export function updateDashboard(): void {
  const t = T();
  const me = team(t, t.activeId);
  setLogo($<HTMLImageElement>('dash-logo'), me);
  $<HTMLSelectElement>('dash-team-select').value = t.activeId;

  const btnDraw = $('btn-draw'), btnSim = $('btn-simulate-match'), btnPlay = $('btn-play-match'), btnChamp = $('btn-show-champion');
  [btnDraw, btnSim, btnPlay, btnChamp].forEach(hideEl);
  ['dash-group-view', 'dash-swiss-view', 'dash-ko-view'].forEach(hideEl);
  setHidden('btn-view-groups', Object.keys(t.groups).length === 0);
  setHidden('btn-view-bracket', !(t.knockout.length || t.bracket || t.draw));
  const fate = teamFate(me);
  $('dash-team-status').textContent = `OVR ${me.ovr} · ${me.country} · ${me.conf}${fate ? ' · ' + fate : ''}`;
  $('dash-campaign').innerHTML = campaignTiles(me.st);

  if (t.phase === 'END') {
    const C = team(t, t.champion!);
    $('dash-phase').textContent = `Fim de Torneio · Campeão: ${C.name}`;
    setNextMatchUI(null, t.champion === me.id ? '🏆 Você é o campeão!' : `🏆 ${C.name} é o campeão!`);
    showEl(btnChamp);
    if (t.knockout.length || t.bracket) renderKoView();
    else showGroupView(me.group ?? Object.keys(t.groups)[0]);
    renderDashboardExtras(null);
    return;
  }

  const ms = currentRoundMatches(t);
  const pendingUser = ms.filter(m => !m.played && isUserMatch(t, m));
  const roundDone = ms.length > 0 && ms.every(m => m.played);
  const myMatch = ms.find(m => m.home === me.id || m.away === me.id) ?? null;

  $('dash-phase').textContent = roundTitle(t) + (t.draw ? ' · Aguardando sorteio' : '');
  if (t.draw) showEl(btnDraw);
  else if (roundDone) { btnSim.textContent = 'Ver Resultados'; showEl(btnSim); }
  else if (ms.length) {
    btnSim.textContent = 'Simular Rodada';
    showEl(btnSim);
    if (pendingUser.length) {
      btnPlay.innerHTML = `<span>🎮</span> Jogar${pendingUser.length > 1 ? ` (${pendingUser.length} jogos)` : ''}`;
      showEl(btnPlay);
    }
  }

  if (t.phase === 'GROUP') {
    showGroupView(me.group);
    setNextMatchUI(myMatch, myMatch ? myMatch.stage : `Grupo ${me.group} · folga nesta rodada`);
  } else if (t.phase === 'SWISS') {
    renderSwissView();
    const ctx = myMatch ? myMatch.stage : me.status === 'advanced' ? '✅ Classificado ao mata-mata!' : me.status === 'eliminated' ? '❌ ' + me.out : 'Aguardando...';
    setNextMatchUI(myMatch, ctx);
  } else {
    renderKoView();
    if (t.draw) setNextMatchUI(null, fate ?? 'Aguardando sorteio...');
    else if (myMatch) setNextMatchUI(myMatch, myMatch.stage);
    else if (fate) setNextMatchUI(null, fate);
    else if (t.phase === 'DE') {
      const future = t.bracket!.nodes.find(n => !n.played && (n.home === me.id || n.away === me.id));
      setNextMatchUI(null, future ? `Aguardando adversário · ${future.label}` : 'Aguardando a próxima rodada');
    } else setNextMatchUI(null, 'Aguardando...');
  }
  renderDashboardExtras(myMatch && !myMatch.played ? myMatch : null);
}

function setNextMatchUI(match: PlayableMatch | null, context: string): void {
  const t = T();
  const odds = $('next-match-odds');
  if (match) {
    const H = team(t, match.home), A = team(t, match.away);
    setLogo($<HTMLImageElement>('next-home-logo'), H);
    setLogo($<HTMLImageElement>('next-away-logo'), A);
    $('next-match-home').textContent = H.name;
    $('next-match-away').textContent = A.name;
    $('next-home-ovr').textContent = `OVR ${H.ovr}`;
    $('next-away-ovr').textContent = `OVR ${A.ovr}`;
    $('next-match-vs').textContent = match.played && match.res ? `${match.res.gH} - ${match.res.gA}` : 'VS';
    if (!match.played) { renderOdds(match); showEl(odds); } else hideEl(odds);
  } else {
    setLogo($<HTMLImageElement>('next-home-logo'), null);
    setLogo($<HTMLImageElement>('next-away-logo'), null);
    $('next-match-home').textContent = '---';
    $('next-match-away').textContent = '---';
    $('next-home-ovr').textContent = '';
    $('next-away-ovr').textContent = '';
    $('next-match-vs').textContent = 'VS';
    hideEl(odds);
  }
  const ctx = $('next-match-context');
  ctx.textContent = context;
  const bad = /^(Eliminado|❌)/.test(context), gold = context.startsWith('🏆');
  ctx.className = `text-xs font-semibold uppercase tracking-widest py-1 px-2 rounded-full border ${bad ? 'text-red-300 bg-red-900/30 border-red-500/30' : gold ? 'text-yellow-300 bg-yellow-900/30 border-yellow-500/30' : 'text-emerald-500 bg-emerald-900/30 border-emerald-500/20'}`;
}

export function renderOdds(m: PlayableMatch): void {
  const t = T();
  const o = oddsFor(t, m);
  const H = team(t, m.home), A = team(t, m.away);
  if (o.advH !== undefined) {
    $('odds-bar').innerHTML = `<div class="bg-emerald-500" style="width:${o.advH * 100}%"></div><div class="bg-sky-500" style="width:${(1 - o.advH) * 100}%"></div>`;
    $('odds-legend').innerHTML = `<span class="text-emerald-400 flex min-w-0 gap-1"><b class="shrink-0">${pct(o.advH)}</b><span class="truncate">${escapeHtml(H.name)}</span></span><span class="text-slate-500 shrink-0 px-1">${m.kind === 'ko' ? 'chance de avançar' : 'chance de vencer'}</span><span class="text-sky-400 flex min-w-0 gap-1 justify-end"><span class="truncate">${escapeHtml(A.name)}</span><b class="shrink-0">${pct(1 - o.advH)}</b></span>`;
  } else {
    $('odds-bar').innerHTML = `<div class="bg-emerald-500" style="width:${o.ph * 100}%"></div><div class="bg-slate-500" style="width:${o.pd * 100}%"></div><div class="bg-sky-500" style="width:${o.pa * 100}%"></div>`;
    $('odds-legend').innerHTML = `<span class="text-emerald-400 flex min-w-0 gap-1"><b class="shrink-0">${pct(o.ph)}</b><span class="truncate">${escapeHtml(H.name)}</span></span><span class="shrink-0 px-1">Empate ${pct(o.pd)}</span><span class="text-sky-400 flex min-w-0 gap-1 justify-end"><span class="truncate">${escapeHtml(A.name)}</span><b class="shrink-0">${pct(o.pa)}</b></span>`;
  }
}

export function renderGroupTable(g: string, tbody: HTMLElement, compact = false): void {
  const t = T();
  const k = t.config.advancingPerGroup;
  tbody.innerHTML = sortGroupIds(t, g).map((id, i) => {
    const x = team(t, id);
    const isU = isUser(t, id);
    const qual = i < k;
    const rowBg = isU ? 'bg-emerald-900/40 font-bold' : '';
    const stickyBg = isU ? 'bg-emerald-950' : 'bg-slate-800';
    const clubCell = `<td class="py-2 sticky-col pl-2 pr-2 ${stickyBg} ${qual ? 'border-l-2 border-l-emerald-500' : 'border-l-2 border-l-transparent'}">
        <div class="flex items-center gap-2 whitespace-nowrap"><span class="text-slate-500 w-4 text-right text-xs tabular-nums">${i + 1}</span>${logoImg(x, 'w-5 h-5 object-contain')}<span class="${isU ? 'text-emerald-400' : 'text-slate-200'} ${compact ? 'max-w-[120px] truncate' : ''}">${escapeHtml(x.name)}</span></div></td>`;
    if (compact) {
      return `<tr class="border-b border-slate-700/30 ${rowBg} tabular-nums">${clubCell}
        <td class="py-2 text-center text-white font-bold">${x.p}</td>
        <td class="py-2 text-center text-slate-500">${x.w + x.d + x.l}</td>
        <td class="py-2 text-center text-slate-400">${x.gd}</td></tr>`;
    }
    return `<tr class="border-b border-slate-700/30 hover:bg-white/5 ${rowBg} tabular-nums">${clubCell}
      <td class="py-2 text-center text-white font-bold">${x.p}</td>
      <td class="py-2 text-center text-slate-500">${x.w + x.d + x.l}</td>
      <td class="py-2 text-center text-slate-400">${x.w}</td>
      <td class="py-2 text-center text-slate-400">${x.d}</td>
      <td class="py-2 text-center text-slate-400">${x.l}</td>
      <td class="py-2 text-center text-slate-400">${x.gf}</td>
      <td class="py-2 text-center text-slate-400">${x.ga}</td>
      <td class="py-2 text-center text-slate-300">${x.gd > 0 ? '+' + x.gd : x.gd}</td>
      <td class="py-2 text-center whitespace-nowrap">${formDots(x.form)}</td></tr>`;
  }).join('');
}

function showGroupView(g: string | null): void {
  const t = T();
  if (!g || !t.groups[g]) return;
  showEl('dash-group-view');
  $('table-group-name').textContent = `Grupo ${g}`;
  renderGroupTable(g, $('group-table-body'));
  const k = t.config.advancingPerGroup;
  $('group-legend').textContent = qualifiedCount(t.config) === 1
    ? 'Pontos corridos: o líder ao fim das rodadas é o campeão. Critérios: pontos, saldo, gols pró, confronto direto, vitórias, sorteio.'
    : `Faixa verde = zona de classificação (Top ${k}). Critérios: pontos, saldo, gols pró, confronto direto, vitórias, sorteio.`;
  const rounds = t.schedule[g];
  const ri = t.phase === 'GROUP' ? Math.min(t.round, rounds.length - 1) : rounds.length - 1;
  $('group-round-title').textContent = `Jogos do Grupo ${g} · Rodada ${ri + 1}/${rounds.length}`;
  $('group-round-list').innerHTML = (rounds[ri] ?? []).map(m => miniMatchRow(m)).join('') || '<p class="text-slate-500 text-sm">Sem jogos.</p>';
}

function renderSwissView(): void {
  const t = T();
  showEl('dash-swiss-view');
  const container = $('swiss-table-container');
  container.innerHTML = '';
  const pools: Record<string, TeamState[]> = {};
  Object.values(t.teams).forEach(x => { (pools[`${x.sw}-${x.sl}`] ??= []).push(x); });
  const recRank = (rec: string) => {
    const [w, l] = rec.split('-').map(Number);
    return [w >= 3 || l >= 3 ? 1 : 0, -(w - l), -w];
  };
  Object.keys(pools).sort((a, b) => {
    const ra = recRank(a), rb = recRank(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
  }).forEach(rec => {
    const list = pools[rec].sort((a, b) => b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name));
    const [w, l] = rec.split('-').map(Number);
    const tag = w >= 3 ? '<span class="text-emerald-400">Classificados</span>' : l >= 3 ? '<span class="text-red-400">Eliminados</span>' : '<span class="text-indigo-300">Em disputa</span>';
    const div = document.createElement('div');
    div.innerHTML = `
      <h5 class="text-slate-300 font-bold mb-2">Campanha ${rec} · ${tag}</h5>
      <table class="w-full text-left border-collapse min-w-[360px] text-sm tabular-nums">
        <thead><tr class="text-slate-500 text-xs border-b border-slate-700/50">
          <th class="pb-2 font-semibold pl-2 sticky-col bg-slate-800">Clube</th>
          <th class="pb-2 font-semibold text-center w-16">V-D</th>
          <th class="pb-2 font-semibold text-center w-14">GP</th>
          <th class="pb-2 font-semibold text-center w-14">SG</th>
          <th class="pb-2 font-semibold text-center w-28">Status</th>
        </tr></thead>
        <tbody>${list.map(x => {
          const isU = isUser(t, x.id);
          const border = x.status === 'advanced' ? 'border-l-2 border-l-emerald-500' : x.status === 'eliminated' ? 'border-l-2 border-l-red-500' : 'border-l-2 border-l-transparent';
          return `<tr class="border-b border-slate-700/30 hover:bg-white/5">
            <td class="py-2 pl-2 sticky-col ${isU ? 'bg-indigo-950' : 'bg-slate-800'} ${border}"><div class="flex items-center gap-2 whitespace-nowrap">${logoImg(x, 'w-5 h-5 object-contain')}<span class="${isU ? 'text-indigo-300 font-bold' : 'text-slate-200'}">${escapeHtml(x.name)}</span></div></td>
            <td class="py-2 text-center text-white font-bold">${x.sw}-${x.sl}</td>
            <td class="py-2 text-center text-slate-400">${x.gf}</td>
            <td class="py-2 text-center text-slate-400">${x.gd > 0 ? '+' + x.gd : x.gd}</td>
            <td class="py-2 text-center text-xs uppercase ${x.status === 'advanced' ? 'text-emerald-400' : x.status === 'eliminated' ? 'text-red-400' : 'text-slate-500'}">${x.status === 'advanced' ? 'Classificado' : x.status === 'eliminated' ? 'Eliminado' : 'Em jogo'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
    container.appendChild(div);
  });
}

function renderKoView(): void {
  const t = T();
  showEl('dash-ko-view');
  const list = $('ko-view-list');
  if (t.phase === 'END') {
    const final = lastDecisiveMatch(t);
    $('ko-view-title').textContent = 'Torneio encerrado';
    $('ko-view-subtitle').textContent = t.championNote ?? '';
    list.innerHTML = final ? miniMatchRow(final) : '';
    return;
  }
  if (t.draw) {
    const D = t.draw;
    const ids = neutralOrder(D.pairs.flat());
    $('ko-view-title').textContent = `${D.phase === 'DE' ? 'Dupla Eliminação' : PHASE_LABEL[D.phase]} · Classificados (${ids.length})`;
    $('ko-view-subtitle').textContent = D.note;
    list.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">${ids.map(id => {
      const x = team(t, id);
      return `<div class="flex items-center gap-2 rounded-lg px-3 py-2 ${isUser(t, id) ? 'bg-emerald-900/30 border border-emerald-500/40' : 'bg-slate-900/50 border border-slate-700/50'}">${logoImg(x, 'w-5 h-5 object-contain')}<span class="truncate">${escapeHtml(x.name)}</span><span class="ml-auto text-[10px] text-slate-500">OVR ${x.ovr}</span></div>`;
    }).join('')}</div>`;
    return;
  }
  const ms = currentRoundMatches(t);
  $('ko-view-title').textContent = roundTitle(t);
  $('ko-view-subtitle').textContent = t.phase === 'DE'
    ? 'Upper: perdeu, cai para a Lower. Lower: perdeu, está fora. Empates vão para prorrogação e pênaltis.'
    : 'Jogo único em campo neutro · empate → prorrogação → pênaltis';
  list.innerHTML = ms.map(m => {
    const n = m as Partial<DENode>;
    const label = t.phase === 'DE' ? `<p class="text-[10px] uppercase tracking-widest font-bold ${n.bracket === 'upper' ? 'text-emerald-400' : n.bracket === 'lower' ? 'text-red-400' : 'text-yellow-400'} mt-2">${n.label}</p>` : '';
    return label + miniMatchRow(m);
  }).join('');
}
