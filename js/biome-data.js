/* Disaster City Challenge - four FIXED biome terrain maps.
   Internally the simulation runs on a 25x25 continuous grid (625 cells),
   generated ONCE per biome (deterministic - bilinear interpolation + a fixed
   procedural texture function, no Math.random) from a small set of authored
   5x5 macro control points. Nothing here is randomized; only the disaster,
   direction, mission, and player placements vary between missions.

   Coordinate convention: u/normalizedX in [0,1] = West(0)->East(1).
   v/normalizedY in [0,1] = North(0)->South(1). gx/gy are floor(u*25)/floor(v*25). */

const TERRAIN_GRID_SIZE = 25;

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

/* ---------- BIOME METADATA (visual identity for cards + scene chrome) ---------- */
const BIOME_LIST = [
  { id: 'desert',   name: 'Desert',   tagline: 'Sand, sun and sudden floods.',
    palette: { sky1:'#3a2a1a', sky2:'#7c5a2e', accent:'#f5c94b', ground1:'#e8c477', ground2:'#c99a4a' } },
  { id: 'mountain', name: 'Mountain', tagline: 'Steep slopes, rivers and rockfall.',
    palette: { sky1:'#1b2a3a', sky2:'#4a6a82', accent:'#8fd6ff', ground1:'#7c8f6b', ground2:'#4d5d42' } },
  { id: 'snow',     name: 'Snow',     tagline: 'Frozen ridges and avalanche paths.',
    palette: { sky1:'#16202e', sky2:'#3c5b74', accent:'#e8f7ff', ground1:'#eef6fb', ground2:'#c3dbe8' } },
  { id: 'coast',    name: 'Coast',    tagline: 'Beaches, estuaries and open ocean.',
    palette: { sky1:'#0e2a3a', sky2:'#1c5c78', accent:'#4fd6d6', ground1:'#e8d9a8', ground2:'#2f7a8c' } }
];

function getBiomeMeta(id) { return BIOME_LIST.find(b => b.id === id); }

