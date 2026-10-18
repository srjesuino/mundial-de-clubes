// Plantão da Rodada: replay do placar de todos os jogos. Os resultados já foram sorteados e salvos antes;
// o replay só mostra, minuto a minuto, o que aconteceu (minutos dos gols do próprio sorteio).
import { isUser, isUserMatch, team, winnerId, isDecided } from '../engine/core';
import { sortGroupIds } from '../engine/groups';
import type { PlayableMatch, Tournament } from '../engine/types';
import { motionOK } from '../state/prefs';
import { T } from '../state/store';
import { logoImg } from './crest';
import { $, escapeHtml, hideEl, isShown, showEl } from './dom';
import * as sfx from './sound';

interface Row {
  m: PlayableMatch;
  goals: [number, 0 | 1][];
  pk: { f: 'home' | 'away'; h: number[]; a: number[] } | null;
  hl: boolean;           // jogo do usuário ou do grupo do usuário
  static: boolean;       // sem minutos (save antigo / partida interrompida): placar final desde o início
  shown: number;         // gols já mostrados
  h: number;
  a: number;
  ph: number;            // pênaltis revelados
  lab: string;           // rótulo atual (FIM, PRORR....), para só mexer no DOM quando muda
  el: HTMLElement | null;
}

let run: { raf: number; done: () => void; rows: Row[]; finished: boolean; virt: number; last: number; fast: boolean; endAt: number | null; pkStart: number | null } | null = null;
let shieldUntil = 0;

const MAX_ROWS = () => (window.innerWidth < 640 ? 8 : 16);

export const tickerOpen = (): boolean => !!run && isShown('round-ticker');

function rowHtml(r: Row, t: Tournament): string {
  const H = team(t, r.m.home), A = team(t, r.m.away);
  return `<div data-mid="${r.m.id}" class="tk-row relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs sm:text-sm ${r.hl ? 'bg-emerald-900/25 border border-emerald-500/40' : 'bg-slate-900/60 border border-slate-700/50'}">
    <div class="flex items-center gap-1.5 justify-end flex-1 min-w-0"><span class="tk-name-h truncate">${escapeHtml(H.name)}</span>${logoImg(H, 'w-5 h-5 object-contain shrink-0')}</div>
    <div class="shrink-0 w-[4.5rem] text-center"><span class="tk-score font-black tabular-nums text-white">0 - 0</span><div class="tk-sub text-[9px] text-slate-500 leading-tight"></div></div>
    <div class="flex items-center gap-1.5 flex-1 min-w-0">${logoImg(A, 'w-5 h-5 object-contain shrink-0')}<span class="tk-name-a truncate">${escapeHtml(A.name)}</span></div>
    <span class="tk-chip-slot absolute -top-2.5 right-2"></span>
  </div>`;
}

// ---------- Classificação parcial (só fase de grupos) ----------
interface Line { id: string; p: number; gd: number; gf: number }
function contrib(gH: number, gA: number): [Line, Line] {
  const ph = gH > gA ? 3 : gH === gA ? 1 : 0, pa = gA > gH ? 3 : gH === gA ? 1 : 0;
  return [{ id: '', p: ph, gd: gH - gA, gf: gH }, { id: '', p: pa, gd: gA - gH, gf: gA }];
}

