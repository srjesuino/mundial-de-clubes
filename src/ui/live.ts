// Partida ao vivo: relógio, chances (minigames), postura, gráfico de chance, prorrogação, pênaltis e salvamento a cada lance
import { PHASE_BY_COUNT, PHASE_LABEL, applyResult, homeAdvantage, simContext, team, winnerId } from '../engine/core';
import { deNode } from '../engine/double';
import { CHANCE_CONV, DIFF } from '../engine/live';
import { bumpSkill } from '../engine/meta';
import {
  TACTIC_ICON, TACTIC_LABEL, hasPens, needsWinner, newShootout, nextKickerIsHome, penKickProb, penWinFrom, recordKick, shootoutOver, simulateShootout,
  type SimContext
} from '../engine/model';
import { poisson, rand } from '../engine/rng';
import type { DENode, LiveRecord, MatchResult, PlayableMatch, Shootout, Side, Tactic, Tournament } from '../engine/types';
import { prefs, savePrefs } from '../state/prefs';
import { T, isStale, saveGame, store } from '../state/store';
import { grantAch } from './ach';
import { logoImg, setLogo } from './crest';
import { $, escapeHtml, hideEl, isShown, setHidden, shieldClicks, shielded, showEl, srSay } from './dom';
import { liveFlow } from './flow';
import { emit } from './hooks';
import { marksHtml, sampleFor, vizSvg, type VizSample } from './liveviz';
import { attackMinigame, defenseMinigame, mgAbort, minigameActive, penaltyDefendMinigame, penaltyShootMinigame, setMinigameOnClose } from './minigames';
import * as sfx from './sound';

const TICK_MS = 80;
let liveSpeed: 1 | 2 | 4 = prefs.speed;

interface LiveState {
  m: PlayableMatch;
  side: Side;
  ctx: SimContext;
  min: number;
  endMin: number;
  period: 'REG' | 'ET' | 'PEN';
  hSc: number;
  aSc: number;
  paused: boolean;
  /** pausa das Preferências: segura o relógio sem mexer nas outras pausas */
  hold: boolean;
  /** aba em segundo plano: o relógio espera a volta */
  away: boolean;
  finished: boolean;
  et: boolean;
  pen: Shootout | null;
  timer: number | undefined;
  token: object;
  htPending: boolean;
  chance: { home: boolean; userAttacks: boolean } | null;
  kick: { home: boolean; userAttacks: boolean } | null;
  // painel ao vivo (não é salvo: recarregar a página conclui o jogo pelo simulador)
  wp: VizSample[];
  penWp: number[];
  misses: { min: number; home: boolean }[];
  ch: { h: number; a: number };
  goals: [number, 0 | 1][];
  mg: { att: number; attG: number; def: number; defG: number; penS: number; penSG: number; penD: number; penDS: number };
  maxDef: number;
  skipped: boolean;
  pensSimulated: boolean;
  trailed: { home: boolean; away: boolean };
  swings: { min: number; before: number; after: number }[];
  said80: boolean;
  upsetBy: Side | null;
}

let L: LiveState | null = null;
export const liveState = (): LiveState | null => L;
export const liveRunning = (): boolean => !!L && !L.finished;

export function chooseSide(m: PlayableMatch, cb: (side: Side) => void): void {
  const t = T();
  const box = $('side-options');
  box.innerHTML = '';
  (['home', 'away'] as const).forEach(side => {
    const x = team(t, m[side]);
    const b = document.createElement('button');
    b.className = 'flex flex-col items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 hover:border-emerald-500 rounded-2xl p-4 transition';
    b.innerHTML = `${logoImg(x, 'tm-logo')}<span class="font-black text-center">${escapeHtml(x.name)}</span><span class="text-xs text-slate-400">OVR ${x.ovr}</span>`;
    b.onclick = () => { hideEl('modal-side'); cb(side); };
    box.appendChild(b);
  });
  showEl('modal-side');
  shieldClicks(500);
}

type EventKind = 'goal' | 'goalAgainst' | 'info' | 'big' | 'note' | 'banner';
function logEvent(kind: EventKind, text: string, minute?: number): HTMLElement {
  const ev = document.createElement('div');
  const styles: Record<EventKind, string> = {
    goal: 'bg-emerald-900/40 border border-emerald-500/30 rounded-xl p-3 flex items-center gap-3',
    goalAgainst: 'bg-red-900/30 border border-red-500/30 rounded-xl p-3 flex items-center gap-3',
    info: 'text-center font-bold text-slate-400 py-2 uppercase tracking-widest text-xs',
    big: 'text-center font-black text-yellow-400 mt-2 pt-3 border-t border-slate-700/50 uppercase tracking-widest',
    note: 'bg-slate-800 border border-slate-700 rounded p-2 flex items-center justify-center gap-2 text-xs text-slate-400 italic',
    banner: 'text-center font-black rounded-xl p-3 border'
  };
  ev.className = styles[kind] + ' event-log-enter';
  const badge = minute !== undefined ? `<span class="bg-slate-950/60 text-white font-bold rounded px-2 py-1 text-xs not-italic tabular-nums">${minute}'</span>` : '';
  ev.innerHTML = `${badge}<span class="${kind === 'goal' ? 'font-bold text-emerald-100' : kind === 'goalAgainst' ? 'font-bold text-red-100' : ''}">${escapeHtml(text)}</span>`;
  $('match-events').prepend(ev);
  // narração: gols e marcos do jogo (os avisos de lance não, para não poluir)
  if (kind === 'goal' || kind === 'goalAgainst' || kind === 'info') srSay((minute !== undefined ? `${minute} ${minute === 1 ? 'minuto' : 'minutos'}. ` : '') + text);
  else if (kind === 'big' || kind === 'banner') srSay(text, true);
  return ev;
}

