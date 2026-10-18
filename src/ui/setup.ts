// Telas de configuração (Sandbox), escolha de clubes e distribuição por continente
import { ALL_TEAMS, CONFS, COUNTRY_NAMES, MAX_USER_TEAMS, getContinentByCountry } from '../data/teams';
import { describeConfig, totalTeamsFor, validateConfig } from '../engine/config';
import { clamp } from '../engine/math';
import { createTournament } from '../engine/tournament';
import type { Confederation, Config } from '../engine/types';
import { loadGame, saveGame, store } from '../state/store';
import { logoImg } from './crest';
import { $, askConfirm, hideEl, isShown, normalizeText, setHidden, showEl, toast } from './dom';
import { enterDashboard } from './dashboard';

const input = (id: string) => $<HTMLInputElement>(id);

function readConfig(): Config {
  const num = (id: string) => {
    const raw = input(id).value.trim();
    return raw === '' ? NaN : Number(raw);
  };
  return {
    initialPhase: input('sb-initial-phase').value as Config['initialPhase'],
    bracketFormat: input('sb-bracket-format').value as Config['bracketFormat'],
    groupsCount: num('sb-groups'),
    teamsPerGroup: num('sb-teams-per-group'),
    advancingPerGroup: num('sb-advancing'),
    groupLegs: num('sb-group-legs'),
    drawType: input('sb-draw-type').value as Config['drawType'],
    totalTeamsSwiss: num('sb-total-teams-swiss'),
    totalTeamsKnockout: num('sb-total-teams'),
    fillMethod: input('sb-fill-method').value as Config['fillMethod']
  };
}

export function refreshConfigUI(): void {
  const phase = input('sb-initial-phase').value;
  document.querySelectorAll('.group-config').forEach(el => el.classList.toggle('hidden', phase !== 'groups'));
  document.querySelectorAll('.swiss-config').forEach(el => el.classList.toggle('hidden', phase !== 'swiss'));
  document.querySelectorAll('.knockout-config').forEach(el => el.classList.toggle('hidden', phase !== 'knockout'));
  document.querySelectorAll('.draw-config').forEach(el => el.classList.toggle('hidden', phase === 'swiss'));
  const d = describeConfig(readConfig());
  if (d.ok) hideEl('sb-error');
  else if (isShown('sb-error')) $('sb-error').textContent = 'Erro: ' + d.text;
  const sum = $('sb-summary');
  sum.textContent = (d.ok ? '✅ ' : '⚠️ ') + d.text;
  sum.className = `mt-6 text-center text-sm font-semibold rounded-lg p-3 border ${d.ok ? 'text-slate-300 bg-slate-900/60 border-slate-700' : 'text-amber-300 bg-amber-900/20 border-amber-500/40'}`;
}

// ---------- Seleção de clubes ----------
let selectGridBuilt = false;
let confFilter: Confederation | 'ALL' = 'ALL';
const cfg = (): Config => store.cfg!;
const maxUserTeams = () => Math.min(MAX_USER_TEAMS, totalTeamsFor(cfg()));

function buildSelectGrid(): void {
  if (selectGridBuilt) return;
  selectGridBuilt = true;
  const grid = $('teams-grid');
  [...ALL_TEAMS].sort((a, b) => a.name.localeCompare(b.name)).forEach(team => {
    const btn = document.createElement('button');
    btn.className = 'team-btn bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 flex flex-col items-center justify-center gap-3 relative overflow-hidden transition-all';
    const conf = getContinentByCountry(team.country);
    btn.dataset.id = team.id;
    btn.dataset.conf = conf;
    btn.dataset.name = normalizeText(team.name);
    btn.dataset.tags = normalizeText(`${team.country} ${COUNTRY_NAMES[team.country] ?? ''} ${conf}`);
    btn.innerHTML = `
      <div class="absolute top-0 right-0 bg-slate-900 px-2 py-1 text-[10px] font-bold rounded-bl text-slate-500">${team.country}</div>
      ${logoImg(team, 'tm-logo')}
      <div class="font-bold text-center leading-tight text-sm">${team.name}</div>
      <div class="text-[10px] bg-emerald-900/60 text-emerald-400 px-2 py-1 rounded-full border border-emerald-500/30">OVR ${team.ovr}</div>`;
    btn.onclick = () => toggleSelectTeam(team.id);
    grid.appendChild(btn);
  });

  const chips = $('conf-filter');
  (['ALL', ...CONFS] as const).forEach(c => {
    const b = document.createElement('button');
    b.dataset.conf = c;
    b.textContent = c === 'ALL' ? 'Todos' : c;
    b.className = 'conf-chip px-3 py-1.5 rounded-full text-xs font-bold border transition';
    b.onclick = () => { confFilter = c; refreshSelectGrid(); };
    chips.appendChild(b);
  });
  $('search-team').addEventListener('input', refreshSelectGrid);
}

