/* Disaster City Challenge - UI wiring, continuous-terrain rendering, main loop. Plain script, no modules. */

function $(sel) { return document.querySelector(sel); }
function clamp01ui(v) { return Math.max(0, Math.min(1, v)); }

const TERRAIN_COLORS = {
  plateau: '#caa86a', open_desert: '#e3c27a', dune: '#d9b563', wadi: '#8a6a3c', basin: '#b98f52', fault_zone: '#c98a5a',
  ridge_crest: '#e8eef2', steep_slope: '#8a9a76', valley: '#5f7a52', river: '#4f8fae', foothill: '#6d8a5a',
  snow_ridge: '#ffffff', avalanche_slope: '#dbe9f5', snow_valley: '#c7ddf0', ridge_shadow: '#a9c6db', ice_area: '#8fd8ea', safe_zone: '#e8f6ff',
  hill: '#7a9a5a', inland: '#8bab6a', estuary: '#3f7f96', coastal_plain: '#d8c890', beach: '#e8d9a8', ocean: '#1f5f7a'
};

function hexToRgb(hex) {
  const c = hex.replace('#', '');
  const n = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function clampByte(v) { return Math.max(0, Math.min(255, Math.round(v))); }

let currentScreen = 'home';
let ambientScene = null;
let prepHazardScene = null;
let simEffectScene = null;
let prepFlags = { warned50: false, warned20: false, lastSecondShown: null, locked: false };
let simFlags = { done: false, revealedBuildingIds: new Set() };
let simWaveOrder = [];
let simOrderIndex = {};
let pendingResumable = null;
let pendingConfirmMessageLines = null;
let toastTimer = null;
let confirmYesHandler = null;
let settings = { sound: true, reducedEffects: false, debugGrid: false };
let riskAnalysisVisible = false;
const terrainOffscreenCache = {};

/* ---------- continuous terrain / hazard rendering (25x25 buffer, crisp upscale) ---------- */
function getTerrainOffscreen(biomeId) {
  if (terrainOffscreenCache[biomeId]) return terrainOffscreenCache[biomeId];
  const G = TERRAIN_GRID_SIZE;
  const off = document.createElement('canvas');
  off.width = G; off.height = G;
  const octx = off.getContext('2d');
  const img = octx.createImageData(G, G);
  getTerrainField(biomeId).forEach(c => {
    const base = hexToRgb(TERRAIN_COLORS[c.terrainType] || '#888888');
    const hillshade = c.hillshade != null ? c.hillshade : 0.55;
    const shade = Math.max(0.45, 0.42 + c.elevation * 0.30 + (hillshade - 0.5) * 0.55 - c.slope * 0.10);
    const p = (c.gy * G + c.gx) * 4;
    img.data[p] = clampByte(base.r * shade);
    img.data[p + 1] = clampByte(base.g * shade);
    img.data[p + 2] = clampByte(base.b * shade);
    img.data[p + 3] = 255;
  });
  octx.putImageData(img, 0, 0);
  terrainOffscreenCache[biomeId] = off;
  return off;
}

function drawTerrainToCanvas(canvas, biomeId) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const off = getTerrainOffscreen(biomeId);
  ctx.drawImage(off, 0, 0, TERRAIN_GRID_SIZE, TERRAIN_GRID_SIZE, 0, 0, canvas.width, canvas.height);
}

const HAZARD_PALETTE = {
  water: { LOW: [90, 170, 255], MODERATE: [55, 140, 255], HIGH: [30, 100, 220], EXTREME: [15, 60, 170] },
  slide: { LOW: [196, 168, 120], MODERATE: [168, 124, 72], HIGH: [128, 86, 46], EXTREME: [90, 58, 30] },
  quake: { LOW: [255, 190, 120], MODERATE: [255, 150, 80], HIGH: [255, 90, 60], EXTREME: [200, 30, 50] },
  wind:  { LOW: [224, 214, 180], MODERATE: [224, 188, 120], HIGH: [214, 150, 80], EXTREME: [168, 104, 52] },
  heat:  { LOW: [255, 210, 140], MODERATE: [255, 170, 90], HIGH: [255, 120, 60], EXTREME: [220, 50, 30] },
  /* snowstorm / blizzard - white / icy-blue only, never the brown "wind" palette */
  snow:  { LOW: [235, 245, 255], MODERATE: [205, 228, 250], HIGH: [165, 205, 240], EXTREME: [120, 170, 220] }
};
function hazardColor(scenario, band) {
  const key = (scenario.disaster === 'blizzard' || scenario.disaster === 'snowstorm') ? 'snow' : scenario.kind;
  const table = HAZARD_PALETTE[key] || HAZARD_PALETTE.quake;
  return table[band] || table.EXTREME;
}

