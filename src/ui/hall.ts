// Galeria de Campeões, Índice de Superação, resumo para copiar e conquistas
import { ALL_TEAMS } from '../data/teams';
import { ACH } from '../engine/achievements';
import { team } from '../engine/core';
import { DIFF, DIFF_ORDER } from '../engine/live';
import { buildShareText, hofEntry, superOneIn, superTotal, type ClubSnap, type HofEntry } from '../engine/meta';
import type { Difficulty } from '../engine/types';
import { achStore, clearHof, hof, onMetaSaveFail, recordHof } from '../state/meta';
import { T, saveGame, store } from '../state/store';
import { checkEnd } from './ach';
import { logoImg } from './crest';
import { $, askConfirm, escapeHtml, fmtBR, hideEl, setHidden, showEl, toast } from './dom';
import { registerDashboardExtra } from './extras';

/** Grava o fim do torneio na Galeria uma única vez (sobrevive a recarregar a página) */
export function recordTournamentEnd(): void {
  const t = store.t;
  if (!t || t.phase !== 'END' || t.hofId) return;
  const e = hofEntry(t);
  recordHof(e);
  t.hofId = e.id;
  checkEnd(t);
  saveGame();
}

// ---------- Copiar resumo ----------
/** Área de transferência → execCommand → janela com o texto selecionado (sempre dentro do clique) */
export function copyText(txt: string): void {
  const opener = document.activeElement;
  const fallback = () => {
    let ok = false;
    try {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      ta.remove();
      (opener as HTMLElement | null)?.focus?.({ preventScroll: true }); // a janela de cópia lembra quem a abriu
    } catch { ok = false; }
    if (ok) { (opener as HTMLElement | null)?.focus?.({ preventScroll: true }); toast('Resumo copiado!'); return; }
    const box = $<HTMLTextAreaElement>('share-text');
    box.value = txt;
    showEl('modal-share');
    box.focus();
    box.select();
    box.setSelectionRange(0, txt.length);
  };
  try {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).then(() => toast('Resumo copiado!'), fallback);
    else fallback();
  } catch { fallback(); }
}

export const copyShare = (): void => { if (store.t) copyText(buildShareText(store.t)); };

// ---------- Painel e campeão ----------
/** "1 em 1,5", "1 em 17", "1 em 1.240" */
const oneIn = (score: number): string => {
  if (score <= 0) return '1';
  const n = superOneIn(score);
  const r1 = Math.round(n * 10) / 10;
  if (r1 >= 10) return fmtBR(Math.round(n));
  return n < 1.1 ? fmtBR(Math.round(n * 100) / 100, 2) : fmtBR(r1, 1);
};
function renderDashSuper(): void {
  const t = store.t;
  const el = $('dash-super');
  if (!t) { setHidden(el, true); return; }
  const s = superTotal(t, t.activeId);
  if (!team(t, t.activeId).st.j) { setHidden(el, true); return; }
  el.textContent = `Superação ${fmtBR(s)} · 1 em ${oneIn(s)}`;
  showEl(el);
}

export function championExtras(): void {
  const t = T();
  const sup = t.userIds.map(id => `${team(t, id).name} ${fmtBR(superTotal(t, id))}`).join(' · ');
  $('champ-super').textContent = `Superação: ${sup}`;
  setHidden('champ-super', !t.userIds.length);
}

// ---------- Galeria ----------
type HallTab = 'champs' | 'clubs' | 'records' | 'ach';
const TABS: [HallTab, string][] = [['champs', 'Campeões'], ['clubs', 'Seus clubes'], ['records', 'Recordes'], ['ach', 'Conquistas']];
let tab: HallTab = 'champs';
let recDiff: Difficulty | 'all' = 'all';

const baseOf = (c: ClubSnap) => ALL_TEAMS.find(x => x.id === c.id) ?? { name: c.name, logo: '' };
const dateBR = (at: number) => new Date(at).toLocaleDateString('pt-BR');