function refreshSelectGrid(): void {
  const term = normalizeText(input('search-team').value.trim());
  let visibleCount = 0;
  $('teams-grid').querySelectorAll<HTMLButtonElement>('.team-btn').forEach(btn => {
    const tags = btn.dataset.tags ?? '';
    const textOk = !term || (btn.dataset.name ?? '').includes(term) || tags.split(' ').some(w => w.startsWith(term)) || (term.includes(' ') && tags.includes(term));
    const visible = textOk && (confFilter === 'ALL' || btn.dataset.conf === confFilter);
    btn.style.display = visible ? 'flex' : 'none';
    if (visible) visibleCount++;
    const sel = store.selectedIds.includes(btn.dataset.id ?? '');
    btn.classList.toggle('border-emerald-500', sel);
    btn.classList.toggle('bg-emerald-900/40', sel);
    btn.classList.toggle('shadow-[0_0_15px_rgba(16,185,129,0.3)]', sel);
    btn.classList.toggle('border-slate-700/50', !sel);
    btn.classList.toggle('bg-slate-800/60', !sel);
    btn.setAttribute('aria-pressed', String(sel));
  });
  setHidden('teams-empty', visibleCount > 0);
  document.querySelectorAll<HTMLButtonElement>('.conf-chip').forEach(b => {
    const on = b.dataset.conf === confFilter;
    b.className = `conf-chip px-3 py-1.5 rounded-full text-xs font-bold border transition ${on ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'}`;
  });
  const n = store.selectedIds.length;
  setHidden('div-confirm-teams', n === 0);
  $('count-teams').textContent = String(n);
  $('select-info').textContent = `Selecione de 1 a ${maxUserTeams()} clube(s) para controlar · ${n} selecionado(s) · ${describeConfig(cfg()).text}`;
}

function enterSelectScreen(): void {
  buildSelectGrid();
  const max = maxUserTeams();
  if (store.selectedIds.length > max) {
    store.selectedIds = store.selectedIds.slice(0, max);
    toast(`Este formato permite no máximo ${max} clube(s) controlado(s).`);
  }
  refreshSelectGrid();
}

function toggleSelectTeam(id: string): void {
  const idx = store.selectedIds.indexOf(id);
  if (idx > -1) store.selectedIds.splice(idx, 1);
  else {
    const max = maxUserTeams();
    if (store.selectedIds.length >= max) { toast(`Máximo de ${max} clube(s) para este formato!`); return; }
    store.selectedIds.push(id);
  }
  refreshSelectGrid();
}

export function resetSelection(): void {
  store.selectedIds = [];
  confFilter = 'ALL';
  input('search-team').value = '';
  hideEl('div-confirm-teams');
  if (selectGridBuilt) refreshSelectGridSafe();
}
function refreshSelectGridSafe(): void { if (store.cfg) refreshSelectGrid(); }

// ---------- Início do torneio ----------
function startTournament(slots: Partial<Record<Confederation, number>> | null): void {
  try {
    store.t = createTournament(cfg(), store.selectedIds, slots);
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Não foi possível montar o torneio.');
    return;
  }
  saveGame();
  enterDashboard();
}

function startTournamentSafely(slots: Partial<Record<Confederation, number>> | null): void {
  if (!store.t && loadGame()) {
    askConfirm('Substituir o torneio salvo?', 'Já existe um torneio salvo neste navegador. Começar este novo torneio vai apagá-lo.',
      () => startTournament(slots), 'Substituir', slots ? () => showEl('modal-continent-dist') : null);
  } else {
    startTournament(slots);
  }
}

// ---------- Distribuição por continente ----------
function continentStock(): Record<Confederation, number> {
  const stock = Object.fromEntries(CONFS.map(c => [c, 0])) as Record<Confederation, number>;
  ALL_TEAMS.filter(t => !store.selectedIds.includes(t.id)).forEach(t => { stock[getContinentByCountry(t.country)]++; });
  return stock;
}

