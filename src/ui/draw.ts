// Sorteio interativo do mata-mata
import { isUser, team } from '../engine/core';
import { finalizeDraw } from '../engine/tournament';
import { T, saveGame } from '../state/store';
import { openBracket } from './bracket';
import { setLogo } from './crest';
import { $, escapeHtml, hideEl, setHidden, shieldClicks, shielded, showEl } from './dom';
import { updateDashboard } from './dashboard';
import { emit } from './hooks';
import * as sfx from './sound';

let drawTimers: number[] = [];
let drawAnimating = false;

export function clearDrawTimers(): void {
  drawTimers.forEach(clearTimeout);
  drawTimers = [];
  drawAnimating = false;
}

function resetDrawUI(): void {
  ['draw-team-a', 'draw-team-b', 'draw-vs'].forEach(id => {
    $(id).classList.remove('draw-anim');
    $(id).style.opacity = '0';
  });
}

function renderDrawHistory(pairs: [string, string][]): void {
  const t = T();
  $('draw-history').innerHTML = pairs.map(([a, b]) => `
    <div class="bg-slate-800 p-2 rounded-lg border ${isUser(t, a) || isUser(t, b) ? 'border-emerald-500/60' : 'border-slate-700'} flex justify-between items-center text-xs gap-1">
      <span class="truncate w-2/5 text-right">${escapeHtml(team(t, a).name)}</span>
      <span class="text-slate-500 px-1">x</span>
      <span class="truncate w-2/5">${escapeHtml(team(t, b).name)}</span>
    </div>`).join('');
}

function updateDrawButtons(): void {
  const D = T().draw;
  const done = !D || D.revealed >= D.pairs.length;
  const wasFocused = document.activeElement;
  const hadFocus = ['btn-draw-next', 'btn-draw-all', 'btn-finish-draw', 'screen-draw'].some(id => wasFocused === $(id));
  setHidden('btn-draw-next', done);
  setHidden('btn-draw-all', done);
  setHidden('btn-finish-draw', !done);
  // aria-disabled (e não disabled): o botão não perde o foco durante a animação, então Enter repetido segue sorteando
  ['btn-draw-next', 'btn-draw-all'].forEach(id => {
    $(id).setAttribute('aria-disabled', String(drawAnimating));
    $(id).classList.toggle('opacity-50', drawAnimating);
  });
  if (hadFocus) $(done ? 'btn-finish-draw' : 'btn-draw-next').focus({ preventScroll: true });
  $('draw-progress').textContent = D ? `Confronto ${Math.min(D.revealed, D.pairs.length)} de ${D.pairs.length}` : 'Sorteio concluído';
}

function showSide(side: 'a' | 'b', id: string): void {
  const x = team(T(), id);
  setLogo($<HTMLImageElement>(`dt-logo-${side}`), x);
  $(`dt-name-${side}`).textContent = x.name;
}

function revealedOne(): void {
  const t = T();
  t.draw!.revealed++;
  const done = t.draw!.revealed >= t.draw!.pairs.length;
  if (done) finalizeDraw(t);
  saveGame();
  if (done) emit('drawFinalized');
}

export function openDraw(): void {
  const t = T();
  if (!t.draw || shielded()) return;
  clearDrawTimers();
  $('draw-title').textContent = t.draw.title;
  $('draw-subtitle').textContent = t.draw.note;
  resetDrawUI();
  renderDrawHistory(t.draw.pairs.slice(0, t.draw.revealed));
  updateDrawButtons(); // antes de mostrar: o foco inicial cai em "Sortear Confronto", não num botão que vai sumir
  hideEl('screen-dashboard');
  showEl('screen-draw');
  shieldClicks(450);
}

export function initDraw(): void {
  $('btn-draw').onclick = openDraw;

  $('btn-draw-next').onclick = () => {
    const D = T().draw;
    if (!D || drawAnimating || D.revealed >= D.pairs.length) return;
    drawAnimating = true;
    updateDrawButtons();
    resetDrawUI();
    const [a, b] = D.pairs[D.revealed];
    sfx.drumroll(300);
    drawTimers.push(window.setTimeout(() => { showSide('a', a); $('draw-team-a').classList.add('draw-anim'); sfx.drumroll(650); }, 300));
    drawTimers.push(window.setTimeout(() => { $('draw-vs').style.opacity = '1'; $('draw-vs').classList.add('draw-anim'); sfx.pop(); }, 1000));
    drawTimers.push(window.setTimeout(() => {
      sfx.pop();
      showSide('b', b);
      $('draw-team-b').classList.add('draw-anim');
      const pairs = D.pairs.slice(0, D.revealed + 1);
      revealedOne();
      drawAnimating = false;
      renderDrawHistory(pairs);
      updateDrawButtons();
      if (!T().draw) shieldClicks(); // "Ver Chaveamento Completo" aparece sob o cursor
    }, 1800));
  };

  $('btn-draw-all').onclick = () => {
    const D = T().draw;
    if (!D || D.revealed >= D.pairs.length) return;
    clearDrawTimers();
    const pairs = D.pairs;
    const [a, b] = pairs[pairs.length - 1];
    showSide('a', a);
    showSide('b', b);
    ['draw-team-a', 'draw-team-b', 'draw-vs'].forEach(id => {
      $(id).classList.remove('draw-anim');
      $(id).style.opacity = '1';
    });
    D.revealed = pairs.length - 1;
    revealedOne();
    renderDrawHistory(pairs);
    updateDrawButtons();
    shieldClicks();
  };

  $('btn-finish-draw').onclick = () => {
    if (shielded()) return;
    shieldClicks();
    clearDrawTimers();
    hideEl('screen-draw');
    showEl('screen-dashboard');
    updateDashboard();
    openBracket();
  };
}
