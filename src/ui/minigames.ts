// Minigames da partida ao vivo: chance de ataque, defesa e pênaltis.
// Toque, mouse e teclado passam pelo mesmo .click() do botão: a mesma trava e as mesmas janelas valem para todos.
import { COL_LOOK, COL_SPOT, PEN_ROW, aiPenaltyKick, diffOf, keeperGuess, ovrWindow, penaltyOutcome, type DiffParams, type PenaltyOutcome } from '../engine/live';
import { rand, shuffle } from '../engine/rng';
import type { TeamState } from '../engine/types';
import { store } from '../state/store';
import { $, hideEl, setHidden, showEl } from './dom';
import * as sfx from './sound';

type Commit = (goal: boolean, why?: string) => void;
type Sfx = 'goal' | 'save' | 'post' | 'miss';

const MG: {
  timers: { id: number; fn: () => void; due: number }[];
  /** aba em segundo plano: quando pausou (0 = rodando) e quando a barra de tempo zera */
  pausedAt: number;
  barEnd: number;
  active: boolean;
  onClose: (() => void) | null;
  cells: HTMLButtonElement[];
  targets: HTMLButtonElement[];
  ball: HTMLButtonElement | null;
  mode: 'att' | 'def' | 'penS' | 'penD' | null;
} = { timers: [], pausedAt: 0, barEnd: 0, active: false, onClose: null, cells: [], targets: [], ball: null, mode: null };

const BOX_WIDE = 'relative w-full max-w-2xl aspect-[4/3] sm:aspect-[2/1] border-4 border-b-0 border-white/80 rounded-t shadow-[inset_0_0_50px_rgba(255,255,255,0.2)] bg-emerald-900/20 overflow-hidden';
const BOX_PEN = 'relative w-full max-w-md aspect-[3/2] border-4 border-b-0 border-white/80 rounded-t shadow-[inset_0_0_50px_rgba(255,255,255,0.2)] bg-emerald-900/20 overflow-hidden';

/** Parâmetros da dificuldade do torneio em andamento (Normal = valores calibrados) */
export const curDiff = (): DiffParams => diffOf(store.t?.config.difficulty);

export const minigameActive = (): boolean => MG.active;
/** Continuação a executar depois que o aviso do lance fecha */
export const setMinigameOnClose = (fn: (() => void) | null): void => { MG.onClose = fn; };

function schedule(fn: () => void, due: number): void {
  const entry = { id: 0, fn, due };
  entry.id = window.setTimeout(() => { MG.timers = MG.timers.filter(x => x !== entry); fn(); }, Math.max(0, due - performance.now()));
  MG.timers.push(entry);
}
function mgTimer(fn: () => void, ms: number): void { schedule(fn, performance.now() + ms); }
function clearTimers(): void {
  MG.timers.forEach(x => clearTimeout(x.id));
  MG.timers = [];
  MG.pausedAt = 0;
}

/**
 * Aba em segundo plano: o lance aberto congela (tempo e barra) e continua de onde parou na volta.
 * Assim o jogador não perde uma chance ou cobrança por trocar de aba.
 */
function pauseMinigame(): void {
  if (MG.pausedAt || !MG.timers.length) return;
  MG.pausedAt = performance.now();
  MG.timers.forEach(x => clearTimeout(x.id));
  if (MG.active && MG.barEnd > MG.pausedAt) mgStopBar(false);
}
function resumeMinigame(): void {
  if (!MG.pausedAt) return;
  const shift = performance.now() - MG.pausedAt;
  MG.pausedAt = 0;
  const pending = MG.timers;
  MG.timers = [];
  pending.forEach(x => schedule(x.fn, x.due + shift));
  if (MG.active && MG.barEnd) {
    MG.barEnd += shift;
    const left = MG.barEnd - performance.now();
    if (left > 0) {
      const bar = $('mg-timer-bar');
      void bar.offsetWidth;
      bar.style.transition = `width ${Math.round(left)}ms linear`;
      bar.style.width = '0%';
    }
  }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseMinigame(); else resumeMinigame(); });