/* ---------- macro control-point templates (authored, fixed) ---------- */
const CONTROL_TEMPLATES = {
  plateau:    { terrainType:'plateau',    elevation:.85, slope:.15, naturalProtection:.6, faultRisk:.1, floodRisk:.05, buildable:true },
  open_desert:{ terrainType:'open_desert',elevation:.45, slope:.10, naturalProtection:.15,faultRisk:.05,floodRisk:.15, buildable:true },
  dune:       { terrainType:'dune',       elevation:.55, slope:.35, naturalProtection:.35,faultRisk:.05,floodRisk:.05, buildable:true },
  wadi:       { terrainType:'wadi',       elevation:.25, slope:.20, naturalProtection:.05,faultRisk:.05,floodRisk:.85, buildable:false },
  basin:      { terrainType:'basin',      elevation:.15, slope:.05, naturalProtection:.05,faultRisk:.05,floodRisk:.75, buildable:true },
  fault_zone: { terrainType:'fault_zone', elevation:.60, slope:.20, naturalProtection:.25,faultRisk:.75,floodRisk:.10, buildable:true },
  ridge_crest:{ terrainType:'ridge_crest',elevation:.98, slope:.95, naturalProtection:.1, faultRisk:.2, floodRisk:0,   landslideRisk:.6, buildable:false },
  steep_slope:{ terrainType:'steep_slope',elevation:.75, slope:.70, naturalProtection:.1, faultRisk:.15,floodRisk:.15, landslideRisk:.85, buildable:true },
  valley:     { terrainType:'valley',     elevation:.40, slope:.15, naturalProtection:.3, faultRisk:.2, floodRisk:.55, landslideRisk:.25, buildable:true },
  river:      { terrainType:'river',      elevation:.30, slope:.10, naturalProtection:0,  faultRisk:.1, floodRisk:.95, landslideRisk:.1, buildable:false },
  foothill:   { terrainType:'foothill',   elevation:.55, slope:.30, naturalProtection:.4, faultRisk:.15,floodRisk:.25, landslideRisk:.35, buildable:true },
  m_plateau:  { terrainType:'plateau',    elevation:.60, slope:.10, naturalProtection:.45,faultRisk:.1, floodRisk:.1, landslideRisk:.05, buildable:true },
  snow_ridge: { terrainType:'snow_ridge', elevation:.98, slope:.95, naturalProtection:.05,faultRisk:.15,floodRisk:0,   avalancheRisk:.6, buildable:false },
  avalanche_slope:{ terrainType:'avalanche_slope', elevation:.70, slope:.65, naturalProtection:.05,faultRisk:.1,floodRisk:0, avalancheRisk:.9, buildable:true },
  snow_valley:{ terrainType:'snow_valley',elevation:.35, slope:.15, naturalProtection:.3, faultRisk:.15,floodRisk:.1,  avalancheRisk:.3, buildable:true },
  ridge_shadow:{ terrainType:'ridge_shadow', elevation:.50, slope:.20, naturalProtection:.6, faultRisk:.1,floodRisk:.05,avalancheRisk:.15, buildable:true },
  ice_area:   { terrainType:'ice_area',   elevation:.20, slope:.05, naturalProtection:.1, faultRisk:.1, floodRisk:.15, avalancheRisk:.1, buildable:true },
  safe_zone:  { terrainType:'safe_zone',  elevation:.55, slope:.10, naturalProtection:.55,faultRisk:.1, floodRisk:.05, avalancheRisk:.1, buildable:true },
  hill:       { terrainType:'hill',       elevation:.85, slope:.35, naturalProtection:.4, faultRisk:.15,floodRisk:.05, buildable:true },
  inland:     { terrainType:'inland',     elevation:.55, slope:.15, naturalProtection:.3, faultRisk:.1, floodRisk:.25, buildable:true },
  estuary:    { terrainType:'estuary',    elevation:.20, slope:.05, naturalProtection:0,  faultRisk:.05,floodRisk:.9,  buildable:false },
  coastal_plain:{ terrainType:'coastal_plain', elevation:.15, slope:.05, naturalProtection:.1,faultRisk:.05,floodRisk:.7, buildable:true },
  beach:      { terrainType:'beach',      elevation:.05, slope:.05, naturalProtection:0,  faultRisk:.05,floodRisk:.95, buildable:true },
  ocean:      { terrainType:'ocean',      elevation:0,   slope:0,   naturalProtection:0,  faultRisk:0,  floodRisk:1,   buildable:false }
};

/* ---------- 5x5 macro legends, row0=North -> row4=South ---------- */
const CONTROL_LEGENDS = {
  desert: [
    ['plateau',    'plateau',     'fault_zone', 'plateau',     'plateau'],
    ['open_desert','open_desert', 'wadi',       'open_desert', 'dune'],
    ['dune',       'open_desert', 'wadi',       'open_desert', 'open_desert'],
    ['open_desert','basin',       'wadi',       'basin',       'open_desert'],
    ['dune',       'basin',       'basin',      'basin',       'dune']
  ],
  mountain: [
    ['ridge_crest','ridge_crest', 'ridge_crest','ridge_crest', 'ridge_crest'],
    ['steep_slope','steep_slope', 'steep_slope','steep_slope', 'steep_slope'],
    ['foothill',   'valley',      'river',      'valley',      'foothill'],
    ['foothill',   'valley',      'river',      'foothill',    'foothill'],
    ['m_plateau',  'm_plateau',   'm_plateau',  'm_plateau',   'm_plateau']
  ],
  snow: [
    ['snow_ridge', 'snow_ridge',  'snow_ridge', 'snow_ridge',  'snow_ridge'],
    ['avalanche_slope','avalanche_slope','avalanche_slope','avalanche_slope','ridge_shadow'],
    ['snow_valley','avalanche_slope','snow_valley','ridge_shadow','ridge_shadow'],
    ['safe_zone',  'snow_valley', 'safe_zone',  'ridge_shadow', 'ice_area'],
    ['safe_zone',  'ice_area',    'ice_area',   'ice_area',     'ice_area']
  ],
  coast: [
    ['hill',       'hill',        'inland',      'hill',        'hill'],
    ['inland',     'inland',      'inland',      'inland',      'inland'],
    ['coastal_plain','coastal_plain','coastal_plain','coastal_plain','coastal_plain'],
    ['beach',      'beach',       'beach',       'beach',       'beach'],
    ['ocean',      'ocean',       'ocean',       'ocean',       'ocean']
  ]
};