// ---------- Painel: gráfico, legenda e prancheta ----------
const total = (): number => (L && L.et ? 120 : 90);
const userHome = (): boolean => L!.side === 'home';

function currentSample(ctx: SimContext = L!.ctx): VizSample {
  const s = L!;
  if (s.period === 'PEN' && s.pen) {
    const adv = penWinFrom(s.pen, ctx.homeOvr, ctx.awayOvr);
    return { min: s.min, w: userHome() ? adv : 1 - adv, d: 0 };
  }
  return sampleFor(ctx, s.side, { min: s.min, hSc: s.hSc, aSc: s.aSc, period: s.period });
}

/** Guarda a chance atual (uma amostra por minuto: a mais nova do minuto substitui) e redesenha */
function sample(): void {
  if (!L) return;
  if (L.period === 'PEN') {
    L.penWp.push(currentSample().w);
  } else {
    const s = currentSample();
    const last = L.wp[L.wp.length - 1];
    if (last && last.min === s.min) L.wp[L.wp.length - 1] = s;
    else L.wp.push(s);
  }
  renderViz();
}

function renderViz(): void {
  if (!L) return;
  $('wp-svg').innerHTML = vizSvg(L.wp, total(), L.penWp);
  $('wp-marks').innerHTML = marksHtml(L.goals, L.misses, userHome(), total(), L.penWp.length > 0);
  const s = L.period === 'PEN' ? { min: L.min, w: L.penWp[L.penWp.length - 1] ?? currentSample().w, d: 0 } : L.wp[L.wp.length - 1];
  const pc = (x: number) => Math.round(x * 100) + '%';
  const legend = $('wp-legend');
  if (L.m.kind === 'group') {
    legend.innerHTML = `<span class="text-emerald-400">Você <b>${pc(s.w)}</b></span><span>Empate <b>${pc(s.d)}</b></span><span class="text-sky-400">Eles <b>${pc(1 - s.w - s.d)}</b></span>`;
  } else {
    legend.innerHTML = `<span class="text-emerald-400">Você ${L.m.kind === 'ko' ? 'avança' : 'vence'} <b>${pc(s.w)}</b></span><span class="text-slate-500">${L.period === 'PEN' ? 'nos pênaltis' : 'se o resto fosse simulado'}</span><span class="text-sky-400">Eles <b>${pc(1 - s.w)}</b></span>`;
  }
}

function ariaViz(): void {
  if (!L) return;
  const s = L.period === 'PEN' ? { w: L.penWp[L.penWp.length - 1] ?? currentSample().w, d: 0 } : currentSample();
  const pc = (x: number) => Math.round(x * 100) + '%';
  $('wp-svg').setAttribute('aria-label', L.m.kind === 'group'
    ? `Chance agora: vitória ${pc(s.w)}, empate ${pc(s.d)}, derrota ${pc(1 - s.w - s.d)}`
    : `Chance de ${L.m.kind === 'ko' ? 'avançar' : 'vencer'} agora: ${pc(s.w)}`);
}

/** "Se simulado daqui": a chance do usuário com cada postura, pelo mesmo modelo */
function renderPrancheta(): void {
  if (!L) return;
  const el = $('prancheta');
  if (L.period === 'PEN' || L.finished) { hideEl(el); return; }
  const t = T();
  const cur = L.m.tactics?.[L.side] ?? 'bal';
  const parts = (['def', 'bal', 'att'] as Tactic[]).map(v => {
    const ctx = simContext(t, L!.m, { ...currentTactics(), [L!.side]: v });
    const p = Math.round(currentSample(ctx).w * 100) + '%';
    return v === cur ? `<b class="text-white">${TACTIC_ICON[v]} ${p}</b>` : `${TACTIC_ICON[v]} ${p}`;
  });
  el.innerHTML = 'Se simulado daqui: ' + parts.join(' · ');
  showEl(el);
}

function currentTactics(): NonNullable<PlayableMatch['tactics']> {
  const t = T();
  const tac = L!.m.tactics ?? {};
  // só os clubes do usuário escolhem; o outro lado joga Equilibrado
  return { home: t.userIds.includes(L!.m.home) ? tac.home ?? 'bal' : 'bal', away: t.userIds.includes(L!.m.away) ? tac.away ?? 'bal' : 'bal' };
}

