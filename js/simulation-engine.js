/* Disaster City Challenge - deterministic hazard simulation on the 25x25 terrain grid.
   No Math.random() anywhere in this file: the same scenario + same placements
   always produces the same exposure field and the same building outcomes.
   Water and debris/snow hazards run a small cellular-automaton flow model
   grounded in the fixed elevation field rather than a hand-placed shape. */

const GRID = TERRAIN_GRID_SIZE;
const MAX_GRID_DIST = Math.hypot(GRID - 1, GRID - 1);
const NEIGHBORS8 = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];

function clamp01b(v) { return Math.max(0, Math.min(1, v)); }

function distanceToNearestSource(cell, sourceCells) {
  if (!sourceCells || sourceCells.length === 0) return MAX_GRID_DIST;
  let min = Infinity;
  for (let i = 0; i < sourceCells.length; i++) {
    const s = sourceCells[i];
    const d = Math.hypot(cell.gx - s.gx, cell.gy - s.gy);
    if (d < min) min = d;
  }
  return min;
}

function nearestSourceProximity(cell, sourceCells) {
  return clamp01b(1 - distanceToNearestSource(cell, sourceCells) / MAX_GRID_DIST);
}

function directionUnitVec(directionId) {
  const a = DIRECTIONS[directionId].angle * Math.PI / 180;
  return { x: Math.cos(a), y: Math.sin(a) };
}

/** How strongly a cell sits on the source-facing side of the map (0..1). */
function directionalAlignment(cell, directionId) {
  const dx = cell.u - 0.5, dy = cell.v - 0.5;
  const mag = Math.hypot(dx, dy) || 0.0001;
  const ux = dx / mag, uy = dy / mag;
  const sv = directionUnitVec(directionId);
  const dot = ux * sv.x + uy * sv.y;
  return clamp01b(((dot + 1) / 2) * Math.min(1, mag / 0.7));
}

function exposureBand(value) {
  if (value <= 0.25) return 'LOW';
  if (value <= 0.50) return 'MODERATE';
  if (value <= 0.75) return 'HIGH';
  return 'EXTREME';
}

/* ---------- cellular-automaton hazard propagation, grounded in elevation ----------
   Returns both the final depth field AND an `arrival` field: the step index at
   which each cell first got measurably wet (or `steps` if it never does). The
   animation later uses `arrival` to gate visuals/damage so nothing at a cell
   shows water or takes damage before the simulated water actually got there. */
const WET_THRESHOLD = 0.002;

function simulateWaterFlow(biomeId, sourceCells, injectAmount, steps) {
  const field = getTerrainField(biomeId);
  const n = field.length;
  const elevation = new Float32Array(n);
  for (let i = 0; i < n; i++) elevation[i] = field[i].elevation;
  let depth = new Float32Array(n);
  const arrival = new Float32Array(n).fill(steps);
  sourceCells.forEach(c => {
    const si = cellIndex(c.gx, c.gy);
    depth[si] = injectAmount;
    if (injectAmount > WET_THRESHOLD) arrival[si] = 0;
  });

  for (let step = 0; step < steps; step++) {
    const next = depth.slice();
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const i = cellIndex(gx, gy);
        if (depth[i] <= 0.0008) continue;
        const surf = elevation[i] + depth[i];
        let total = 0;
        const deficits = [];
        for (let k = 0; k < NEIGHBORS8.length; k++) {
          const nx = gx + NEIGHBORS8[k][0], ny = gy + NEIGHBORS8[k][1];
          if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) continue;
          const ni = cellIndex(nx, ny);
          const d = surf - (elevation[ni] + depth[ni]);
          if (d > 0) { deficits.push([ni, d]); total += d; }
        }
        if (total <= 0) continue;
        const channelFactor = 1 + field[i].floodRisk * 0.9;
        const flowable = Math.min(depth[i] * 0.5 * channelFactor, depth[i]);
        for (let k = 0; k < deficits.length; k++) {
          const share = flowable * (deficits[k][1] / total);
          next[deficits[k][0]] += share;
          next[i] -= share;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (arrival[i] === steps && next[i] > WET_THRESHOLD) arrival[i] = step + 1;
    }
    depth = next;
  }
  return { depth, arrival };
}

/** Normalizes per-cell arrival-step to 0..1 simulation progress, so the
   animation can gate reveal/damage on "has progress reached this cell's
   arrival time yet" instead of a distance heuristic. */
function normalizeArrival(arrival, steps) {
  const out = new Float32Array(arrival.length);
  for (let i = 0; i < arrival.length; i++) out[i] = clamp01b(arrival[i] / steps);
  return out;
}

