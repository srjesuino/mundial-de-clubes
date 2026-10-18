// Regras dos lances jogados ao vivo (minigames e pênaltis interativos).
// Ficam no motor para serem testáveis: a interface só mostra e coleta o toque do jogador.
import { clamp } from './math';
import { rand, weightedPick } from './rng';

/** Ao vivo, nem toda chance é gol: chances por jogo = xG / CHANCE_CONV */
export const CHANCE_CONV = 0.6;

/**
 * O reflexo muda muito a chance, mas não decide sozinho.
 * Com CHANCE_CONV = 0.6, um jogador mediano fica perto do simulador; um muito bom, acima.
 */
export const LIVE = {
  aimGoal: 0.75,      // acertou o canto livre
  keeperGoal: 0.2,    // chutou onde o goleiro estava (pode soltar)
  lateGoal: 0.1,      // demorou: chute travado que ainda pode desviar e entrar
  touchedGoal: 0.35,  // goleiro chegou na bola, mas pode não segurar
  missedGoal: 0.9     // não chegou: quase sempre é gol
} as const;

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
export function keeperGuess(userCols: readonly number[]): number {
  const w = [...KEEPER_BASE];
  userCols.forEach(c => { w[c] += 0.2; });
  return weightedPick(w);
}

/**
 * Batida da máquina quando o usuário é o goleiro.
 * Primeiro a "olhada" do batedor, depois o canto real: P(canto = dica | dica) = confiabilidade, para qualquer dica.
 * Batedores melhores disfarçam mais; a confiabilidade nunca cai abaixo de 0,45, então a dica nunca aponta
 * para longe do canto mais provável.
 */
export function aiPenaltyKick(attOvr: number, defOvr: number): { hint: number; col: number; row: number; reliability: number } {
  const d = attOvr - defOvr;
  const base = d > 3 ? [0.42, 0.16, 0.42] : [0.38, 0.24, 0.38];
  const reliability = clamp(0.47 - d * 0.004, 0.45, 0.55);
  const hint = weightedPick(base);
  let col = hint;
  if (rand() >= reliability) {
    const others = [0, 1, 2].filter(c => c !== hint);
    col = others[weightedPick(others.map(c => base[c]))];
  }
  return { hint, col, row: weightedPick([0.3, 0.35, 0.35]), reliability };
}
