// Partida ao vivo: relógio, chances (minigames), prorrogação, pênaltis e salvamento a cada lance
import { applyResult, homeAdvantage, simContext, team, winnerId } from '../engine/core';
import { CHANCE_CONV } from '../engine/live';
import { hasPens, matchOdds, needsWinner, newShootout, nextKickerIsHome, recordKick, shootoutOver, simulateShootout, type SimContext } from '../engine/model';
import { poisson, rand } from '../engine/rng';
import type { MatchResult, PlayableMatch, Shootout, Side } from '../engine/types';
import { T, saveGame } from '../state/store';
import { logoImg, setLogo } from './crest';
import { $, escapeHtml, hideEl, isShown, pct, setHidden, shieldClicks, shielded, showEl } from './dom';
import { attackMinigame, defenseMinigame, mgAbort, minigameActive, penaltyDefendMinigame, penaltyShootMinigame, setMinigameOnClose } from './minigames';
import { liveFlow } from './flow';

const TICK_MS = 80;
let liveSpeed = 1;

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
  finished: boolean;
  et: boolean;
  pen: Shootout | null;
  timer: number | undefined;
  token: object;
  htPending: boolean;
  chance: { home: boolean; userAttacks: boolean } | null;
  kick: { home: boolean; userAttacks: boolean } | null;
  /** [minuto, 0=mandante/1=visitante, 1=gol] */
  events: [number, 0 | 1, 0 | 1][];
}

let L: LiveState | null = null;
export const liveState = (): LiveState | null => L;

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

type EventKind = 'goal' | 'goalAgainst' | 'info' | 'big' | 'note';
function logEvent(kind: EventKind, text: string, minute?: number): void {
  const ev = document.createElement('div');
  const styles: Record<EventKind, string> = {
    goal: 'bg-emerald-900/40 border border-emerald-500/30 rounded-xl p-3 flex items-center gap-3',
    goalAgainst: 'bg-red-900/30 border border-red-500/30 rounded-xl p-3 flex items-center gap-3',
    info: 'text-center font-bold text-slate-400 py-2 uppercase tracking-widest text-xs',
    big: 'text-center font-black text-yellow-400 mt-2 pt-3 border-t border-slate-700/50 uppercase tracking-widest',
    note: 'bg-slate-800 border border-slate-700 rounded p-2 flex items-center justify-center gap-2 text-xs text-slate-400 italic'
  };
  ev.className = styles[kind] + ' event-log-enter';
  const badge = minute !== undefined ? `<span class="bg-slate-950/60 text-white font-bold rounded px-2 py-1 text-xs not-italic tabular-nums">${minute}'</span>` : '';
  ev.innerHTML = `${badge}<span class="${kind === 'goal' ? 'font-bold text-emerald-100' : kind === 'goalAgainst' ? 'font-bold text-red-100' : ''}">${escapeHtml(text)}</span>`;
  $('match-events').prepend(ev);
}

function renderClock(): void {
  if (!L) return;
  $('match-clock').textContent = L.period === 'PEN' ? 'PÊN' : `${L.min}'`;
  const total = L.et ? 120 : 90;
  $('match-progress').style.width = Math.min(100, (L.min / total) * 100) + '%';
  renderLiveOdds();
}

/** Probabilidade ao vivo pelo placar e pelo tempo que falta (mesmo modelo do simulador) */
function renderLiveOdds(): void {
  if (!L) return;
  const t = T();
  const H = team(t, L.m.home), A = team(t, L.m.away);
  const bar = $('live-odds-bar'), legend = $('live-odds-legend');
  if (L.period === 'PEN' || L.finished) { hideEl('live-odds'); return; }
  showEl('live-odds');
  const remaining = L.period === 'ET' ? (120 - L.min) / 30 : (90 - L.min) / 90;
  const o = matchOdds(L.ctx, { hSc: L.hSc, aSc: L.aSc, remaining, period: L.period === 'ET' ? 'ET' : 'REG' });
  if (o.advH !== undefined) {
    bar.innerHTML = `<div class="bg-emerald-500 transition-all duration-300" style="width:${o.advH * 100}%"></div><div class="bg-sky-500 transition-all duration-300" style="width:${(1 - o.advH) * 100}%"></div>`;
    legend.innerHTML = `<span class="text-emerald-400 truncate"><b>${pct(o.advH)}</b> ${escapeHtml(H.name)}</span><span class="text-slate-500 shrink-0">${L.m.kind === 'ko' ? 'chance de avançar' : 'chance de vencer'}</span><span class="text-sky-400 truncate text-right">${escapeHtml(A.name)} <b>${pct(1 - o.advH)}</b></span>`;
  } else {
    bar.innerHTML = `<div class="bg-emerald-500 transition-all duration-300" style="width:${o.ph * 100}%"></div><div class="bg-slate-500 transition-all duration-300" style="width:${o.pd * 100}%"></div><div class="bg-sky-500 transition-all duration-300" style="width:${o.pa * 100}%"></div>`;
    legend.innerHTML = `<span class="text-emerald-400 truncate"><b>${pct(o.ph)}</b> ${escapeHtml(H.name)}</span><span class="shrink-0">Empate <b>${pct(o.pd)}</b></span><span class="text-sky-400 truncate text-right">${escapeHtml(A.name)} <b>${pct(o.pa)}</b></span>`;
  }
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
    b.className = `speed-btn px-3 py-2 rounded-lg text-xs font-black ${on ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`;
    b.setAttribute('aria-pressed', String(on));
  });
}

