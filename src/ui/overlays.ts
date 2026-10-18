// Camadas de tela cheia (partida, sorteio, plantão, janelas): a de cima recebe o foco e o resto da página fica
// inerte, para que Tab/Enter nunca acionem um botão escondido atrás dela. Ao fechar, o foco volta a quem abriu.
import { isShown } from './dom';

/** Da camada de baixo para a de cima (mesma ordem do z-index) */
const LAYERS = ['modal-groups', 'screen-match', 'screen-draw', 'round-ticker', 'modal-round-results', 'modal-continent-dist', 'modal-champion',
  'minigame-overlay', 'modal-bracket', 'modal-stats', 'modal-odds', 'modal-hall', 'modal-settings', 'modal-report', 'modal-share',
  'modal-side', 'modal-confirm'];
/** Nunca ficam inertes (avisos) */
const ALWAYS_LIVE = new Set(['toast', 'sr-live']);

let current: string | null = null;
const openers = new Map<string, HTMLElement | null>();

const el = (id: string) => document.getElementById(id);
const visible = (id: string) => { const e = el(id); return !!e && isShown(e); };
export const topLayer = (): string | null => [...LAYERS].reverse().find(visible) ?? null;

function focusInto(id: string): void {
  const box = el(id)!;
  if (box.contains(document.activeElement)) return;
  const auto = box.querySelector<HTMLElement>('[data-autofocus]:not(.hidden)');
  if (auto && auto.offsetParent !== null) { auto.focus({ preventScroll: true }); return; }
  if (!box.hasAttribute('tabindex')) box.tabIndex = -1;
  box.focus({ preventScroll: true });
}

function apply(): void {
  const app = el('app');
  if (!app) return;
  const top = topLayer();
  Array.from(app.children).forEach(c => {
    const node = c as HTMLElement;
    if (ALWAYS_LIVE.has(node.id)) return;
    node.inert = !!top && node.id !== top;
  });
  if (top === current) return;
  const prev = current;
  current = top;
  if (top && (!prev || LAYERS.indexOf(top) > LAYERS.indexOf(prev) || !visible(prev))) {
    // nova camada por cima: lembra quem estava com o foco e entra nela
    if (!openers.has(top)) openers.set(top, document.activeElement as HTMLElement | null);
    focusInto(top);
  }
  if (prev && !visible(prev)) {
    // a camada fechou: o foco volta para quem a abriu, se ainda estiver acessível
    const back = openers.get(prev);
    openers.delete(prev);
    if (back && back.isConnected && !back.closest('[inert]') && back.offsetParent !== null) back.focus({ preventScroll: true });
    else if (top) focusInto(top);
  }
}

export function initOverlays(): void {
  const obs = new MutationObserver(apply);
  LAYERS.forEach(id => {
    const e = el(id);
    if (!e) return;
    obs.observe(e, { attributes: true, attributeFilter: ['class'] });
    if (!e.getAttribute('role')) { e.setAttribute('role', 'dialog'); e.setAttribute('aria-modal', 'true'); }
    const h = e.querySelector('h2, h3');
    if (h && !e.hasAttribute('aria-labelledby')) {
      if (!h.id) h.id = id + '-title';
      e.setAttribute('aria-labelledby', h.id);
    }
  });
  apply();
}