function champsTab(list: HofEntry[]): string {
  const h = hof();
  const top = Object.entries(h.titles).filter(([, r]) => r.t > 0).sort((a, b) => b[1].t - a[1].t || b[1].f - a[1].f).slice(0, 5);
  const most = top.length ? `<div class="bg-slate-900/60 border border-slate-700 rounded-xl p-3 mb-4"><h3 class="text-slate-400 font-bold uppercase tracking-wider text-xs mb-2">Mais títulos</h3>${top.map(([id, r]) =>
    `<div class="flex items-center gap-2 py-1">${logoImg(ALL_TEAMS.find(x => x.id === id) ?? { name: r.name, logo: '' }, 'w-5 h-5 object-contain shrink-0')}<span class="truncate">${escapeHtml(r.name)}</span><span class="ml-auto text-xs text-slate-400 tabular-nums shrink-0">🏆 ${r.t} · ${r.f} ${r.f === 1 ? 'final' : 'finais'}</span></div>`).join('')}</div>` : '';
  if (!list.length) return most + '<p class="text-center text-slate-400 py-6">Nenhum torneio terminado ainda. Termine um torneio para ele aparecer aqui.</p>';
  return most + `<div class="flex flex-col gap-2">${list.slice().reverse().map(e => {
    const best = e.users.reduce((a, b) => (b.rank > a.rank ? b : a), e.users[0]);
    const mine = e.users.some(u => u.id === e.champ.id);
    return `<div class="bg-slate-900/60 border ${mine ? 'border-amber-500/50' : 'border-slate-700'} rounded-xl p-3 flex flex-col gap-1">
      <div class="flex items-center gap-2 min-w-0">${logoImg(baseOf(e.champ), 'w-8 h-8 object-contain shrink-0')}<div class="min-w-0"><p class="font-black truncate">${mine ? '⭐ ' : ''}${escapeHtml(e.champ.name)} <span class="text-[10px] text-slate-500 font-bold">OVR ${e.champ.ovr}</span></p>
        <p class="text-[11px] text-slate-400 truncate">${dateBR(e.at)} · ${escapeHtml(e.fmt)}</p></div>
        <button type="button" data-share="${e.id}" class="ml-auto shrink-0 min-h-[44px] min-w-[44px] px-2 rounded-lg bg-slate-800 border border-slate-600 text-xs" aria-label="Copiar resumo deste torneio">📋</button></div>
      ${e.final ? `<p class="text-xs text-slate-300 truncate">${escapeHtml(e.final.stage)}: ${escapeHtml(e.final.score)}</p>` : e.note ? `<p class="text-xs text-slate-300">${escapeHtml(e.note)}</p>` : ''}
      ${best ? `<p class="text-[11px] text-slate-400 truncate">Seu melhor: ${escapeHtml(best.name)} — ${escapeHtml(best.label)} · Superação ${fmtBR(best.sup)} · ${DIFF[e.diff]?.label ?? ''}</p>` : ''}
    </div>`;
  }).join('')}</div>`;
}

const prunedNote = (): string => {
  const d = hof().dropped;
  return d ? `<p class="text-[11px] text-slate-500 text-center mb-2">Mostrando os últimos 200 torneios (${fmtBR(d)} ${d === 1 ? 'mais antigo saiu' : 'mais antigos saíram'} da lista; os títulos em "Mais títulos" contam todos).</p>` : '';
};