function prepareContinentModal(): void {
  const stock = continentStock();
  const wrap = $('continent-inputs');
  wrap.innerHTML = '';
  CONFS.forEach(c => {
    const box = document.createElement('div');
    box.className = 'flex flex-col gap-2';
    box.innerHTML = `
      <label for="slot-${c}" class="text-slate-300 font-bold text-xs uppercase">${c} (Max: ${stock[c]})</label>
      <input type="number" id="slot-${c}" data-conf="${c}" value="0" min="0" max="${stock[c]}" step="1" inputmode="numeric"
        class="continent-input p-3 bg-slate-900 border border-slate-700 rounded-lg text-white font-bold w-full focus:border-indigo-500 focus:outline-none text-center text-lg">`;
    wrap.appendChild(box);
  });
  wrap.querySelectorAll<HTMLInputElement>('.continent-input').forEach(el => el.addEventListener('input', () => {
    const v = Number(el.value);
    if (el.value.trim() === '' || Number.isNaN(v)) { updateModalContinentSlots(); return; }
    if (!Number.isInteger(v)) el.value = String(Math.floor(v));
    if (Number(el.value) > Number(el.max)) el.value = el.max;
    if (Number(el.value) < 0) el.value = '0';
    updateModalContinentSlots();
  }));
  updateModalContinentSlots();
}

function readContinentSlots(): Record<Confederation, number> {
  const slots = {} as Record<Confederation, number>;
  CONFS.forEach(c => { const el = input('slot-' + c); slots[c] = clamp(Math.floor(Number(el.value) || 0), 0, Number(el.max)); });
  return slots;
}

function updateModalContinentSlots(): void {
  const needed = totalTeamsFor(cfg()) - store.selectedIds.length;
  const slots = readContinentSlots();
  const diff = needed - Object.values(slots).reduce((s, v) => s + v, 0);
  const span = $('mod-slots-remaining');
  span.textContent = String(diff);
  const btn = $<HTMLButtonElement>('btn-start-modal-tourney');
  const ok = diff === 0;
  span.className = `tabular-nums ${ok ? 'text-emerald-400' : diff < 0 ? 'text-red-400' : 'text-yellow-400'}`;
  btn.disabled = !ok;
  btn.classList.toggle('opacity-50', !ok);
  btn.classList.toggle('cursor-not-allowed', !ok);
}

/** Distribuição proporcional ao número de clubes disponíveis em cada confederação */
function autoContinents(): void {
  const needed = totalTeamsFor(cfg()) - store.selectedIds.length;
  const stock = continentStock();
  const totalStock = Object.values(stock).reduce((s, v) => s + v, 0);
  const alloc = {} as Record<Confederation, number>;
  const rema: [Confederation, number][] = [];
  let used = 0;
  CONFS.forEach(c => {
    const exact = (needed * stock[c]) / totalStock;
    alloc[c] = Math.min(stock[c], Math.floor(exact));
    used += alloc[c];
    rema.push([c, exact - Math.floor(exact)]);
  });
  rema.sort((a, b) => b[1] - a[1]);
  for (let i = 0, guard = 0; used < needed && guard++ < 1000; i++) {
    const c = rema[i % rema.length][0];
    if (alloc[c] < stock[c]) { alloc[c]++; used++; }
  }
  CONFS.forEach(c => { input('slot-' + c).value = String(alloc[c]); });
  updateModalContinentSlots();
}

export function showConfigScreen(): void {
  hideEl('screen-select');
  $('screen-select').classList.remove('flex-1');
  showEl('screen-sandbox-config');
  $('screen-sandbox-config').classList.add('flex-1');
  hideEl('div-confirm-teams');
  refreshConfigUI();
  window.scrollTo(0, 0);
}

export function initSetupScreens(): void {
  document.querySelectorAll('.sb-input').forEach(el => {
    el.addEventListener('input', refreshConfigUI);
    el.addEventListener('change', refreshConfigUI);
  });
  window.addEventListener('pageshow', () => { if (!store.t) refreshConfigUI(); });

  $('btn-start-sandbox').onclick = () => {
    const c = readConfig();
    const err = validateConfig(c);
    const errEl = $('sb-error');
    if (err) { errEl.textContent = 'Erro: ' + err; showEl(errEl); return; }
    hideEl(errEl);
    store.cfg = c;
    hideEl('screen-sandbox-config');
    $('screen-sandbox-config').classList.remove('flex-1');
    showEl('screen-select');
    $('screen-select').classList.add('flex', 'flex-1');
    enterSelectScreen();
    window.scrollTo(0, 0);
  };

  $('btn-back-config').onclick = showConfigScreen;

  $('btn-confirm-teams').onclick = () => {
    if (!store.selectedIds.length) return;
    const needed = totalTeamsFor(cfg()) - store.selectedIds.length;
    if (cfg().fillMethod === 'custom' && needed > 0) {
      prepareContinentModal();
      showEl('modal-continent-dist');
    } else startTournamentSafely(null);
  };

  $('btn-auto-continents').onclick = autoContinents;
  $('btn-start-modal-tourney').onclick = () => {
    if ($<HTMLButtonElement>('btn-start-modal-tourney').disabled) return;
    const slots = readContinentSlots();
    hideEl('modal-continent-dist');
    startTournamentSafely(slots);
  };
  refreshConfigUI();
}