function paintHazardCanvas(canvas, biomeId, exposureArr, revealFn, scenario) {
  const G = TERRAIN_GRID_SIZE;
  const off = document.createElement('canvas');
  off.width = G; off.height = G;
  const octx = off.getContext('2d');
  const img = octx.createImageData(G, G);
  getTerrainField(biomeId).forEach(c => {
    const i = cellIndex(c.gx, c.gy);
    const exp = exposureArr[i] || 0;
    const reveal = revealFn ? revealFn(c) : 1;
    const band = exposureBand(exp);
    const rgb = hazardColor(scenario, band);
    const p = i * 4;
    img.data[p] = rgb[0]; img.data[p + 1] = rgb[1]; img.data[p + 2] = rgb[2];
    img.data[p + 3] = clampByte(exp * 170 * reveal);
  });
  octx.putImageData(img, 0, 0);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(off, 0, 0, G, G, 0, 0, canvas.width, canvas.height);
}

/* ---------- tsunami / flood: real top-down water, driven by the simulated depth field
   (not a flat exposure tint). Shallow leading edge reads as white/pale foam, deeper
   water reads darker and more saturated, and a slow directional ripple gives it
   visible movement instead of a static wash. ---------- */
function paintWaterFlowCanvas(canvas, biomeId, hazard, revealFn, dirVec, t) {
  const G = TERRAIN_GRID_SIZE;
  const off = document.createElement('canvas');
  off.width = G; off.height = G;
  const octx = off.getContext('2d');
  const img = octx.createImageData(G, G);
  const depth = hazard.depth;
  getTerrainField(biomeId).forEach(c => {
    const i = cellIndex(c.gx, c.gy);
    const reveal = revealFn ? revealFn(c) : 1;
    const d = (depth && depth[i]) || 0;
    const depthNorm = clamp01ui(d / 0.045);
    const flowPhase = (c.u * dirVec.x + c.v * dirVec.y) * 22 - t * 2.2;
    const ripple = 0.9 + 0.1 * Math.sin(flowPhase);
    let r, g, b, a;
    if (depthNorm <= 0.015) {
      r = 0; g = 0; b = 0; a = 0;
    } else if (depthNorm < 0.24) {
      const foamT = depthNorm / 0.24;
      r = 235 - foamT * 40; g = 245 - foamT * 25; b = 255;
      a = (0.5 + foamT * 0.3) * ripple;
    } else {
      const deepT = clamp01ui((depthNorm - 0.24) / 0.76);
      r = lerp(150, 12, deepT); g = lerp(205, 55, deepT); b = lerp(250, 145, deepT);
      a = (0.62 + deepT * 0.3) * ripple;
    }
    const p = i * 4;
    img.data[p] = clampByte(r); img.data[p + 1] = clampByte(g); img.data[p + 2] = clampByte(b);
    img.data[p + 3] = clampByte(a * 235 * reveal);
  });
  octx.putImageData(img, 0, 0);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(off, 0, 0, G, G, 0, 0, canvas.width, canvas.height);
}

function renderDebugGrid(canvas, biomeId) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const G = TERRAIN_GRID_SIZE, cw = canvas.width / G, ch = canvas.height / G;
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= G; i++) {
    ctx.beginPath(); ctx.moveTo(i * cw, 0); ctx.lineTo(i * cw, canvas.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * ch); ctx.lineTo(canvas.width, i * ch); ctx.stroke();
  }
}

function positionDirectionIndicator(arrowEl, scenario, biomeId) {
  if (!scenario.direction) {
    arrowEl.textContent = '';
    arrowEl.innerHTML = '<div class="epicenter-dot"></div>';
    const epi = scenario.epicenter;
    arrowEl.style.left = ((epi.gx + 0.5) / TERRAIN_GRID_SIZE * 100) + '%';
    arrowEl.style.top = ((epi.gy + 0.5) / TERRAIN_GRID_SIZE * 100) + '%';
    arrowEl.style.transform = 'translate(-50%,-50%)';
    return;
  }
  arrowEl.innerHTML = '➤';
  const angle = DIRECTIONS[scenario.direction].angle;
  const rad = angle * Math.PI / 180;
  const x = 50 + Math.cos(rad) * 44, y = 50 + Math.sin(rad) * 44;
  arrowEl.style.left = x + '%';
  arrowEl.style.top = y + '%';
  arrowEl.style.transform = `translate(-50%,-50%) rotate(${angle + 180}deg)`;
}

/* ---------- building layer (DOM icons over the continuous map, cheap: O(buildings) not O(625)) ---------- */
function renderPlacementLayer(layerEl) {
  layerEl.innerHTML = '';
  GameState.data.placements.forEach(p => {
    const div = document.createElement('div');
    div.className = 'placed-building';
    div.style.left = (p.normalizedX * 100) + '%';
    div.style.top = (p.normalizedY * 100) + '%';
    div.innerHTML = p.type === 'house' ? ICONS.house(BUILDING_TYPES.house.tone) : ICONS.highrise(BUILDING_TYPES.highrise.tone);
    layerEl.appendChild(div);
  });
}