/** Tique-taque nos últimos instantes do tempo de reação */
function mgTicks(ms: number): void {
  [1000, 500, 250].forEach(before => { if (ms - before > 0) mgTimer(sfx.tick, ms - before); });
}

// Último tipo de entrada usado: os números de tecla só aparecem para quem está no teclado
let lastInput: 'key' | 'pointer' = 'pointer';
document.addEventListener('pointerdown', () => { lastInput = 'pointer'; }, true);
document.addEventListener('keydown', () => { lastInput = 'key'; }, true);

function resetInputs(): void {
  MG.cells = [];
  MG.targets = [];
  MG.ball = null;
}

function mgOpen(title: string, subtitle: string, boxClass: string, inShootout: boolean, mode: NonNullable<typeof MG.mode>): void {
  clearTimers();
  MG.active = true;
  MG.onClose = null;
  MG.mode = mode;
  resetInputs();
  $('mg-title').textContent = title;
  $('mg-subtitle').textContent = subtitle;
  $('mg-targets').innerHTML = '';
  const fb = $('mg-feedback');
  fb.textContent = '';
  fb.className = 'min-h-[2.5rem] sm:min-h-[3rem] mt-2 text-center text-2xl sm:text-4xl font-black';
  $('minigame-box').className = boxClass;
  setHidden('mg-sim-pens', !inShootout);
  const bar = $('mg-timer-bar');
  bar.style.transition = 'none';
  bar.style.width = '100%';
  $('screen-match').inert = true;
  const ov = $('minigame-overlay');
  ov.setAttribute('aria-describedby', 'mg-subtitle');
  showEl(ov);
  ov.focus({ preventScroll: true });
}

function mgStartBar(ms: number): void {
  MG.barEnd = performance.now() + ms;
  const bar = $('mg-timer-bar');
  bar.style.transition = 'none';
  bar.style.width = '100%';
  void bar.offsetWidth;
  bar.style.transition = `width ${ms}ms linear`;
  bar.style.width = '0%';
}

function mgStopBar(empty: boolean): void {
  if (!MG.pausedAt) MG.barEnd = 0;
  const bar = $('mg-timer-bar');
  const w = empty ? '0%' : getComputedStyle(bar).width;
  bar.style.transition = 'none';
  bar.style.width = w;
}

function mgClose(): void {
  hideEl('minigame-overlay');
  $('screen-match').inert = false;
}

const SFX_PLAY: Record<Sfx, () => void> = { goal: sfx.net, save: sfx.save, post: sfx.post, miss: sfx.miss };

/** Encerra o minigame uma única vez (protege contra clique + timeout simultâneos) */
function mgFinish(text: string, color: string, commit: () => void, delay = 850, timedOut = false, sound?: Sfx): void {
  if (!MG.active) return;
  MG.active = false;
  clearTimers();
  mgStopBar(timedOut);
  const fb = $('mg-feedback');
  fb.textContent = text;
  fb.className = `min-h-[2.5rem] sm:min-h-[3rem] mt-2 text-center text-2xl sm:text-4xl font-black ${color}`;
  if (sound) SFX_PLAY[sound]();
  commit(); // o resultado vale a partir de agora; o aviso só fecha depois
  mgTimer(mgFlush, delay);
}

function mgFlush(): void {
  const next = MG.onClose;
  MG.onClose = null;
  clearTimers();
  MG.mode = null;
  resetInputs();
  mgClose();
  $('match-card').focus({ preventScroll: true });
  next?.();
}

export function mgAbort(): void {
  MG.active = false;
  MG.onClose = null;
  MG.mode = null;
  clearTimers();
  resetInputs();
  mgClose();
}

/** Toque, clique ou teclado (Enter/Espaço disparam 'click'); a trava MG.active evita contar duas vezes */
function onHit(el: HTMLElement, fn: () => void): void {
  el.addEventListener('pointerdown', e => { e.preventDefault(); fn(); });
  el.addEventListener('click', e => { e.preventDefault(); fn(); });
}

function slotPos(slot: number): { left: number; top: number } {
  const col = slot % 5, row = Math.floor(slot / 5);
  return { left: 10 + col * 20 + (rand() * 4 - 2), top: 18 + row * 32 + (rand() * 4 - 2) };
}

