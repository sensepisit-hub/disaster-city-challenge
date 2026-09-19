/* Disaster City Challenge - scoring, ranks, population metric, educational report (no emoji) */

const STATUS_MULTIPLIER = { safe: 1.0, damaged: 0.5, destroyed: 0.0 };
const STATUS_LABEL = { safe: 'SAFE', damaged: 'DAMAGED', destroyed: 'DESTROYED' };

function calculateBuildingSurvivalScore(buildingResults) {
  if (buildingResults.length === 0) return 0;
  let weightSum = 0, weightedSurvival = 0;
  buildingResults.forEach(r => {
    const w = BUILDING_TYPES[r.type].damageWeight;
    weightSum += w;
    weightedSurvival += w * STATUS_MULTIPLIER[r.status];
  });
  return (weightedSurvival / weightSum) * SCORING_WEIGHTS.survival;
}

function calculateSmartPlacementScore(placements, exposureArr) {
  if (placements.length === 0) return 0;
  let weightSum = 0, weightedQuality = 0;
  placements.forEach(p => {
    const w = BUILDING_TYPES[p.type].damageWeight;
    const exp = exposureArr[cellIndex(p.gridX, p.gridY)] || 0;
    const quality = clamp01b(1 - exp);
    weightSum += w;
    weightedQuality += w * quality;
  });
  return (weightedQuality / weightSum) * SCORING_WEIGHTS.placement;
}

function calculateMissionCompletionScore(placements, mission) {
  const requiredTotal = mission.housesRequired + mission.highRisesRequired;
  if (requiredTotal === 0) return SCORING_WEIGHTS.completion;
  const placedHouses = Math.min(mission.housesRequired, placements.filter(p => p.type === 'house').length);
  const placedHighRise = Math.min(mission.highRisesRequired, placements.filter(p => p.type === 'highrise').length);
  const ratio = (placedHouses + placedHighRise) / requiredTotal;
  return SCORING_WEIGHTS.completion * ratio;
}

function calculatePopulationProtected(buildingResults) {
  if (buildingResults.length === 0) return 0;
  let totalPop = 0, protectedPop = 0;
  buildingResults.forEach(r => {
    const units = BUILDING_TYPES[r.type].populationUnits;
    totalPop += units;
    protectedPop += units * STATUS_MULTIPLIER[r.status];
  });
  return Math.round((protectedPop / totalPop) * 100);
}

function calculateFinalScore(placements, mission, buildingResults, exposureArr) {
  const placementsWithCells = placements.map((p, i) => ({ type: p.type, gridX: buildingResults[i].gridX, gridY: buildingResults[i].gridY }));
  const survival = calculateBuildingSurvivalScore(buildingResults);
  const placement = calculateSmartPlacementScore(placementsWithCells, exposureArr);
  const completion = calculateMissionCompletionScore(placements, mission);
  const total = Math.round(Math.max(0, Math.min(100, survival + placement + completion)));
  return {
    score: total,
    categories: {
      survival: Math.round(survival),
      placement: Math.round(placement),
      completion: Math.round(completion)
    }
  };
}

/* ---------- educational report, generated from actual placement/outcome data ---------- */
function describeCellAdvantage(cell, scenario, biome) {
  const bits = [];
  if (scenario.kind === 'water') {
    if (biome === 'coast' && cell.coastDistance > 0.6) bits.push('high ground well inland from the coastline');
    else if (cell.elevation > 0.6) bits.push('elevated terrain above the flood line');
    if (cell.naturalProtection > 0.5) bits.push('natural high ground that broke the surge');
  } else if (scenario.kind === 'slide') {
    if (cell.naturalProtection > 0.5) bits.push('sheltered ground outside the flow path');
    if (cell.terrainType === 'safe_zone' || cell.terrainType === 'ridge_shadow') bits.push('a protected ridge-shadow pocket');
  } else if (scenario.kind === 'quake') {
    if (cell.faultRisk < 0.3) bits.push('stable ground away from the fault zone');
  } else if (scenario.kind === 'wind') {
    if (cell.naturalProtection > 0.5) bits.push('windbreak terrain that cut the wind');
  } else if (scenario.kind === 'heat') {
    if (cell.naturalProtection > 0.4) bits.push('shaded, sheltered ground');
  }
  return bits[0] || 'a comparatively lower-risk position';
}

