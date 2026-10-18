// Um único despachante de teclado. Ordem: confirmação → minigame → plantão → partida → fechar janelas.
import { $, hideEl, isShown } from './dom';
import { liveKey } from './live';
import { minigameActive, minigameKey } from './minigames';
import { toggleSound } from './settings';
import { skipTicker, tickerOpen } from './ticker';

/** Janelas fechadas pelo Esc, da que fica por cima para a de baixo */
const ESC_ORDER = ['modal-share', 'modal-report', 'modal-settings', 'modal-bracket', 'modal-stats', 'modal-odds', 'modal-hall',
  'modal-champion', 'modal-groups', 'modal-continent-dist'];
const BLOCKING = [...ESC_ORDER, 'modal-side', 'modal-round-results', 'modal-confirm'];

const anyModal = () => BLOCKING.some(id => { const el = document.getElementById(id); return !!el && isShown(el); });

function onKey(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = (e.target as HTMLElement | null)?.tagName;
  const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  if (typing && e.key !== 'Escape') return;

  if (isShown('modal-confirm')) {
    if (e.key === 'Escape') { e.preventDefault(); $('confirm-no').click(); }
    return;
  }
  if (minigameActive()) {
    if (minigameKey(e)) e.preventDefault();
    return;
  }
  if (tickerOpen()) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); skipTicker(); }
    return;
  }
  if (!anyModal() && !typing) {
    if (e.key.toLowerCase() === 'm' && !e.repeat) { e.preventDefault(); toggleSound(); return; }
    if (isShown('screen-match') && liveKey(e)) { e.preventDefault(); return; }
  }
  if (e.key === 'Escape') {
    for (const id of ESC_ORDER) {
      const el = document.getElementById(id);
      if (el && isShown(el)) { e.preventDefault(); hideEl(el); return; }
    }
    if (isShown('modal-round-results') && isShown('btn-close-results')) hideEl('modal-round-results');
  }
}

export function initKeys(): void {
  document.addEventListener('keydown', onKey);
}
