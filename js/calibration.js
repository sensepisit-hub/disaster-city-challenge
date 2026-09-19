/* Disaster City Challenge - DEVELOPER-ONLY difficulty calibration utility.
   Not run automatically. From the browser console: runDifficultyCalibration()
   Measures whether random/naive placement is appropriately hard (target
   15%-30% weighted survival) and confirms smart placement clearly beats it. */

function calibrationSourceCells(biome, def, direction) {
  switch (def.id) {
    case 'flashflood':
      if (biome === 'desert') return getTerrainField(biome).filter(c => c.v < 0.32 && c.floodRisk > 0.4);
      return getSourceCellsByType(biome, getRidgeSourceType(biome), direction);
    case 'landslide': case 'rockfall': case 'avalanche':
      return getSourceCellsByType(biome, getRidgeSourceType(biome), direction);
    case 'tsunami': case 'coastalflood': case 'stormsurge': case 'typhoon':
      return getSourceCellsByType(biome, 'ocean', direction);
    default: return [];
  }
}

function calibrationBuildScenario(biome, disasterId) {
  const def = DISASTER_CATALOG[biome].find(d => d.id === disasterId);
  const direction = def.directions ? def.directions[Math.floor(Math.random() * def.directions.length)] : null;
  const level = INTENSITY_LEVELS[Math.floor(Math.random() * INTENSITY_LEVELS.length)];
  return {
    disaster: def.id, kind: def.kind, direction,
    sourceCells: def.id === 'earthquake' ? [] : calibrationSourceCells(biome, def, direction).map(c => ({ gx: c.gx, gy: c.gy })),
    epicenter: def.id === 'earthquake' ? (() => { const e = getEpicenterCell(biome); return { gx: e.gx, gy: e.gy }; })() : null,
    intensity: level.value
  };
}

function calibrationRandomPlacements(biome, mission) {
  const buildable = getTerrainField(biome).filter(c => c.buildable);
  const placements = [];
  function tryPlace(type) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const cell = buildable[Math.floor(Math.random() * buildable.length)];
      const nx = (cell.gx + 0.5) / TERRAIN_GRID_SIZE, ny = (cell.gy + 0.5) / TERRAIN_GRID_SIZE;
      if (!checkFootprintOverlap(nx, ny, type, placements)) { placements.push({ id: 'c' + placements.length, type, normalizedX: nx, normalizedY: ny }); return; }
    }
  }
  for (let i = 0; i < mission.housesRequired; i++) tryPlace('house');
  for (let i = 0; i < mission.highRisesRequired; i++) tryPlace('highrise');
  return placements;
}

function calibrationSmartPlacements(biome, mission, scenario) {
  // "excellent" strategy = an omniscient placer that can see the true hazard
  // field (the player never sees this in-game - placement happens blind).
  const hazard = calculateHazardField(biome, scenario);
  const field = getTerrainField(biome).filter(c => c.buildable);
  const sorted = field.slice().sort((a, b) => hazard.exposure[cellIndex(a.gx, a.gy)] - hazard.exposure[cellIndex(b.gx, b.gy)]);
  const placements = [];
  function place(type) {
    for (const c of sorted) {
      const nx = (c.gx + 0.5) / TERRAIN_GRID_SIZE, ny = (c.gy + 0.5) / TERRAIN_GRID_SIZE;
      if (!checkFootprintOverlap(nx, ny, type, placements)) { placements.push({ id: 's' + placements.length, type, normalizedX: nx, normalizedY: ny }); return; }
    }
  }
  for (let i = 0; i < mission.housesRequired; i++) place('house');
  for (let i = 0; i < mission.highRisesRequired; i++) place('highrise');
  return placements;
}

