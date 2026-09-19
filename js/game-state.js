/* Disaster City Challenge - state machine, scenario generation, continuous placement, pause/resume, session persistence */

const PHASES = {
  HOME: 'HOME',
  BIOME_SELECTION: 'BIOME_SELECTION',
  TIME_SELECTION: 'TIME_SELECTION',
  BRIEFING: 'BRIEFING',
  PREPARATION: 'PREPARATION',
  SIMULATION: 'SIMULATION',
  RESULT: 'RESULT',
  HISTORY: 'HISTORY',
  SETTINGS: 'SETTINGS'
};

const SIMULATION_DURATION_MS = {
  water: 12000, slide: 10000, quake: 9000, wind: 11000, heat: 8000
};

function freshGameState() {
  return {
    phase: PHASES.HOME,
    biome: null,
    scenario: { id: null, seed: null, disaster: null, kind: null, direction: null, sourceCells: [], epicenter: null, intensity: null, threatLabel: null },
    mission: { housesRequired: 0, highRisesRequired: 0 },
    preparation: { durationSeconds: DEFAULT_PREP_SECONDS, endsAt: null, paused: false, remainingAtPause: null, planningTimeUsedSeconds: null },
    placements: [],
    selectedBuildingType: 'house',
    simulation: { running: false, accumulatedMs: 0, segmentStartedAt: null, paused: false, speed: 1, buildingResults: [] },
    result: null,
    _placementCounter: 0
  };
}