function renderResultLayer(layerEl, buildingResults, revealedIds) {
  layerEl.innerHTML = '';
  buildingResults.forEach(r => {
    const revealed = !revealedIds || revealedIds.has(r.buildingId);
    const div = document.createElement('div');
    div.className = 'placed-building' + (revealed ? ' status-' + r.status : '');
    div.style.left = (r.normalizedX * 100) + '%';
    div.style.top = (r.normalizedY * 100) + '%';
    div.innerHTML = r.type === 'house' ? ICONS.house(BUILDING_TYPES.house.tone) : ICONS.highrise(BUILDING_TYPES.highrise.tone);
    if (revealed) {
      const badge = document.createElement('div');
      badge.className = 'status-badge-wrap';
      badge.innerHTML = ICONS.statusBadge(r.status);
      div.appendChild(badge);
    }
    layerEl.appendChild(div);
  });
}

function computeWaveOrder(biomeId, scenario) {
  const field = getTerrainField(biomeId);
  let scored;
  if (scenario.kind === 'quake') {
    const epi = scenario.epicenter;
    scored = field.map(c => ({ c, s: Math.hypot(c.gx - epi.gx, c.gy - epi.gy) }));
  } else if (scenario.sourceCells && scenario.sourceCells.length && (scenario.kind === 'water' || scenario.kind === 'slide')) {
    scored = field.map(c => ({ c, s: -nearestSourceProximity(c, scenario.sourceCells) }));
  } else if (scenario.kind === 'wind') {
    scored = field.map(c => ({ c, s: -directionalAlignment(c, scenario.direction) }));
  } else {
    scored = field.map(c => ({ c, s: -(1 - c.naturalProtection) }));
  }
  scored.sort((a, b) => a.s - b.s);
  const order = scored.map(s => s.c);
  const indexOf = {};
  order.forEach((c, i) => { indexOf[cellIndex(c.gx, c.gy)] = i; });
  return { order, indexOf };
}

/* ---------- toast ---------- */
function showToast(msg) {
  const el = $('#zone-toast');
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 1900);
}

/* ---------- screen navigation ---------- */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => { s.hidden = s.dataset.screen !== name; });
  currentScreen = name;
  if (name !== 'prep' && prepHazardScene) { prepHazardScene.stop(); prepHazardScene = null; }
  if (name !== 'simulation' && simEffectScene) { simEffectScene.stop(); simEffectScene = null; const sm = $('#sim-map'); if (sm) sm.classList.remove('shake'); }
}

function goBiomeSelection() { showScreen('biome'); renderBiomeGrid(); }
function goTimeSelection() { showScreen('time'); renderTimeGrid(); }
function goBriefing() { showScreen('briefing'); renderBriefing(); }
function goPreparation() { showScreen('prep'); setupPreparationScreen(); }
function goSimulation() { showScreen('simulation'); setupSimulationScreen(); }

/* ---------- HOME ---------- */
function updateSoundIcon(on) {
  const btn = $('#btn-sound');
  btn.textContent = on ? '🔊' : '🔇';
  btn.setAttribute('aria-pressed', String(on));
}

function wireHome() {
  $('#btn-start-mission').addEventListener('click', () => { AudioFX.click(); goBiomeSelection(); });
  $('#btn-how-to-play').addEventListener('click', () => { $('#howto-modal').hidden = false; });
  $('#btn-view-history').addEventListener('click', () => { showScreen('history'); renderHistory(); });
  $('#btn-settings').addEventListener('click', () => { $('#settings-modal').hidden = false; });
  $('#btn-sound').addEventListener('click', () => {
    settings.sound = !settings.sound;
    Storage.saveSettings(settings);
    AudioFX.setEnabled(settings.sound);
    $('#toggle-sound').checked = settings.sound;
    updateSoundIcon(settings.sound);
  });
  $('#btn-fullscreen').addEventListener('click', () => { AudioFX.click(); toggleFullscreen(); });
  document.addEventListener('fullscreenchange', updateFullscreenIcon);
  document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
  updateFullscreenIcon();
}

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function toggleFullscreen() {
  const el = document.documentElement;
  if (!isFullscreen()) {
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (req) req.call(el);
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (exit) exit.call(document);
  }
}

function updateFullscreenIcon() {
  const btn = $('#btn-fullscreen');
  const on = isFullscreen();
  btn.innerHTML = on ? ICONS.collapse() : ICONS.expand();
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Enter fullscreen');
}

/* ---------- BIOME SELECTION ---------- */
function renderBiomeGrid() {
  const grid = $('#biome-grid');
  grid.innerHTML = '';
  BIOME_LIST.forEach(b => {
    const card = document.createElement('article');
    card.className = 'biome-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', 'Choose ' + b.name);
    card.innerHTML = `<canvas width="320" height="260"></canvas>
      <div class="biome-card-body">
        <h3>${b.name.toUpperCase()}</h3>
        <p>${b.tagline}</p>
      </div>`;
    grid.appendChild(card);
    renderBiomeCardArt(card.querySelector('canvas'), b.id);
    const select = () => { AudioFX.click(); GameState.selectBiome(b.id); goTimeSelection(); };
    card.addEventListener('click', select);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
  });
}

