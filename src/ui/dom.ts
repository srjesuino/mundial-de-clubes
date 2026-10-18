// Utilitários de DOM compartilhados pela interface

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento #${id} não encontrado`);
  return el as T;
};
const elOf = (el: string | HTMLElement): HTMLElement => (typeof el === 'string' ? $(el) : el);
/** Avisado (na hora) a cada troca de visibilidade: o gerenciador de camadas ajusta foco e inércia antes do próximo passo */
let onVisibility: ((el: HTMLElement) => void) | null = null;
export const setVisibilityHook = (fn: (el: HTMLElement) => void): void => { onVisibility = fn; };
export const setHidden = (el: string | HTMLElement, hidden: boolean): void => {
  const e = elOf(el);
  if (e.classList.contains('hidden') === hidden) return;
  e.classList.toggle('hidden', hidden);
  onVisibility?.(e);
};
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
// Mensagens do mesmo instante são juntadas numa fala só (nada se perde: placar final + consequência, gols de um "pular").
// Entre falas, 1,2 s; das mensagens comuns que chegam nesse intervalo, só a mais nova é dita. As urgentes nunca se perdem.
let srBusyUntil = 0;
let srTimer: number | undefined;
let srQueue: { text: string; urgent: boolean; tick: number }[] = [];
let srEnabled = (): boolean => true;
export const setSrEnabled = (fn: () => boolean): void => { srEnabled = fn; };
// "Instante": tudo o que roda na mesma tarefa (ex.: os gols de um "Pular para o Fim", o gol e o aviso de zebra)
let srTick = 0;
let srTickOpen = false;
function currentTick(): number {
  if (!srTickOpen) { srTickOpen = true; queueMicrotask(() => { srTick++; srTickOpen = false; }); }
  return srTick;
}

function srFlush(): void {
  srTimer = undefined;
  const el = document.getElementById('sr-live');
  if (!el || !srQueue.length) return;
  // urgentes sempre; das comuns, todas as do instante mais recente (as anteriores, ditas durante a pausa, saem)
  const normals = srQueue.filter(m => !m.urgent);
  const lastTick = normals.length ? normals[normals.length - 1].tick : -1;
  const parts = srQueue.filter(m => m.urgent || m.tick === lastTick).map(m => m.text);
  srQueue = [];
  el.textContent = '';
  // trocar o texto depois de limpar faz o leitor repetir frases iguais
  window.setTimeout(() => { el.textContent = parts.join(' · '); }, 30);
  srBusyUntil = performance.now() + 1200;
}

export function srSay(text: string, urgent = false): void {
  if (!srEnabled()) return;
  srQueue.push({ text, urgent, tick: currentTick() });
  if (srTimer !== undefined) {
    if (!urgent) return;
    clearTimeout(srTimer); // urgente: sai já, junto com o que chegou no mesmo instante
  }
  const wait = urgent ? 40 : Math.max(40, srBusyUntil - performance.now());
  srTimer = window.setTimeout(srFlush, wait);
}

/** Número no formato brasileiro (1.240 · 12,4) */
export const fmtBR = (x: number, digits = 0): string => x.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
