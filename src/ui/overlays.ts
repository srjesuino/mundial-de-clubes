// Camadas de tela cheia (partida, sorteio, plantão, janelas): a de cima recebe o foco e o resto da página fica
// inerte, para que Tab/Enter nunca acionem um botão escondido atrás dela. Ao fechar, o foco volta a quem abriu
// (ou ao controle principal da tela), a menos que o próprio app já tenha posto o foco num lugar válido.
import { isShown, setVisibilityHook } from './dom';

/** Da camada de baixo para a de cima (mesma ordem do z-index) */
const LAYERS = ['modal-groups', 'screen-match', 'screen-draw', 'round-ticker', 'modal-round-results', 'modal-continent-dist', 'modal-champion',
  'minigame-overlay', 'modal-bracket', 'modal-stats', 'modal-odds', 'modal-hall', 'modal-settings', 'modal-report', 'modal-share',
  'modal-side', 'modal-confirm'];
const LAYER_SET = new Set(LAYERS);
/** Nunca ficam inertes (avisos) */
const ALWAYS_LIVE = new Set(['toast', 'sr-live']);

let current: string | null = null;
const openers = new Map<string, HTMLElement | null>();

const el = (id: string) => document.getElementById(id);
const visible = (id: string) => { const e = el(id); return !!e && isShown(e); };
export const topLayer = (): string | null => [...LAYERS].reverse().find(visible) ?? null;

/** O foco está num lugar que o usuário consegue usar? */
function focusUsable(): boolean {
  const a = document.activeElement as HTMLElement | null;
  return !!a && a !== document.body && a.isConnected && !a.closest('[inert]') && !a.closest('.hidden') && a.getClientRects().length > 0;
}

function focusInto(id: string): void {
  const box = el(id)!;
  if (box.contains(document.activeElement) && focusUsable()) return;
  const auto = Array.from(box.querySelectorAll<HTMLElement>('[data-autofocus]')).find(x => !x.closest('.hidden') && x.getClientRects().length > 0);
  if (auto) { auto.focus({ preventScroll: true }); return; }
  if (!box.hasAttribute('tabindex')) box.tabIndex = -1;
  box.focus({ preventScroll: true });
}

/** Sem camada aberta e sem quem abriu: o controle principal da tela visível */
function focusScreen(): void {
  const candidates = ['btn-draw', 'btn-play-match', 'btn-simulate-match', 'btn-show-champion', 'dash-phase', 'btn-start-sandbox', 'search-team'];
  const target = candidates.map(el).find(x => !!x && !x.closest('.hidden') && x.getClientRects().length > 0);
  target?.focus({ preventScroll: true });
}

const usable = (x: HTMLElement | null | undefined): x is HTMLElement =>
  !!x && x.isConnected && !x.closest('[inert]') && !x.closest('.hidden') && x.getClientRects().length > 0;

let shown = new Set<string>();

function apply(): void {
  const app = el('app');
  if (!app) return;
  const top = topLayer();
  Array.from(app.children).forEach(c => {
    const node = c as HTMLElement;
    if (ALWAYS_LIVE.has(node.id)) return;
    const inert = !!top && node.id !== top;
    if (node.inert !== inert) node.inert = inert;
  });
  const before = shown;
  shown = new Set(LAYERS.filter(visible));
  if (top === current) return;
  const prev = current;
  current = top;
  const prevClosed = !!prev && !shown.has(prev);
  if (top && !before.has(top)) {
    // camada nova por cima: lembra quem abriu (se ela substituiu outra no mesmo passo, herda o "abridor" dela)
    const active = document.activeElement as HTMLElement | null;
    openers.set(top, prevClosed ? openers.get(prev!) ?? active : active);
    focusInto(top);
  } else if (prevClosed) {
    // a camada de cima fechou: se o app já pôs o foco num lugar válido, respeita; senão volta a quem abriu
    const back = openers.get(prev!);
    const kept = focusUsable() && (!top || el(top)!.contains(document.activeElement));
    if (!kept) {
      if (usable(back)) back.focus({ preventScroll: true });
      else if (top) focusInto(top);
      else focusScreen();
    }
    // o clique que fechou a camada ainda pode trocar a tela (ex.: Avançar Rodada): confere de novo em seguida
    window.setTimeout(() => {
      if (focusUsable()) return;
      const t = topLayer();
      if (t) focusInto(t); else focusScreen();
    }, 0);
  }
  if (prevClosed) openers.delete(prev!);
}

export function initOverlays(): void {
  // na hora (showEl/hideEl) e também para mudanças de classe feitas por fora
  setVisibilityHook(e => { if (LAYER_SET.has(e.id) || e.closest('#app')) apply(); });
  const obs = new MutationObserver(apply);
  LAYERS.forEach(id => {
    const e = el(id);
    if (!e) return;
    obs.observe(e, { attributes: true, attributeFilter: ['class'] });
    if (!e.getAttribute('role')) { e.setAttribute('role', 'dialog'); e.setAttribute('aria-modal', 'true'); }
    const h = e.querySelector('h2, h3');
    if (h && !e.hasAttribute('aria-labelledby') && !e.hasAttribute('aria-label')) {
      if (!h.id) h.id = id + '-title';
      e.setAttribute('aria-labelledby', h.id);
    }
  });
  apply();
}
