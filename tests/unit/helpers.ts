import { ALL_TEAMS } from '../../src/data/teams';
import { DEFAULT_CONFIG } from '../../src/engine/config';
import { currentRoundMatches, advance, finalizeDraw, simulateRound, createTournament } from '../../src/engine/tournament';
import type { Config, Tournament } from '../../src/engine/types';

export const cfg = (over: Partial<Config>): Config => ({ ...DEFAULT_CONFIG, ...over });

/** Ids de clubes do usuário de forma determinística (k primeiros de uma lista embaralhada pela semente) */
export const someUsers = (n: number, offset = 0): string[] => ALL_TEAMS.slice(offset, offset + n).map(t => t.id);

/** Joga o torneio todo chamando hook(t) após cada rodada simulada (antes de avançar) */
export function playAll(t: Tournament, hook?: (t: Tournament) => void): Tournament {
  let guard = 0;
  while (t.phase !== 'END' && guard++ < 5000) {
    if (t.draw) { finalizeDraw(t); continue; }
    if (!currentRoundMatches(t).length) throw new Error(`Sem jogos na fase ${t.phase}`);
    simulateRound(t);
    hook?.(t);
    if (!advance(t)) throw new Error('advance() não avançou uma rodada completa');
  }
  return t;
}

export { createTournament };