const GameState = {
  data: freshGameState(),
  liveHazard: null,
  _recentByBiome: { desert: [], mountain: [], snow: [], coast: [] },
  _recentDirections: [],
  _lastMissionSig: null,
  _scenarioSignatures: [],

  reset() {
    this.data = freshGameState();
    this.liveHazard = null;
    Storage.clearActiveSession();
  },

  selectBiome(biomeId) {
    this.data = freshGameState();
    this.liveHazard = null;
    this.data.biome = biomeId;
    this.generateScenario();
    this.data.phase = PHASES.TIME_SELECTION;
    this.persist();
  },

  generateDisaster() {
    const catalog = DISASTER_CATALOG[this.data.biome];
    const ids = catalog.map(d => d.id);
    const chosenId = pickAvoidingRecent(ids, this._recentByBiome[this.data.biome], 1);
    this._recentByBiome[this.data.biome] = this._recentByBiome[this.data.biome].concat([chosenId]).slice(-3);
    return catalog.find(d => d.id === chosenId);
  },

  generateDisasterDirection(disasterDef) {
    if (!disasterDef.directions) return null;
    const dir = pickAvoidingRecent(disasterDef.directions, this._recentDirections, 2);
    this._recentDirections = this._recentDirections.concat([dir]).slice(-4);
    return dir;
  },

  computeSourceCells(disasterDef, direction) {
    const biome = this.data.biome;
    switch (disasterDef.id) {
      case 'flashflood':
        if (biome === 'desert') {
          const field = getTerrainField(biome);
          return field.filter(c => c.v < 0.32 && c.floodRisk > 0.4);
        }
        return getSourceCellsByType(biome, getRidgeSourceType(biome), direction);
      case 'landslide':
      case 'rockfall':
      case 'avalanche':
        return getSourceCellsByType(biome, getRidgeSourceType(biome), direction);
      case 'tsunami':
      case 'coastalflood':
      case 'stormsurge':
      case 'typhoon':
        return getSourceCellsByType(biome, 'ocean', direction);
      default:
        return [];
    }
  },

  generateBuildingMission() {
    let houses, highRises, sig, attempts = 0;
    do {
      houses = secureRandomInt(MISSION_RANGES.house.min, MISSION_RANGES.house.max);
      highRises = secureRandomInt(MISSION_RANGES.highrise.min, MISSION_RANGES.highrise.max);
      sig = houses + '-' + highRises;
      attempts++;
    } while (sig === this._lastMissionSig && attempts < 8);
    this._lastMissionSig = sig;
    return { housesRequired: houses, highRisesRequired: highRises };
  },

  generateScenario() {
    const disasterDef = this.generateDisaster();
    const direction = this.generateDisasterDirection(disasterDef);
    const sourceCells = disasterDef.id === 'earthquake' ? [] : this.computeSourceCells(disasterDef, direction);
    const epicenter = disasterDef.id === 'earthquake' ? getEpicenterCell(this.data.biome) : null;
    const mission = this.generateBuildingMission();
    const level = weightedRandomChoice(INTENSITY_LEVELS, l => l.weight);

    this.data.scenario = {
      id: 'scn_' + Date.now() + '_' + secureRandomInt(1000, 9999),
      seed: Date.now(),
      disaster: disasterDef.id,
      label: disasterDef.label,
      kind: disasterDef.kind,
      direction,
      sourceCells: sourceCells.map(c => ({ gx: c.gx, gy: c.gy })),
      epicenter: epicenter ? { gx: epicenter.gx, gy: epicenter.gy } : null,
      intensity: level.value,
      threatLabel: level.label
    };
    this.data.mission = mission;
  },

  selectPreparationTime(seconds) {
    this.data.preparation.durationSeconds = seconds;
    this.data.phase = PHASES.BRIEFING;
    this.persist();
  },

  beginPreparation() {
    this.data.preparation.endsAt = Date.now() + this.data.preparation.durationSeconds * 1000;
    this.data.preparation.paused = false;
    const sig = ScenarioHistory.signature(this.data.biome, this.data.scenario.disaster, this.data.scenario.direction,
      this.data.mission.housesRequired, this.data.mission.highRisesRequired, this.data.preparation.durationSeconds);
    this._scenarioSignatures = ScenarioHistory.push(sig, this._scenarioSignatures);
    this.data.phase = PHASES.PREPARATION;
    this.persist();
  },

  remainingPrepSeconds() {
    if (this.data.preparation.paused) return this.data.preparation.remainingAtPause;
    if (!this.data.preparation.endsAt) return this.data.preparation.durationSeconds;
    return Math.max(0, Math.ceil((this.data.preparation.endsAt - Date.now()) / 1000));
  },

  pausePreparation() {
    if (this.data.preparation.paused) return;
    this.data.preparation.remainingAtPause = this.remainingPrepSeconds();
    this.data.preparation.paused = true;
    this.persist();
  },

  resumePreparation() {
    if (!this.data.preparation.paused) return;
    this.data.preparation.endsAt = Date.now() + this.data.preparation.remainingAtPause * 1000;
    this.data.preparation.paused = false;
    this.data.preparation.remainingAtPause = null;
    this.persist();
  },

  selectBuildingType(type) { this.data.selectedBuildingType = type; },

  remainingCount(type) {
    const required = type === 'house' ? this.data.mission.housesRequired : this.data.mission.highRisesRequired;
    const placed = this.data.placements.filter(p => p.type === type).length;
    return Math.max(0, required - placed);
  },

  allRequiredPlaced() {
    return this.remainingCount('house') === 0 && this.remainingCount('highrise') === 0;
  },

  totalRemainingCount() { return this.remainingCount('house') + this.remainingCount('highrise'); },

  canPlace(nx, ny, type) {
    const cell = cellAtNormalized(this.data.biome, nx, ny);
    if (!cell.buildable) return { ok: false, reason: 'This ground cannot be built on.' };
    if (this.remainingCount(type) <= 0) return { ok: false, reason: 'All buildings of this type are already placed.' };
    if (checkFootprintOverlap(nx, ny, type, this.data.placements)) return { ok: false, reason: 'TOO CLOSE TO ANOTHER BUILDING. Choose another location.' };
    return { ok: true };
  },

  placeBuilding(nx, ny) {
    const type = this.data.selectedBuildingType;
    const check = this.canPlace(nx, ny, type);
    if (!check.ok) return check;
    this.data._placementCounter++;
    this.data.placements.push({
      id: 'building-' + String(this.data._placementCounter).padStart(3, '0'),
      type, normalizedX: nx, normalizedY: ny, gridX: Math.floor(nx * TERRAIN_GRID_SIZE), gridY: Math.floor(ny * TERRAIN_GRID_SIZE),
      placedAt: Date.now()
    });
    this.persist();
    return { ok: true };
  },

  undoPlacement() {
    this.data.placements.pop();
    this.persist();
  },

  resetPlacements() {
    this.data.placements = [];
    this.persist();
  },

  lockPlacements() {
    this.data.preparation.planningTimeUsedSeconds = Math.max(0, this.data.preparation.durationSeconds - this.remainingPrepSeconds());
    this.data.preparation.paused = false;
    this.data.phase = PHASES.SIMULATION;
    this.data.simulation.running = true;
    this.data.simulation.paused = false;
    this.data.simulation.speed = 1;
    this.data.simulation.accumulatedMs = 0;
    this.data.simulation.segmentStartedAt = Date.now();
    const sim = runSimulation(this.data.biome, this.data.scenario, this.data.placements);
    this.liveHazard = sim.hazard;
    this.data.simulation.buildingResults = sim.buildingResults;
    this.persist();
  },

  simulationDurationMs() { return SIMULATION_DURATION_MS[this.data.scenario.kind] || 10000; },

  simulationElapsedMs() {
    const sim = this.data.simulation;
    if (sim.paused || !sim.segmentStartedAt) return sim.accumulatedMs;
    return sim.accumulatedMs + (Date.now() - sim.segmentStartedAt) * sim.speed;
  },

  simulationProgress() {
    return clamp01b(this.simulationElapsedMs() / this.simulationDurationMs());
  },

  pauseSimulation() {
    if (this.data.simulation.paused) return;
    this.data.simulation.accumulatedMs = this.simulationElapsedMs();
    this.data.simulation.paused = true;
    this.persist();
  },

  resumeSimulation() {
    if (!this.data.simulation.paused) return;
    this.data.simulation.segmentStartedAt = Date.now();
    this.data.simulation.paused = false;
    this.persist();
  },

  setSimulationSpeed(mult) {
    this.data.simulation.accumulatedMs = this.simulationElapsedMs();
    this.data.simulation.segmentStartedAt = Date.now();
    this.data.simulation.speed = mult;
  },

  finalizeSimulation() {
    if (!this.liveHazard) {
      const sim = runSimulation(this.data.biome, this.data.scenario, this.data.placements);
      this.liveHazard = sim.hazard;
      this.data.simulation.buildingResults = sim.buildingResults;
    }
    this.data.simulation.running = false;
    const buildingResults = this.data.simulation.buildingResults;

    const scoreData = calculateFinalScore(this.data.placements, this.data.mission, buildingResults, this.liveHazard.exposure);
    const rank = getRank(scoreData.score);
    const population = calculatePopulationProtected(buildingResults);
    const report = generateEducationalReport(this.data.scenario, this.data.biome, buildingResults);

    const housesRes = buildingResults.filter(r => r.type === 'house');
    const highRes = buildingResults.filter(r => r.type === 'highrise');
    const count = (arr, s) => arr.filter(r => r.status === s).length;

    const result = {
      score: scoreData.score,
      rank: rank.label,
      rankBadge: rank.badge,
      categories: scoreData.categories,
      buildings: {
        houses: { safe: count(housesRes, 'safe'), damaged: count(housesRes, 'damaged'), destroyed: count(housesRes, 'destroyed'), total: housesRes.length },
        highRise: { safe: count(highRes, 'safe'), damaged: count(highRes, 'damaged'), destroyed: count(highRes, 'destroyed'), total: highRes.length }
      },
      populationProtectedPercent: population,
      report,
      planningTimeUsedSeconds: this.data.preparation.planningTimeUsedSeconds,
      threatLabel: this.data.scenario.threatLabel,
      biome: this.data.biome,
      disaster: this.data.scenario.disaster,
      disasterLabel: this.data.scenario.label,
      buildingResults,
      date: Date.now()
    };
    this.data.result = result;
    this.data.phase = PHASES.RESULT;

    Storage.saveResult(result);
    const allResults = Storage.loadResults().missions;
    const bestByBiome = {};
    allResults.forEach(m => { bestByBiome[m.biome] = Math.max(bestByBiome[m.biome] || 0, m.score); });
    const newAchievements = checkNewAchievements({ totalPlayed: allResults.length, biome: this.data.biome, score: result.score, bestByBiome });
    result.newAchievements = newAchievements;

    Storage.clearActiveSession();
    return result;
  },

  playAgainSameBiome() {
    const biome = this.data.biome;
    this.data = freshGameState();
    this.liveHazard = null;
    this.data.biome = biome;
    this.generateScenario();
    this.data.phase = PHASES.TIME_SELECTION;
    this.persist();
  },

  persist() {
    if (this.data.phase === PHASES.RESULT || this.data.phase === PHASES.HOME) { Storage.clearActiveSession(); return; }
    Storage.saveActiveSession(this.data);
  },

  loadResumableSession() {
    const s = Storage.loadActiveSession();
    if (!s || !s.biome || s.phase === PHASES.HOME || s.phase === PHASES.RESULT) return null;
    return s;
  },

  resumeSession(session) {
    this.data = session;
    this.liveHazard = null;
    if (this.data.phase === PHASES.SIMULATION) {
      return this.finalizeSimulation();
    }
    if (this.data.phase === PHASES.PREPARATION && !this.data.preparation.paused && this.remainingPrepSeconds() <= 0) {
      this.lockPlacements();
      return this.finalizeSimulation();
    }
    return null;
  },

  discardResumable() {
    Storage.clearActiveSession();
  }
};