function partialTable(t: Tournament, g: string, rows: Row[], final: boolean): string {
  const official = sortGroupIds(t, g);
  const k = t.config.advancingPerGroup;
  let order: string[];
  const pre: Record<string, Line> = {};
  official.forEach(id => { const x = team(t, id); pre[id] = { id, p: x.p, gd: x.gd, gf: x.gf }; });
  const roundRows = rows.filter(r => r.m.kind === 'group' && team(t, r.m.home).group === g);
  // tira os jogos desta rodada para ter a tabela de antes
  roundRows.forEach(r => {
    const [ch, ca] = contrib(r.m.res!.gH, r.m.res!.gA);
    const H = pre[r.m.home], A = pre[r.m.away];
    H.p -= ch.p; H.gd -= ch.gd; H.gf -= ch.gf;
    A.p -= ca.p; A.gd -= ca.gd; A.gf -= ca.gf;
  });
  const sortBy = (cur: Record<string, Line>) => official.slice().sort((a, b) => cur[b].p - cur[a].p || cur[b].gd - cur[a].gd || cur[b].gf - cur[a].gf || official.indexOf(a) - official.indexOf(b));
  const preOrder = sortBy(pre);
  const cur: Record<string, Line> = {};
  official.forEach(id => { cur[id] = { ...pre[id] }; });
  if (final) order = official;
  else {
    roundRows.forEach(r => {
      const [ch, ca] = contrib(r.h, r.a);
      cur[r.m.home].p += ch.p; cur[r.m.home].gd += ch.gd; cur[r.m.home].gf += ch.gf;
      cur[r.m.away].p += ca.p; cur[r.m.away].gd += ca.gd; cur[r.m.away].gf += ca.gf;
    });
    order = sortBy(cur);
  }
  const vals = final ? Object.fromEntries(official.map(id => { const x = team(t, id); return [id, { id, p: x.p, gd: x.gd, gf: x.gf }]; })) : cur;
  const body = order.map((id, i) => {
    const x = team(t, id);
    const move = preOrder.indexOf(id) - i;
    const arrow = move > 0 ? '<span class="text-emerald-400">▲</span>' : move < 0 ? '<span class="text-red-400">▼</span>' : '<span class="text-slate-600">·</span>';
    const v = vals[id];
    return `<tr data-id="${id}" class="${i === k - 1 ? 'border-b-2 border-emerald-500/60' : 'border-b border-slate-700/30'} ${isUser(t, id) ? 'text-emerald-300 font-bold' : ''}">
      <td class="py-1 pr-1 w-4 text-slate-500 tabular-nums">${i + 1}</td><td class="py-1 w-3">${arrow}</td>
      <td class="py-1 truncate max-w-[9rem]">${escapeHtml(x.name)}</td>
      <td class="py-1 text-center tabular-nums font-bold">${v.p}</td><td class="py-1 text-center tabular-nums text-slate-400">${v.gd > 0 ? '+' + v.gd : v.gd}</td><td class="py-1 text-center tabular-nums text-slate-400">${v.gf}</td></tr>`;
  }).join('');
  return `<div class="bg-slate-900/60 border border-slate-700 rounded-xl p-3" data-group="${g}">
    <p class="text-[10px] uppercase tracking-widest font-bold ${final ? 'text-emerald-400' : 'text-slate-500'} mb-1">Grupo ${g} · ${final ? 'classificação oficial' : 'classificação parcial (pontos, saldo, gols)'}</p>
    <table class="w-full text-xs table-fixed"><thead><tr class="text-slate-500"><th class="w-4"></th><th class="w-3"></th><th class="text-left">Clube</th><th class="w-9">PTS</th><th class="w-9">SG</th><th class="w-9">GP</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Reordena com animação FLIP (só com animações ligadas) */
function renderTables(t: Tournament, rows: Row[], final: boolean): void {
  if (t.phase !== 'GROUP' && !rows.some(r => r.m.kind === 'group')) return;
  const box = $('tk-tables');
  const groups = [...new Set(t.userIds.map(id => team(t, id).group).filter((g): g is string => !!g && !!t.groups[g]))].slice(0, 2)
    .filter(g => rows.some(r => r.m.kind === 'group' && team(t, r.m.home).group === g));
  if (!groups.length) return;
  const before = new Map<string, number>();
  if (motionOK()) box.querySelectorAll<HTMLElement>('tr[data-id]').forEach(tr => before.set(tr.dataset.id!, tr.getBoundingClientRect().top));
  box.innerHTML = groups.map(g => partialTable(t, g, rows, final)).join('');
  if (!before.size) return;
  box.querySelectorAll<HTMLElement>('tr[data-id]').forEach(tr => {
    const old = before.get(tr.dataset.id!);
    if (old === undefined) return;
    const dy = old - tr.getBoundingClientRect().top;
    if (!dy) return;
    tr.style.transform = `translateY(${dy}px)`;
    tr.style.transition = 'none';
    requestAnimationFrame(() => { tr.style.transition = 'transform 300ms ease'; tr.style.transform = ''; });
  });
}

function setScore(r: Row, label?: string): void {
  if (!r.el) return;
  r.el.querySelector('.tk-score')!.textContent = `${r.h} - ${r.a}`;
  if (label !== undefined) r.el.querySelector('.tk-sub')!.textContent = label;
}

function flashGoal(r: Row, min: number): void {
  if (!r.el) return;
  const slot = r.el.querySelector('.tk-chip-slot')!;
  slot.innerHTML = `<span class="tk-chip bg-emerald-600 text-white text-[10px] font-black rounded px-1.5 py-0.5 whitespace-nowrap">⚽ ${min}'</span>`;
  window.setTimeout(() => { if (slot.firstChild) slot.innerHTML = ''; }, 1500);
  if (r.hl) {
    r.el.classList.remove('tk-flash'); void r.el.offsetWidth; r.el.classList.add('tk-flash');
    sfx.pop();
  }
}