function renderTacButtons(): void {
  const cur = L ? L.m.tactics?.[L.side] ?? 'bal' : 'bal';
  document.querySelectorAll<HTMLButtonElement>('#live-tac .tac-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tac === cur)));
}

/** Troca de postura durante o jogo: vale para os minutos que faltam (e para o simulador, se a página recarregar) */
export function setLiveTactic(v: Tactic): void {
  if (!L || L.finished || L.period === 'PEN' || minigameActive()) return;
  if ((L.m.tactics?.[L.side] ?? 'bal') === v) return;
  L.m.tactics = { ...L.m.tactics, [L.side]: v };
  L.ctx = simContext(T(), L.m);
  logEvent('note', 'Você muda a postura para ' + TACTIC_LABEL[v], L.min);
  persistLive();
  renderTacButtons();
  sample();
  renderPrancheta();
}

// ---------- Placar, relógio e controles ----------
function renderClock(): void {
  if (!L) return;
  $('match-clock').textContent = L.period === 'PEN' ? 'PÊN' : `${L.min}'`;
  $('match-progress').style.width = Math.min(100, (L.min / total()) * 100) + '%';
}

function renderScore(): void {
  if (!L) return;
  $('sim-home-score').textContent = String(L.hSc);
  $('sim-away-score').textContent = String(L.aSc);
}

function renderPenBoard(): void {
  const P = L?.pen;
  const board = $('pen-board');
  if (!L || !P) { hideEl(board); board.innerHTML = ''; return; }
  showEl(board);
  const t = T();
  const row = (kicks: boolean[], name: string) => {
    const n = Math.max(5, kicks.length);
    const dots = Array.from({ length: n }, (_, i) => {
      if (i >= kicks.length) return '<span class="pen-dot"></span>';
      return kicks[i] ? '<span class="pen-dot bg-emerald-500 border-emerald-300">✓</span>' : '<span class="pen-dot bg-red-600 border-red-300">✗</span>';
    }).join('');
    return `<div class="flex items-center gap-2 min-w-0"><span class="w-24 sm:w-36 truncate text-right shrink-0">${escapeHtml(name)}</span><div class="flex flex-wrap gap-1">${dots}</div></div>`;
  };
  board.innerHTML = `<div class="text-amber-300 font-black tracking-widest uppercase text-xs">Pênaltis ${P.h} x ${P.a}</div>`
    + row(P.kicks.home, team(t, L.m.home).name) + row(P.kicks.away, team(t, L.m.away).name);
}

function setSpeedButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('.speed-btn').forEach(b => {
    const on = Number(b.dataset.speed) === liveSpeed;
    b.className = `speed-btn min-h-[44px] min-w-[44px] px-3 py-2 rounded-lg text-xs font-black ${on ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`;
    b.setAttribute('aria-pressed', String(on));
  });
}

function setSpeed(v: 1 | 2 | 4): void {
  liveSpeed = v;
  prefs.speed = v;
  savePrefs();
  setSpeedButtons();
  if (L?.timer) setLiveTimer();
}

function setLiveTimer(): void {
  if (!L) return;
  clearInterval(L.timer);
  L.timer = window.setInterval(liveTick, TICK_MS / liveSpeed);
}

function setLiveControls(running: boolean): void {
  setHidden('btn-skip-match', !running);
  setHidden('speed-controls', !running);
  setHidden('live-tac', !running);
}

/** Salva o andamento: recarregar a página não permite "rejogar" um jogo que estava sendo perdido */
function persistLive(): void {
  if (!L || L.finished) return;
  T().live = { id: L.m.id, side: L.side, min: L.min, hSc: L.hSc, aSc: L.aSc, period: L.period, et: L.et, pen: L.pen, chance: L.chance, kick: L.kick };
  saveGame();
}

export function startLive(m: PlayableMatch, side: Side): void {
  const t = T();
  const H = team(t, m.home), A = team(t, m.away);
  if (L?.timer) clearInterval(L.timer);
  emit('liveStart');
  L = {
    m, side, ctx: simContext(t, m), min: 0, endMin: 90, period: 'REG', hSc: 0, aSc: 0, paused: false, hold: false, away: document.hidden, finished: false, et: false,
    pen: null, timer: undefined, token: {}, htPending: false, chance: null, kick: null,
    wp: [], penWp: [], misses: [], ch: { h: 0, a: 0 }, goals: [],
    mg: { att: 0, attG: 0, def: 0, defG: 0, penS: 0, penSG: 0, penD: 0, penDS: 0 },
    maxDef: 0, skipped: false, pensSimulated: false, trailed: { home: false, away: false }, swings: [], said80: false, upsetBy: null
  };
  liveSpeed = prefs.speed;
  // postura no pontapé inicial (o relatório mostra as chances "antes do jogo" com ela)
  m.tac0 = { ...currentTactics() };
  const level = t.config.difficulty ?? 'normal';
  t.diffUsed = [...new Set([...(t.diffUsed ?? []), level])];

  hideEl('screen-dashboard');
  showEl('screen-match');
  hideEl('btn-finish-match');
  hideEl('btn-sim-pens');
  showEl('btn-live-settings');
  setLiveControls(true);
  setSpeedButtons();
  renderTacButtons();

  setLogo($<HTMLImageElement>('sim-home-logo'), H);
  setLogo($<HTMLImageElement>('sim-away-logo'), A);
  $('sim-home-name').textContent = H.name;
  $('sim-away-name').textContent = A.name;
  $('sim-home-ovr').textContent = `OVR ${H.ovr}`;
  $('sim-away-ovr').textContent = `OVR ${A.ovr}`;
  setHidden('sim-home-you', side !== 'home');
  setHidden('sim-away-you', side !== 'away');
  $('match-header-context').textContent = m.stage + (homeAdvantage(t, m) ? ` · mando de ${H.name}` : ' · campo neutro') + ' · ' + DIFF[level].label;
  renderScore();
  renderPenBoard();
  renderClock();
  sample();
  ariaViz();
  renderPrancheta();
  $('match-events').innerHTML = '';
  logEvent('info', `O árbitro autoriza, rola a bola! Você comanda o ${team(t, m[side]).name}.`);
  logEvent('note', 'No ataque, toque no canto livre 🎯 (os 🧤 o goleiro cobre). Na defesa, toque na bola antes que ela entre. Acertar aumenta muito a chance, mas não garante o lance.');
  persistLive();
  sfx.whistle(1, true);
  sfx.crowdBed();
  $('match-card').focus({ preventScroll: true }); // também no 2º jogo da rodada (a camada não muda)
  shieldClicks(600);
  setLiveTimer();
}

