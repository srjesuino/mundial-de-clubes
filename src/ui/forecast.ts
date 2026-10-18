// Probabilidades do torneio: roda o Monte Carlo em pedaços (sem travar a tela), guarda e mostra
import { isUser, team } from '../engine/core';
import { qualifiedCount } from '../engine/config';
import { canForecast, clinchStatus, forecastJob, forecastKey, formatChance, marginPP, storeForecast, type ForecastJob } from '../engine/forecast';
import { sortGroupIds } from '../engine/groups';
import { currentRoundMatches } from '../engine/tournament';
import type { Forecast, Tournament } from '../engine/types';
import { T, saveGame, store } from '../state/store';
import { logoImg } from './crest';
import { $, escapeHtml, fmtBR, isShown, setHidden, showEl } from './dom';
import { registerDashboardExtra } from './extras';
import { on } from './hooks';

let job: ForecastJob | null = null;
let jobOwner: Tournament | null = null;
let debounce: number | undefined;
let chunkTimer: number | undefined;

const busyScreens = ['screen-match', 'screen-draw', 'round-ticker'];
const screensBusy = () => busyScreens.some(id => isShown(id));

function cancel(): void {
  clearTimeout(chunkTimer);
  job = null;
  jobOwner = null;
}

/** Agenda um cálculo (espera 800 ms de calmaria; pausa durante partida, sorteio e plantão) */
export function mcSchedule(): void {
  clearTimeout(debounce);
  debounce = window.setTimeout(startIfNeeded, 800);
}

function startIfNeeded(): void {
  const t = store.t;
  if (!t || !canForecast(t)) { cancel(); refreshViews(); return; }
  if (screensBusy()) { mcSchedule(); return; }
  const key = forecastKey(t);
  if (t.mc?.key === key) { refreshViews(); return; }
  if (job && jobOwner === t && job.key === key) return; // já calculando
  cancel();
  try { job = forecastJob(t); } catch { job = null; return; }
  jobOwner = t;
  chunk();
}

function chunk(): void {
  const t = store.t;
  if (!job || !t || t !== jobOwner) { cancel(); return; }
  if (forecastKey(t) !== job.key) { cancel(); mcSchedule(); return; }
  if (screensBusy()) { chunkTimer = window.setTimeout(chunk, 400); return; }
  let finished = false;
  try {
    finished = job.step(12);
  } catch (e) {
    console.error('Previsão interrompida', e);
    cancel();
    return;
  }
  if (finished) {
    storeForecast(t, job.result());
    cancel();
    saveGame();
    refreshViews();
    return;
  }
  refreshProgress();
  chunkTimer = window.setTimeout(chunk, 0);
}

// ---------- Painel ----------
const titleCol = (f: Forecast) => f.cols.indexOf('Título');

