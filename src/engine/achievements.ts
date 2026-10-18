// Conquistas verificáveis: cada uma guarda a prova (placar e a chance que o motor dava).
// Lances simulados, tempo pulado e partidas interrompidas nunca contam para as conquistas de habilidade.
import { baseOdds, isDecided, isUser, team, winnerId } from './core';
import { qualifiedCount } from './config';
import { easiestDiff } from './live';
import { sideOdds } from './model';
import { clubMatches, pctBR, scoreLine } from './meta';
import type { PlayableMatch, Tournament } from './types';

export interface AchDef { k: string; icon: string; t: string; d: string }

export const ACH: AchDef[] = [
  { k: 'first_live_goal', icon: '⚽', t: 'Primeiro grito', d: 'Marque um gol num lance de ataque ao vivo.' },
  { k: 'giant_killer', icon: '🪨', t: 'Davi x Golias', d: 'Vença um jogo de grupo (ou avance num jogo eliminatório) em que o motor te dava 25% ou menos.' },
  { k: 'miracle', icon: '✨', t: 'Milagre', d: 'O mesmo, com 10% ou menos de chance.' },
  { k: 'comeback', icon: '🔄', t: 'Virada', d: 'Vença ao vivo depois de estar perdendo por 2 gols, sem usar "Pular para o Fim".' },
  { k: 'wall', icon: '🧱', t: 'Paredão', d: 'Pegue 3 pênaltis numa mesma disputa ao vivo (só cobranças jogadas no minigame).' },
  { k: 'ice', icon: '🧊', t: 'Sangue frio', d: 'Converta todas as suas cobranças numa disputa ao vivo, com no mínimo 5.' },
  { k: 'rout', icon: '💥', t: 'Atropelo', d: 'Vença por 4 gols ou mais de diferença.' },
  { k: 'champ', icon: '🏆', t: 'Campeão', d: 'Conquiste um título com um clube seu.' },
  { k: 'unbeaten', icon: '🛡️', t: 'Invicto', d: 'Seja campeão sem perder nenhum jogo (decisão por pênaltis conta como empate).' },
  { k: 'underdog', icon: '🐺', t: 'Azarão', d: 'Seja campeão com um clube da metade de baixo do torneio em OVR.' },
  { k: 'all_live', icon: '🎮', t: 'Mão na massa', d: 'Seja campeão jogando ao vivo, até o fim, todos os jogos do seu clube.' },
  { k: 'lower', icon: '🪜', t: 'Da Lower ao topo', d: 'Seja campeão na dupla eliminação depois de perder um jogo.' },
  { k: 'league', icon: '📈', t: 'Regularidade', d: 'Seja campeão de pontos corridos.' },
  { k: 'max64', icon: '🏃', t: 'Maratona', d: 'Termine um torneio com 64 clubes.' },
  { k: 'legend', icon: '👑', t: 'Lenda', d: 'Seja campeão no nível Lenda (o mais fácil que você usou) jogando ao vivo pelo menos metade dos jogos do clube.' }
];

export interface Unlock { k: string; detail: string }

const proof = (t: Tournament, m: PlayableMatch, p: number) => `${scoreLine(t, m)} — o motor dava ${pctBR(p)}`;

/** Conquistas de um jogo disputado, do ponto de vista de cada clube do usuário nele */
export function matchAchievements(t: Tournament, m: PlayableMatch): Unlock[] {
  const out: Unlock[] = [];
  if (!m.res) return out;
  (['home', 'away'] as const).forEach(side => {
    const id = m[side];
    if (!isUser(t, id)) return;
    const r = m.res!;
    const mine = side === 'home' ? r.gH : r.gA, theirs = side === 'home' ? r.gA : r.gH;
    const won = m.kind === 'group' ? mine > theirs : isDecided(m) && winnerId(m) === id;
    if (won) {
      const o = sideOdds(baseOdds(t, m), side);
      const p = m.kind === 'group' ? o.win : o.adv ?? o.win;
      if (p <= 0.25) out.push({ k: 'giant_killer', detail: proof(t, m, p) });
      if (p <= 0.1) out.push({ k: 'miracle', detail: proof(t, m, p) });
    }
    if (mine - theirs >= 4) out.push({ k: 'rout', detail: scoreLine(t, m) });
    const lv = r.live;
    if (!lv) return; // só partidas jogadas ao vivo até o fim
    if (lv.at && lv.at[1] > 0) out.push({ k: 'first_live_goal', detail: scoreLine(t, m) });
    if (won && lv.md >= 2 && lv.sk === 0) out.push({ k: 'comeback', detail: `${scoreLine(t, m)} — esteve ${lv.md} gols atrás` });
    if (lv.pd[1] >= 3) out.push({ k: 'wall', detail: `${scoreLine(t, m)} — ${lv.pd[1]} pênaltis pegos em ${lv.pd[0]}` });
    if (lv.ps[0] >= 5 && lv.ps[1] === lv.ps[0]) out.push({ k: 'ice', detail: `${scoreLine(t, m)} — ${lv.ps[1]}/${lv.ps[0]} nas cobranças` });
  });
  return out;
}

/** Conquistas do fim do torneio */
export function endAchievements(t: Tournament): Unlock[] {
  const out: Unlock[] = [];
  if (t.phase !== 'END') return out;
  const n = Object.keys(t.teams).length;
  if (n >= 64) out.push({ k: 'max64', detail: `Torneio com ${n} clubes` });
  const c = t.champion;
  if (!c || !isUser(t, c)) return out;
  const C = team(t, c);
  const ms = clubMatches(t, c);
  const note = `${C.name} (OVR ${C.ovr})`;
  out.push({ k: 'champ', detail: `${note} · ${C.st.v}V ${C.st.e}E ${C.st.d}D` });
  if (C.st.d === 0) out.push({ k: 'unbeaten', detail: `${note} · ${C.st.v}V ${C.st.e}E 0D` });
  const stronger = Object.values(t.teams).filter(x => x.ovr > C.ovr).length;
  if (stronger >= n / 2) out.push({ k: 'underdog', detail: `${note} · ${stronger} clubes com OVR maior` });
  const live = ms.filter(m => m.res?.live).length;
  if (ms.length && live === ms.length) out.push({ k: 'all_live', detail: `${note} · ${live} jogos ao vivo` });
  if (t.bracket && C.dl >= 1) out.push({ k: 'lower', detail: `${note} · ${C.dl} derrota na chave` });
  if (t.config.initialPhase === 'groups' && qualifiedCount(t.config) === 1) out.push({ k: 'league', detail: `${note} · ${C.p} pontos` });
  if (easiestDiff(t.diffUsed, t.config.difficulty ?? 'normal') === 'lenda' && t.diffUsed?.length && live * 2 >= ms.length) {
    out.push({ k: 'legend', detail: `${note} · ${live}/${ms.length} jogos ao vivo no nível Lenda` });
  }
  return out;
}
