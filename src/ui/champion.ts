// Tela de campeão e estatísticas do torneio
import { isUser, team } from '../engine/core';
import { championPath, tournamentStats } from '../engine/stats';
import { rand } from '../engine/rng';
import type { TeamState } from '../engine/types';
import { T } from '../state/store';
import { openBracket } from './bracket';
import { logoImg, setLogo } from './crest';
import { $, escapeHtml, hideEl, pct, setHidden, showEl } from './dom';
import { campaignTiles, miniMatchRow } from './render';
import { openAllGroups } from './results';

function launchConfetti(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layer = $('confetti-layer');
  layer.innerHTML = '';
  const colors = ['#facc15', '#10b981', '#38bdf8', '#f472b6', '#f97316', '#ffffff'];
  for (let i = 0; i < 90; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = rand() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 2.5 + rand() * 2.5 + 's';
    c.style.animationDelay = rand() * 1.2 + 's';
    c.style.transform = `rotate(${rand() * 360}deg)`;
    layer.appendChild(c);
  }
  window.setTimeout(() => { layer.innerHTML = ''; }, 6500);
}

export function showChampion(celebrate: boolean): void {
  const t = T();
  if (!t.champion) return;
  const C = team(t, t.champion);
  setLogo($<HTMLImageElement>('champ-logo'), C);
  $('champ-name').textContent = C.name;
  $('champ-note').textContent = `${t.championNote ?? 'Campeão'}${t.runnerUp ? ` · Vice: ${team(t, t.runnerUp).name}` : ''}`;
  const userChamp = isUser(t, C.id);
  setHidden('champ-user-msg', !userChamp);
  $('champ-user-msg').textContent = userChamp ? '🎉 O título é seu! Que campanha!' : '';
  $('champ-campaign').innerHTML = campaignTiles(C.st);

  const path = championPath(t);
  $('champ-path').innerHTML = path.length
    ? path.map(m => `<div><p class="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">${escapeHtml(m.stage)}</p>${miniMatchRow(m)}</div>`).join('')
    : `<p class="text-slate-400 text-sm">${C.st.v} vitórias, ${C.st.e} empates e ${C.st.d} derrotas nos pontos corridos (${C.p} pontos).</p>`;

  $('champ-user-teams').innerHTML = t.userIds.map(id => {
    const x = team(t, id);
    const status = t.champion === id ? '🏆 Campeão' : x.out ?? '—';
    return `<div class="flex items-center gap-3 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2">${logoImg(x, 'w-6 h-6 object-contain')}<span class="font-bold">${escapeHtml(x.name)}</span><span class="ml-auto text-xs text-slate-400 text-right">${escapeHtml(status)} · ${x.st.v}V ${x.st.e}E ${x.st.d}D</span></div>`;
  }).join('');

  $('champ-btn-bracket').textContent = t.knockout.length || t.bracket ? 'Ver Chaveamento' : 'Ver Classificação';
  showEl('modal-champion');
  if (celebrate) launchConfetti();
}

export function openStats(): void {
  const t = T();
  const s = tournamentStats(t);
  const box = $('stats-content');
  if (!s.matches.length) { box.innerHTML = '<p class="text-center text-slate-400">Nenhuma partida disputada ainda.</p>'; showEl('modal-stats'); return; }
  const n = s.matches.length;
  const list = (title: string, arr: TeamState[], val: (x: TeamState) => string | number) =>
    `<div class="bg-slate-900/60 border border-slate-700 rounded-xl p-4"><h4 class="text-slate-400 font-bold uppercase tracking-wider text-xs mb-3">${title}</h4>${arr.map((x, i) =>
      `<div class="flex items-center gap-2 py-1 ${isUser(t, x.id) ? 'text-emerald-400 font-bold' : ''}"><span class="w-4 text-slate-500 text-xs tabular-nums">${i + 1}</span>${logoImg(x, 'w-5 h-5 object-contain')}<span class="truncate">${escapeHtml(x.name)}</span><span class="ml-auto font-black tabular-nums">${val(x)}</span></div>`).join('')}</div>`;
  const tile = (label: string, value: string | number) => `<div class="bg-slate-900/60 border border-slate-700 rounded-xl p-4 text-center"><div class="text-2xl md:text-3xl font-black text-white tabular-nums">${value}</div><div class="text-[11px] text-slate-400 font-bold uppercase tracking-wider mt-1">${label}</div></div>`;
  box.innerHTML = `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      ${tile('Jogos', n)}${tile('Gols', s.goals)}${tile('Média de gols', (s.goals / n).toFixed(2))}${tile('Decisões por pênaltis', s.pens)}
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      <div><p class="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Maior goleada · ${escapeHtml(s.biggest!.stage)}</p>${miniMatchRow(s.biggest!)}</div>
      <div><p class="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Jogo com mais gols · ${escapeHtml(s.wildest!.stage)}</p>${miniMatchRow(s.wildest!)}</div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      ${list('Melhores ataques (gols)', s.attack, x => x.st.gp)}
      ${list('Melhores defesas (gols sofridos/jogo)', s.defense, x => (x.st.gc / x.st.j).toFixed(2))}
      ${list('Mais vitórias', s.wins, x => x.st.v)}
    </div>
    <p class="text-xs text-slate-500 text-center mb-2">Vitórias do mandante/1º listado: ${pct(s.homeWins / n)} · empates no tempo normal/prorrogação: ${pct(s.draws / n)} · prorrogações: ${s.extraTimes}</p>
    ${s.upsets.length ? `<div class="mt-4"><h4 class="text-slate-400 font-bold uppercase tracking-wider text-xs mb-3">Zebras (vencedor com OVR 6+ abaixo)</h4><div class="flex flex-col gap-2">${s.upsets.slice(0, 5).map(m => miniMatchRow(m)).join('')}</div></div>` : ''}`;
  showEl('modal-stats');
}

export function initChampion(onNewTournament: () => void): void {
  $('btn-show-champion').onclick = () => showChampion(false);
  $('champ-btn-bracket').onclick = () => {
    const t = T();
    if (t.knockout.length || t.bracket) openBracket();
    else { hideEl('modal-champion'); openAllGroups(); }
  };
  $('champ-btn-stats').onclick = openStats;
  $('champ-btn-new').onclick = onNewTournament;
  $('btn-view-stats').onclick = openStats;
}