/* ---------- TIME SELECTION ---------- */
function renderTimeGrid() {
  const grid = $('#time-grid');
  grid.innerHTML = '';
  PREP_TIME_OPTIONS.forEach(opt => {
    const card = document.createElement('div');
    card.className = 'time-card' + (opt.seconds === DEFAULT_PREP_SECONDS ? ' selected' : '');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.innerHTML = `<div class="time-seconds">${opt.seconds}</div><div class="time-title">${opt.title}</div><p>${opt.subtitle}</p>`;
    const select = () => { AudioFX.click(); GameState.selectPreparationTime(opt.seconds); goBriefing(); };
    card.addEventListener('click', select);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
    grid.appendChild(card);
  });
}

/* ---------- BRIEFING ---------- */
function renderBriefing() {
  const s = GameState.data.scenario, m = GameState.data.mission;
  $('#briefing-disaster-name').textContent = `${s.label.toUpperCase()} WARNING`;
  $('#briefing-alert-icon').innerHTML = ICONS.warning();
  $('#brief-biome').textContent = getBiomeMeta(GameState.data.biome).name;
  $('#brief-threat').textContent = `${s.label} (${s.threatLabel})`;
  $('#brief-direction').textContent = s.direction ? DISASTER_WARNING_TEXT[s.disaster](s.direction) : DISASTER_WARNING_TEXT[s.disaster]();
  $('#brief-mission').textContent = `${m.housesRequired} House${m.housesRequired === 1 ? '' : 's'}, ${m.highRisesRequired} High-Rise${m.highRisesRequired === 1 ? '' : 's'}`;
  $('#brief-prep-time').textContent = `${GameState.data.preparation.durationSeconds} seconds`;
  drawTerrainToCanvas($('#briefing-map-canvas'), GameState.data.biome);
  positionDirectionIndicator($('#briefing-direction-arrow'), s, GameState.data.biome);
}

/* ---------- PREPARATION ---------- */
function updateRemainingUI() {
  $('#remaining-house').textContent = GameState.remainingCount('house');
  $('#remaining-highrise').textContent = GameState.remainingCount('highrise');
  $('#btn-select-house').disabled = GameState.remainingCount('house') === 0;
  $('#btn-select-highrise').disabled = GameState.remainingCount('highrise') === 0;
}

function onPrepMapClick(e) {
  if (GameState.data.preparation.paused) return;
  const rect = $('#prep-map-surface').getBoundingClientRect();
  const nx = clamp01ui((e.clientX - rect.left) / rect.width);
  const ny = clamp01ui((e.clientY - rect.top) / rect.height);
  const res = GameState.placeBuilding(nx, ny);
  if (!res.ok) { showToast(res.reason); AudioFX.zoneFull(); return; }
  AudioFX.place();
  renderPlacementLayer($('#prep-building-layer'));
  updateRemainingUI();
}

function setupPreparationScreen() {
  prepFlags = { warned50: false, warned20: false, lastSecondShown: null, locked: false };
  $('#countdown-overlay').hidden = true;
  $('#countdown-overlay').classList.remove('shake');
  $('#prep-pause-overlay').hidden = true;
  $('#lock-transition-overlay').hidden = true;
  drawTerrainToCanvas($('#prep-map-canvas'), GameState.data.biome);
  renderPlacementLayer($('#prep-building-layer'));
  updateRemainingUI();
  positionDirectionIndicator($('#prep-direction-arrow'), GameState.data.scenario, GameState.data.biome);
  document.querySelectorAll('#building-selector .building-btn').forEach(b => b.classList.toggle('selected', b.dataset.type === GameState.data.selectedBuildingType));

  const debugCanvas = $('#prep-debug-canvas');
  debugCanvas.hidden = !settings.debugGrid;
  if (settings.debugGrid) renderDebugGrid(debugCanvas, GameState.data.biome);

  if (prepHazardScene) prepHazardScene.stop();
  const dv = GameState.data.scenario.direction ? directionUnitVec(GameState.data.scenario.direction) : { x: 0, y: 0.6 };
  prepHazardScene = createHazardOverlayScene($('#prep-hazard-canvas'), GameState.data.scenario, dv);
  prepHazardScene.start();
}

function playLockTransition(callback) {
  const overlay = $('#lock-transition-overlay');
  const countEl = $('#lock-transition-count');
  overlay.hidden = false;
  let n = 3;
  countEl.textContent = n;
  AudioFX.beepUrgent();
  const timer = setInterval(() => {
    n--;
    if (n > 0) { countEl.textContent = n; AudioFX.beepUrgent(); }
    else {
      clearInterval(timer);
      overlay.hidden = true;
      AudioFX.simStart();
      callback();
    }
  }, 700);
}

function beginLockSequence() {
  playLockTransition(() => {
    GameState.lockPlacements();
    goSimulation();
  });
}