function calibrationGoodPlacements(biome, mission, scenario) {
  // "good" strategy = what a terrain-literate player can see without the hidden
  // hazard field: elevation, natural shelter, slope, coast distance, and the
  // briefed hazard direction.
  function score(c) {
    let s = c.elevation * 0.5 + c.naturalProtection * 0.45 - c.slope * 0.3;
    if (biome === 'coast') s += c.coastDistance * 0.8;
    if (scenario.direction) s -= directionalAlignment(c, scenario.direction) * 0.5;
    return s;
  }
  const sorted = getTerrainField(biome).filter(c => c.buildable).sort((a, b) => score(b) - score(a));
  const placements = [];
  function place(type) {
    for (const c of sorted) {
      const nx = (c.gx + 0.5) / TERRAIN_GRID_SIZE, ny = (c.gy + 0.5) / TERRAIN_GRID_SIZE;
      if (!checkFootprintOverlap(nx, ny, type, placements)) { placements.push({ id: 'g' + placements.length, type, normalizedX: nx, normalizedY: ny }); return; }
    }
  }
  for (let i = 0; i < mission.housesRequired; i++) place('house');
  for (let i = 0; i < mission.highRisesRequired; i++) place('highrise');
  return placements;
}

function calibrationWeightedSurvival(buildingResults) {
  if (buildingResults.length === 0) return 0;
  let ws = 0, wt = 0;
  buildingResults.forEach(r => { const w = BUILDING_TYPES[r.type].damageWeight; wt += w; ws += w * STATUS_MULTIPLIER[r.status]; });
  return wt ? (ws / wt) * 100 : 0;
}

function median(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function runDifficultyCalibration(trialsPerCombo) {
  trialsPerCombo = trialsPerCombo || 100;
  const mission = { housesRequired: 4, highRisesRequired: 1 };
  const report = [];
  Object.keys(DISASTER_CATALOG).forEach(biome => {
    DISASTER_CATALOG[biome].forEach(def => {
      const randomSurvivals = [];
      for (let i = 0; i < trialsPerCombo; i++) {
        const scenario = calibrationBuildScenario(biome, def.id);
        const placements = calibrationRandomPlacements(biome, mission);
        const sim = runSimulation(biome, scenario, placements);
        randomSurvivals.push(calibrationWeightedSurvival(sim.buildingResults));
      }
      const goodSurvivals = [];
      const smartSurvivals = [];
      for (let i = 0; i < 15; i++) {
        const scenario = calibrationBuildScenario(biome, def.id);
        const goodPlacements = calibrationGoodPlacements(biome, mission, scenario);
        goodSurvivals.push(calibrationWeightedSurvival(runSimulation(biome, scenario, goodPlacements).buildingResults));
        const smartPlacements = calibrationSmartPlacements(biome, mission, scenario);
        smartSurvivals.push(calibrationWeightedSurvival(runSimulation(biome, scenario, smartPlacements).buildingResults));
      }
      report.push({
        biome, disaster: def.id,
        randomMedian: Math.round(median(randomSurvivals)),
        randomMin: Math.round(Math.min(...randomSurvivals)),
        randomMax: Math.round(Math.max(...randomSurvivals)),
        goodMedian: Math.round(median(goodSurvivals)),
        smartMedian: Math.round(median(smartSurvivals))
      });
    });
  });

  if (typeof console !== 'undefined') {
    console.log('=== DISASTER CITY CHALLENGE - DIFFICULTY CALIBRATION ===');
    report.forEach(r => {
      const flag = r.randomMedian > 35 ? '  <- TOO EASY' : r.randomMedian < 10 ? '  <- TOO HARD' : '';
      console.log(`${r.biome.padEnd(9)} ${r.disaster.padEnd(13)} random ${String(r.randomMedian).padStart(3)}% (${r.randomMin}-${r.randomMax}%)  good ${String(r.goodMedian).padStart(3)}%  smart ${String(r.smartMedian).padStart(3)}%${flag}`);
    });
  }
  return report;
}

if (typeof window !== 'undefined') window.runDifficultyCalibration = runDifficultyCalibration;
if (typeof module !== 'undefined') module.exports = { runDifficultyCalibration };