function finalLabel(r: Row): string {
  const res = r.m.res!;
  if (res.penH !== null && res.penH !== undefined) return `pên. ${res.penH}-${res.penA}`;
  if (res.et) return 'PRORR. · FIM';
  return 'FIM';
}

function swissOrKoBadges(t: Tournament, rows: Row[]): void {
  rows.forEach(r => {
    if (!r.el || r.m.kind === 'group') return;
    if (!isDecided(r.m)) return;
    const w = winnerId(r.m);
    const sub = r.el.querySelector('.tk-sub')!;
    if (r.m.kind === 'swiss') {
      const W = team(t, w), Lo = team(t, w === r.m.home ? r.m.away : r.m.home);
      const tag = (x: typeof W) => (x.status === 'advanced' ? `✅ ${x.sw}-${x.sl}` : x.status === 'eliminated' ? `❌ ${x.sw}-${x.sl}` : `${x.sw}-${x.sl}`);
      sub.textContent = `${finalLabel(r)} · ${tag(w === r.m.home ? W : Lo)} | ${tag(w === r.m.home ? Lo : W)}`;
    } else {
      // o vencedor fica destacado no próprio nome (o primeiro nome sozinho pode ser ambíguo: Manchester, Atlético...)
      sub.textContent = finalLabel(r);
      const el = r.el.querySelector(w === r.m.home ? '.tk-name-h' : '.tk-name-a');
      el?.classList.add('text-emerald-400', 'font-bold');
      el?.setAttribute('aria-label', `${team(t, w).name}, avança`);
    }
  });
}

function minuteLabel(r: Row, minute: number): string {
  const et = r.m.res!.et;
  if (!et) return minute >= 90 ? 'FIM' : '';
  if (minute >= 120) return r.pk ? 'PRORR.' : 'PRORR. · FIM';
  return minute > 90 ? 'PRORR.' : '';
}

function frame(now: number): void {
  if (!run) return;
  const R = run;
  const t = T();
  const dt = Math.min(100, now - R.last);
  R.last = now;
  const total = R.rows.some(r => r.el && r.m.res?.et && !r.static) ? 120 : 90;
  if (R.virt < total) {
    const prevMinute = Math.floor(R.virt);
    R.virt = Math.min(total, R.virt + (dt / 1000) * (R.fast ? 26 : 13));
    const minute = Math.floor(R.virt);
    if (minute !== prevMinute) {
      $('tk-clock').textContent = `${minute}'`;
      let anyGoal = false;
      R.rows.forEach(r => {
        if (r.static) return;
        let changed = false;
        while (r.shown < r.goals.length && r.goals[r.shown][0] <= minute) {
          const [gmin, side] = r.goals[r.shown++];
          if (side === 0) r.h++; else r.a++;
          changed = true;
          flashGoal(r, gmin);
        }
        const lab = minuteLabel(r, minute);
        if (changed || lab !== r.lab) { r.lab = lab; setScore(r, lab); }
        anyGoal ||= changed;
      });
      if (anyGoal) renderTables(t, R.rows, false);
    }
  } else if (R.rows.some(r => r.el && r.pk && r.ph < r.pk.h.length + r.pk.a.length)) {
    // pênaltis: uma cobrança a cada 250 ms (alternadas a partir de quem começou)
    if (R.pkStart === null) { R.pkStart = now; $('tk-clock').textContent = 'PÊN'; }
    const due = Math.floor((now - R.pkStart) / (R.fast ? 125 : 250));
    R.rows.forEach(r => {
      if (!r.pk || !r.el) return;
      const n = Math.min(due, r.pk.h.length + r.pk.a.length);
      if (n === r.ph) return;
      r.ph = n;
      const first = r.pk.f === 'home' ? r.pk.h : r.pk.a, second = r.pk.f === 'home' ? r.pk.a : r.pk.h;
      const seq: string[] = [];
      for (let i = 0; i < n; i++) seq.push((i % 2 === 0 ? first[i >> 1] : second[i >> 1]) ? '●' : '○');
      setScore(r, 'pên. ' + seq.join(''));
    });
  } else {
    R.endAt ??= now + 600;
    if (now >= R.endAt) { finish(); return; }
  }
  R.raf = requestAnimationFrame(frame);
}