/* deterministic fixed pseudo-texture (NOT Math.random - same every load) */
function hashNoise(u, v) {
  const s = Math.sin(u * 127.1 + v * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
function fbmNoise(u, v) {
  let n = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < 3; i++) {
    n += amp * hashNoise(u * freq * 6 + 1.7 * i, v * freq * 6 + 2.3 * i);
    freq *= 2; amp *= 0.5;
  }
  return n;
}

function buildControlGrid(biomeId) {
  const legend = CONTROL_LEGENDS[biomeId];
  const grid = [];
  for (let r = 0; r < 5; r++) {
    const row = [];
    for (let c = 0; c < 5; c++) {
      const t = CONTROL_TEMPLATES[legend[r][c]];
      row.push(Object.assign({
        nonBuildableMask: t.buildable ? 0 : 1,
        landslideRisk: t.landslideRisk || 0,
        avalancheRisk: t.avalancheRisk || 0,
        coastDistanceC: biomeId === 'coast' ? clamp01(1 - r / 4) : 1
      }, t));
    }
    grid.push(row);
  }
  return grid;
}

function bilinearSample(grid, field, u, v) {
  const cx = clamp01(u) * 4, cy = clamp01(v) * 4;
  const x0 = Math.floor(cx), x1 = Math.min(4, x0 + 1), fx = cx - x0;
  const y0 = Math.floor(cy), y1 = Math.min(4, y0 + 1), fy = cy - y0;
  const top = lerp(grid[y0][x0][field], grid[y0][x1][field], fx);
  const bot = lerp(grid[y1][x0][field], grid[y1][x1][field], fx);
  return lerp(top, bot, fy);
}

function nearestControlCell(grid, u, v) {
  const cx = Math.round(clamp01(u) * 4), cy = Math.round(clamp01(v) * 4);
  return grid[cy][cx];
}

function generateTerrainField(biomeId) {
  const grid = buildControlGrid(biomeId);
  const G = TERRAIN_GRID_SIZE;
  const cells = new Array(G * G);

  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      const u = (gx + 0.5) / G, v = (gy + 0.5) / G;
      const nearest = nearestControlCell(grid, u, v);
      const tex = fbmNoise(u, v);
      const elevation = clamp01(bilinearSample(grid, 'elevation', u, v) + (tex - 0.5) * 0.10);
      const naturalProtection = clamp01(bilinearSample(grid, 'naturalProtection', u, v) + (tex - 0.5) * 0.05);
      cells[gy * G + gx] = {
        gx, gy, u, v, normalizedX: u, normalizedY: v,
        terrainType: nearest.terrainType,
        elevation,
        slopeBase: bilinearSample(grid, 'slope', u, v),
        naturalProtection,
        faultRisk: clamp01(bilinearSample(grid, 'faultRisk', u, v)),
        floodRisk: clamp01(bilinearSample(grid, 'floodRisk', u, v)),
        landslideRisk: clamp01(bilinearSample(grid, 'landslideRisk', u, v)),
        avalancheRisk: clamp01(bilinearSample(grid, 'avalancheRisk', u, v)),
        nonBuildableMask: bilinearSample(grid, 'nonBuildableMask', u, v),
        coastDistance: clamp01(bilinearSample(grid, 'coastDistanceC', u, v)),
        tex
      };
    }
  }

  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      const cell = cells[gy * G + gx];
      const eR = cells[gy * G + Math.min(G - 1, gx + 1)].elevation;
      const eD = cells[Math.min(G - 1, gy + 1) * G + gx].elevation;
      const gradMag = Math.hypot(eR - cell.elevation, eD - cell.elevation) * G * 0.6;
      cell.slope = clamp01(cell.slopeBase * 0.5 + gradMag * 0.5);
      cell.buildable = cell.nonBuildableMask < 0.5;

      /* directional hillshade (light from the NW, above) - rendering only,
         gives ridges/valleys/cliffs a lit side and a shadow side instead of
         a flat top-down color fill. Does not feed into any hazard/damage math. */
      const dzx = (eR - cell.elevation) * G * 0.6;
      const dzy = (eD - cell.elevation) * G * 0.6;
      const nx = -dzx, ny = -dzy, nz = 1;
      const nlen = Math.hypot(nx, ny, nz);
      const lx = -0.6, ly = -0.6, lz = 0.53;
      const llen = Math.hypot(lx, ly, lz);
      cell.hillshade = clamp01((nx * lx + ny * ly + nz * lz) / (nlen * llen));
      cell.stability = clamp01(1 - cell.slope * 0.55 - cell.faultRisk * 0.15);
      cell.waterRetention = clamp01(cell.floodRisk * 0.7 + (1 - cell.slope) * 0.3 * (1 - cell.elevation));
      cell.vegetationProtection = cell.naturalProtection;
      cell.windExposure = clamp01(1 - cell.naturalProtection * 0.8);

      if (biomeId === 'coast') {
        cell.tsunamiExposure = clamp01((1 - cell.coastDistance) * 0.85 + (1 - cell.elevation) * 0.25);
        cell.stormSurgeExposure = clamp01((1 - cell.coastDistance) * 0.75 + cell.windExposure * 0.25);
      } else if (biomeId === 'mountain') {
        cell.landslidePotential = clamp01(cell.landslideRisk * 0.6 + cell.slope * 0.4);
        cell.rockfallPotential = clamp01(cell.slope * 0.7 + (1 - cell.vegetationProtection) * 0.3);
        cell.drainagePotential = clamp01(cell.slope * 0.5 + (1 - cell.floodRisk) * 0.5);
      } else if (biomeId === 'snow') {
        cell.avalanchePotential = clamp01(cell.avalancheRisk * 0.6 + cell.slope * 0.4);
        cell.snowLoad = clamp01(cell.elevation * 0.6 + cell.slope * 0.3);
        cell.windShelter = cell.naturalProtection;
      } else if (biomeId === 'desert') {
        cell.flashFloodPotential = clamp01(cell.floodRisk);
        cell.sandExposure = cell.windExposure;
        cell.heatExposure = clamp01(0.55 - cell.naturalProtection * 0.35 + (1 - cell.elevation) * 0.1);
      }
    }
  }
  return cells;
}

