// Utilitários de DOM compartilhados pela interface

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento #${id} não encontrado`);
  return el as T;
};
const elOf = (el: string | HTMLElement): HTMLElement => (typeof el === 'string' ? $(el) : el);
export const setHidden = (el: string | HTMLElement, hidden: boolean): void => { elOf(el).classList.toggle('hidden', hidden); };
export const showEl = (el: string | HTMLElement): void => setHidden(el, false);
export const hideEl = (el: string | HTMLElement): void => setHidden(el, true);
export const isShown = (el: string | HTMLElement): boolean => !elOf(el).classList.contains('hidden');

export const pct = (x: number): string => Math.round(x * 100) + '%';
export const normalizeText = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function escapeHtml(s: unknown): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// ---------- Proteção contra duplo clique ----------
// Um clique que chega logo após uma troca de tela cai no botão que acabou de aparecer: descarta.
let clickShieldUntil = 0;
export const shieldClicks = (ms = 450): void => { clickShieldUntil = performance.now() + ms; };
export const shielded = (): boolean => performance.now() < clickShieldUntil;

export function installClickShield(): void {
  document.addEventListener('click', e => {
    if (!shielded()) return;
    const b = (e.target as HTMLElement | null)?.closest?.('button');
    // fechar um modal nunca é perigoso; os minigames têm a própria trava
    if (b && !b.closest('#minigame-overlay') && !b.hasAttribute('data-close') && b.id !== 'btn-close-results') {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);
}

// ---------- Avisos e confirmações (o app não usa alert/confirm) ----------
let toastTimer: number | undefined;
export function toast(msg: string, ms = 2600): void {
  const el = $('toast');
  el.textContent = msg;
  showEl(el);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => hideEl(el), ms);
}

export function askConfirm(title: string, text: string, onYes: () => void, yesLabel = 'Confirmar', onNo: (() => void) | null = null): void {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-yes').textContent = yesLabel;
  showEl('modal-confirm');
  shieldClicks(500); // um toque duplo no botão que abriu a pergunta não pode confirmá-la
  $('confirm-no').onclick = () => { hideEl('modal-confirm'); onNo?.(); };
  $('confirm-yes').onclick = () => { hideEl('modal-confirm'); onYes(); };
}

// ---------- Narração para leitor de tela ----------
// No máximo uma fala a cada 1,2 s; se chegar outra no meio, fica só a mais nova (urgente fala na hora).
let srBusyUntil = 0;
let srQueued: string | null = null;
let srTimer: number | undefined;
let srEnabled = (): boolean => true;
export const setSrEnabled = (fn: () => boolean): void => { srEnabled = fn; };

function srFlush(text: string): void {
  const el = document.getElementById('sr-live');
  if (!el) return;
  el.textContent = '';
  // trocar o texto depois de limpar faz o leitor repetir frases iguais
  window.setTimeout(() => { el.textContent = text; }, 30);
  srBusyUntil = performance.now() + 1200;
}

export function srSay(text: string, urgent = false): void {
  if (!srEnabled()) return;
  const now = performance.now();
  if (urgent || now >= srBusyUntil) {
    srQueued = null;
    clearTimeout(srTimer);
    srFlush(text);
    return;
  }
  srQueued = text;
  clearTimeout(srTimer);
  srTimer = window.setTimeout(() => { if (srQueued) { const q = srQueued; srQueued = null; srFlush(q); } }, srBusyUntil - now);
}

/** Número no formato brasileiro (1.240 · 12,4) */
export const fmtBR = (x: number, digits = 0): string => x.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