/** Ataque: um canto livre (🎯) e os outros cobertos pelo goleiro (🧤) */
export function attackMinigame(att: TeamState, def: TeamState, cb: Commit): void {
  const D = curDiff();
  const time = ovrWindow(1000 * D.win, att.ovr - def.ovr);
  mgOpen('⚽ CHANCE DE GOL!', `${att.name} no ataque — toque no canto livre 🎯 antes que a zaga feche!`, BOX_WIDE, false, 'att');
  const slots = shuffle([...Array(15).keys()]).slice(0, D.gloves + 1);
  const goodIdx = Math.floor(rand() * (D.gloves + 1)); // ordem no DOM aleatória: o 1º Tab não entrega o canto livre
  const placed: { btn: HTMLButtonElement; left: number; top: number }[] = [];
  slots.forEach((s, i) => {
    const good = i === goodIdx;
    const pos = slotPos(s);
    const btn = document.createElement('button');
    btn.className = `absolute -translate-x-1/2 -translate-y-1/2 w-12 h-12 md:w-14 md:h-14 rounded-full border-4 text-xl md:text-2xl flex items-center justify-center transition active:scale-90 focus:outline-none focus-visible:ring-4 focus-visible:ring-yellow-300 ${good ? 'bg-emerald-500/90 border-white shadow-[0_0_18px_rgba(16,185,129,0.9)]' : 'bg-slate-700/90 border-slate-400'}`;
    btn.style.left = pos.left + '%';
    btn.style.top = pos.top + '%';
    btn.textContent = good ? '🎯' : '🧤';
    btn.setAttribute('aria-label', good ? 'Canto livre' : 'Canto coberto pelo goleiro');
    onHit(btn, () => {
      if (!MG.active) return;
      sfx.kick();
      if (good) {
        if (rand() < D.aimGoal) mgFinish('GOOOOL!', 'text-emerald-400', () => cb(true), 850, false, 'goal');
        else if (rand() < 0.5) mgFinish('NA TRAVE!', 'text-amber-300', () => cb(false, 'Achou o canto livre, mas a bola explodiu na trave!'), 850, false, 'post');
        else mgFinish('QUE DEFESA!', 'text-amber-300', () => cb(false, `Achou o canto livre, mas o goleiro do ${def.name} voou e espalmou!`), 850, false, 'save');
      } else if (rand() < D.keeperGoal) {
        mgFinish('GOL! O GOLEIRO SOLTOU!', 'text-emerald-400', () => cb(true), 850, false, 'goal');
      } else {
        mgFinish('O GOLEIRO DEFENDEU!', 'text-red-400', () => cb(false, `Chutou onde o goleiro estava. Defesa do ${def.name}!`), 850, false, 'save');
      }
    });
    $('mg-targets').appendChild(btn);
    placed.push({ btn, ...pos });
  });
  // Teclas 1..n seguem a ordem visual da esquerda para a direita (não revelam nada que não esteja na tela)
  MG.targets = placed.sort((a, b) => a.left - b.left || a.top - b.top).map(p => p.btn);
  MG.targets.forEach((b, i) => b.setAttribute('aria-label', `${b.getAttribute('aria-label')}, tecla ${i + 1}`));
  if (lastInput === 'key') {
    MG.targets.forEach((b, i) => {
      const badge = document.createElement('span');
      badge.className = 'absolute -top-2 -right-2 bg-slate-950 text-white text-[10px] font-black rounded-full w-5 h-5 flex items-center justify-center border border-slate-500';
      badge.textContent = String(i + 1);
      badge.setAttribute('aria-hidden', 'true');
      b.appendChild(badge);
    });
  }
  mgStartBar(time);
  mgTicks(time);
  mgTimer(() => {
    if (rand() < D.lateGoal) mgFinish('DESVIOU E ENTROU!', 'text-emerald-400', () => cb(true), 850, true, 'goal');
    else mgFinish('DEMOROU!', 'text-red-400', () => cb(false, 'Demorou para finalizar e a zaga travou o chute.'), 850, true, 'miss');
  }, time);
}