function resumeLive(delay = 450): void {
  if (!L) return;
  const tok = L.token;
  window.setTimeout(() => { if (L && L.token === tok && !L.finished && L.period !== 'PEN') L.paused = false; }, delay);
}

function halfTime(): void {
  if (!L) return;
  const t = T();
  logEvent('info', `Intervalo: ${team(t, L.m.home).name} ${L.hSc} x ${L.aSc} ${team(t, L.m.away).name} · chances ${L.ch.h} x ${L.ch.a}`);
  sfx.whistle(2);
  persistLive();
  L.paused = true;
  resumeLive(900);
}

function liveTick(): void {
  if (!L || L.paused || L.hold || L.away || L.finished) return;
  if (L.min >= L.endMin) { onPeriodEnd(); return; }
  L.min++;
  renderClock();
  sample();
  renderPrancheta(); // a cada minuto, como a legenda ao lado
  persistLive();
  if (L.min === 105 && L.period === 'ET') logEvent('info', 'Fim do 1º tempo da prorrogação');
  if (L.min === 80 && L.period === 'REG' && L.m.kind === 'ko' && !L.said80) {
    const mine = userHome() ? L.hSc : L.aSc, theirs = userHome() ? L.aSc : L.hSc;
    if (theirs - mine === 1) { L.said80 = true; logEvent('info', 'Precisa de um gol para levar à prorrogação'); }
  }
  // Um único sorteio por minuto: chance do mandante, do visitante ou nada (taxas = xG / CHANCE_CONV)
  const perMin = 1 / CHANCE_CONV / 90;
  const r = rand();
  if (r < L.ctx.xh * perMin) liveChance(true);
  else if (r < (L.ctx.xh + L.ctx.xa) * perMin) liveChance(false);
  if (L && L.min === 45 && L.period === 'REG') {
    if (L.paused) L.htPending = true; // o intervalo acontece depois do lance em andamento
    else halfTime();
  }
}

/** Frase do gol pelo placar antes e depois, do ponto de vista de quem marcou */
function goalPhrase(isHome: boolean): string {
  const s = isHome ? L!.hSc - 1 : L!.aSc - 1;     // placar do autor antes do gol
  const o = isHome ? L!.aSc : L!.hSc;
  const after = s + 1;
  if (s === 0 && o === 0) return 'abre o placar';
  if (after === o) return 'empata o jogo';
  if (s === o) return L!.trailed[isHome ? 'home' : 'away'] ? 'VIROU!' : 'desempata';
  if (after > o) return after - o >= 3 ? 'amplia. É goleada!' : 'amplia';
  return 'desconta';
}

function scoreGoal(isHome: boolean, minute: number): void {
  if (!L) return;
  const t = T();
  const before = currentSample().w;
  if (isHome) L.hSc++; else L.aSc++;
  L.goals.push([minute, isHome ? 0 : 1]);
  const phrase = goalPhrase(isHome);
  if (L.hSc < L.aSc) L.trailed.home = true;
  if (L.aSc < L.hSc) L.trailed.away = true;
  // passou à frente: uma nova virada só depois de voltar a ficar atrás
  if (L.hSc > L.aSc) L.trailed.home = false;
  if (L.aSc > L.hSc) L.trailed.away = false;
  const mine = userHome() ? L.hSc : L.aSc, theirs = userHome() ? L.aSc : L.hSc;
  L.maxDef = Math.max(L.maxDef, theirs - mine);
  renderScore();
  const el = $(isHome ? 'sim-home-score' : 'sim-away-score');
  el.classList.remove('goal-scored'); void el.offsetWidth; el.classList.add('goal-scored');
  const scorer = team(t, isHome ? L.m.home : L.m.away);
  const userGoal = userHome() === isHome;
  logEvent(userGoal ? 'goal' : 'goalAgainst', `GOL! ${scorer.name} ${phrase} (${L.hSc} x ${L.aSc})`, minute);
  // Zebra: quem lidera tem OVR 6+ abaixo do rival (o mesmo critério das estatísticas)
  const lead: Side | null = L.hSc > L.aSc ? 'home' : L.aSc > L.hSc ? 'away' : null;
  if (lead && lead !== L.upsetBy) {
    const Ld = team(t, L.m[lead]), Op = team(t, L.m[lead === 'home' ? 'away' : 'home']);
    if (Op.ovr - Ld.ovr >= 6) { L.upsetBy = lead; logEvent('info', `Zebra à vista: ${Ld.name} (OVR ${Ld.ovr}) vence o ${Op.name} (OVR ${Op.ovr})`); }
  }
  // Torcida: com mando de campo (grupos de ida e volta) a casa explode e cala; em campo neutro, a mesma reação
  if (homeAdvantage(t, L.m) > 0) sfx.crowd(isHome ? 0.35 : 0.015, 2500);
  else sfx.crowd(0.25, 2500);
  if (userGoal) sfx.buzz([60, 40, 120]);
  sample();
  L.swings.push({ min: minute, before, after: L.wp[L.wp.length - 1].w });
  ariaViz();
  renderPrancheta();
  persistLive();
}

