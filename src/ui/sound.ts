// Som sintetizado com WebAudio (sem arquivos, sem rede) + vibração. Tudo vira silêncio se o navegador não suportar.
import { prefs } from '../state/prefs';

interface Sfx {
  ctx: AudioContext | null;
  master: GainNode | null;
  noise: AudioBuffer | null;
  bed: AudioBufferSourceNode | null;
  bedGain: GainNode | null;
  voices: number;
}
const SFX: Sfx = { ctx: null, master: null, noise: null, bed: null, bedGain: null, voices: 0 };

/** O áudio só pode começar depois de um gesto do jogador */
export function ensureAudio(): void {
  if (SFX.ctx || !prefs.sound) return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 6;
    comp.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = prefs.vol * 0.8;
    master.connect(comp);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    Object.assign(SFX, { ctx, master, noise });
    void ctx.resume();
  } catch { SFX.ctx = null; }
}

export function initSound(): void {
  document.addEventListener('pointerdown', ensureAudio, true);
  document.addEventListener('keydown', ensureAudio, true);
  document.addEventListener('visibilitychange', () => {
    if (!SFX.ctx) return;
    try { if (document.hidden) void SFX.ctx.suspend(); else void SFX.ctx.resume(); } catch { /* ignora */ }
  });
  window.addEventListener('pagehide', () => stopBed());
}

export function setVolume(v: number): void {
  if (SFX.master && SFX.ctx) SFX.master.gain.setTargetAtTime(v * 0.8, SFX.ctx.currentTime, 0.05);
}

/** Uma "voz" curta: devolve null (e não cria nada) se o som está desligado ou saturado */
function voice(ms: number): { ctx: AudioContext; out: GainNode; t0: number } | null {
  const { ctx, master } = SFX;
  if (!ctx || !master || !prefs.sound || document.hidden || SFX.voices >= 6) return null;
  try {
    const out = ctx.createGain();
    out.connect(master);
    SFX.voices++;
    window.setTimeout(() => { SFX.voices = Math.max(0, SFX.voices - 1); try { out.disconnect(); } catch { /* já desligado */ } }, ms + 120);
    return { ctx, out, t0: ctx.currentTime + 0.01 };
  } catch { return null; }
}

function env(g: GainNode, t0: number, peak: number, attack: number, dur: number): void {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

function osc(type: OscillatorType, f0: number, f1: number | null, peak: number, dur: number, delay = 0): void {
  const v = voice((dur + delay) * 1000);
  if (!v) return;
  try {
    const o = v.ctx.createOscillator();
    o.type = type;
    const t0 = v.t0 + delay;
    o.frequency.setValueAtTime(f0, t0);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = v.ctx.createGain();
    env(g, t0, peak, 0.01, dur);
    o.connect(g).connect(v.out);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  } catch { /* ignora */ }
}

function noiseBurst(filter: BiquadFilterType, freq: number, peak: number, dur: number, delay = 0): void {
  const v = voice((dur + delay) * 1000);
  if (!v || !SFX.noise) return;
  try {
    const src = v.ctx.createBufferSource();
    src.buffer = SFX.noise;
    const f = v.ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    const g = v.ctx.createGain();
    const t0 = v.t0 + delay;
    env(g, t0, peak, 0.005, dur);
    src.connect(f).connect(g).connect(v.out);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.02);
  } catch { /* ignora */ }
}

/** Apito: duas senoides moduladas (o "trinado" do apito) */
export function whistle(n = 1, long = false): void {
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    const dur = long && last ? 0.75 : 0.22;
    const delay = i * 0.32;
    const v = voice((dur + delay) * 1000);
    if (!v) return;
    try {
      const t0 = v.t0 + delay;
      const g = v.ctx.createGain();
      env(g, t0, 0.15, 0.01, dur);
      const lfo = v.ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 28;
      const lfoGain = v.ctx.createGain();
      lfoGain.gain.value = 0.35;
      lfo.connect(lfoGain).connect(g.gain);
      [2900, 3150].forEach(f => {
        const o = v.ctx.createOscillator();
        o.frequency.value = f;
        o.connect(g);
        o.start(t0);
        o.stop(t0 + dur + 0.02);
      });
      g.connect(v.out);
      lfo.start(t0);
      lfo.stop(t0 + dur + 0.02);
    } catch { return; }
  }
}

