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