function liveChance(isHome: boolean): void {
  if (!L) return;
  const t = T();
  const att = team(t, isHome ? L.m.home : L.m.away);
  const def = team(t, isHome ? L.m.away : L.m.home);
  const userAttacks = (L.side === 'home') === isHome;
  const tok = L.token;
  const minute = L.min;
  L.paused = true;
  L.chance = { home: isHome, userAttacks };
  L.ch[isHome ? 'h' : 'a']++;
  persistLive();
  sfx.crowd(0.1, 900);
  // Grava o lance assim que é decidido (antes de fechar o aviso), para recarregar a página não apagá-lo
  const commit = (goal: boolean, why?: string) => {
    if (!L || L.token !== tok) return;
    L.chance = null;
    // aproveitamento medido: só lances decididos no minigame
    if (userAttacks) { L.mg.att++; if (goal) L.mg.attG++; bumpSkill(T(), 'att', goal); }
    else { L.mg.def++; if (goal) L.mg.defG++; bumpSkill(T(), 'def', goal); if (!goal) sfx.buzz(30); }
    if (goal) {
      scoreGoal(isHome, minute);
      if (userAttacks && grantAch('first_live_goal', `${att.name} contra o ${def.name}, aos ${minute}'`)) logEvent('big', '🏅 Conquista: Primeiro grito');
    } else {
      L.misses.push({ min: minute, home: isHome });
      logEvent('note', why ?? 'Chance desperdiçada.', minute);
      renderViz();
      persistLive();
    }
  };
  if (userAttacks) attackMinigame(att, def, commit);
  else defenseMinigame(att, def, commit);
  setMinigameOnClose(() => {
    if (!L || L.token !== tok) return;
    if (L.htPending) { L.htPending = false; halfTime(); }
    else resumeLive(450);
  });
}

function onPeriodEnd(): void {
  if (!L) return;
  const tie = L.hSc === L.aSc;
  if (L.period === 'REG') {
    if (tie && L.m.kind === 'ko') {
      L.period = 'ET';
      L.et = true;
      L.endMin = 120;
      logEvent('big', 'Fim do tempo normal. PRORROGAÇÃO!');
      sfx.whistle(2);
      sample();
      ariaViz();
      renderPrancheta();
      persistLive();
      L.paused = true;
      resumeLive(1200);
      return;
    }
    if (tie && needsWinner(L.m.kind)) { startLiveShootout(); return; }
    finishLive();
    return;
  }
  if (L.period === 'ET') { if (tie) startLiveShootout(); else finishLive(); }
}

/** Pular: simula o tempo restante com o mesmo modelo (inclusive a prorrogação). Bloqueado só com minigame aberto. */
export function skipLive(): void {
  if (!L || L.finished || L.period === 'PEN' || minigameActive() || isShown('minigame-overlay') || shielded()) return;
  L.token = {}; // cancela retomadas pendentes (intervalo, fim de lance)
  L.paused = true;
  L.htPending = false;
  L.skipped = true;
  const live = L;
  const addGoals = (from: number, to: number) => {
    const frac = Math.max(0, to - from) / 90;
    const evs: [boolean, number][] = [];
    for (let i = poisson(live.ctx.xh * frac); i > 0; i--) evs.push([true, from + 1 + Math.floor(rand() * (to - from))]);
    for (let i = poisson(live.ctx.xa * frac); i > 0; i--) evs.push([false, from + 1 + Math.floor(rand() * (to - from))]);
    evs.sort((a, b) => a[1] - b[1]).forEach(([home, minute]) => { live.min = minute; scoreGoal(home, minute); });
  };
  if (live.period === 'REG') {
    addGoals(live.min, 90);
    live.min = 90;
    if (live.hSc === live.aSc && live.m.kind === 'ko') {
      live.period = 'ET';
      live.et = true;
      live.endMin = 120;
      logEvent('big', 'Fim do tempo normal. PRORROGAÇÃO!');
      addGoals(90, 120);
      live.min = 120;
    }
  } else if (live.period === 'ET') {
    addGoals(live.min, 120);
    live.min = 120;
  }
  renderClock();
  sample();
  if (live.hSc === live.aSc && needsWinner(live.m.kind)) startLiveShootout();
  else finishLive();
}