function sparkline(t: Tournament, id: string): string {
  const pts = (t.mcLog ?? []).map(e => e.t[id]).filter((v): v is number => typeof v === 'number');
  if (pts.length < 2) return '';
  const max = Math.max(...pts, 0.01);
  const xy = pts.map((v, i) => `${((i / (pts.length - 1)) * 78 + 1).toFixed(1)},${(19 - (v / max) * 18).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 80 20" class="w-20 h-5 shrink-0" aria-hidden="true"><polyline points="${xy}" fill="none" stroke="#a78bfa" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

function refreshProgress(): void {
  const el = $('dash-mc');
  if (!job || !store.t) return;
  const t = store.t;
  if (t.mc && t.mc.key !== job.key) return; // mostra o valor anterior até terminar
  if (t.mc) return;
  el.innerHTML = `<span class="text-slate-400">Calculando probabilidades…</span><span class="text-slate-500 tabular-nums">${fmtBR(job.done)}/${fmtBR(job.total)} simulações</span>`;
  showEl(el);
}

function renderDashMc(): void {
  const el = $('dash-mc');
  const t = store.t;
  if (!t || t.phase === 'END') { setHidden(el, true); return; }
  const f = t.mc;
  if (!f) {
    if (t.draw) { el.innerHTML = '<span class="text-slate-400">📊 Probabilidades: disponível depois do sorteio</span>'; showEl(el); }
    else if (job) refreshProgress();
    else setHidden(el, true);
    return;
  }
  const ti = titleCol(f);
  const id = t.activeId;
  const c = formatChance(f, id, ti);
  const log = t.mcLog ?? [];
  const prev = log.length >= 2 ? log[log.length - 2].t[id] : undefined;
  const cur = f.p[id]?.[ti] ?? 0;
  let delta = '';
  if (prev !== undefined && !c.sure) {
    const d = Math.round((cur - prev) * 1000) / 10;
    if (d >= 0.1) delta = `<span class="text-emerald-400">▲${fmtBR(d, 1)}</span>`;
    else if (d <= -0.1) delta = `<span class="text-red-400">▼${fmtBR(-d, 1)}</span>`;
  }
  const stale = f.key !== forecastKey(t);
  const note = t.draw ? ' <span class="text-slate-500">(antes do sorteio)</span>' : stale && job ? ' <span class="text-slate-500">(atualizando…)</span>' : '';
  el.innerHTML = `<span class="min-w-0"><span class="text-slate-400">Chance de título</span> <b class="text-white tabular-nums">${c.text}</b> ${delta}${note}</span>${sparkline(t, id)}`;
  el.setAttribute('aria-label', `Chance de título ${c.text}. Abrir as probabilidades do torneio`);
  showEl(el);
}

/** Cenários do próximo jogo (grupos e suíço) + classificação/eliminação matemática */
function renderScenarios(): void {
  const el = $('next-scenarios');
  const t = store.t;
  if (!t || (t.phase !== 'GROUP' && t.phase !== 'SWISS')) { setHidden(el, true); return; }
  const id = t.activeId;
  const m = currentRoundMatches(t).find(x => !x.played && (x.home === id || x.away === id));
  const league = t.config.initialPhase === 'groups' && qualifiedCount(t.config) === 1;
  const cl = clinchStatus(t, id);
  const badge = cl === 'in' ? `<p class="text-emerald-300 font-bold">✓ ${league ? 'Campeão' : 'Classificado'} matematicamente</p>`
    : cl === 'out' ? `<p class="text-red-300 font-bold">✗ ${league ? 'Sem chance de título' : 'Eliminado'} matematicamente</p>` : '';
  let line = '';
  const f = t.mc;
  if (m && f && f.key === forecastKey(t) && f.cond[id]) {
    const what = league ? 'título' : 'classifica';
    const cell = (cls: 'V' | 'E' | 'D') => {
      const v = f.cond[id][cls];
      if (!v || !v[0]) return '—';
      const p = v[1] / v[0];
      const txt = p <= 0 ? '<0,1%' : p >= 1 ? '>99,9%' : fmtBR(Math.round(p * 1000) / 10, 1) + '%';
      return v[0] < 100 ? `${txt} <span class="text-slate-500">(amostra pequena)</span>` : txt;
    };
    const parts = [`Se vencer: ${what} em <b>${cell('V')}</b>`];
    if (m.kind === 'group') parts.push(`empatar: <b>${cell('E')}</b>`);
    parts.push(`perder: <b>${cell('D')}</b>`);
    line = `<p>${parts.join(' · ')}</p>`;
  } else if (m && job) line = '<p class="text-slate-500">Calculando os cenários do próximo jogo…</p>';
  el.innerHTML = badge + line;
  setHidden(el, !badge && !line);
}

function refreshViews(): void {
  if (!store.t || !isShown('screen-dashboard')) return;
  renderDashMc();
  renderScenarios();
  if (isShown('modal-odds')) renderOdds();
}

// ---------- Janela de probabilidades ----------
let oddsTab: 'torneio' | 'pos' = 'torneio';
let posGroup: string | null = null;

function cellButton(f: Forecast, id: string, ci: number): string {
  const avg = f.cols[ci] === 'Posição média';
  if (avg) return `<td class="px-1 py-1.5 text-center tabular-nums text-slate-300">${fmtBR(f.p[id]?.[ci] ?? 0, 1)}</td>`;
  const c = formatChance(f, id, ci);
  const tip = c.sure ? (c.text === '✓' ? 'já garantido' : 'sem chance') : `±${fmtBR(marginPP(c.p, f.n), 1)} p.p.`;
  return `<td class="px-1 py-1 text-center"><button type="button" data-tip="${tip}" data-val="${c.text}" class="odds-cell min-h-[36px] w-full rounded px-1 tabular-nums ${c.sure ? (c.text === '✓' ? 'text-emerald-300 font-black' : 'text-slate-600') : 'text-slate-200 hover:bg-slate-700/60'}">${c.text}</button></td>`;
}

function renderOdds(): void {
  const t = store.t;
  if (!t) return;
  const f = t.mc;
  const sub = $('odds-sub'), content = $('odds-content'), tabs = $('odds-tabs');
  if (!f) {
    sub.textContent = '';
    tabs.innerHTML = '';
    content.innerHTML = `<p class="text-center text-slate-400 py-8">${t.draw ? 'Disponível depois do sorteio.' : t.phase === 'END' ? 'Torneio encerrado.' : job ? `Calculando… ${fmtBR(job.done)}/${fmtBR(job.total)} simulações` : 'Calculando…'}</p>`;
    return;
  }
  sub.textContent = `${fmtBR(f.n)} simulações · ${f.label}${t.draw ? ' · antes do sorteio' : f.key !== forecastKey(t) ? ' · atualizando…' : ''}`;
  const hasPos = Object.keys(f.pos).length > 0 && t.phase === 'GROUP';
  if (!hasPos) oddsTab = 'torneio';
  tabs.innerHTML = hasPos
    ? (['torneio', 'pos'] as const).map(k => `<button type="button" role="tab" data-tab="${k}" aria-selected="${oddsTab === k}" class="min-h-[44px] px-4 rounded-lg text-sm font-bold border ${oddsTab === k ? 'bg-violet-700 border-violet-400 text-white' : 'bg-slate-800 border-slate-600 text-slate-300'}">${k === 'torneio' ? 'Torneio' : 'Posições no grupo'}</button>`).join('')
    : '';
  tabs.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => { b.onclick = () => { oddsTab = b.dataset.tab as typeof oddsTab; renderOdds(); }; });
  if (oddsTab === 'pos' && hasPos) { renderPositions(t, f); return; }

  const ti = titleCol(f);
  const ids = Object.keys(t.teams).sort((a, b) => {
    if (ti >= 0) { const d = (f.p[b]?.[ti] ?? 0) - (f.p[a]?.[ti] ?? 0); if (d) return d; }
    for (let c = 0; c < f.cols.length; c++) { if (f.cols[c] === 'Posição média') continue; const d = (f.p[b]?.[c] ?? 0) - (f.p[a]?.[c] ?? 0); if (d) return d; }
    return team(t, b).ovr - team(t, a).ovr;
  });
  content.innerHTML = `<div class="table-scroll scrollbar-thin"><table class="w-full text-xs md:text-sm border-collapse min-w-[420px]">
    <thead><tr class="text-slate-400 text-[10px] md:text-xs border-b border-slate-700"><th class="sticky-col bg-slate-800 text-left py-2 pl-2">Clube</th>${f.cols.map(c => `<th class="px-1 py-2 font-semibold">${escapeHtml(c)}</th>`).join('')}</tr></thead>
    <tbody>${ids.map(id => {
      const x = team(t, id);
      const u = isUser(t, id);
      return `<tr class="border-b border-slate-700/30 ${u ? 'bg-emerald-900/30' : ''}"><td class="sticky-col ${u ? 'bg-emerald-950 text-emerald-300 font-bold' : 'bg-slate-800 text-slate-200'} py-1 pl-2 pr-2"><div class="flex items-center gap-2 whitespace-nowrap max-w-[11rem] md:max-w-none">${logoImg(x, 'w-5 h-5 object-contain shrink-0')}<span class="truncate">${escapeHtml(x.name)}</span></div></td>${f.cols.map((_, ci) => cellButton(f, id, ci)).join('')}</tr>`;
    }).join('')}</tbody></table></div>`;
  bindCells(content);
}

function bindCells(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>('.odds-cell').forEach(b => {
    b.onclick = () => {
      const showingTip = b.textContent === b.dataset.tip;
      b.textContent = showingTip ? b.dataset.val! : b.dataset.tip!;
    };
  });
}

function renderPositions(t: Tournament, f: Forecast): void {
  const groups = Object.keys(f.pos);
  const mine = team(t, t.activeId).group;
  if (!posGroup || !f.pos[posGroup]) posGroup = mine && f.pos[mine] ? mine : groups[0];
  const g = posGroup;
  const ids = sortGroupIds(t, g);
  const n = ids.length;
  const k = t.config.advancingPerGroup;
  const content = $('odds-content');
  content.innerHTML = `<div class="flex justify-center mb-3"><select id="pos-group" aria-label="Grupo" class="px-3 py-2 min-h-[44px] rounded-lg bg-slate-800 border border-slate-600 text-white">${groups.map(x => `<option value="${x}" ${x === g ? 'selected' : ''}>Grupo ${x}</option>`).join('')}</select></div>
    <div class="table-scroll scrollbar-thin ${n > 8 ? 'max-h-[60vh] overflow-y-auto' : ''}"><table class="border-collapse text-xs mx-auto">
    <thead><tr class="text-slate-400"><th class="sticky-col bg-slate-800 text-left pl-2 py-1">Clube</th>${ids.map((_, i) => `<th class="px-0.5 py-1 font-semibold ${i < k ? 'text-emerald-400' : ''}">${i + 1}º</th>`).join('')}</tr></thead>
    <tbody>${ids.map(id => {
      const x = team(t, id);
      const row = f.pos[g][id] ?? [];
      return `<tr><td class="sticky-col bg-slate-800 pl-2 pr-2 py-0.5 ${isUser(t, id) ? 'text-emerald-300 font-bold' : 'text-slate-200'}"><div class="flex items-center gap-1.5 whitespace-nowrap max-w-[9rem]">${logoImg(x, 'w-4 h-4 object-contain shrink-0')}<span class="truncate">${escapeHtml(x.name)}</span></div></td>${row.map((p, i) => {
        const txt = p <= 0 ? '0%' : p >= 1 ? '100%' : fmtBR(Math.round(p * 1000) / 10, 1) + '%';
        return `<td class="px-0.5 py-0.5"><button type="button" class="pos-cell ${i < k ? 'ring-1 ring-emerald-500/60' : ''}" style="background:rgba(16,185,129,${(0.08 + p * 0.85).toFixed(2)})" aria-label="${escapeHtml(x.name)}: ${i + 1}º lugar em ${txt} das simulações" title="${txt}" data-short="${p >= 0.005 ? Math.round(p * 100) : ''}">${p >= 0.005 ? Math.round(p * 100) : ''}</button></td>`;
      }).join('')}</tr>`;
    }).join('')}</tbody></table></div>
    <p class="text-[10px] text-slate-500 text-center mt-2">% das simulações em que o clube termina em cada posição · contorno verde = vagas de classificação · toque para ver o valor exato</p>`;
  $<HTMLSelectElement>('pos-group').onchange = e => { posGroup = (e.target as HTMLSelectElement).value; renderPositions(t, f); };
  content.querySelectorAll<HTMLButtonElement>('.pos-cell').forEach(b => {
    b.onclick = () => { b.textContent = b.textContent === b.title ? b.dataset.short ?? '' : b.title; };
  });
}

export function openOdds(): void {
  oddsTab = 'torneio';
  renderOdds();
  showEl('modal-odds');
  $('modal-odds').scrollTop = 0;
  if (!T().mc) mcSchedule();
}

export function initForecast(): void {
  $('btn-view-odds').onclick = openOdds;
  $('dash-mc').onclick = openOdds;
  registerDashboardExtra(() => { renderDashMc(); renderScenarios(); mcSchedule(); });
  on('roundResults', mcSchedule);
  on('drawFinalized', mcSchedule);
  on('advance', mcSchedule);
  on('liveStart', () => { cancel(); });
  on('newTournament', () => { cancel(); clearTimeout(debounce); });
  document.addEventListener('mc64:tactic', () => { renderScenarios(); mcSchedule(); });
}
