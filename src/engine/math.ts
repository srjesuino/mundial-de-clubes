export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function poisPmf(k: number, l: number): number {
  let p = Math.exp(-l);
  for (let i = 1; i <= k; i++) p *= l / i;
  return p;
}

export function binomPmf(k: number, n: number, p: number): number {
  let c = 1;
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
  return c * Math.pow(p, k) * Math.pow(1 - p, n - k);
}

export function chunkPairs<T>(arr: readonly T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i + 1 < arr.length; i += 2) out.push([arr[i], arr[i + 1]]);
  return out;
}
