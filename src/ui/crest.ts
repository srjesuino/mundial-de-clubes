// Escudos: imagem pública do clube, com um escudo gerado (SVG) quando a imagem não carrega
import { escapeHtml } from './dom';

interface Crestable { name: string; logo: string; color?: string }

const crestCache: Record<string, string> = {};
const failedLogos = new Set<string>();

export function crestFor(name: string, color?: string): string {
  const key = name + (color ?? '');
  if (crestCache[key]) return crestCache[key];
  const initials = name.split(/[\s.-]+/).filter(w => w && /[A-Za-zÀ-ÿ0-9]/.test(w[0])).map(w => w[0]).join('').slice(0, 3).toUpperCase() || '?';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const fill = color ?? `hsl(${h % 360},55%,36%)`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><path d='M32 3 L58 12 V32 C58 47 46 57 32 61 C18 57 6 47 6 32 V12 Z' fill='${fill}' stroke='white' stroke-width='3'/><text x='32' y='39' font-family='Arial,sans-serif' font-size='17' font-weight='bold' fill='white' text-anchor='middle'>${escapeHtml(initials)}</text></svg>`;
  return (crestCache[key] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
}

export const NO_TEAM_IMG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><circle cx='32' cy='32' r='27' fill='#1e293b' stroke='#475569' stroke-width='3'/><text x='32' y='41' font-family='Arial,sans-serif' font-size='26' font-weight='bold' fill='#64748b' text-anchor='middle'>?</text></svg>`);

const srcFor = (team: Crestable): string => (!team.logo || failedLogos.has(team.logo) ? crestFor(team.name, team.color) : team.logo);

export function logoImg(team: Crestable | null | undefined, cls: string): string {
  if (!team) return `<img src="${NO_TEAM_IMG}" class="${cls}" alt="">`;
  const src = srcFor(team);
  const fb = src === team.logo ? '' : ' data-fb="1"';
  return `<img src="${src}" data-team="${escapeHtml(team.name)}"${team.color ? ` data-color="${escapeHtml(team.color)}"` : ''}${fb} class="${cls}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
}

export function setLogo(el: HTMLImageElement, team: Crestable | null | undefined): void {
  delete el.dataset.fb;
  el.referrerPolicy = 'no-referrer';
  if (!team) { el.removeAttribute('data-team'); el.src = NO_TEAM_IMG; return; }
  el.dataset.team = team.name;
  if (team.color) el.dataset.color = team.color; else delete el.dataset.color;
  const src = srcFor(team);
  if (src !== team.logo) el.dataset.fb = '1';
  if (el.getAttribute('src') !== src) el.src = src;
}

/** Eventos de erro não borbulham, mas podem ser capturados na fase de captura */
export function installCrestFallback(): void {
  document.addEventListener('error', e => {
    const img = e.target as HTMLImageElement | null;
    if (img && img.tagName === 'IMG' && img.dataset.team && !img.dataset.fb) {
      failedLogos.add(img.getAttribute('src') ?? '');
      img.dataset.fb = '1';
      img.src = crestFor(img.dataset.team, img.dataset.color);
    }
  }, true);
}
