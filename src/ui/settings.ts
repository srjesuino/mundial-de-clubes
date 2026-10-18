// Preferências (som, vibração, animações, plantão, velocidade, narração, dificuldade) e botões de som
import { DIFF, DIFF_ORDER } from '../engine/live';
import type { Difficulty } from '../engine/types';
import { motionOK, prefs, setPref, onPrefsChange, type MotionPref } from '../state/prefs';
import { saveGame, store } from '../state/store';
import { $, escapeHtml, hideEl, isShown, setSrEnabled, showEl } from './dom';
import { holdLive, liveRunning } from './live';
import * as sfx from './sound';

let heldLive = false;

export function applyPrefs(): void {
  document.documentElement.dataset.motion = motionOK() ? 'full' : 'reduced';
  ['btn-sound', 'btn-live-sound'].forEach(id => {
    const b = document.getElementById(id);
    if (!b) return;
    b.textContent = prefs.sound ? '🔊' : '🔇';
    b.setAttribute('aria-pressed', String(prefs.sound));
    b.setAttribute('aria-label', prefs.sound ? 'Som ligado' : 'Som desligado');
  });
  sfx.setVolume(prefs.vol);
}

export function toggleSound(): void {
  setPref('sound', !prefs.sound);
  sfx.onSoundToggled();
  if (prefs.sound) {
    sfx.ensureAudio();
    if (liveRunning()) sfx.crowdBed();
  }
}

const toggle = (key: 'sound' | 'haptics' | 'ticker' | 'sr', label: string, hint = '') => `
  <div class="flex items-center justify-between gap-3 bg-slate-900/60 border border-slate-700 rounded-xl px-3 py-2 min-h-[44px]">
    <div><p class="font-bold text-sm">${label}</p>${hint ? `<p class="text-[11px] text-slate-500">${hint}</p>` : ''}</div>
    <button type="button" data-toggle="${key}" aria-pressed="${prefs[key]}" aria-label="${label}"
      class="shrink-0 min-h-[44px] min-w-[64px] rounded-full font-black text-xs border ${prefs[key] ? 'bg-emerald-600 border-emerald-300 text-white' : 'bg-slate-800 border-slate-600 text-slate-400'}">${prefs[key] ? 'Ligado' : 'Desligado'}</button>
  </div>`;

const segmented = (name: string, label: string, opts: [string, string][], cur: string, hint = '') => `
  <div class="bg-slate-900/60 border border-slate-700 rounded-xl px-3 py-2">
    <p class="font-bold text-sm mb-1">${label}</p>${hint ? `<p class="text-[11px] text-slate-500 mb-1">${hint}</p>` : ''}
    <div class="grid gap-1" style="grid-template-columns:repeat(${opts.length},minmax(0,1fr))" role="group" aria-label="${label}">${opts.map(([v, l]) =>
      `<button type="button" data-seg="${name}" data-v="${v}" aria-pressed="${v === cur}" class="min-h-[44px] rounded-lg text-xs font-bold border ${v === cur ? 'bg-emerald-600 border-emerald-300 text-white' : 'bg-slate-800 border-slate-600 text-slate-300'}">${l}</button>`).join('')}</div>
  </div>`;

/** Recria as linhas sem perder o lugar de quem navega pelo teclado */
function renderSettings(): void {
  const a = document.activeElement as HTMLElement | null;
  const keep = a?.closest('#settings-rows') ? (a.dataset.toggle ? `[data-toggle="${a.dataset.toggle}"]` : a.dataset.seg ? `[data-seg="${a.dataset.seg}"][data-v="${a.dataset.v}"]` : a.id ? '#' + a.id : null) : null;
  drawSettings();
  if (keep) $('settings-rows').querySelector<HTMLElement>(keep)?.focus({ preventScroll: true });
}

