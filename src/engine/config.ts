import { MAX_TOURNAMENT_TEAMS } from '../data/teams';
import { PHASE_BY_COUNT, PHASE_LABEL } from './core';
import type { Config } from './types';

export const DEFAULT_CONFIG: Config = {
  initialPhase: 'groups', bracketFormat: 'single', groupsCount: 8, teamsPerGroup: 4, advancingPerGroup: 2,
  groupLegs: 2, drawType: 'potted', totalTeamsSwiss: 32, totalTeamsKnockout: 32, fillMethod: 'random'
};

export function totalTeamsFor(c: Config): number {
  if (c.initialPhase === 'groups') return c.groupsCount * c.teamsPerGroup;
  if (c.initialPhase === 'swiss') return c.totalTeamsSwiss;
  return c.totalTeamsKnockout;
}

export function qualifiedCount(c: Config): number {
  if (c.initialPhase === 'groups') return c.groupsCount * c.advancingPerGroup;
  if (c.initialPhase === 'swiss') return c.totalTeamsSwiss / 2;
  return c.totalTeamsKnockout;
}

export function groupRoundsCount(c: Config): number {
  const n = c.teamsPerGroup;
  return (n % 2 === 0 ? n - 1 : n) * c.groupLegs;
}

/** null = configuração válida; senão, a mensagem explicando o que corrigir */
export function validateConfig(c: Config): string | null {
  if (c.initialPhase === 'groups') {
    if (!Number.isInteger(c.groupsCount) || c.groupsCount < 1 || c.groupsCount > 16) return 'O número de grupos precisa estar entre 1 e 16.';
    if (!Number.isInteger(c.teamsPerGroup) || c.teamsPerGroup < 3 || c.teamsPerGroup > 32) return 'Cada grupo precisa ter entre 3 e 32 times (para confrontos diretos de 2 times, use o Mata-Mata Direto).';
    const total = totalTeamsFor(c);
    if (total > MAX_TOURNAMENT_TEAMS) return `O torneio precisaria de ${total} times, mas o limite é ${MAX_TOURNAMENT_TEAMS}.`;
    if (c.teamsPerGroup <= c.advancingPerGroup) return 'O número de classificados deve ser menor que o total de times no grupo.';
    const adv = qualifiedCount(c);
    if (adv === 1) return null; // grupo único, Top 1 = pontos corridos
    if (![2, 4, 8, 16, 32].includes(adv)) return `O total de classificados (${c.groupsCount} grupos x ${c.advancingPerGroup} vagas = ${adv}) precisa ser 2, 4, 8, 16 ou 32 para fechar a chave do mata-mata. (Ou use 1 grupo com Top 1 para pontos corridos.)`;
    if (c.bracketFormat === 'double' && adv < 4) return 'A Dupla Eliminação precisa de pelo menos 4 classificados.';
  } else if (c.initialPhase === 'swiss') {
    if (![16, 32, 64].includes(c.totalTeamsSwiss)) return 'O total de times precisa ser 16, 32 ou 64 para o Sistema Suíço.';
  } else if (![8, 16, 32, 64].includes(c.totalTeamsKnockout)) {
    return 'O total de times precisa ser 8, 16, 32 ou 64.';
  }
  return null;
}

function knockoutStartLabel(n: number, c: Config): string {
  if (c.bracketFormat === 'double') return `chave de dupla eliminação com ${n}`;
  return `mata-mata a partir ${n === 2 ? 'da Final' : n === 4 ? 'da Semifinal' : 'das ' + PHASE_LABEL[PHASE_BY_COUNT[n]]}`;
}

export function describeConfig(c: Config): { ok: boolean; text: string } {
  const err = validateConfig(c);
  if (err) return { ok: false, text: err };
  const total = totalTeamsFor(c);
  const adv = qualifiedCount(c);
  if (c.initialPhase === 'groups') {
    const g = c.groupsCount;
    const r = groupRoundsCount(c);
    const head = `${total} clubes · ${g} grupo${g > 1 ? 's' : ''} de ${c.teamsPerGroup} · ${c.groupLegs === 2 ? 'ida e volta' : 'turno único'} (${r} rodada${r > 1 ? 's' : ''})`;
    if (adv === 1) return { ok: true, text: `${head} · Pontos corridos: o 1º colocado é o campeão` };
    return { ok: true, text: `${head} · ${adv} classificados → ${knockoutStartLabel(adv, c)}` };
  }
  if (c.initialPhase === 'swiss') return { ok: true, text: `${total} clubes · Sistema Suíço (até 5 rodadas) · ${adv} classificados → ${knockoutStartLabel(adv, c)}` };
  return { ok: true, text: `${total} clubes · ${knockoutStartLabel(total, c)}` };
}