function describeCellWeakness(cell, scenario, biome) {
  const bits = [];
  if (scenario.kind === 'water') {
    if (biome === 'coast' && cell.coastDistance < 0.35) bits.push('too close to the coastline');
    if (cell.elevation < 0.35) bits.push('low elevation directly in the water\'s path');
    if (cell.floodRisk > 0.6) bits.push('a natural flood channel or basin');
  } else if (scenario.kind === 'slide') {
    if (cell.landslideRisk > 0.5 || cell.avalancheRisk > 0.5) bits.push('directly downhill from the source');
    if (cell.slope > 0.5) bits.push('unstable, steep ground');
  } else if (scenario.kind === 'quake') {
    if (cell.faultRisk > 0.5) bits.push('right on top of the fault zone');
    else bits.push('soft, low-stability ground that amplified the shaking');
  } else if (scenario.kind === 'wind') {
    if (cell.naturalProtection < 0.2) bits.push('wide open ground with no windbreak');
  } else if (scenario.kind === 'heat') {
    bits.push('fully exposed open terrain');
  }
  return bits[0] || 'an exposed, high-risk position';
}

function coordLabel(gridX, gridY) { return `(${gridX + 1}, ${gridY + 1})`; }

function generateEducationalReport(scenario, biome, buildingResults) {
  const sorted = buildingResults.slice().sort((a, b) => b.hazardExposure - a.hazardExposure);
  const worst = sorted[0];
  const best = sorted[sorted.length - 1];
  const report = { safest: null, mostDangerous: null, tip: '' };

  if (best) {
    const cell = cellAt(biome, best.gridX, best.gridY);
    const label = BUILDING_TYPES[best.type].label;
    report.safest = `The ${label.toLowerCase()} at ${coordLabel(best.gridX, best.gridY)} stayed ${best.status === 'safe' ? 'safe' : 'standing'}. It sat on ${describeCellAdvantage(cell, scenario, biome)}.`;
  }
  if (worst && (worst.status === 'destroyed' || worst.status === 'damaged')) {
    const cell = cellAt(biome, worst.gridX, worst.gridY);
    const label = BUILDING_TYPES[worst.type].label;
    report.mostDangerous = `The ${label.toLowerCase()} at ${coordLabel(worst.gridX, worst.gridY)} was ${worst.status}. It was placed on ${describeCellWeakness(cell, scenario, biome)}.`;
  }

  const destroyedCount = buildingResults.filter(r => r.status === 'destroyed').length;
  const safeCount = buildingResults.filter(r => r.status === 'safe').length;
  if (buildingResults.every(r => r.status === 'safe')) {
    report.tip = 'Every building survived. That terrain analysis translates directly to real disaster planning.';
  } else if (buildingResults.every(r => r.status === 'destroyed')) {
    report.tip = 'Next time, spread your buildings toward higher, more sheltered ground before locking placements.';
  } else if (destroyedCount > safeCount) {
    report.tip = 'Favor terrain with higher natural protection and greater distance from the hazard source. That matters more than being close to the center of the map.';
  } else {
    report.tip = 'Strong result. Push your riskiest building to an even safer zone next time for a higher placement score.';
  }
  return report;
}

function checkNewAchievements(ctx) {
  const unlocked = Storage.loadAchievements().unlocked;
  const newlyUnlocked = [];
  ACHIEVEMENTS.forEach(a => {
    if (!unlocked.includes(a.id) && a.check(ctx)) newlyUnlocked.push(a);
  });
  if (newlyUnlocked.length > 0) {
    Storage.saveAchievements({ unlocked: unlocked.concat(newlyUnlocked.map(a => a.id)) });
  }
  return newlyUnlocked;
}