function drawSettings(): void {
  const t = store.t;
  const locked = liveRunning();
  const diff = t ? `
    <div class="bg-slate-900/60 border border-slate-700 rounded-xl px-3 py-2">
      <label for="set-difficulty" class="font-bold text-sm">Dificuldade dos minigames (este torneio)</label>
      <select id="set-difficulty" ${locked ? 'disabled' : ''} class="mt-1 w-full p-2 min-h-[44px] bg-slate-900 border border-slate-700 rounded-lg text-white font-bold disabled:opacity-50">
        ${DIFF_ORDER.map(d => `<option value="${d}" ${(t.config.difficulty ?? 'normal') === d ? 'selected' : ''}>${escapeHtml(DIFF[d].label)}</option>`).join('')}
      </select>
      <p class="text-[11px] text-slate-500 mt-1">${locked ? 'Não dá para trocar no meio de uma partida.' : 'Só muda os minigames das partidas ao vivo. Simular e as probabilidades continuam iguais. Recordes e conquistas registram o nível mais fácil usado.'}</p>
    </div>` : '';
  $('settings-rows').innerHTML = toggle('sound', 'Som', 'Apito, torcida e lances, gerados no próprio aparelho')
    + `<div class="bg-slate-900/60 border border-slate-700 rounded-xl px-3 py-2"><label for="set-vol" class="font-bold text-sm">Volume</label>
        <input id="set-vol" type="range" min="0" max="100" value="${Math.round(prefs.vol * 100)}" class="w-full mt-1 accent-emerald-500 min-h-[44px]"></div>`
    + toggle('haptics', 'Vibração', 'Nos gols e defesas, em celulares compatíveis')
    + segmented('motion', 'Animações', [['auto', 'Auto'], ['reduced', 'Reduzidas'], ['full', 'Completas']], prefs.motion, 'Auto segue a configuração do aparelho')
    + toggle('ticker', 'Plantão da rodada', 'Mostra o placar de todos os jogos minuto a minuto antes dos resultados')
    + segmented('speed', 'Velocidade padrão da partida', [['1', '1x'], ['2', '2x'], ['4', '4x']], String(prefs.speed))
    + toggle('sr', 'Narração para leitor de tela', 'Gols e marcos do jogo anunciados em voz')
    + diff;
  const rows = $('settings-rows');
  rows.querySelectorAll<HTMLButtonElement>('[data-toggle]').forEach(b => {
    b.onclick = () => {
      const k = b.dataset.toggle as 'sound' | 'haptics' | 'ticker' | 'sr';
      if (k === 'sound') toggleSound(); else setPref(k, !prefs[k]);
      renderSettings();
    };
  });
  rows.querySelectorAll<HTMLButtonElement>('[data-seg]').forEach(b => {
    b.onclick = () => {
      if (b.dataset.seg === 'motion') setPref('motion', b.dataset.v as MotionPref);
      else setPref('speed', Number(b.dataset.v) as 1 | 2 | 4);
      renderSettings();
    };
  });
  const vol = $<HTMLInputElement>('set-vol');
  vol.oninput = () => { prefs.vol = Number(vol.value) / 100; sfx.setVolume(prefs.vol); };
  vol.onchange = () => setPref('vol', Number(vol.value) / 100);
  const sel = document.getElementById('set-difficulty') as HTMLSelectElement | null;
  if (sel) sel.onchange = () => {
    if (!store.t || liveRunning()) return;
    store.t.config.difficulty = sel.value as Difficulty;
    saveGame();
  };
}

export function openSettings(fromLive = false): void {
  renderSettings();
  if (fromLive && liveRunning()) { holdLive(true); heldLive = true; }
  showEl('modal-settings');
  $('modal-settings').scrollTop = 0;
}

export function initSettings(): void {
  setSrEnabled(() => prefs.sr);
  onPrefsChange(applyPrefs);
  applyPrefs();
  try {
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', applyPrefs);
  } catch { /* navegador antigo */ }
  $('btn-settings').onclick = () => openSettings(false);
  $('btn-live-settings').onclick = () => openSettings(true);
  $('btn-sound').onclick = toggleSound;
  $('btn-live-sound').onclick = toggleSound;
  // ao fechar (X, Esc ou clique fora), o relógio da partida volta a correr
  new MutationObserver(() => {
    if (!isShown('modal-settings') && heldLive) { heldLive = false; holdLive(false); }
  }).observe($('modal-settings'), { attributes: true, attributeFilter: ['class'] });
  $('modal-settings').addEventListener('click', e => { if (e.target === $('modal-settings')) hideEl('modal-settings'); });
}
