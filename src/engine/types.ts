export type Confederation = 'UEFA' | 'CONMEBOL' | 'CONCACAF' | 'AFC' | 'CAF' | 'OFC';
export type KoPhase = 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F';
export type Phase = 'GROUP' | 'SWISS' | 'DE' | 'END' | KoPhase;
/** group: empate vale · swiss: empate → pênaltis · ko: empate → prorrogação → pênaltis */
export type MatchKind = 'group' | 'swiss' | 'ko';
export type Side = 'home' | 'away';
/** Postura tática de um clube controlado pelo usuário */
export type Tactic = 'def' | 'bal' | 'att';

export interface ClubBase {
  id: string;
  name: string;
  country: string;
  ovr: number;
  logo: string;
  isElite: boolean;
  custom?: boolean;
  color?: string;
}

export interface Config {
  initialPhase: 'groups' | 'swiss' | 'knockout';
  bracketFormat: 'single' | 'double';
  groupsCount: number;
  teamsPerGroup: number;
  advancingPerGroup: number;
  groupLegs: number;
  drawType: 'potted' | 'random';
  totalTeamsSwiss: number;
  totalTeamsKnockout: number;
  fillMethod: 'random' | 'custom';
}

export interface Stats { j: number; v: number; e: number; d: number; gp: number; gc: number }

export interface TeamState extends ClubBase {
  conf: Confederation;
  // fase de grupos
  group: string | null;
  p: number; w: number; d: number; l: number; gf: number; ga: number; gd: number;
  form: ('V' | 'E' | 'D')[];
  // sistema suíço
  sw: number; sl: number;
  status: 'playing' | 'advanced' | 'eliminated';
  opp: string[];
  // dupla eliminação
  dl: number;
  // campanha geral
  st: Stats;
  /** sorteio para o último critério de desempate */
  tb: number;
  /** onde foi eliminado (null = segue vivo ou campeão) */
  out: string | null;
}

export interface MatchResult {
  gH: number;
  gA: number;
  et: boolean;
  penH: number | null;
  penA: number | null;
  /** quem jogou ao vivo (para o relatório e as estatísticas de habilidade) */
  live?: boolean;
  /** linha do tempo das chances: [minuto, lado, gol?] */
  events?: [number, 0 | 1, 0 | 1][];
}

export interface Match {
  id: string;
  home: string;
  away: string;
  kind: MatchKind;
  stage: string;
  played: boolean;
  res: MatchResult | null;
  /** táticas escolhidas pelos clubes do usuário neste jogo */
  tactics?: Partial<Record<Side, Tactic>>;
}

export interface DENode {
  id: string;
  bracket: 'upper' | 'lower' | 'final';
  label: string;
  stage: string;
  kind: 'ko';
  home: string | null;
  away: string | null;
  nextW: string | null;
  nextL: string | null;
  played: boolean;
  propagated: boolean;
  res: MatchResult | null;
  round: number;
  isGF1?: boolean;
  isGF2?: boolean;
  tactics?: Partial<Record<Side, Tactic>>;
}

/** Um jogo com os dois lados definidos (nó de chave pronto para ser jogado inclusive) */
export type PlayableMatch = (Match | DENode) & { home: string; away: string };

export interface Draw {
  phase: KoPhase | 'DE';
  title: string;
  note: string;
  pairs: [string, string][];
  revealed: number;
}

export interface KnockoutRound {
  phase: KoPhase;
  label: string;
  matches: Match[];
}

export interface Shootout {
  h: number; a: number; hk: number; ak: number;
  first: Side;
  kicks: { home: boolean[]; away: boolean[] };
  userCols: number[];
}

export interface LiveSnapshot {
  id: string;
  side: Side;
  min: number;
  hSc: number;
  aSc: number;
  period: 'REG' | 'ET' | 'PEN';
  et: boolean;
  pen: Shootout | null;
  chance: { home: boolean; userAttacks: boolean } | null;
  kick: { home: boolean; userAttacks: boolean } | null;
  events?: [number, 0 | 1, 0 | 1][];
}

export interface Tournament {
  v: 3;
  config: Config;
  userIds: string[];
  activeId: string;
  teams: Record<string, TeamState>;
  phase: Phase;
  round: number;
  seq: number;
  groups: Record<string, string[]>;
  schedule: Record<string, Match[][]>;
  swissRounds: Match[][];
  knockout: KnockoutRound[];
  bracket: { nodes: DENode[]; round: number } | null;
  draw: Draw | null;
  champion: string | null;
  runnerUp: string | null;
  championNote: string | null;
  live: LiveSnapshot | null;
  /** postura padrão de cada clube do usuário (pode ser trocada antes de cada jogo) */
  tactics: Record<string, Tactic>;
  /** histórico da chance de título dos clubes do usuário, uma entrada por rodada */
  oddsHistory: { label: string; title: Record<string, number> }[];
}