function clubsTab(list: HofEntry[]): string {
  const agg: Record<string, { name: string; ovr: number; n: number; t: number; f: number; best: { rank: number; label: string }; v: number; e: number; d: number; base: ClubSnap }> = {};
  list.forEach(e => e.users.forEach(u => {
    const a = (agg[u.id] ??= { name: u.name, ovr: u.ovr, n: 0, t: 0, f: 0, best: { rank: -1, label: '' }, v: 0, e: 0, d: 0, base: u });
    a.n++;
    if (u.rank === 1000) a.t++;
    if (u.rank >= 999) a.f++;
    if (u.rank > a.best.rank) a.best = { rank: u.rank, label: u.label };
    a.v += u.st.v; a.e += u.st.e; a.d += u.st.d;
  }));
  const rows = Object.values(agg).sort((a, b) => b.t - a.t || b.f - a.f || b.n - a.n);
  if (!rows.length) return '<p class="text-center text-slate-400 py-6">Seus clubes aparecem aqui quando um torneio termina.</p>';
  return prunedNote() + `<div class="flex flex-col gap-2">${rows.map(a => `<div class="bg-slate-900/60 border border-slate-700 rounded-xl p-3 flex items-center gap-3 min-w-0">
    ${logoImg(baseOf(a.base), 'w-8 h-8 object-contain shrink-0')}<div class="min-w-0 flex-1"><p class="font-bold truncate">${escapeHtml(a.name)}</p>
    <p class="text-[11px] text-slate-400">${a.n} torneio${a.n === 1 ? '' : 's'} · 🏆 ${a.t} · finais ${a.f} · melhor: ${escapeHtml(a.best.label)}</p>
    <p class="text-[11px] text-slate-500 tabular-nums">${a.v}V ${a.e}E ${a.d}D</p></div></div>`).join('')}</div>`;
}

function recordsTab(list: HofEntry[]): string {
  const all = list.flatMap(e => e.users.map(u => ({ ...u, diff: e.diff, at: e.at, fmt: e.fmt })))
    .filter(u => recDiff === 'all' || u.diff === recDiff)
    .sort((a, b) => b.sup - a.sup).slice(0, 10);
  const chips = (['all', ...DIFF_ORDER] as const).map(d => `<button type="button" data-diff="${d}" aria-pressed="${recDiff === d}" class="min-h-[44px] px-3 rounded-full text-xs font-bold border ${recDiff === d ? 'bg-amber-600 border-amber-300 text-white' : 'bg-slate-800 border-slate-600 text-slate-300'}">${d === 'all' ? 'Todos' : DIFF[d].label}</button>`).join('');
  const rows = all.length ? all.map((u, i) => `<div class="flex items-center gap-2 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 min-w-0">
    <span class="w-5 text-slate-500 text-xs tabular-nums">${i + 1}</span>${logoImg(baseOf(u), 'w-6 h-6 object-contain shrink-0')}
    <div class="min-w-0 flex-1"><p class="font-bold truncate">${escapeHtml(u.name)} <span class="text-[10px] text-slate-500">OVR ${u.ovr}</span></p><p class="text-[11px] text-slate-400 truncate">${escapeHtml(u.label)} · ${dateBR(u.at)} · ${DIFF[u.diff]?.label ?? ''}</p></div>
    <div class="text-right shrink-0"><p class="font-black text-amber-300 tabular-nums">${fmtBR(u.sup)}</p><p class="text-[10px] text-slate-500 tabular-nums">1 em ${oneIn(u.sup)}</p></div></div>`).join('')
    : '<p class="text-center text-slate-400 py-6">Sem recordes neste filtro.</p>';
  return prunedNote() + `<p class="text-[11px] text-slate-500 text-center mb-2">Superação: pelos OVRs do simulador, a chance de ir tão bem em cada um dos jogos, um a um (posturas não contam).</p>
    <div class="flex flex-wrap justify-center gap-2 mb-3">${chips}</div><div class="flex flex-col gap-2">${rows}</div>`;
}

function achTab(): string {
  const got = achStore().got;
  const n = ACH.filter(a => got[a.k]).length;
  return `<p class="text-center text-xs text-slate-400 mb-3">${n} de ${ACH.length} desbloqueadas neste navegador</p><div class="grid grid-cols-2 gap-2">${ACH.map(a => {
    const g = got[a.k];
    return `<div class="rounded-xl p-3 border ${g ? 'bg-amber-900/25 border-amber-500/40' : 'bg-slate-900/60 border-slate-700 opacity-80'} flex flex-col gap-1 min-w-0">
      <p class="font-black text-sm"><span class="${g ? '' : 'grayscale'}">${a.icon}</span> ${escapeHtml(a.t)}</p>
      <p class="text-[11px] text-slate-400 leading-snug">${escapeHtml(a.d)}</p>
      <p class="text-[10px] ${g ? 'text-amber-200' : 'text-slate-500'} leading-snug">${g ? `${dateBR(g.at)} · ${escapeHtml(g.detail)}` : 'Bloqueada'}</p></div>`;
  }).join('')}</div>`;
}

