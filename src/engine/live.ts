// Regras dos lances jogados ao vivo (minigames e pênaltis interativos).
// Ficam no motor para serem testáveis: a interface só mostra e coleta o toque do jogador.
import { clamp } from './math';
import { rand, weightedPick } from './rng';
import type { Difficulty } from './types';

/** Ao vivo, nem toda chance é gol: chances por jogo = xG / CHANCE_CONV */
export const CHANCE_CONV = 0.6;

/**
 * O reflexo muda muito a chance, mas não decide sozinho.
 * A dificuldade só mexe nos minigames ao vivo: o simulador e as probabilidades não mudam.
 * Normal = os valores calibrados (jogador mediano perto do simulador, que converte 60%).
 */
export interface DiffParams {
  label: string;
  win: number;          // escala da janela de reação
  aimGoal: number;      // acertou o canto livre
  keeperGoal: number;   // chutou onde o goleiro estava (pode soltar)
  lateGoal: number;     // demorou: chute travado que ainda pode desviar e entrar
  touchedGoal: number;  // goleiro chegou na bola, mas pode não segurar
  missedGoal: number;   // não chegou: quase sempre é gol
  learn: number;        // quanto o goleiro adversário aprende com batidas repetidas
  rel: number;          // ajuste da confiabilidade da "olhada" do batedor
  penShootMs: number;
  penDefMs: number;
  gloves: number;       // cantos cobertos pelo goleiro no ataque
}

export const DIFF: Record<Difficulty, DiffParams> = {
  facil: { label: 'Fácil', win: 1.35, aimGoal: 0.8, keeperGoal: 0.25, lateGoal: 0.15, touchedGoal: 0.28, missedGoal: 0.85, learn: 0.1, rel: 0.08, penShootMs: 6000, penDefMs: 4500, gloves: 2 },
  normal: { label: 'Normal', win: 1, aimGoal: 0.75, keeperGoal: 0.2, lateGoal: 0.1, touchedGoal: 0.35, missedGoal: 0.9, learn: 0.2, rel: 0, penShootMs: 5000, penDefMs: 3500, gloves: 3 },
  dificil: { label: 'Difícil', win: 0.8, aimGoal: 0.7, keeperGoal: 0.15, lateGoal: 0.08, touchedGoal: 0.4, missedGoal: 0.92, learn: 0.3, rel: -0.02, penShootMs: 4000, penDefMs: 2800, gloves: 3 },
  lenda: { label: 'Lenda', win: 0.65, aimGoal: 0.66, keeperGoal: 0.12, lateGoal: 0.05, touchedGoal: 0.45, missedGoal: 0.94, learn: 0.4, rel: -0.02, penShootMs: 3500, penDefMs: 2400, gloves: 4 }
};
export const DIFF_ORDER: Difficulty[] = ['facil', 'normal', 'dificil', 'lenda'];
export const diffOf = (level: Difficulty | undefined): DiffParams => DIFF[level ?? 'normal'] ?? DIFF.normal;
/** A mais fácil de uma lista (usada nos recordes e conquistas) */
export const easiestDiff = (levels: Difficulty[] | undefined, fallback: Difficulty = 'normal'): Difficulty =>
  levels && levels.length ? DIFF_ORDER.find(l => levels.includes(l))! : fallback;

/** Compatibilidade: parâmetros do nível Normal */
export const LIVE = DIFF.normal;

/** Janela de reação: o OVR só mexe ±10% (ele já pesa no número de chances) */
export const ovrWindow = (base: number, diff: number): number => Math.round(base * (1 + clamp(diff, -20, 20) * 0.005));

// ---------- Pênaltis interativos ----------
export const PEN_ROW = [
  { name: 'no alto', miss: 0.14, save: 0.3 },
  { name: 'a meia-altura', miss: 0.06, save: 0.45 },
  { name: 'rasteiro', miss: 0.03, save: 0.55 }
] as const;
export const COL_LOOK = ['a esquerda', 'o centro', 'a direita'] as const;
export const COL_SPOT = ['no canto esquerdo', 'no meio do gol', 'no canto direito'] as const;
export const KEEPER_BASE = [0.35, 0.3, 0.35] as const;

export interface PenaltyOutcome { goal: boolean; miss?: boolean; why: string }

/** Batida em (col, row) contra um goleiro que pulou para keeperCol */
export function penaltyOutcome(attOvr: number, defOvr: number, col: number, row: number, keeperCol: number): PenaltyOutcome {
  const d = attOvr - defOvr;
  let miss = PEN_ROW[row].miss * clamp(1 - d * 0.012, 0.6, 1.4);
  if (col === 1) miss *= 0.7;
  const save = clamp(PEN_ROW[row].save - d * 0.004 + (col === 1 ? 0.15 : 0), 0.1, 0.9);
  if (rand() < miss) return { goal: false, miss: true, why: row === 0 ? 'isolou, por cima do travessão!' : 'mandou pra fora!' };
  if (keeperCol === col && rand() < save) return { goal: false, why: 'o goleiro acertou o lado e defendeu!' };
  return {
    goal: true,
    why: keeperCol === col
      ? `gol ${PEN_ROW[row].name}, ${COL_SPOT[col]}, mesmo com o goleiro no lado certo!`
      : `gol! Bateu ${PEN_ROW[row].name} ${COL_SPOT[col]} e o goleiro foi para o outro lado.`
  };
}

/** O goleiro adversário "aprende": o lado que você repete fica mais visado */
export function keeperGuess(userCols: readonly number[], learn = DIFF.normal.learn): number {
  const w = [...KEEPER_BASE];
  userCols.forEach(c => { w[c] += learn; });
  return weightedPick(w);
}

/**
 * Batida da máquina quando o usuário é o goleiro.
 * Primeiro a "olhada" do batedor, depois o canto real: P(canto = dica | dica) = confiabilidade, para qualquer dica.
 * Batedores melhores disfarçam mais; a confiabilidade nunca cai abaixo de 0,45, então a dica nunca aponta
 * para longe do canto mais provável.
 */
export function aiPenaltyKick(attOvr: number, defOvr: number, relBonus = 0): { hint: number; col: number; row: number; reliability: number } {
  const d = attOvr - defOvr;
  const base = d > 3 ? [0.42, 0.16, 0.42] : [0.38, 0.24, 0.38];
  const reliability = clamp(0.47 - d * 0.004 + relBonus, 0.45, 0.6);
  const hint = weightedPick(base);
  let col = hint;
  if (rand() >= reliability) {
    const others = [0, 1, 2].filter(c => c !== hint);
    col = others[weightedPick(others.map(c => base[c]))];
  }
  return { hint, col, row: weightedPick([0.3, 0.35, 0.35]), reliability };
}