function simulateFlowMass(biomeId, sourceCells, injectAmount, steps) {
  const field = getTerrainField(biomeId);
  const n = field.length;
  const elevation = new Float32Array(n);
  for (let i = 0; i < n; i++) elevation[i] = field[i].elevation;
  let mass = new Float32Array(n);
  const accumulated = new Float32Array(n);
  sourceCells.forEach(c => { mass[cellIndex(c.gx, c.gy)] = injectAmount; });

  for (let step = 0; step < steps; step++) {
    const next = new Float32Array(n);
    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const i = cellIndex(gx, gy);
        if (mass[i] <= 0.0008) continue;
        accumulated[i] += mass[i] * 0.06;
        let total = 0;
        const lower = [];
        for (let k = 0; k < NEIGHBORS8.length; k++) {
          const nx = gx + NEIGHBORS8[k][0], ny = gy + NEIGHBORS8[k][1];
          if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) continue;
          const ni = cellIndex(nx, ny);
          const d = elevation[i] - elevation[ni];
          if (d > 0.002) { lower.push([ni, d]); total += d; }
        }
        if (lower.length === 0) { accumulated[i] += mass[i] * 0.5; continue; }
        const moving = mass[i] * 0.94;
        for (let k = 0; k < lower.length; k++) {
          next[lower[k][0]] += moving * (lower[k][1] / total);
        }
      }
    }
    mass = next;
  }
  return accumulated;
}

/* ---------- per-scenario hazard field (625 cells), computed once, deterministic ---------- */
/* Regional exposure floor: during a severe/extreme regional disaster, no cell
   on the map is ever treated as perfectly zero-risk (the disaster still reaches
   everywhere at some background level) - this is what keeps even the best
   possible placement from being a guaranteed, trivial 100%. */
const EXPOSURE_FLOOR_BY_KIND = { water: 0.12, slide: 0.13, quake: 0.15, wind: 0.09, heat: 0.06 };

function applyExposureFloor(exposure, kind, intensity) {
  const floor = clamp01b((EXPOSURE_FLOOR_BY_KIND[kind] || 0.1) * intensity);
  for (let i = 0; i < exposure.length; i++) exposure[i] = clamp01b(exposure[i] * (1 - floor) + floor);
  return exposure;
}

function calculateHazardField(biomeId, scenario) {
  const field = getTerrainField(biomeId);
  const n = field.length;
  const exposure = new Float32Array(n);
  const intensity = scenario.intensity;
  let extra = {};

  if (scenario.disaster === 'tsunami' || scenario.disaster === 'coastalflood' || scenario.disaster === 'stormsurge') {
    const waterSteps = 65;
    const flow = simulateWaterFlow(biomeId, scenario.sourceCells, 0.85 * intensity, waterSteps);
    const depth = flow.depth;
    for (let i = 0; i < n; i++) {
      const c = field[i];
      const align = directionalAlignment(c, scenario.direction);
      const baseRisk = clamp01b((1 - c.coastDistance) * 1.05 + (1 - c.elevation) * 0.4 + align * 0.22 - c.naturalProtection * 0.1);
      const depthTerm = clamp01b(depth[i] / 0.035);
      exposure[i] = clamp01b((baseRisk * 0.65 + depthTerm * 0.65) * intensity);
    }
    extra = { depth, arrival: normalizeArrival(flow.arrival, waterSteps) };
  } else if (scenario.disaster === 'flashflood') {
    const waterSteps = 65;
    const flow = simulateWaterFlow(biomeId, scenario.sourceCells, 0.55 * intensity, waterSteps);
    const depth = flow.depth;
    for (let i = 0; i < n; i++) {
      const c = field[i];
      const prox = nearestSourceProximity(c, scenario.sourceCells);
      const baseRisk = clamp01b(c.floodRisk * 0.65 + prox * 0.4 + (1 - c.elevation) * 0.22 - c.naturalProtection * 0.12);
      const depthTerm = clamp01b(depth[i] / 0.035);
      let e = clamp01b((baseRisk * 0.62 + depthTerm * 0.62) * intensity);
      if (biomeId === 'mountain') e = clamp01b(e * 0.75 + c.landslidePotential * 0.35 * intensity);
      exposure[i] = e;
    }
    extra = { depth, arrival: normalizeArrival(flow.arrival, waterSteps) };
  } else if (scenario.disaster === 'landslide' || scenario.disaster === 'rockfall' || scenario.disaster === 'avalanche') {
    const mass = simulateFlowMass(biomeId, scenario.sourceCells, 0.9 * intensity, 55);
    for (let i = 0; i < n; i++) {
      const c = field[i];
      const shelter = scenario.disaster === 'avalanche' ? c.windShelter : c.vegetationProtection;
      const risk = scenario.disaster === 'avalanche' ? c.avalancheRisk : c.landslideRisk;
      const prox = nearestSourceProximity(c, scenario.sourceCells);
      const baseRisk = clamp01b(risk * 0.45 + prox * 0.4 + c.slope * 0.15 - (shelter || 0) * 0.3);
      const massTerm = clamp01b(mass[i] / 0.035);
      exposure[i] = clamp01b((baseRisk * 0.55 + massTerm * 0.55) * intensity);
    }
    extra = { mass };
  } else if (scenario.disaster === 'earthquake') {
    const epi = scenario.epicenter;
    for (let i = 0; i < n; i++) {
      const c = field[i];
      const dist = Math.hypot(c.gx - epi.gx, c.gy - epi.gy) / MAX_GRID_DIST;
      const proximity = Math.pow(clamp01b(1 - dist), 0.85);
      const amplification = 1 + (1 - c.stability) * 0.6;
      let e = clamp01b(proximity * amplification * intensity * 0.8);
      if (biomeId === 'coast') e = clamp01b(e + c.tsunamiExposure * 0.12 * intensity);
      exposure[i] = e;
    }
  } else if (scenario.disaster === 'extremeheat') {
    for (let i = 0; i < n; i++) {
      const c = field[i];
      exposure[i] = clamp01b((0.50 - c.naturalProtection * 0.30 + (1 - c.elevation) * 0.10) * intensity);
    }
  } else {
    // wind-kind: sandstorm, blizzard, snowstorm, typhoon
    for (let i = 0; i < n; i++) {
      const c = field[i];
      const align = directionalAlignment(c, scenario.direction);
      let e = (1 - c.naturalProtection) * 0.50 + align * 0.30 + c.slope * 0.07;
      if (scenario.disaster === 'typhoon') {
        const waterPart = clamp01b((c.stormSurgeExposure || 0) * 0.75 + align * 0.3);
        e = e * 0.5 + waterPart * 0.5;
      }
      if ((scenario.disaster === 'blizzard' || scenario.disaster === 'snowstorm') && c.snowLoad != null) {
        e += c.snowLoad * 0.12;
      }
      exposure[i] = clamp01b(e * intensity);
    }
  }

  applyExposureFloor(exposure, scenario.kind, intensity);
  return Object.assign({ exposure }, extra);
}

