export type Confederation = 'UEFA' | 'CONMEBOL' | 'CONCACAF' | 'AFC' | 'CAF' | 'OFC';
export type KoPhase = 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F';
export type Phase = 'GROUP' | 'SWISS' | 'DE' | 'END' | KoPhase;
/** group: empate vale · swiss: empate → pênaltis · ko: empate → prorrogação → pênaltis */
export type MatchKind = 'group' | 'swiss' | 'ko';
export type Side = 'home' | 'away';
/** Postura tática de um clube controlado pelo usuário */
export type Tactic = 'def' | 'bal' | 'att';
/** Dificuldade dos minigames (não muda o simulador) */
export type Difficulty = 'facil' | 'normal' | 'dificil' | 'lenda';

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
  /** só muda os minigames das partidas ao vivo */
  difficulty?: Difficulty;
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

/** Resumo de uma partida que o usuário jogou ao vivo até o apito final (interrompida não tem) */
export interface LiveRecord {
  /** lado que o usuário controlou */
  s?: Side;
  /** dificuldade usada */
  d: Difficulty;
  /** maior desvantagem do usuário no placar durante o jogo */
  md: number;
  /** 1 se usou "Pular para o Fim" */
  sk: 0 | 1;
  /** 1 se usou "Simular Pênaltis" (cobranças simuladas não contam para conquistas de habilidade) */
  sp?: 0 | 1;
  /** pênaltis batidos pelo usuário nos minigames: [cobranças, gols] */
  ps: [number, number];
  /** pênaltis do adversário com o usuário no gol: [cobranças, defesas] (chutes para fora não contam) */
  pd: [number, number];
  /** chances de ataque nos minigames: [tentativas, gols] */
  at?: [number, number];
  /** chances do adversário nos minigames: [tentativas, gols sofridos] */
  df?: [number, number];
}

export interface MatchResult {
  gH: number;
  gA: number;
  et: boolean;
  penH: number | null;
  penA: number | null;
  /** minutos dos gols: [minuto, 0=mandante/1=visitante] */
  gm?: [number, 0 | 1][];
  /** cobranças da disputa de pênaltis: quem começou e acertos (1) / erros (0) */
  pk?: { f: Side; h: number[]; a: number[] };
  /** presente só quando o usuário jogou a partida inteira ao vivo */
  live?: LiveRecord;
}

export interface Match {
  id: string;
  home: string;
  away: string;
  kind: MatchKind;
  stage: string;
  played: boolean;
  res: MatchResult | null;
  /** posturas escolhidas pelos clubes do usuário neste jogo (NPCs sempre Equilibrado) */
  tactics?: Partial<Record<Side, Tactic>>;
  /** posturas no pontapé inicial de um jogo ao vivo (a postura pode mudar durante o jogo) */
  tac0?: Partial<Record<Side, Tactic>>;
  /** conquistas já verificadas para este jogo */
  achk?: 1;
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
  tac0?: Partial<Record<Side, Tactic>>;
  achk?: 1;
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
}

/** Aproveitamento do usuário nos minigames, contado lance a lance */
export interface Skill {
  att: { n: number; g: number };              // chances de ataque: tentativas, gols
  def: { n: number; g: number };              // chances do adversário: tentativas, gols sofridos
  penS: { n: number; g: number; e: number };  // pênaltis batidos: cobranças, gols, gols esperados pelo motor
  penD: { n: number; g: number; e: number };  // pênaltis defendidos: cobranças, gols sofridos, gols esperados
}

/** Previsão do torneio por Monte Carlo (guardada para mostrar sem recalcular) */
export interface Forecast {
  key: string;
  n: number;
  label: string;
  cols: string[];
  /** probabilidade por clube, na ordem de cols (na coluna 'Posição média', a posição média) */
  p: Record<string, number[]>;
  /** cenários do próximo jogo dos clubes do usuário: resultado → [simulações, classificou (ou título)] */
  cond: Record<string, Partial<Record<'V' | 'E' | 'D', [number, number]>>>;
  /** posições finais no grupo: grupo → clube → probabilidade de cada posição */
  pos: Record<string, Record<string, number[]>>;
  /**
   * O que já está decidido (não estimado), uma letra por coluna: '1' garantido, '0' impossível, '.' em aberto.
   * Clubes sem nada decidido ficam de fora.
   */
  known: Record<string, string>;
}

export interface ForecastLogEntry {
  /** resultados conhecidos (jogos disputados): uma entrada por conjunto de resultados */
  k: string;
  label: string;
  n: number;
  /** chance de título dos clubes do usuário */
  t: Record<string, number>;
}

export interface Tournament {
  v: 3;
  /** identificador único do torneio (não usa o sorteio do jogo) */
  tid?: string;
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
  /** dificuldades usadas nas partidas ao vivo deste torneio */
  diffUsed?: Difficulty[];
  skill?: Skill;
  /** última previsão calculada e histórico da chance de título dos clubes do usuário */
  mc?: Forecast;
  mcLog?: ForecastLogEntry[];
  /** distribuição por continente usada (para a Revanche) */
  slots?: Partial<Record<Confederation, number>> | null;
  /** id da entrada na Galeria de Campeões (gravada uma única vez) */
  hofId?: string;
}