/** Defesa: a bola aparece num ponto do gol após um instante; toque nela a tempo */
export function defenseMinigame(att: TeamState, def: TeamState, cb: Commit): void {
  const D = curDiff();
  const time = ovrWindow(750 * D.win, def.ovr - att.ovr);
  mgOpen('🧤 DEFENDA O CHUTE!', `${att.name} vai finalizar — toque na bola antes que ela entre!`, BOX_WIDE, false, 'def');
  mgTimer(() => {
    if (!MG.active) return;
    const pos = slotPos(Math.floor(rand() * 15));
    const ball = document.createElement('button');
    ball.className = 'absolute -translate-x-1/2 -translate-y-1/2 w-12 h-12 md:w-14 md:h-14 bg-red-600 border-4 border-red-200 rounded-full shadow-[0_0_20px_red] animate-pulse text-xl md:text-2xl flex items-center justify-center active:scale-90 focus:outline-none focus-visible:ring-4 focus-visible:ring-yellow-300';
    ball.style.left = pos.left + '%';
    ball.style.top = pos.top + '%';
    ball.textContent = '⚽';
    ball.setAttribute('aria-label', 'Bola');
    onHit(ball, () => {
      if (!MG.active) return;
      if (rand() < D.touchedGoal) mgFinish('TOCOU, MAS ENTROU...', 'text-red-400', () => cb(true), 850, false, 'goal');
      else mgFinish('DEFESAÇA!', 'text-emerald-400', () => cb(false, `Defesaça! O goleiro salvou o chute do ${att.name}.`), 850, false, 'save');
    });
    $('mg-targets').appendChild(ball);
    MG.ball = ball;
    sfx.kick();
    mgStartBar(time);
    mgTicks(time);
    mgTimer(() => {
      if (rand() < D.missedGoal) mgFinish('GOL DELES...', 'text-red-400', () => cb(true), 850, true, 'goal');
      else mgFinish('NA TRAVE! UFA!', 'text-amber-300', () => cb(false, `Não deu tempo de reagir, mas o chute do ${att.name} explodiu na trave!`), 850, true, 'post');
    }, time);
  }, 300 + rand() * 700);
}

// ---------- Pênaltis ----------
function penGridCells(): HTMLButtonElement[] {
  $('mg-targets').innerHTML = '<div id="pen-grid" class="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-1.5 p-2 sm:p-3"></div>';
  const grid = $('pen-grid');
  MG.cells = Array.from({ length: 9 }, (_, i) => {
    const c = document.createElement('button');
    c.className = 'w-full h-full bg-slate-800/60 border-2 border-slate-600/70 rounded-lg flex items-center justify-center text-2xl sm:text-3xl transition hover:bg-slate-700/80 focus:outline-none focus-visible:ring-4 focus-visible:ring-yellow-300';
    c.dataset.idx = String(i);
    c.setAttribute('aria-label', `${PEN_ROW[Math.floor(i / 3)].name}, ${COL_SPOT[i % 3]}`);
    grid.appendChild(c);
    return c;
  });
  return MG.cells;
}

function revealPenalty(cells: HTMLButtonElement[], col: number, row: number, keeperCol: number, outcome: PenaltyOutcome): void {
  cells.forEach((c, i) => { if (i % 3 === keeperCol) c.classList.add('bg-sky-900/70', 'border-sky-400/70'); });
  const keeperCell = cells[3 + keeperCol];
  const ballCell = cells[row * 3 + col];
  keeperCell.textContent = '🧤';
  ballCell.textContent = outcome.miss ? '💨' : ballCell === keeperCell ? '🧤⚽' : '⚽';
  ballCell.classList.add(outcome.goal ? 'border-emerald-400' : 'border-red-400');
}

const penSound = (o: PenaltyOutcome): Sfx => (o.goal ? 'goal' : o.miss ? 'miss' : 'save');