/** O que o resultado significa no torneio (lido do estado, logo depois de aplicar o resultado) */
function consequence(t: Tournament, m: PlayableMatch, me: string): { text: string; good: boolean } | null {
  if (m.kind === 'group') return null;
  const won = winnerId(m) === me;
  if (m.kind === 'swiss') {
    const x = team(t, me);
    if (x.status === 'advanced') return { text: '✅ 3 vitórias: classificado ao mata-mata!', good: true };
    if (x.status === 'eliminated') return { text: '❌ 3 derrotas: eliminado', good: false };
    return null;
  }
  const n = m as Partial<DENode>;
  if (t.phase === 'DE' && n.bracket) {
    if (n.isGF1) {
      if (winnerId(m) === m.home) return won ? { text: '🏆 CAMPEÃO!', good: true } : { text: 'Vice-campeão', good: false };
      return { text: 'Grande Final · Reset: mais um jogo decide o título', good: won };
    }
    if (n.isGF2) return won ? { text: '🏆 CAMPEÃO!', good: true } : { text: 'Vice-campeão', good: false };
    if (won) return n.nextW ? { text: 'Próximo jogo: ' + deNode(t, n.nextW).label, good: true } : null;
    return n.nextL ? { text: 'Cai para a ' + deNode(t, n.nextL).label, good: false } : { text: '❌ Eliminado (2ª derrota)', good: false };
  }
  const last = t.knockout[t.knockout.length - 1];
  const M = last?.matches.length ?? 0;
  if (won) return M === 1 ? { text: '🏆 CAMPEÃO!', good: true } : { text: '✅ Classificado: ' + PHASE_LABEL[PHASE_BY_COUNT[M]], good: true };
  return M === 1 ? { text: 'Vice-campeão', good: false } : { text: '❌ Eliminado: ' + m.stage, good: false };
}

/** Ficha do jogo: chances, gols, seus lances nos minigames, o gráfico congelado e o momento decisivo */
function renderFicha(t: Tournament, res: MatchResult): void {
  if (!L) return;
  const H = team(t, L.m.home), A = team(t, L.m.away);
  const goals = L.goals.map(([min, s]) => `${min}' ${escapeHtml((s === 0 ? H : A).name)}`).join(' · ') || 'sem gols';
  const g = L.mg;
  const rec = [g.att ? `finalizações ${g.attG}/${g.att}` : '', g.def ? `defesas ${g.def - g.defG}/${g.def}` : '', g.penS ? `pênaltis ${g.penSG}/${g.penS}` : '', g.penD ? `pênaltis pegos ${g.penDS}/${g.penD}` : '']
    .filter(Boolean).join(' · ');
  const best = L.swings.reduce<typeof L.swings[0] | null>((b, s) => (!b || Math.abs(s.after - s.before) > Math.abs(b.after - b.before) ? s : b), null);
  const pc = (x: number) => Math.round(x * 100) + '%';
  const box = document.createElement('div');
  box.className = 'bg-slate-900/80 border border-slate-700 rounded-xl p-3 text-xs text-slate-300 flex flex-col gap-1.5';
  box.innerHTML = `<p class="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Ficha do jogo</p>
    <p>Chances: <b>${escapeHtml(H.name)} ${L.ch.h} x ${L.ch.a} ${escapeHtml(A.name)}</b></p>
    <p>Gols: ${goals}${hasPens(res) ? ` · pênaltis ${res.penH}-${res.penA}` : ''}</p>
    ${rec ? `<p>Seus lances: ${rec}${L.skipped ? ' · usou Pular para o Fim' : ''}</p>` : L.skipped ? '<p>Usou Pular para o Fim</p>' : ''}
    <div class="wp-frozen relative rounded overflow-hidden"><svg viewBox="0 0 120 40" preserveAspectRatio="none" aria-hidden="true">${$('wp-svg').innerHTML}</svg><div class="absolute inset-0">${$('wp-marks').innerHTML}</div></div>
    ${best && Math.abs(best.after - best.before) >= 0.05 ? `<p>Momento decisivo: aos ${best.min}', sua chance foi de ${pc(best.before)} para ${pc(best.after)}.</p>` : ''}`;
  $('match-events').prepend(box);
}