/* ---------- damage thresholds, tuned per hazard kind (harder than a single global cutoff) ---------- */
const DAMAGE_THRESHOLDS = {
  water: { safeMax: 0.00, damagedMax: 0.12 },
  slide: { safeMax: 0.00, damagedMax: 0.12 },
  quake: { safeMax: 0.03, damagedMax: 0.16 },
  wind:  { safeMax: 0.03, damagedMax: 0.16 },
  heat:  { safeMax: 0.06, damagedMax: 0.20 }
};

function buildingKindResistance(buildingTypeId, disasterKind) {
  const cfg = BUILDING_TYPES[buildingTypeId];
  switch (disasterKind) {
    case 'water': return cfg.floodResistance;
    case 'wind': return cfg.windResistance;
    case 'slide': return cfg.slideResistance;
    case 'quake': return cfg.earthquakeResistance;
    case 'heat': return (cfg.floodResistance + cfg.windResistance) / 2;
    default: return 0.3;
  }
}

function calculateBuildingDamage(buildingTypeId, exposure, cell, scenario) {
  let resistance = buildingKindResistance(buildingTypeId, scenario.kind);
  let effectiveResistance = clamp01b(resistance + (cell.naturalProtection || 0) * 0.12);

  if (scenario.kind === 'quake' && buildingTypeId === 'highrise' && exposure > 0.65) {
    effectiveResistance = clamp01b(effectiveResistance - 0.10);
  }

  const net = exposure - effectiveResistance;
  const t = DAMAGE_THRESHOLDS[scenario.kind] || DAMAGE_THRESHOLDS.wind;
  let status;
  if (net <= t.safeMax) status = 'safe';
  else if (net <= t.damagedMax) status = 'damaged';
  else status = 'destroyed';

  return { status, exposure, resistance: effectiveResistance, net };
}

function runSimulation(biomeId, scenario, placements) {
  const hazard = calculateHazardField(biomeId, scenario);
  const buildingResults = placements.map(p => {
    const cell = cellAtNormalized(biomeId, p.normalizedX, p.normalizedY);
    const exp = hazard.exposure[cellIndex(cell.gx, cell.gy)];
    const dmg = calculateBuildingDamage(p.type, exp, cell, scenario);
    return {
      buildingId: p.id,
      type: p.type,
      normalizedX: p.normalizedX,
      normalizedY: p.normalizedY,
      gridX: cell.gx,
      gridY: cell.gy,
      hazardExposure: exp,
      resistance: dmg.resistance,
      status: dmg.status
    };
  });
  return { hazard, buildingResults };
}

/* ---------- footprint / minimum-separation check for continuous placement ---------- */
function normalizedDistance(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

function checkFootprintOverlap(nx, ny, type, existingPlacements) {
  const myRadius = BUILDING_TYPES[type].radius;
  for (let i = 0; i < existingPlacements.length; i++) {
    const p = existingPlacements[i];
    const otherRadius = BUILDING_TYPES[p.type].radius;
    const minDist = (myRadius + otherRadius) * 0.9;
    if (normalizedDistance(nx, ny, p.normalizedX, p.normalizedY) < minDist) return true;
  }
  return false;
}