function wirePrepControls() {
  document.querySelectorAll('#building-selector .building-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      GameState.selectBuildingType(btn.dataset.type);
      document.querySelectorAll('.building-btn').forEach(b => b.classList.toggle('selected', b === btn));
      AudioFX.click();
    });
  });
  $('#prep-map-surface').addEventListener('click', onPrepMapClick);
  $('#prep-map-surface').addEventListener('mousemove', e => {
    const marker = $('#prep-placement-marker');
    const rect = e.currentTarget.getBoundingClientRect();
    marker.hidden = false;
    marker.style.left = ((e.clientX - rect.left) / rect.width * 100) + '%';
    marker.style.top = ((e.clientY - rect.top) / rect.height * 100) + '%';
  });
  $('#prep-map-surface').addEventListener('mouseleave', () => { $('#prep-placement-marker').hidden = true; });

  $('#btn-undo').addEventListener('click', () => {
    GameState.undoPlacement();
    renderPlacementLayer($('#prep-building-layer'));
    updateRemainingUI();
    AudioFX.undo();
  });
  $('#btn-reset-placements').addEventListener('click', () => {
    GameState.resetPlacements();
    renderPlacementLayer($('#prep-building-layer'));
    updateRemainingUI();
    AudioFX.undo();
  });
  $('#btn-begin-preparation').addEventListener('click', () => {
    AudioFX.click();
    GameState.beginPreparation();
    goPreparation();
  });
  $('#btn-pause-prep').addEventListener('click', () => {
    GameState.pausePreparation();
    $('#prep-pause-overlay').hidden = false;
    AudioFX.click();
  });
  $('#btn-resume-prep').addEventListener('click', () => {
    GameState.resumePreparation();
    $('#prep-pause-overlay').hidden = true;
    AudioFX.click();
  });
  $('#btn-start-simulation').addEventListener('click', () => {
    if (prepFlags.locked) return;
    const remaining = GameState.totalRemainingCount();
    if (remaining > 0) {
      openConfirm(
        `You still have ${remaining} building${remaining === 1 ? '' : 's'} left to place.\nStart the disaster anyway?`,
        () => { prepFlags.locked = true; beginLockSequence(); },
        'START DISASTER', 'KEEP BUILDING'
      );
    } else {
      prepFlags.locked = true;
      beginLockSequence();
    }
  });
}

function updatePreparationFrame() {
  if (GameState.data.preparation.paused) return;
  const total = GameState.data.preparation.durationSeconds;
  const remaining = GameState.remainingPrepSeconds();
  const elapsedRatio = 1 - remaining / total;
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const timerEl = $('#prep-timer');
  timerEl.textContent = `${mm}:${ss}`;
  timerEl.classList.toggle('warn', remaining <= total * 0.5 && remaining > 10);
  timerEl.classList.toggle('critical', remaining <= 10);
  $('#prep-timer-fill').style.width = (Math.max(0, remaining) / total * 100) + '%';

  if (prepHazardScene) prepHazardScene.setIntensity(Math.min(1, Math.pow(elapsedRatio, 1.4)) * (settings.reducedEffects ? 0.35 : 1));

  if (remaining <= Math.floor(total * 0.5) && !prepFlags.warned50) { prepFlags.warned50 = true; AudioFX.warning(); }
  if (remaining <= Math.floor(total * 0.2) && !prepFlags.warned20) { prepFlags.warned20 = true; AudioFX.warning(); }

  const overlay = $('#countdown-overlay');
  if (remaining <= 10 && remaining > 0 && !prepFlags.locked) {
    overlay.hidden = false;
    overlay.classList.toggle('shake', remaining <= 3);
    if (prepFlags.lastSecondShown !== remaining) {
      prepFlags.lastSecondShown = remaining;
      $('#countdown-number').textContent = remaining;
      $('#countdown-label').textContent = remaining > 3 ? 'DISASTER IMMINENT' : 'TAKE COVER';
      AudioFX.beepUrgent();
    }
  } else {
    overlay.hidden = true;
  }

  if (remaining <= 0 && !prepFlags.locked) {
    prepFlags.locked = true;
    overlay.hidden = true;
    beginLockSequence();
  }
}

/* ---------- SIMULATION ---------- */
function setupSimulationScreen() {
  simFlags = { done: false, revealedBuildingIds: new Set() };
  drawTerrainToCanvas($('#sim-map-canvas'), GameState.data.biome);
  const wo = computeWaveOrder(GameState.data.biome, GameState.data.scenario);
  simWaveOrder = wo.order;
  simOrderIndex = wo.indexOf;
  $('#sim-progress-fill').style.width = '0%';
  $('#sim-subhead').textContent = `${GameState.data.scenario.label} · ${GameState.data.scenario.threatLabel} THREAT`;
  $('#sim-pause-overlay').hidden = true;
  document.querySelectorAll('.sim-speed-btn').forEach(b => b.classList.toggle('selected', b.dataset.speed === '1'));
  GameState.setSimulationSpeed(1);
  renderResultLayer($('#sim-building-layer'), GameState.data.simulation.buildingResults, new Set());
  positionDirectionIndicator($('#sim-direction-arrow'), GameState.data.scenario, GameState.data.biome);
  $('#sim-map').classList.remove('shake');

  if (simEffectScene) simEffectScene.stop();
  const dv = GameState.data.scenario.direction ? directionUnitVec(GameState.data.scenario.direction) : { x: 0, y: 0.6 };
  simEffectScene = createHazardOverlayScene($('#sim-effect-canvas'), GameState.data.scenario, dv);
  simEffectScene.start();
}