const TERRAIN_FIELD_CACHE = {};
function getTerrainField(biomeId) {
  if (!TERRAIN_FIELD_CACHE[biomeId]) TERRAIN_FIELD_CACHE[biomeId] = generateTerrainField(biomeId);
  return TERRAIN_FIELD_CACHE[biomeId];
}
function cellIndex(gx, gy) { return gy * TERRAIN_GRID_SIZE + gx; }
function clampGrid(g) { return Math.max(0, Math.min(TERRAIN_GRID_SIZE - 1, g)); }
function cellAt(biomeId, gx, gy) { return getTerrainField(biomeId)[cellIndex(clampGrid(gx), clampGrid(gy))]; }
function cellAtNormalized(biomeId, nx, ny) {
  const gx = clampGrid(Math.floor(clamp01(nx) * TERRAIN_GRID_SIZE));
  const gy = clampGrid(Math.floor(clamp01(ny) * TERRAIN_GRID_SIZE));
  return cellAt(biomeId, gx, gy);
}

/* ---------- dynamic hazard-source queries (derived from the field itself) ---------- */
function getSourceCellsByType(biomeId, terrainType, direction) {
  const all = getTerrainField(biomeId).filter(c => c.terrainType === terrainType);
  let filtered = all;
  if (direction === 'NE' || direction === 'SE') filtered = all.filter(c => c.u >= 0.5);
  else if (direction === 'NW' || direction === 'SW') filtered = all.filter(c => c.u < 0.5);
  return filtered.length ? filtered : all;
}

function getEpicenterCell(biomeId) {
  const field = getTerrainField(biomeId);
  const sorted = field.slice().sort((a, b) => b.faultRisk - a.faultRisk);
  const topCount = Math.max(6, Math.floor(field.length * 0.05));
  return randomChoice(sorted.slice(0, topCount));
}

function getRidgeSourceType(biomeId) {
  if (biomeId === 'mountain') return 'ridge_crest';
  if (biomeId === 'snow') return 'snow_ridge';
  return null;
}