function setLiveTimer(): void {
  if (!L) return;
  clearInterval(L.timer);
  L.timer = window.setInterval(liveTick, TICK_MS / liveSpeed);
}

/** Salva o andamento: recarregar a página não permite "rejogar" um jogo que estava sendo perdido */
function persistLive(): void {
  if (!L || L.finished) return;
  T().live = { id: L.m.id, side: L.side, min: L.min, hSc: L.hSc, aSc: L.aSc, period: L.period, et: L.et, pen: L.pen, chance: L.chance, kick: L.kick, events: L.events };
  saveGame();
}

export function startLive(m: PlayableMatch, side: Side): void {
  const t = T();
  const H = team(t, m.home), A = team(t, m.away);
  if (L?.timer) clearInterval(L.timer);
  L = {
    m, side, ctx: simContext(t, m), min: 0, endMin: 90, period: 'REG', hSc: 0, aSc: 0, paused: false, finished: false, et: false,
    pen: null, timer: undefined, token: {}, htPending: false, chance: null, kick: null, events: []
  };

  hideEl('screen-dashboard');
  showEl('screen-match');
  hideEl('btn-finish-match');
  hideEl('btn-sim-pens');
  showEl('btn-skip-match');
  showEl('speed-controls');
  setSpeedButtons();

  setLogo($<HTMLImageElement>('sim-home-logo'), H);
  setLogo($<HTMLImageElement>('sim-away-logo'), A);
  $('sim-home-name').textContent = H.name;
  $('sim-away-name').textContent = A.name;
  $('sim-home-ovr').textContent = `OVR ${H.ovr}`;
  $('sim-away-ovr').textContent = `OVR ${A.ovr}`;
  setHidden('sim-home-you', side !== 'home');
  setHidden('sim-away-you', side !== 'away');
  $('match-header-context').textContent = m.stage + (homeAdvantage(t, m) ? ` · mando de ${H.name}` : ' · campo neutro');
  renderScore();
  renderPenBoard();
  renderClock();
  $('match-events').innerHTML = '';
  logEvent('info', `O árbitro autoriza, rola a bola! Você comanda o ${team(t, m[side]).name}.`);
  logEvent('note', 'No ataque, toque no canto livre 🎯 (os 🧤 o goleiro cobre). Na defesa, toque na bola antes que ela entre. Acertar aumenta muito a chance, mas não garante o lance.');
  persistLive();
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
  logEvent('info', 'Fim do 1º tempo');
  persistLive();
  L.paused = true;
  resumeLive(900);
}