function finishLive(): void {
  if (!L || L.finished) return;
  const t = T();
  clearInterval(L.timer);
  L.finished = true;
  L.paused = true;
  L.token = {};
  mgAbort();
  const m = L.m;
  const live: LiveRecord = {
    s: L.side, d: t.config.difficulty ?? 'normal', md: L.maxDef, sk: L.skipped ? 1 : 0, sp: L.pensSimulated ? 1 : 0,
    ps: [L.mg.penS, L.mg.penSG], pd: [L.mg.penD, L.mg.penDS], at: [L.mg.att, L.mg.attG], df: [L.mg.def, L.mg.defG]
  };
  const res: MatchResult = { gH: L.hSc, gA: L.aSc, et: L.et, penH: L.pen ? L.pen.h : null, penA: L.pen ? L.pen.a : null, gm: L.goals.slice(), live };
  if (L.pen) res.pk = { f: L.pen.first, h: L.pen.kicks.home.map(Number), a: L.pen.kicks.away.map(Number) };
  L.chance = null;
  L.kick = null;
  t.live = null;
  applyResult(t, m, res);
  saveGame();

  renderClock();
  renderPenBoard();
  hideEl('btn-sim-pens');
  setLiveControls(false);
  showEl('btn-live-settings');
  hideEl('prancheta');
  sfx.finalWhistle();
  sfx.stopBed(1500);
  const H = team(t, m.home), A = team(t, m.away);
  let txt: string;
  if (hasPens(res)) txt = `Fim! ${team(t, winnerId(m)).name} vence nos pênaltis por ${Math.max(res.penH, res.penA)} x ${Math.min(res.penH, res.penA)}!`;
  else if (res.gH === res.gA) txt = `Fim de jogo! Empate: ${H.name} ${res.gH} x ${res.gA} ${A.name}`;
  else txt = `Fim de jogo${res.et ? ' (na prorrogação)' : ''}! ${team(t, winnerId(m)).name} vence por ${Math.max(res.gH, res.gA)} x ${Math.min(res.gH, res.gA)}`;
  renderFicha(t, res);
  logEvent('big', txt);
  const c = consequence(t, m, m[L.side]);
  if (c) {
    const el = logEvent('banner', c.text);
    el.classList.add(...(c.good ? ['text-emerald-200', 'bg-emerald-900/40', 'border-emerald-500/40'] : ['text-red-200', 'bg-red-900/30', 'border-red-500/40']));
  }
  $('match-events').scrollTop = 0;

  const btn = $('btn-finish-match');
  btn.textContent = liveFlow.hasMoreUserMatches() ? 'Próximo Jogo →' : 'Ver Resultados da Rodada →';
  showEl(btn);
  btn.focus({ preventScroll: true });
  shieldClicks(700);
  btn.onclick = () => {
    if (shielded()) return;
    shieldClicks();
    hideEl(btn);
    emit('liveEnd');
    liveFlow.next();
  };
}

export function closeMatchScreen(): void {
  if (L?.timer) clearInterval(L.timer);
  mgAbort();
  sfx.stopBed();
  hideEl('screen-match');
  showEl('screen-dashboard');
}

/** Encerra qualquer partida em andamento sem gravar (usado ao começar um torneio novo) */
export function discardLive(): void {
  if (L?.timer) clearInterval(L.timer);
  if (L) { L.finished = true; L.token = {}; }
  L = null;
  mgAbort();
  sfx.stopBed();
}

// ---------- Pênaltis ao vivo ----------
function startLiveShootout(): void {
  if (!L) return;
  clearInterval(L.timer);
  L.period = 'PEN';
  L.paused = true;
  L.htPending = false;
  L.pen = newShootout();
  const first = team(T(), L.pen.first === 'home' ? L.m.home : L.m.away);
  logEvent('big', 'DISPUTA DE PÊNALTIS!');
  logEvent('info', `${first.name} começa batendo (cara ou coroa).`);
  setLiveControls(false);
  hideEl('btn-live-settings');
  showEl('btn-sim-pens');
  sfx.crowd(0.08, 1500);
  renderPenBoard();
  renderClock();
  sample();
  ariaViz();
  renderPrancheta();
  persistLive();
  shieldClicks(700);
  const tok = L.token;
  window.setTimeout(() => { if (L && L.token === tok) whenVisible(nextLiveKick); }, 1400);
}

function nextLiveKick(): void {
  if (!L || !L.pen) return;
  const P = L.pen;
  if (shootoutOver(P)) { finishLive(); return; }
  const t = T();
  const homeKicks = nextKickerIsHome(P);
  const att = team(t, homeKicks ? L.m.home : L.m.away);
  const def = team(t, homeKicks ? L.m.away : L.m.home);
  const userAttacks = (L.side === 'home') === homeKicks;
  const tok = L.token;
  L.kick = { home: homeKicks, userAttacks };
  persistLive();
  const commit = (goal: boolean, why?: string, miss = false) => {
    if (!L || L.token !== tok) return;
    L.kick = null;
    recordKick(P, homeKicks, goal);
    const e = penKickProb(att.ovr, def.ovr);
    if (userAttacks) { L.mg.penS++; if (goal) L.mg.penSG++; bumpSkill(T(), 'penS', goal, e); }
    // "pênaltis pegos": só defesas de verdade (chute para fora não conta)
    else { L.mg.penD++; if (!goal && !miss) { L.mg.penDS++; sfx.buzz(30); } bumpSkill(T(), 'penD', goal, e); }
    logEvent(goal ? ((L.side === 'home') === homeKicks ? 'goal' : 'goalAgainst') : 'note', `${goal ? '⚽' : '❌'} ${att.name}: ${why ?? ''}`);
    renderPenBoard();
    sample();
    ariaViz();
    // conquistas no momento em que acontecem (só cobranças do minigame)
    if (L.mg.penDS >= 3 && grantAch('wall', `${team(t, L.m[L.side]).name}: ${L.mg.penDS} pênaltis pegos numa disputa`)) logEvent('big', '🏅 Conquista: Paredão');
    if (shootoutOver(P) && L.mg.penS >= 5 && L.mg.penSG === L.mg.penS && grantAch('ice', `${team(t, L.m[L.side]).name}: ${L.mg.penSG}/${L.mg.penS} nas cobranças`)) logEvent('big', '🏅 Conquista: Sangue frio');
    persistLive();
  };
  if (userAttacks) penaltyShootMinigame(att, def, P.userCols, commit);
  else penaltyDefendMinigame(att, def, commit);
  setMinigameOnClose(() => {
    if (!L || L.token !== tok) return;
    const over = shootoutOver(P);
    window.setTimeout(() => { if (L && L.token === tok) { if (over) finishLive(); else whenVisible(nextLiveKick); } }, over ? 500 : 700);
  });
}