function wireSimulationControls() {
  $('#btn-pause-sim').addEventListener('click', () => {
    GameState.pauseSimulation();
    $('#sim-pause-overlay').hidden = false;
    AudioFX.click();
  });
  $('#btn-resume-sim').addEventListener('click', () => {
    GameState.resumeSimulation();
    $('#sim-pause-overlay').hidden = true;
    AudioFX.click();
  });
  document.querySelectorAll('.sim-speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const speed = Number(btn.dataset.speed);
      GameState.setSimulationSpeed(speed);
      document.querySelectorAll('.sim-speed-btn').forEach(b => b.classList.toggle('selected', b === btn));
      AudioFX.click();
    });
  });
}

function updateSimulationFrame() {
  if (!GameState.liveHazard) return;
  const progress = GameState.simulationProgress();
  $('#sim-progress-fill').style.width = (progress * 100) + '%';

  const scenario = GameState.data.scenario;
  const hazard = GameState.liveHazard;
  const buildingResults = GameState.data.simulation.buildingResults;
  let revealedBuildingIds;

  if (scenario.kind === 'water' && hazard.arrival) {
    /* Water/wave contact is gated by the real simulated arrival time per cell -
       a building cannot show damage (or even get wet) before the modeled water
       actually reached its location. A short EDGE gives the wetting a soft
       foam-in instead of a hard on/off flip. */
    const EDGE = 0.05;
    const revealFn = c => {
      const arr = hazard.arrival[cellIndex(c.gx, c.gy)];
      if (progress < arr) return 0;
      return clamp01ui((progress - arr) / EDGE);
    };
    const dv = scenario.direction ? directionUnitVec(scenario.direction) : { x: 0, y: -1 };
    paintWaterFlowCanvas($('#sim-hazard-canvas'), GameState.data.biome, hazard, revealFn, dv, performance.now() / 1000);
    revealedBuildingIds = new Set(
      buildingResults.filter(r => progress >= hazard.arrival[cellIndex(r.gridX, r.gridY)]).map(r => r.buildingId)
    );
  } else {
    const total = simWaveOrder.length;
    const revealFn = c => {
      const t = simOrderIndex[cellIndex(c.gx, c.gy)] / (total - 1);
      return clamp01ui((progress - t) * 3.2 + 0.2);
    };
    paintHazardCanvas($('#sim-hazard-canvas'), GameState.data.biome, hazard.exposure, revealFn, scenario);
    const revealedCellIdx = new Set(simWaveOrder.slice(0, Math.floor(progress * total)).map(c => cellIndex(c.gx, c.gy)));
    revealedBuildingIds = new Set(buildingResults.filter(r => revealedCellIdx.has(cellIndex(r.gridX, r.gridY))).map(r => r.buildingId));
  }

  const sm = $('#sim-map');
  if (scenario.kind === 'quake' && progress > 0.08 && progress < 0.92) sm.classList.add('shake');
  else sm.classList.remove('shake');
  if (simEffectScene) simEffectScene.setIntensity(Math.min(1, progress * 1.6) * (settings.reducedEffects ? 0.35 : 1));

  const newlyRevealed = [...revealedBuildingIds].filter(id => !simFlags.revealedBuildingIds.has(id));
  if (newlyRevealed.length) {
    const hasBadNews = buildingResults.some(r => newlyRevealed.includes(r.buildingId) && r.status !== 'safe');
    if (hasBadNews) AudioFX.damage();
  }
  simFlags.revealedBuildingIds = revealedBuildingIds;

  renderResultLayer($('#sim-building-layer'), buildingResults, revealedBuildingIds);

  if (progress >= 1 && !simFlags.done) {
    simFlags.done = true;
    const result = GameState.finalizeSimulation();
    setTimeout(() => showResultScreen(result), 500);
  }
}