function finish(): void {
  if (!run || run.finished) return;
  const R = run;
  R.finished = true;
  cancelAnimationFrame(R.raf);
  const t = T();
  // fotografia final: placares, pênaltis e a classificação oficial (com confronto direto)
  R.rows.forEach(r => { r.h = r.m.res!.gH; r.a = r.m.res!.gA; setScore(r, finalLabel(r)); });
  swissOrKoBadges(t, R.rows);
  renderTables(t, R.rows, true);
  $('tk-clock').textContent = 'FIM';
  const done = R.done;
  run = null;
  window.setTimeout(() => { hideEl('round-ticker'); done(); }, 350);
}

export function skipTicker(): void {
  if (!run || performance.now() < shieldUntil) return;
  finish();
}

/** Mostra o plantão e chama onDone ao terminar (ou ao pular) */
export function playRoundTicker(ms: PlayableMatch[], title: string, onDone: () => void): void {
  const t = T();
  const userGroups = new Set(t.userIds.map(id => team(t, id).group).filter(Boolean));
  const rank = (m: PlayableMatch) => (isUserMatch(t, m) ? 0 : m.kind === 'group' && userGroups.has(team(t, m.home).group) ? 1 : 2);
  // Todos os jogos entram na conta (classificação parcial); só os primeiros aparecem na lista
  const all = ms.filter(m => m.played && m.res).slice().sort((a, b) => rank(a) - rank(b));
  const visible = (all.length > 40 ? all.filter(m => rank(m) < 2) : all).slice(0, MAX_ROWS());
  const hidden = ms.length - visible.length;
  const rows: Row[] = all.map(m => {
    const res = m.res!;
    return {
      m, goals: res.gm ? [...res.gm].sort((a, b) => a[0] - b[0]) : [], pk: res.pk ?? null, hl: rank(m) < 2,
      static: !res.gm, shown: 0, h: 0, a: 0, ph: 0, lab: '', el: null
    };
  });
  const shownRows = visible.map(m => rows.find(r => r.m === m)!);
  $('tk-title').textContent = title;
  $('tk-clock').textContent = "0'";
  $('tk-list').innerHTML = shownRows.map(r => rowHtml(r, t)).join('');
  shownRows.forEach(r => { r.el = $('tk-list').querySelector<HTMLElement>(`[data-mid="${r.m.id}"]`); });
  rows.forEach(r => { if (r.static) { r.h = r.m.res!.gH; r.a = r.m.res!.gA; setScore(r, 'encerrado'); } });
  const more = $('tk-more');
  more.textContent = hidden > 0 ? `+${hidden} jogos (todos aparecem nos resultados)` : '';
  more.classList.toggle('hidden', hidden <= 0);
  $('tk-tables').innerHTML = '';
  const fastBtn = $('tk-fast');
  fastBtn.setAttribute('aria-pressed', 'false');
  run = { raf: 0, done: onDone, rows, finished: false, virt: 0, last: performance.now(), fast: false, endAt: null, pkStart: null };
  renderTables(t, rows, false);
  showEl('round-ticker');
  $('round-ticker').scrollTop = 0;
  shieldUntil = performance.now() + 350; // o toque que abriu o plantão não pode pulá-lo
  $('tk-skip').focus({ preventScroll: true });
  run.raf = requestAnimationFrame(frame);
}

export function initTicker(): void {
  $('tk-skip').onclick = skipTicker;
  $('tk-fast').onclick = () => {
    if (!run) return;
    run.fast = !run.fast;
    $('tk-fast').setAttribute('aria-pressed', String(run.fast));
    $('tk-fast').classList.toggle('bg-emerald-700', run.fast);
  };
}
