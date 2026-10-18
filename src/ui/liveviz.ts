// Gráfico da chance minuto a minuto (SVG) e marcas de gols/chances. Usado ao vivo, na ficha e no relatório.
import { liveOdds, type SimContext } from '../engine/model';
import type { MatchKind, Side } from '../engine/types';

/** Amostra do ponto de vista do usuário: w = vitória (ou avançar), d = empate (0 quando o jogo precisa de vencedor) */
export interface VizSample { min: number; w: number; d: number }

const W = 120, H = 40, PEN_X = 108;
const C_WIN = '#10b981', C_DRAW = '#64748b', C_LOSS = '#0ea5e9';
const f1 = (x: number) => Math.round(x * 10) / 10;

export function sampleFor(ctx: SimContext, side: Side, s: Parameters<typeof liveOdds>[1]): VizSample {
  const o = liveOdds(ctx, s);
  if (o.advH !== undefined) return { min: s.min, w: side === 'home' ? o.advH : 1 - o.advH, d: 0 };
  return { min: s.min, w: side === 'home' ? o.ph : o.pa, d: o.pd };
}

/** Caminhos SVG das faixas empilhadas (vitória embaixo, empate no meio, derrota em cima) */
export function vizSvg(samples: VizSample[], total: number, pens: number[] = []): string {
  if (!samples.length) return '';
  const width = pens.length ? PEN_X : W;
  const pts = samples.map(s => ({ x: f1((Math.min(s.min, total) / total) * width), w: s.w, d: s.d }));
  // Pênaltis: um degrau por cobrança, depois do fim do tempo
  if (pens.length) {
    const step = (W - PEN_X) / Math.max(10, pens.length);
    pens.forEach((v, i) => {
      pts.push({ x: f1(PEN_X + i * step), w: v, d: 0 });
      pts.push({ x: f1(PEN_X + (i + 1) * step), w: v, d: 0 });
    });
  }
  const last = pts[pts.length - 1];
  const y = (p: number) => f1(H - p * H);
  const band = (lo: (p: typeof pts[0]) => number, hi: (p: typeof pts[0]) => number, color: string) => {
    const top = pts.map(p => `${p.x},${y(hi(p))}`);
    const bot = pts.slice().reverse().map(p => `${p.x},${y(lo(p))}`);
    return `<path d="M${top.join('L')}L${bot.join('L')}Z" fill="${color}" fill-opacity="0.85"/>`;
  };
  const hasDraw = pts.some(p => p.d > 0);
  let out = band(() => 0, p => p.w, C_WIN);
  if (hasDraw) out += band(p => p.w, p => p.w + p.d, C_DRAW);
  out += band(p => p.w + p.d, () => 1, C_LOSS);
  // linhas-guia: intervalo e fim do tempo normal (com prorrogação)
  const guide = (min: number) => { const x = f1((min / total) * width); return x < last.x ? `<line x1="${x}" x2="${x}" y1="0" y2="${H}" stroke="#0f172a" stroke-width="0.6" stroke-dasharray="1.5 1.5"/>` : ''; };
  out += guide(45);
  if (total > 90) out += guide(90) + guide(105);
  if (!hasDraw) out += `<line x1="0" x2="${last.x}" y1="${H / 2}" y2="${H / 2}" stroke="#0f172a" stroke-width="0.4" stroke-opacity="0.6"/>`;
  return out;
}

/** Marcas sobre o gráfico: gols (⚽) e chances perdidas (traços); o usuário em cima, o adversário embaixo */
export function marksHtml(goals: [number, 0 | 1][], misses: { min: number; home: boolean }[], userHome: boolean, total: number, withPens: boolean): string {
  const width = withPens ? PEN_X : W;
  const left = (min: number) => ((Math.min(min, total) / total) * width / W) * 100;
  const g = goals.map(([min, s]) => {
    const mine = (s === 0) === userHome;
    return `<span class="wp-goal" style="left:${left(min)}%;${mine ? 'top:1px' : 'bottom:1px'}">⚽</span>`;
  }).join('');
  const m = misses.map(c => {
    const mine = c.home === userHome;
    return `<span class="wp-tick" style="left:${left(c.min)}%;${mine ? 'top:0;background:#a7f3d0' : 'bottom:0;border:1px solid #bae6fd'}"></span>`;
  }).join('');
  return g + m;
}

/**
 * Série completa reconstruída de um jogo já disputado (placar a cada minuto pelos minutos dos gols).
 * É o mesmo cálculo da partida ao vivo, com a postura final do jogo.
 */
export function seriesFromGoals(ctx: SimContext, kind: MatchKind, side: Side, gm: [number, 0 | 1][], et: boolean): VizSample[] {
  const total = et ? 120 : 90;
  const out: VizSample[] = [];
  let h = 0, a = 0, gi = 0;
  const goals = [...gm].sort((x, y) => x[0] - y[0]);
  for (let min = 0; min <= total; min++) {
    while (gi < goals.length && goals[gi][0] <= min) { if (goals[gi][1] === 0) h++; else a++; gi++; }
    const period = min > 90 || (min === 90 && et && kind === 'ko') ? 'ET' : 'REG';
    out.push(sampleFor(ctx, side, { min, hSc: h, aSc: a, period: period as 'REG' | 'ET' }));
  }
  return out;
}