/* ---------- RESULT ---------- */
function showResultScreen(result) {
  showScreen('result');
  riskAnalysisVisible = false;
  $('#result-hazard-canvas').hidden = true;
  $('#btn-toggle-risk-analysis').textContent = 'SHOW RISK ANALYSIS';

  $('#result-title').textContent = result.score >= 55 ? 'CITY SURVIVED' : 'CITY IN DANGER';
  $('#result-score').textContent = result.score;
  $('#result-rank-icon').innerHTML = ICONS.rankBadge(result.rankBadge);
  $('#result-rank-label').textContent = result.rank;
  $('#result-population').textContent = `${result.populationProtectedPercent}%`;
  $('#result-planning-time').textContent = `${Math.round(result.planningTimeUsedSeconds || 0)}s`;
  $('#result-threat-level').textContent = result.threatLabel;

  $('#result-breakdown').innerHTML = [
    ['Building Survival', result.categories.survival, SCORING_WEIGHTS.survival],
    ['Strategic Placement', result.categories.placement, SCORING_WEIGHTS.placement],
    ['Mission Completion', result.categories.completion, SCORING_WEIGHTS.completion]
  ].map(([label, val, max]) => `
    <div class="score-bar-row">
      <span>${label}</span>
      <div class="score-bar-track"><div class="score-bar-fill" style="width:${(val / max * 100)}%"></div></div>
      <span>${val}/${max}</span>
    </div>`).join('');

  function structureRow(icon, label, s) {
    return `<div class="structure-row">
      <span class="structure-icon">${icon}</span>
      <div>
        <strong>${label}</strong>
        <div class="structure-counts">
          <span>${ICONS.statusBadge('safe')} ${s.safe} Safe</span>
          <span>${ICONS.statusBadge('damaged')} ${s.damaged} Damaged</span>
          <span>${ICONS.statusBadge('destroyed')} ${s.destroyed} Destroyed</span>
        </div>
      </div>
    </div>`;
  }
  $('#result-structures').innerHTML =
    structureRow(ICONS.house(BUILDING_TYPES.house.tone), 'Houses', result.buildings.houses) +
    structureRow(ICONS.highrise(BUILDING_TYPES.highrise.tone), 'High-Rises', result.buildings.highRise);

  const report = result.report;
  let reportHtml = '';
  if (report.safest) reportHtml += `<div class="report-item"><span class="report-kicker">Safest Decision</span>${report.safest}</div>`;
  if (report.mostDangerous) reportHtml += `<div class="report-item report-danger"><span class="report-kicker">Most Dangerous Decision</span>${report.mostDangerous}</div>`;
  reportHtml += `<div class="report-item report-tip"><span class="report-kicker">What To Try Next</span>${report.tip}</div>`;
  $('#result-report').innerHTML = reportHtml;

  $('#result-achievements').innerHTML = (result.newAchievements || []).map(a => `<span class="achievement-chip">${a.label}</span>`).join('');

  drawTerrainToCanvas($('#result-map-canvas'), GameState.data.biome);
  renderResultLayer($('#result-building-layer'), result.buildingResults, null);

  if (result.score >= 55) AudioFX.victory(); else AudioFX.failure();
}

function wireResultActions() {
  $('#btn-play-same-biome').addEventListener('click', () => { AudioFX.click(); GameState.playAgainSameBiome(); goTimeSelection(); });
  $('#btn-choose-another-biome').addEventListener('click', () => { AudioFX.click(); GameState.reset(); goBiomeSelection(); });
  $('#btn-result-view-history').addEventListener('click', () => { showScreen('history'); renderHistory(); });
  $('#btn-result-main-menu').addEventListener('click', () => { GameState.reset(); showScreen('home'); });
  $('#btn-toggle-risk-analysis').addEventListener('click', () => {
    if (!GameState.liveHazard) return;
    riskAnalysisVisible = !riskAnalysisVisible;
    $('#result-hazard-canvas').hidden = !riskAnalysisVisible;
    $('#btn-toggle-risk-analysis').textContent = riskAnalysisVisible ? 'HIDE RISK ANALYSIS' : 'SHOW RISK ANALYSIS';
    if (riskAnalysisVisible) paintHazardCanvas($('#result-hazard-canvas'), GameState.data.biome, GameState.liveHazard.exposure, null, GameState.data.scenario);
    AudioFX.click();
  });
}

/* ---------- HISTORY ---------- */
function renderHistory() {
  const data = Storage.loadResults().missions;
  const totalPlayed = data.length;
  const bestScore = data.reduce((m, r) => Math.max(m, r.score), 0);
  const avgScore = totalPlayed ? Math.round(data.reduce((s, r) => s + r.score, 0) / totalPlayed) : 0;
  const bestByBiome = {};
  data.forEach(r => { bestByBiome[r.biome] = Math.max(bestByBiome[r.biome] || 0, r.score); });
  const bestRankLabel = totalPlayed ? getRank(bestScore).label : '-';

  $('#history-summary').innerHTML = `
    <div class="history-stat"><div class="stat-value">${totalPlayed}</div><div class="stat-label">Missions Played</div></div>
    <div class="history-stat"><div class="stat-value">${bestScore}</div><div class="stat-label">Best Score</div></div>
    <div class="history-stat"><div class="stat-value">${avgScore}</div><div class="stat-label">Average Score</div></div>
    <div class="history-stat"><div class="stat-value">${bestRankLabel}</div><div class="stat-label">Best Rank</div></div>
    ${BIOME_LIST.map(b => `<div class="history-stat"><div class="stat-value">${bestByBiome[b.id] || 0}</div><div class="stat-label">Best ${b.name}</div></div>`).join('')}
  `;

  const unlocked = Storage.loadAchievements().unlocked;
  $('#history-achievements').innerHTML = ACHIEVEMENTS.map(a =>
    `<span class="achievement-chip" style="opacity:${unlocked.includes(a.id) ? 1 : 0.35}">${a.label}</span>`
  ).join('');

  const recent = data.slice(-15).reverse();
  $('#history-list').innerHTML = recent.length ? recent.map(r => `
    <div class="history-row">
      <span>${getBiomeMeta(r.biome).name}</span>
      <span>${r.disasterLabel}</span>
      <span class="hr-score">${r.score}/100</span>
      <span>${r.rank}</span>
      <span>${new Date(r.date).toLocaleDateString()}</span>
    </div>`).join('') : '<p class="history-empty">No missions played yet. Start your first mission!</p>';
}

