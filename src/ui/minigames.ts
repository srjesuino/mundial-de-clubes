// Minigames da partida ao vivo: chance de ataque, defesa e pênaltis
import { COL_LOOK, COL_SPOT, LIVE, PEN_ROW, aiPenaltyKick, keeperGuess, ovrWindow, penaltyOutcome, type PenaltyOutcome } from '../engine/live';
import { rand, shuffle } from '../engine/rng';
import type { TeamState } from '../engine/types';
import { $, hideEl, setHidden, showEl } from './dom';

type Commit = (goal: boolean, why?: string) => void;

const MG: { timers: number[]; active: boolean; onClose: (() => void) | null } = { timers: [], active: false, onClose: null };
const BOX_WIDE = 'relative w-full max-w-2xl aspect-[4/3] sm:aspect-[2/1] border-4 border-b-0 border-white/80 rounded-t shadow-[inset_0_0_50px_rgba(255,255,255,0.2)] bg-emerald-900/20 overflow-hidden';
const BOX_PEN = 'relative w-full max-w-md aspect-[3/2] border-4 border-b-0 border-white/80 rounded-t shadow-[inset_0_0_50px_rgba(255,255,255,0.2)] bg-emerald-900/20 overflow-hidden';

/** Ajustes de dificuldade (escala das janelas de reação); 1 = normal */
export const MG_SETTINGS = { windowScale: 1 };

export const minigameActive = (): boolean => MG.active;
/** Continuação a executar depois que o aviso do lance fecha */
export const setMinigameOnClose = (fn: (() => void) | null): void => { MG.onClose = fn; };

function mgTimer(fn: () => void, ms: number): void { MG.timers.push(window.setTimeout(fn, ms)); }

function mgOpen(title: string, subtitle: string, boxClass: string, inShootout: boolean): void {
  MG.timers.forEach(clearTimeout);
  MG.timers = [];
  MG.active = true;
  MG.onClose = null;
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
  showEl('minigame-overlay');
  $('minigame-overlay').focus({ preventScroll: true });
}

function mgStartBar(ms: number): void {
  const bar = $('mg-timer-bar');
  bar.style.transition = 'none';
  bar.style.width = '100%';
  void bar.offsetWidth;
  bar.style.transition = `width ${ms}ms linear`;
  bar.style.width = '0%';
}

function mgStopBar(empty: boolean): void {
  const bar = $('mg-timer-bar');
  const w = empty ? '0%' : getComputedStyle(bar).width;
  bar.style.transition = 'none';
  bar.style.width = w;
}

function mgClose(): void {
  hideEl('minigame-overlay');
  $('screen-match').inert = false;
}

/** Encerra o minigame uma única vez (protege contra clique + timeout simultâneos) */
function mgFinish(text: string, color: string, commit: () => void, delay = 850, timedOut = false): void {
  if (!MG.active) return;
  MG.active = false;
  MG.timers.forEach(clearTimeout);
  MG.timers = [];
  mgStopBar(timedOut);
  const fb = $('mg-feedback');
  fb.textContent = text;
  fb.className = `min-h-[2.5rem] sm:min-h-[3rem] mt-2 text-center text-2xl sm:text-4xl font-black ${color}`;
  commit(); // o resultado vale a partir de agora; o aviso só fecha depois
  MG.timers.push(window.setTimeout(mgFlush, delay));
}

function mgFlush(): void {
  const next = MG.onClose;
  MG.onClose = null;
  MG.timers.forEach(clearTimeout);
  MG.timers = [];
  mgClose();
  next?.();
}

export function mgAbort(): void {
  MG.active = false;
  MG.onClose = null;
  MG.timers.forEach(clearTimeout);
  MG.timers = [];
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

const scaled = (ms: number) => Math.round(ms * MG_SETTINGS.windowScale);

/** Ataque: um canto livre (🎯) e três cobertos pelo goleiro (🧤) */
export function attackMinigame(att: TeamState, def: TeamState, cb: Commit): void {
  const time = scaled(ovrWindow(1000, att.ovr - def.ovr));
  mgOpen('⚽ CHANCE DE GOL!', `${att.name} no ataque — toque no canto livre 🎯 antes que a zaga feche!`, BOX_WIDE, false);
  const slots = shuffle([...Array(15).keys()]).slice(0, 4);
  const goodIdx = Math.floor(rand() * 4); // ordem no DOM aleatória: o 1º Tab não entrega o canto livre
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
      if (good) {
        if (rand() < LIVE.aimGoal) mgFinish('GOOOOL!', 'text-emerald-400', () => cb(true));
        else if (rand() < 0.5) mgFinish('NA TRAVE!', 'text-amber-300', () => cb(false, 'Achou o canto livre, mas a bola explodiu na trave!'));
        else mgFinish('QUE DEFESA!', 'text-amber-300', () => cb(false, `Achou o canto livre, mas o goleiro do ${def.name} voou e espalmou!`));
      } else if (rand() < LIVE.keeperGoal) {
        mgFinish('GOL! O GOLEIRO SOLTOU!', 'text-emerald-400', () => cb(true));
      } else {
        mgFinish('O GOLEIRO DEFENDEU!', 'text-red-400', () => cb(false, `Chutou onde o goleiro estava. Defesa do ${def.name}!`));
      }
    });
    $('mg-targets').appendChild(btn);
  });
  mgStartBar(time);
  mgTimer(() => {
    if (rand() < LIVE.lateGoal) mgFinish('DESVIOU E ENTROU!', 'text-emerald-400', () => cb(true), 850, true);
    else mgFinish('DEMOROU!', 'text-red-400', () => cb(false, 'Demorou para finalizar e a zaga travou o chute.'), 850, true);
  }, time);
}