/** Fim de jogo: curto, curto, longo */
export const finalWhistle = (): void => { whistle(3, true); };
export const kick = (): void => { osc('sine', 140, 45, 0.5, 0.09); noiseBurst('highpass', 3000, 0.15, 0.005); };
export const net = (): void => { noiseBurst('highpass', 1200, 0.25, 0.25); };
export const save = (): void => { noiseBurst('lowpass', 300, 0.45, 0.12); };
export const post = (): void => { osc('triangle', 1180, null, 0.18, 0.6); osc('triangle', 1760, null, 0.1, 0.6); };
export const tick = (): void => { osc('square', 1000, null, 0.05, 0.015); };
export const pop = (): void => { osc('sine', 600, 900, 0.12, 0.02 + 0.06); };
export const miss = (): void => { osc('sine', 420, 260, 0.08, 0.25); };
export function drumroll(ms: number): void {
  const n = Math.floor(ms / 45);
  for (let i = 0; i < n; i++) noiseBurst('bandpass', 180, 0.12 + (0.1 * i) / n, 0.04, i * 0.045);
}
export function fanfare(): void {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => osc('triangle', f, null, 0.16, 0.22, i * 0.16));
  [523.25, 659.25, 783.99].forEach(f => osc('triangle', f, null, 0.1, 0.9, 0.7));
}
export const elim = (): void => { osc('sine', 392, null, 0.12, 0.35); osc('sine', 329.63, null, 0.12, 0.6, 0.32); };

// ---------- Torcida ----------
export function crowdBed(): void {
  const { ctx, master, noise } = SFX;
  if (!ctx || !master || !noise || !prefs.sound || SFX.bed) return;
  try {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(0.04, ctx.currentTime, 0.4);
    src.connect(bp).connect(lp).connect(g).connect(master);
    src.start();
    SFX.bed = src;
    SFX.bedGain = g;
  } catch { /* ignora */ }
}

/** Torcida sobe para `level` e volta ao ruído de fundo em `ms` */
export function crowd(level: number, ms = 1200): void {
  const { ctx, bedGain } = SFX;
  if (!ctx || !bedGain || !prefs.sound) return;
  try {
    const t = ctx.currentTime;
    bedGain.gain.cancelScheduledValues(t);
    bedGain.gain.setTargetAtTime(level, t, 0.08);
    bedGain.gain.setTargetAtTime(0.04, t + ms / 1000, 0.6);
  } catch { /* ignora */ }
}

export function stopBed(fadeMs = 0): void {
  const { ctx, bed, bedGain } = SFX;
  SFX.bed = null;
  SFX.bedGain = null;
  if (!ctx || !bed) return;
  try {
    if (fadeMs && bedGain) {
      bedGain.gain.setTargetAtTime(0.0001, ctx.currentTime, fadeMs / 3000);
      bed.stop(ctx.currentTime + fadeMs / 1000 + 0.1);
    } else bed.stop();
    window.setTimeout(() => { try { bed.disconnect(); bedGain?.disconnect(); } catch { /* ignora */ } }, fadeMs + 200);
  } catch { /* ignora */ }
}

/** Liga/desliga pelo botão: desligar para tudo na hora */
export function onSoundToggled(): void {
  if (!prefs.sound) stopBed();
}

export function buzz(pattern: number | number[]): void {
  try { if (prefs.haptics) navigator.vibrate?.(pattern); } catch { /* ignora */ }
}

export const soundState = (): Readonly<Sfx> => SFX;