function simulateRemainingPens(): void {
  if (!L || L.period !== 'PEN' || L.finished || !L.pen || shielded()) return;
  mgAbort(); // uma cobrança já decidida e mostrada já foi registrada; a que estava aberta será simulada
  L.token = {};
  L.kick = null;
  const P = L.pen;
  if (!shootoutOver(P)) {
    const t = T();
    L.pensSimulated = true;
    const before = { h: P.kicks.home.length, a: P.kicks.away.length };
    simulateShootout(L.ctx.homeOvr, L.ctx.awayOvr, P);
    const fmt = (arr: boolean[]) => arr.map(g => (g ? '✓' : '✗')).join(' ') || '—';
    logEvent('note', `Cobranças simuladas: ${team(t, L.m.home).name} ${fmt(P.kicks.home.slice(before.h))} · ${team(t, L.m.away).name} ${fmt(P.kicks.away.slice(before.a))}`);
    sample();
  }
  finishLive();
}

// ---------- Outras abas ----------
// Uma aba que vai continuar o torneio pergunta se a partida salva está sendo jogada agora em outra aba.
const tabs: BroadcastChannel | null = (() => { try { return new BroadcastChannel('mundial64-live'); } catch { return null; } })();
tabs?.addEventListener('message', e => {
  const d = e.data;
  if (d?.type !== 'who-plays' || !L || L.finished || isStale() || L.m.id !== d.id) return;
  if (d.tid && store.t?.tid !== d.tid) return; // mesmo id de partida, outro torneio
  tabs.postMessage({ type: 'playing', id: L.m.id });
});

/** true se outra aba responde que está jogando essa partida (espera até 300 ms) */
export function liveElsewhere(matchId: string, tid?: string): Promise<boolean> {
  if (!tabs) return Promise.resolve(false);
  return new Promise(resolve => {
    const onMsg = (e: MessageEvent) => { if (e.data?.type === 'playing' && e.data.id === matchId) done(true); };
    const done = (v: boolean) => { tabs.removeEventListener('message', onMsg); clearTimeout(timer); resolve(v); };
    tabs.addEventListener('message', onMsg);
    const timer = window.setTimeout(() => done(false), 300);
    tabs.postMessage({ type: 'who-plays', id: matchId, tid });
  });
}

/** Com a aba em segundo plano, a próxima cobrança só abre quando o jogador voltar */
function whenVisible(fn: () => void): void {
  if (!document.hidden) { fn(); return; }
  const tok = L?.token;
  const back = () => {
    if (document.hidden) return;
    document.removeEventListener('visibilitychange', back);
    if (L && L.token === tok) fn();
  };
  document.addEventListener('visibilitychange', back);
}

// ---------- Preferências e teclado ----------
/** Abrir as Preferências no meio do jogo segura o relógio (o minigame nunca está aberto nessa hora) */
export function holdLive(on: boolean): void {
  if (!L || L.finished) return;
  L.hold = on;
}

/** Teclas da partida ao vivo. Devolve true se tratou. */
export function liveKey(e: KeyboardEvent): boolean {
  if (!L || L.finished || !isShown('screen-match')) return false;
  const k = e.key.toLowerCase();
  if (k === '1' || k === '2' || k === '4') {
    if (L.period === 'PEN') return false;
    setSpeed(Number(k) as 1 | 2 | 4);
    return true;
  }
  if (k === 'p') { skipLive(); return true; }
  const tac = ({ r: 'def', e: 'bal', o: 'att' } as Record<string, Tactic>)[k];
  if (tac) { setLiveTactic(tac); return true; }
  return false;
}

export function initLive(): void {
  document.querySelectorAll<HTMLButtonElement>('.speed-btn').forEach(b => {
    b.onclick = () => setSpeed(Number(b.dataset.speed) as 1 | 2 | 4);
  });
  document.querySelectorAll<HTMLButtonElement>('#live-tac .tac-btn').forEach(b => {
    b.onclick = () => setLiveTactic(b.dataset.tac as Tactic);
  });
  $('btn-skip-match').onclick = skipLive;
  $('btn-sim-pens').onclick = simulateRemainingPens;
  $('mg-sim-pens').onclick = simulateRemainingPens;
  window.addEventListener('pagehide', persistLive);
  document.addEventListener('visibilitychange', () => { if (L && !L.finished) L.away = document.hidden; });
  setSpeedButtons();
}