/** Defesa: a bola aparece num ponto do gol após um instante; toque nela a tempo */
export function defenseMinigame(att: TeamState, def: TeamState, cb: Commit): void {
  const time = scaled(ovrWindow(750, def.ovr - att.ovr));
  mgOpen('🧤 DEFENDA O CHUTE!', `${att.name} vai finalizar — toque na bola antes que ela entre!`, BOX_WIDE, false);
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
      if (rand() < LIVE.touchedGoal) mgFinish('TOCOU, MAS ENTROU...', 'text-red-400', () => cb(true));
      else mgFinish('DEFESAÇA!', 'text-emerald-400', () => cb(false, `Defesaça! O goleiro salvou o chute do ${att.name}.`));
    });
    $('mg-targets').appendChild(ball);
    mgStartBar(time);
    mgTimer(() => {
      if (rand() < LIVE.missedGoal) mgFinish('GOL DELES...', 'text-red-400', () => cb(true), 850, true);
      else mgFinish('NA TRAVE! UFA!', 'text-amber-300', () => cb(false, `Não deu tempo de reagir, mas o chute do ${att.name} explodiu na trave!`), 850, true);
    }, time);
  }, 300 + rand() * 700);
}

// ---------- Pênaltis ----------
function penGridCells(): HTMLButtonElement[] {
  $('mg-targets').innerHTML = '<div id="pen-grid" class="absolute inset-0 grid grid-cols-3 grid-rows-3 gap-1.5 p-2 sm:p-3"></div>';
  const grid = $('pen-grid');
  return Array.from({ length: 9 }, (_, i) => {
    const c = document.createElement('button');
    c.className = 'w-full h-full bg-slate-800/60 border-2 border-slate-600/70 rounded-lg flex items-center justify-center text-2xl sm:text-3xl transition hover:bg-slate-700/80 focus:outline-none focus-visible:ring-4 focus-visible:ring-yellow-300';
    c.dataset.idx = String(i);
    c.setAttribute('aria-label', `${PEN_ROW[Math.floor(i / 3)].name}, ${COL_SPOT[i % 3]}`);
    grid.appendChild(c);
    return c;
  });
}

function revealPenalty(cells: HTMLButtonElement[], col: number, row: number, keeperCol: number, outcome: PenaltyOutcome): void {
  cells.forEach((c, i) => { if (i % 3 === keeperCol) c.classList.add('bg-sky-900/70', 'border-sky-400/70'); });
  const keeperCell = cells[3 + keeperCol];
  const ballCell = cells[row * 3 + col];
  keeperCell.textContent = '🧤';
  ballCell.textContent = outcome.miss ? '💨' : ballCell === keeperCell ? '🧤⚽' : '⚽';
  ballCell.classList.add(outcome.goal ? 'border-emerald-400' : 'border-red-400');
}

/** Toque no gol só conta como 'click' (arrastar para rolar a tela não chuta) */
export function penaltyShootMinigame(att: TeamState, def: TeamState, userCols: number[], cb: Commit): void {
  mgOpen('PÊNALTI! ESCOLHA O CANTO', 'Alto: difícil de defender, mas pode isolar · Rasteiro: quase nunca sai, mas é mais defensável · o goleiro lê as batidas repetidas', BOX_PEN, true);
  const cells = penGridCells();
  cells.forEach((c, i) => c.addEventListener('click', () => {
    if (!MG.active) return;
    const col = i % 3, row = Math.floor(i / 3);
    const keeperCol = keeperGuess(userCols);
    userCols.push(col);
    const out = penaltyOutcome(att.ovr, def.ovr, col, row, keeperCol);
    revealPenalty(cells, col, row, keeperCol, out);
    mgFinish(out.goal ? 'GOOOL!' : out.miss ? 'PRA FORA!' : 'DEFENDEU!', out.goal ? 'text-emerald-400' : 'text-red-400', () => cb(out.goal, out.why), 1300);
  }));
  mgStartBar(5000);
  mgTimer(() => mgFinish('HESITOU!', 'text-red-400', () => cb(false, 'hesitou na batida e o goleiro pegou fácil.'), 1000, true), 5000);
}

export function penaltyDefendMinigame(att: TeamState, def: TeamState, cb: Commit): void {
  const kick = aiPenaltyKick(att.ovr, def.ovr);
  mgOpen('🧤 DEFENDA O PÊNALTI!', `👀 O batedor do ${att.name} parece olhar para ${COL_LOOK[kick.hint]}... mas pode estar disfarçando. Toque numa coluna para pular!`, BOX_PEN, true);
  const cells = penGridCells();
  const dive = (diveCol: number) => {
    if (!MG.active) return;
    const out = penaltyOutcome(att.ovr, def.ovr, kick.col, kick.row, diveCol);
    revealPenalty(cells, kick.col, kick.row, diveCol, out);
    mgFinish(out.goal ? 'GOL DELES...' : out.miss ? 'PRA FORA!' : 'DEFENDEU!', out.goal ? 'text-red-400' : 'text-emerald-400', () => cb(out.goal, out.why), 1300);
  };
  cells.forEach((c, i) => c.addEventListener('click', () => dive(i % 3)));
  mgStartBar(3500);
  mgTimer(() => dive(1), 3500); // sem reação: o goleiro fica no meio
}
