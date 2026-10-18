// Relatório de uma partida disputada: placar, gols por minuto, pênaltis, chances antes do jogo e a curva de chance.
// Tudo sai do resultado guardado e das mesmas fórmulas do simulador.
import { effectiveTactics, isPlayable, isUser, oddsFor, simContext, team, winnerId, isDecided } from '../engine/core';
import { DIFF } from '../engine/live';
import { superPoints, achievedChance } from '../engine/meta';
import { TACTIC_LABEL, hasPens, mostLikelyScore, scoreProb } from '../engine/model';
import { allMatches } from '../engine/tournament';
import type { Side, Tactic } from '../engine/types';
import { store } from '../state/store';
import { logoImg } from './crest';
import { $, escapeHtml, fmtBR, showEl } from './dom';
import { marksHtml, seriesFromGoals, vizSvg } from './liveviz';
import { extraText } from './render';

const pc = (x: number) => fmtBR(Math.round(x * 1000) / 10, 1) + '%';

export function openReport(id: string): void {
  const t = store.t;
  if (!t) return;
  const m = allMatches(t).find(x => x.id === id);
  if (!m || !m.played || !m.res || !isPlayable(m)) return;
  const r = m.res;
  const H = team(t, m.home), A = team(t, m.away);
  const side: Side = isUser(t, m.away) && !isUser(t, m.home) ? 'away' : 'home';
  // "Antes do jogo": a postura do pontapé inicial (num jogo ao vivo ela pode ter mudado depois)
  const tac0 = m.tac0 ?? effectiveTactics(t, m);
  const ctx = simContext(t, m, tac0);
  const o = oddsFor(t, m, tac0);
  const ctxFinal = simContext(t, m);
  const w = isDecided(m) ? winnerId(m) : null;
  const ex = extraText(m);

  // Placar do tempo normal: separado pelos minutos dos gols quando houve prorrogação
  const reg = r.gm ? { h: r.gm.filter(g => g[0] <= 90 && g[1] === 0).length, a: r.gm.filter(g => g[0] <= 90 && g[1] === 1).length } : r.et ? null : { h: r.gH, a: r.gA };
  const ml = mostLikelyScore(ctx.xh, ctx.xa);

  const head = `<p class="text-[10px] uppercase tracking-widest text-slate-500 font-bold text-center px-10">${escapeHtml(m.stage)}</p>
    <div class="flex items-center justify-between gap-2 mt-3">
      <div class="flex flex-col items-center flex-1 min-w-0">${logoImg(H, 'tm-logo')}<span class="text-sm font-bold text-center truncate w-full ${w === m.home ? 'text-emerald-400' : ''}">${escapeHtml(H.name)}</span><span class="text-[10px] text-slate-500">OVR ${H.ovr}</span></div>
      <div class="text-center shrink-0"><div class="text-3xl font-black tabular-nums">${r.gH} - ${r.gA}</div>${ex ? `<div class="text-[11px] text-amber-300 font-bold">${ex}</div>` : ''}</div>
      <div class="flex flex-col items-center flex-1 min-w-0">${logoImg(A, 'tm-logo')}<span class="text-sm font-bold text-center truncate w-full ${w === m.away ? 'text-emerald-400' : ''}">${escapeHtml(A.name)}</span><span class="text-[10px] text-slate-500">OVR ${A.ovr}</span></div>
    </div>
    <p class="text-center text-[11px] text-slate-400 mt-1">${r.live ? `🎮 Jogada ao vivo · minigames no nível ${DIFF[r.live.d]?.label ?? 'Normal'}${r.live.sk ? ' · usou Pular para o Fim' : ''}${r.live.sp ? ' · pênaltis simulados' : ''}` : 'Simulada pelo motor'}</p>`;

  // Linha do tempo
  let timeline = '';
  if (r.gm && r.gm.length) {
    let h = 0, a = 0;
    timeline = r.gm.slice().sort((x, y) => x[0] - y[0]).map(([min, s]) => {
      if (s === 0) h++; else a++;
      return `<li class="flex items-center gap-2"><span class="w-9 text-right tabular-nums text-slate-400">${min}'</span>⚽ <span class="truncate">${escapeHtml((s === 0 ? H : A).name)}</span><span class="ml-auto tabular-nums text-slate-400">${h}-${a}</span></li>`;
    }).join('');
    timeline = `<ul class="flex flex-col gap-1 text-sm">${timeline}</ul>`;
  } else if (r.gH + r.gA === 0) timeline = '<p class="text-sm text-slate-400">Sem gols.</p>';
  else timeline = '<p class="text-xs text-slate-500">Minutos dos gols não registrados (partida concluída pelo simulador após uma interrupção, ou de um save antigo).</p>';

  let pens = '';
  if (hasPens(r)) {
    if (r.pk) {
      const first = r.pk.f === 'home' ? H : A;
      const row = (arr: number[], x: typeof H) => `<div class="flex items-center gap-2"><span class="w-28 truncate text-right text-xs">${escapeHtml(x.name)}</span><span class="flex gap-1">${arr.map(k => `<span class="pen-dot ${k ? 'bg-emerald-500 border-emerald-300' : 'bg-red-600 border-red-300'}">${k ? '✓' : '✗'}</span>`).join('')}</span></div>`;
      pens = `<div class="mt-2"><p class="text-xs text-slate-400 mb-1">Pênaltis ${r.penH}-${r.penA} · ${escapeHtml(first.name)} começou batendo</p>${row(r.pk.h, H)}${row(r.pk.a, A)}</div>`;
    } else pens = `<p class="text-xs text-slate-400 mt-2">Pênaltis: ${r.penH}-${r.penA}</p>`;
  }

  // Curva de chance (do ponto de vista do clube do usuário, ou do mandante)
  let chart = '';
  if (r.gm) {
    const series = seriesFromGoals(ctxFinal, m.kind, side, r.gm, r.et);
    const total = r.et ? 120 : 90;
    chart = `<div class="mt-3"><p class="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Chance de ${m.kind === 'group' ? 'vitória' : m.kind === 'ko' ? 'avançar' : 'vencer'} de ${escapeHtml(team(t, m[side]).name)}, minuto a minuto</p>
      <div class="relative"><svg viewBox="0 0 120 40" preserveAspectRatio="none" class="block w-full h-14 rounded bg-slate-900/70" role="img" aria-label="Curva de chance ao longo do jogo">${vizSvg(series, total)}</svg><div class="absolute inset-0" aria-hidden="true">${marksHtml(r.gm, [], side === 'home', total, false)}</div></div>
      <p class="text-[10px] text-slate-500 mt-0.5">Pelo placar e pelo tempo restante, com a postura final do jogo (o mesmo cálculo da partida ao vivo).</p></div>`;
  }

  const tacText = (x: Partial<Record<Side, Tactic>> | undefined) =>
    (['home', 'away'] as const).filter(sd => x?.[sd] && x[sd] !== 'bal').map(sd => `${escapeHtml(team(t, m[sd]).name)} ${TACTIC_LABEL[x![sd]!]}`).join(' · ') || 'Equilibrado';
  const finalTac = effectiveTactics(t, m);
  const changed = (['home', 'away'] as const).some(sd => (tac0[sd] ?? 'bal') !== (finalTac[sd] ?? 'bal'));
  // jogo ao vivo gravado antes de a postura inicial ser registrada: não dá para afirmar qual era
  const tacKnown = m.tac0 !== undefined || !r.live;
  const tac = tacKnown
    ? `<p>Postura no início: ${tacText(tac0)}${changed ? ` · postura final: ${tacText(finalTac)}` : ''}</p>`
    : `<p>Postura: ${tacText(finalTac)} (a do início do jogo não foi registrada; as chances acima usam esta)</p>`;
  const before = o.advH !== undefined
    ? `${escapeHtml(H.name)} ${pc(o.advH)} · ${escapeHtml(A.name)} ${pc(1 - o.advH)} (${m.kind === 'ko' ? 'avançar' : 'vencer'})`
    : `${escapeHtml(H.name)} ${pc(o.ph)} · empate ${pc(o.pd)} · ${escapeHtml(A.name)} ${pc(o.pa)}`;
  const regP = reg ? `<p>Placar do tempo normal (${reg.h}-${reg.a}): ${pc(scoreProb(ctx.xh, ctx.xa, reg.h, reg.a))} de chance · o mais provável era ${ml.h}-${ml.a} (${pc(ml.p)})</p>` : '';
  const users = (['home', 'away'] as const).filter(s => isUser(t, m[s]));
  const sup = users.map(s => {
    const id = m[s];
    const p = achievedChance(t, m, id);
    return p === null ? '' : `<p class="text-amber-300">Superação ${escapeHtml(team(t, id).name)}: +${superPoints(t, m, id)} (a chance de ir tão bem, sem contar a postura, era ${pc(p)})</p>`;
  }).join('');
  const lv = r.live;
  const mine = lv ? [lv.at && lv.at[0] ? `finalizações ${lv.at[1]}/${lv.at[0]}` : '', lv.df && lv.df[0] ? `defesas ${lv.df[0] - lv.df[1]}/${lv.df[0]}` : '', lv.ps[0] ? `pênaltis ${lv.ps[1]}/${lv.ps[0]}` : '', lv.pd[0] ? `pênaltis pegos ${lv.pd[1]}/${lv.pd[0]}` : ''].filter(Boolean).join(' · ') : '';
  const pre = `<div class="mt-4 bg-slate-900/60 border border-slate-700 rounded-xl p-3 text-xs text-slate-300 flex flex-col gap-1">
    <p class="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Antes do jogo, pelo simulador</p>
    <p>${before}</p>
    <p>Gols esperados: ${fmtBR(ctx.xh, 2)} x ${fmtBR(ctx.xa, 2)}</p>${tac}${regP}${sup}${mine ? `<p>Seus lances: ${mine}</p>` : ''}</div>`;

  $('report-content').innerHTML = head + `<div class="mt-4">${timeline}${pens}</div>` + chart + pre;
  showEl('modal-report');
  $('modal-report').scrollTop = 0;
}

export function initReport(): void {
  document.addEventListener('click', e => {
    const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-report]');
    if (!el) return;
    openReport(el.dataset.report!);
  });
}