/* ---------- MODALS ---------- */
function openConfirm(message, onYes, yesLabel, noLabel) {
  $('#confirm-message').textContent = message;
  $('#confirm-title').textContent = yesLabel ? 'Confirm' : 'Are you sure?';
  $('#btn-confirm-yes').textContent = yesLabel || 'Yes, Reset';
  $('#btn-confirm-no').textContent = noLabel || 'Cancel';
  confirmYesHandler = onYes;
  $('#confirm-modal').hidden = false;
}

function wireModals() {
  [['#howto-modal', '#btn-close-howto'], ['#settings-modal', '#btn-close-settings']].forEach(([overlaySel, closeSel]) => {
    const overlay = $(overlaySel);
    $(closeSel).addEventListener('click', () => { overlay.hidden = true; });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.hidden = true; });
  });

  $('#toggle-sound').addEventListener('change', e => {
    settings.sound = e.target.checked;
    Storage.saveSettings(settings);
    AudioFX.setEnabled(settings.sound);
    updateSoundIcon(settings.sound);
  });
  $('#toggle-reduced-effects').addEventListener('change', e => {
    settings.reducedEffects = e.target.checked;
    Storage.saveSettings(settings);
  });
  $('#toggle-debug-grid').addEventListener('change', e => {
    settings.debugGrid = e.target.checked;
    Storage.saveSettings(settings);
    const canvas = $('#prep-debug-canvas');
    canvas.hidden = !settings.debugGrid;
    if (settings.debugGrid && currentScreen === 'prep') renderDebugGrid(canvas, GameState.data.biome);
  });
  $('#btn-reset-current-mission').addEventListener('click', () => {
    GameState.reset();
    $('#settings-modal').hidden = true;
    showScreen('home');
  });
  $('#btn-reset-all-results').addEventListener('click', () => {
    openConfirm('This will permanently delete all saved results and achievements. This cannot be undone.', () => {
      Storage.resetResults();
      Storage.saveAchievements({ unlocked: [] });
      if (currentScreen === 'history') renderHistory();
    });
  });

  $('#btn-confirm-yes').addEventListener('click', () => {
    if (confirmYesHandler) confirmYesHandler();
    $('#confirm-modal').hidden = true;
  });
  $('#btn-confirm-no').addEventListener('click', () => { $('#confirm-modal').hidden = true; });
}

function routeAfterResume() {
  switch (GameState.data.phase) {
    case PHASES.TIME_SELECTION: goTimeSelection(); break;
    case PHASES.BRIEFING: goBriefing(); break;
    case PHASES.PREPARATION:
      goPreparation();
      if (GameState.data.preparation.paused) $('#prep-pause-overlay').hidden = false;
      break;
    default: showScreen('home');
  }
}

function wireResume() {
  $('#btn-resume-continue').addEventListener('click', () => {
    const result = GameState.resumeSession(pendingResumable);
    $('#resume-modal').hidden = true;
    if (result) showResultScreen(result); else routeAfterResume();
  });
  $('#btn-resume-new').addEventListener('click', () => {
    GameState.discardResumable();
    GameState.reset();
    $('#resume-modal').hidden = true;
    showScreen('home');
  });
}

function wireNav() {
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.nav;
      if (target === 'home') GameState.reset();
      showScreen(target);
      if (target === 'biome') renderBiomeGrid();
    });
  });
}

/* ---------- static icon injection (no emoji in gameplay UI) ---------- */
function injectStaticIcons() {
  $('#building-icon-house').innerHTML = ICONS.house(BUILDING_TYPES.house.tone);
  $('#building-icon-highrise').innerHTML = ICONS.highrise(BUILDING_TYPES.highrise.tone);
  $('#icon-undo').innerHTML = ICONS.undo();
  $('#icon-reset').innerHTML = ICONS.reset();
  $('#icon-pause-prep').innerHTML = ICONS.pause();
  $('#icon-pause-sim').innerHTML = ICONS.pause();
}

/* ---------- main loop ---------- */
function mainLoop() {
  if (GameState.data.phase === PHASES.PREPARATION) updatePreparationFrame();
  else if (GameState.data.phase === PHASES.SIMULATION) updateSimulationFrame();
  requestAnimationFrame(mainLoop);
}

/* ---------- init ---------- */
function init() {
  settings = Storage.loadSettings();
  AudioFX.setEnabled(settings.sound);
  $('#toggle-sound').checked = settings.sound;
  $('#toggle-reduced-effects').checked = settings.reducedEffects;
  $('#toggle-debug-grid').checked = !!settings.debugGrid;
  updateSoundIcon(settings.sound);
  injectStaticIcons();

  ambientScene = createAmbientScene($('#ambient-bg-canvas'));
  ambientScene.start();
  window.addEventListener('resize', () => ambientScene.resize());

  wireNav();
  wireHome();
  wireModals();
  wireResume();
  wirePrepControls();
  wireSimulationControls();
  wireResultActions();

  showScreen('home');

  pendingResumable = GameState.loadResumableSession();
  if (pendingResumable) $('#resume-modal').hidden = false;

  requestAnimationFrame(mainLoop);
}

document.addEventListener('DOMContentLoaded', init);