function renderHall(): void {
  const a = document.activeElement as HTMLElement | null;
  const keep = a?.closest('#hall-content') && a.dataset.diff ? `[data-diff="${a.dataset.diff}"]` : null;
  drawHall();
  if (keep) $('hall-content').querySelector<HTMLElement>(keep)?.focus({ preventScroll: true });
}

function drawHall(): void {
  const list = hof().list;
  const tabs = $('hall-tabs');
  tabs.innerHTML = TABS.map(([k, label]) => `<button type="button" role="tab" id="hall-tab-${k}" aria-controls="hall-content" data-tab="${k}" aria-selected="${tab === k}" tabindex="${tab === k ? 0 : -1}" class="min-h-[44px] px-3 rounded-lg text-sm font-bold border ${tab === k ? 'bg-amber-600 border-amber-300 text-white' : 'bg-slate-800 border-slate-600 text-slate-300'}">${label}</button>`).join('');
  const content = $('hall-content');
  content.setAttribute('role', 'tabpanel');
  content.setAttribute('aria-labelledby', 'hall-tab-' + tab);
  content.innerHTML = tab === 'champs' ? champsTab(list) : tab === 'clubs' ? clubsTab(list) : tab === 'records' ? recordsTab(list) : achTab();
  tabs.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => {
    b.onclick = () => { tab = b.dataset.tab as HallTab; renderHall(); $('hall-tab-' + tab).focus(); };
    b.onkeydown = e => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const i = TABS.findIndex(([k]) => k === tab);
      tab = e.key === 'Home' ? TABS[0][0] : e.key === 'End' ? TABS[TABS.length - 1][0] : TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
      renderHall();
      $('hall-tab-' + tab).focus();
    };
  });
  content.querySelectorAll<HTMLButtonElement>('[data-share]').forEach(b => {
    b.onclick = () => { const e = hof().list.find(x => x.id === b.dataset.share); if (e) copyText(e.share); };
  });
  content.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach(b => {
    b.onclick = () => { recDiff = b.dataset.diff as typeof recDiff; renderHall(); };
  });
  setHidden('btn-hall-clear', !list.length);
}

export function openHall(start: HallTab = 'champs'): void {
  tab = start;
  try {
    renderHall();
  } catch (e) {
    // dado estranho guardado: a janela abre mesmo assim, com o botão de apagar disponível
    console.error(e);
    $('hall-content').innerHTML = '<p class="text-center text-red-300 py-6">Não foi possível ler a galeria guardada neste navegador.</p>';
    showEl('btn-hall-clear');
  }
  showEl('modal-hall');
  $('modal-hall').scrollTop = 0;
}

export function initHall(onRematch: () => void): void {
  onMetaSaveFail(() => toast('Armazenamento indisponível: a galeria vale só nesta sessão', 4000));
  $('btn-hall-config').onclick = () => openHall();
  $('btn-view-hall').onclick = () => openHall();
  $('champ-btn-hall').onclick = () => openHall();
  $('btn-share').onclick = copyShare;
  $('champ-btn-share').onclick = copyShare;
  $('champ-btn-rematch').onclick = () => askConfirm('Revanche?', 'Um torneio novo com as mesmas regras e os mesmos clubes seus (os adversários e o sorteio são refeitos). O torneio atual já está na Galeria.', onRematch, 'Revanche');
  $('btn-hall-clear').onclick = () => askConfirm('Apagar a galeria?', 'Os campeões e recordes guardados neste navegador serão apagados. As conquistas continuam.', () => { clearHof(); renderHall(); }, 'Apagar');
  $('modal-hall').addEventListener('click', e => { if (e.target === $('modal-hall')) hideEl('modal-hall'); });
  registerDashboardExtra(renderDashSuper);
}