function liveTick(): void {
  if (!L || L.paused || L.finished) return;
  if (L.min >= L.endMin) { onPeriodEnd(); return; }
  L.min++;
  renderClock();
  persistLive();
  if (L.min === 105 && L.period === 'ET') logEvent('info', 'Fim do 1º tempo da prorrogação');
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

function scoreGoal(isHome: boolean, minute: number): void {
  if (!L) return;
  if (isHome) L.hSc++; else L.aSc++;
  L.events.push([minute, isHome ? 0 : 1, 1]);
  renderScore();
  renderLiveOdds();
  const el = $(isHome ? 'sim-home-score' : 'sim-away-score');
  el.classList.remove('goal-scored'); void el.offsetWidth; el.classList.add('goal-scored');
  const scorer = team(T(), isHome ? L.m.home : L.m.away);
  const mine = (L.side === 'home') === isHome;
  logEvent(mine ? 'goal' : 'goalAgainst', `GOL! ${scorer.name}  (${L.hSc} x ${L.aSc})`, minute);
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
  persistLive();
  // Grava o lance assim que é decidido (antes de fechar o aviso), para recarregar a página não apagá-lo
  const commit = (goal: boolean, why?: string) => {
    if (!L || L.token !== tok) return;
    L.chance = null;
    if (goal) scoreGoal(isHome, minute);
    else { L.events.push([minute, isHome ? 0 : 1, 0]); logEvent('note', why ?? 'Chance desperdiçada.', minute); persistLive(); }
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
function skipLive(): void {
  if (!L || L.finished || L.period === 'PEN' || minigameActive() || isShown('minigame-overlay') || shielded()) return;
  L.token = {}; // cancela retomadas pendentes (intervalo, fim de lance)
  L.paused = true;
  L.htPending = false;
  const live = L;
  const addGoals = (from: number, to: number) => {
    const frac = Math.max(0, to - from) / 90;
    const evs: [boolean, number][] = [];
    for (let i = poisson(live.ctx.xh * frac); i > 0; i--) evs.push([true, from + 1 + Math.floor(rand() * (to - from))]);
    for (let i = poisson(live.ctx.xa * frac); i > 0; i--) evs.push([false, from + 1 + Math.floor(rand() * (to - from))]);
    evs.sort((a, b) => a[1] - b[1]).forEach(([home, minute]) => scoreGoal(home, minute));
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
  if (live.hSc === live.aSc && needsWinner(live.m.kind)) startLiveShootout();
  else finishLive();
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
  const res: MatchResult = { gH: L.hSc, gA: L.aSc, et: L.et, penH: L.pen ? L.pen.h : null, penA: L.pen ? L.pen.a : null, live: true, events: L.events };
  L.chance = null;
  L.kick = null;
  t.live = null;
  applyResult(t, m, res);
  saveGame();

  renderClock();
  renderPenBoard();
  hideEl('btn-skip-match');
  hideEl('btn-sim-pens');
  hideEl('speed-controls');
  const H = team(t, m.home), A = team(t, m.away);
  let txt: string;
  if (hasPens(res)) txt = `Fim! ${team(t, winnerId(m)).name} vence nos pênaltis por ${Math.max(res.penH, res.penA)} x ${Math.min(res.penH, res.penA)}!`;
  else if (res.gH === res.gA) txt = `Fim de jogo! Empate: ${H.name} ${res.gH} x ${res.gA} ${A.name}`;
  else txt = `Fim de jogo${res.et ? ' (na prorrogação)' : ''}! ${team(t, winnerId(m)).name} vence por ${Math.max(res.gH, res.gA)} x ${Math.min(res.gH, res.gA)}`;
  logEvent('big', txt);

  const btn = $('btn-finish-match');
  btn.textContent = liveFlow.hasMoreUserMatches() ? 'Próximo Jogo →' : 'Ver Resultados da Rodada →';
  showEl(btn);
  shieldClicks(700);
  btn.onclick = () => {
    if (shielded()) return;
    shieldClicks();
    hideEl(btn);
    liveFlow.next();
  };
}

export function closeMatchScreen(): void {
  if (L?.timer) clearInterval(L.timer);
  mgAbort();
  hideEl('screen-match');
  showEl('screen-dashboard');
}

/** Encerra qualquer partida em andamento sem gravar (usado ao começar um torneio novo) */
export function discardLive(): void {
  if (L?.timer) clearInterval(L.timer);
  if (L) { L.finished = true; L.token = {}; }
  L = null;
  mgAbort();
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
  hideEl('btn-skip-match');
  hideEl('speed-controls');
  showEl('btn-sim-pens');
  renderPenBoard();
  renderClock();
  persistLive();
  shieldClicks(700);
  const tok = L.token;
  window.setTimeout(() => { if (L && L.token === tok) nextLiveKick(); }, 1400);
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
  const commit = (goal: boolean, why?: string) => {
    if (!L || L.token !== tok) return;
    L.kick = null;
    recordKick(P, homeKicks, goal);
    logEvent(goal ? ((L.side === 'home') === homeKicks ? 'goal' : 'goalAgainst') : 'note', `${goal ? '⚽' : '❌'} ${att.name}: ${why ?? ''}`);
    renderPenBoard();
    persistLive();
  };
  if (userAttacks) penaltyShootMinigame(att, def, P.userCols, commit);
  else penaltyDefendMinigame(att, def, commit);
  setMinigameOnClose(() => {
    if (!L || L.token !== tok) return;
    const over = shootoutOver(P);
    window.setTimeout(() => { if (L && L.token === tok) { if (over) finishLive(); else nextLiveKick(); } }, over ? 500 : 700);
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
    const before = { h: P.kicks.home.length, a: P.kicks.away.length };
    simulateShootout(L.ctx.homeOvr, L.ctx.awayOvr, P);
    const fmt = (arr: boolean[]) => arr.map(g => (g ? '✓' : '✗')).join(' ') || '—';
    logEvent('note', `Cobranças simuladas: ${team(t, L.m.home).name} ${fmt(P.kicks.home.slice(before.h))} · ${team(t, L.m.away).name} ${fmt(P.kicks.away.slice(before.a))}`);
  }
  finishLive();
}

export function initLive(): void {
  document.querySelectorAll<HTMLButtonElement>('.speed-btn').forEach(b => {
    b.onclick = () => {
      liveSpeed = Number(b.dataset.speed);
      setSpeedButtons();
      if (L?.timer) setLiveTimer();
    };
  });
  $('btn-skip-match').onclick = skipLive;
  $('btn-sim-pens').onclick = simulateRemainingPens;
  $('mg-sim-pens').onclick = simulateRemainingPens;
  window.addEventListener('pagehide', persistLive);
}