/** Toque no gol só conta como 'click' (arrastar para rolar a tela não chuta) */
export function penaltyShootMinigame(att: TeamState, def: TeamState, userCols: number[], cb: Commit): void {
  const D = curDiff();
  mgOpen('PÊNALTI! ESCOLHA O CANTO', 'Alto: difícil de defender, mas pode isolar · Rasteiro: quase nunca sai, mas é mais defensável · o goleiro lê as batidas repetidas', BOX_PEN, true, 'penS');
  const cells = penGridCells();
  cells.forEach((c, i) => c.addEventListener('click', () => {
    if (!MG.active) return;
    const col = i % 3, row = Math.floor(i / 3);
    const keeperCol = keeperGuess(userCols, D.learn);
    userCols.push(col);
    const out = penaltyOutcome(att.ovr, def.ovr, col, row, keeperCol);
    revealPenalty(cells, col, row, keeperCol, out);
    sfx.kick();
    mgFinish(out.goal ? 'GOOOL!' : out.miss ? 'PRA FORA!' : 'DEFENDEU!', out.goal ? 'text-emerald-400' : 'text-red-400', () => cb(out.goal, out.why), 1300, false, penSound(out));
  }));
  mgStartBar(D.penShootMs);
  mgTicks(D.penShootMs);
  mgTimer(() => mgFinish('HESITOU!', 'text-red-400', () => cb(false, 'hesitou na batida e o goleiro pegou fácil.'), 1000, true, 'save'), D.penShootMs);
}

export function penaltyDefendMinigame(att: TeamState, def: TeamState, cb: Commit): void {
  const D = curDiff();
  const kick = aiPenaltyKick(att.ovr, def.ovr, D.rel);
  mgOpen('🧤 DEFENDA O PÊNALTI!', `👀 O batedor do ${att.name} parece olhar para ${COL_LOOK[kick.hint]}... mas pode estar disfarçando. Toque numa coluna para pular!`, BOX_PEN, true, 'penD');
  const cells = penGridCells();
  const dive = (diveCol: number) => {
    if (!MG.active) return;
    const out = penaltyOutcome(att.ovr, def.ovr, kick.col, kick.row, diveCol);
    revealPenalty(cells, kick.col, kick.row, diveCol, out);
    sfx.kick();
    mgFinish(out.goal ? 'GOL DELES...' : out.miss ? 'PRA FORA!' : 'DEFENDEU!', out.goal ? 'text-red-400' : 'text-emerald-400', () => cb(out.goal, out.why), 1300, false, penSound(out));
  };
  cells.forEach((c, i) => c.addEventListener('click', () => dive(i % 3)));
  mgStartBar(D.penDefMs);
  mgTicks(D.penDefMs);
  mgTimer(() => dive(1), D.penDefMs); // sem reação: o goleiro fica no meio
}

// ---------- Teclado ----------
const PEN_KEYS: Record<string, number> = { q: 0, w: 1, e: 2, a: 3, s: 4, d: 5, z: 6, x: 7, c: 8 };
const NUMPAD: Record<string, number> = { Numpad7: 0, Numpad8: 1, Numpad9: 2, Numpad4: 3, Numpad5: 4, Numpad6: 5, Numpad1: 6, Numpad2: 7, Numpad3: 8 };

/** Teclas do minigame aberto. Devolve true se a tecla foi tratada (o despachante para aí). */
export function minigameKey(e: KeyboardEvent): boolean {
  if (!MG.active) return false;
  const k = e.key.toLowerCase();
  if (MG.mode === 'penS' || MG.mode === 'penD') {
    let idx = NUMPAD[e.code] ?? PEN_KEYS[k];
    if (MG.mode === 'penD' && idx === undefined) idx = ({ arrowleft: 3, arrowdown: 4, arrowright: 5 } as Record<string, number>)[k];
    if (idx !== undefined && MG.cells[idx]) { MG.cells[idx].click(); return true; }
    return false;
  }
  if (MG.mode === 'att' && /^[1-9]$/.test(e.key)) {
    const b = MG.targets[Number(e.key) - 1];
    if (b) { b.click(); return true; }
    return false;
  }
  if (MG.mode === 'def' && (e.key === ' ' || e.key === 'Enter')) {
    MG.ball?.click(); // antes de a bola aparecer, a tecla não faz nada (apertar cedo não ajuda)
    return true;
  }
  return false;
}
