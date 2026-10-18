// Gerador pseudoaleatório com semente (mulberry32).
// Em produção usa uma semente aleatória; nos testes, uma fixa, para resultados reproduzíveis.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let current: Rng = mulberry32((Math.random() * 2 ** 32) >>> 0);

/** Número em [0, 1). Todo o motor usa esta função em vez de Math.random. */
export const rand = (): number => current();

export function setSeed(seed: number): void {
  current = mulberry32(seed);
}

export function setRng(r: Rng): void {
  current = r;
}

export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function weightedPick(weights: readonly number[]): number {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** Amostra de Poisson (algoritmo de Knuth; λ do futebol é pequeno). */
export function poisson(lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > L);
  return k - 1;
}
