/* Disaster City Challenge - static game-balance data (buildings, disasters, directions, scoring, ranks, achievements) */

const DIRECTIONS = {
  N:  { id: 'N',  label: 'North',     angle: 270, opposite: 'S'  },
  NE: { id: 'NE', label: 'Northeast', angle: 315, opposite: 'SW' },
  E:  { id: 'E',  label: 'East',      angle: 0,   opposite: 'W'  },
  SE: { id: 'SE', label: 'Southeast', angle: 45,  opposite: 'NW' },
  S:  { id: 'S',  label: 'South',     angle: 90,  opposite: 'N'  },
  SW: { id: 'SW', label: 'Southwest', angle: 135, opposite: 'NE' },
  W:  { id: 'W',  label: 'West',      angle: 180, opposite: 'E'  },
  NW: { id: 'NW', label: 'Northwest', angle: 225, opposite: 'SE' }
};

/* radius is normalized (fraction of the 0..1 map = 50cm sandbox), used for
   minimum building-separation / footprint checks on the continuous grid. */
const BUILDING_TYPES = {
  house: {
    id: 'house',
    label: 'House',
    tone: '#caa877',
    populationWeight: 1,
    damageWeight: 1,
    populationUnits: 10,
    radius: 1 / TERRAIN_GRID_SIZE,
    earthquakeResistance: 0.42,
    floodResistance: 0.24,
    windResistance: 0.38,
    slideResistance: 0.20
  },
  highrise: {
    id: 'highrise',
    label: 'High-Rise',
    tone: '#9fb0c2',
    populationWeight: 2,
    damageWeight: 2,
    populationUnits: 40,
    radius: 1.75 / TERRAIN_GRID_SIZE,
    earthquakeResistance: 0.50,
    floodResistance: 0.44,
    windResistance: 0.42,
    slideResistance: 0.14
  }
};

const PREP_TIME_OPTIONS = [
  { seconds: 45, title: 'QUICK RESPONSE', subtitle: '45 seconds' },
  { seconds: 60, title: 'STANDARD MISSION', subtitle: '60 seconds' },
  { seconds: 90, title: 'STRATEGY MODE', subtitle: '90 seconds' }
];
const DEFAULT_PREP_SECONDS = 60;

const MISSION_RANGES = {
  house: { min: 3, max: 5 },
  highrise: { min: 1, max: 2 }
};

/* Threat level = randomized scenario intensity multiplier. Exact numbers are
   never shown to the player - only the MODERATE/SEVERE/EXTREME label. */
const INTENSITY_LEVELS = [
  { id: 'moderate', label: 'MODERATE', value: 0.90, weight: 25 },
  { id: 'severe',   label: 'SEVERE',   value: 1.05, weight: 50 },
  { id: 'extreme',  label: 'EXTREME',  value: 1.20, weight: 25 }
];

/* Disaster catalog: ONE fixed disaster per biome (no random disaster-type
   selection). Direction pools are restricted to what is geographically
   sensible for the fixed map layout (North edge = inland/high ground; ridge
   sits along the North edge for mountain/snow; ocean sits along the South
   edge for coast). */
const DISASTER_CATALOG = {
  desert:   [{ id: 'sandstorm',  label: 'Sandstorm', directions: ['N','NE','E','SE','S','SW','W','NW'], kind: 'wind' }],
  mountain: [{ id: 'flashflood', label: 'Flood',      directions: ['N','NE','NW'], kind: 'water' }],
  snow:     [{ id: 'blizzard',   label: 'Blizzard',   directions: ['N','NE','E','NW','W'], kind: 'wind' }],
  coast:    [{ id: 'tsunami',    label: 'Tsunami',    directions: ['S','SE','SW'], kind: 'water' }]
};

const DISASTER_WARNING_TEXT = {
  sandstorm:   dir => `Blowing sand and dust approaching from the ${DIRECTIONS[dir].label.toUpperCase()}.`,
  flashflood:  dir => `Flood water surging down from the ${DIRECTIONS[dir].label.toUpperCase()} highlands.`,
  earthquake:  () => `Seismic activity detected near the marked fault zone.`,
  extremeheat: () => `A dangerous heat wave is settling over the whole region.`,
  landslide:   dir => `Unstable slope collapsing from the ${DIRECTIONS[dir].label.toUpperCase()} ridge.`,
  rockfall:    dir => `Loose rock breaking away from the ${DIRECTIONS[dir].label.toUpperCase()} cliffs.`,
  avalanche:   dir => `Snow mass descending from the ${DIRECTIONS[dir].label.toUpperCase()} ridge.`,
  blizzard:    dir => `A blinding blizzard is blowing in from the ${DIRECTIONS[dir].label.toUpperCase()}.`,
  snowstorm:   dir => `Heavy snowstorm rolling in from the ${DIRECTIONS[dir].label.toUpperCase()}.`,
  tsunami:     dir => `Massive wave approaching from the ${DIRECTIONS[dir].label.toUpperCase()}.`,
  coastalflood:dir => `Rising seawater flooding inland from the ${DIRECTIONS[dir].label.toUpperCase()}.`,
  stormsurge:  dir => `A storm surge is pushing ocean water inland from the ${DIRECTIONS[dir].label.toUpperCase()}.`,
  typhoon:     dir => `A powerful typhoon is closing in from the ${DIRECTIONS[dir].label.toUpperCase()}.`
};

const SCORING_WEIGHTS = {
  survival: 60,
  placement: 25,
  completion: 15
};

const RANKS = [
  { min: 90, max: 100, label: 'DISASTER MASTER', badge: 'trophy' },
  { min: 75, max: 89,  label: 'CITY PROTECTOR',  badge: 'shield' },
  { min: 55, max: 74,  label: 'SMART PLANNER',   badge: 'brain' },
  { min: 35, max: 54,  label: 'RISK LEARNER',    badge: 'ladder' },
  { min: 0,  max: 34,  label: 'REBUILD & RETRY', badge: 'wrench' }
];

function getRank(score) {
  return RANKS.find(r => score >= r.min && score <= r.max) || RANKS[RANKS.length - 1];
}

const ACHIEVEMENTS = [
  { id: 'first_survival',    label: 'First Survival',    desc: 'Complete your first mission.',            check: ctx => ctx.totalPlayed >= 1 },
  { id: 'coastal_guardian',  label: 'Coastal Guardian',  desc: 'Score 85+ in the Coast biome.',            check: ctx => ctx.biome === 'coast' && ctx.score >= 85 },
  { id: 'mountain_master',   label: 'Mountain Master',   desc: 'Score 85+ in the Mountain biome.',         check: ctx => ctx.biome === 'mountain' && ctx.score >= 85 },
  { id: 'snow_survivor',     label: 'Snow Survivor',     desc: 'Score 85+ in the Snow biome.',             check: ctx => ctx.biome === 'snow' && ctx.score >= 85 },
  { id: 'desert_strategist', label: 'Desert Strategist', desc: 'Score 85+ in the Desert biome.',           check: ctx => ctx.biome === 'desert' && ctx.score >= 85 },
  { id: 'perfect_city',      label: 'Perfect City',      desc: 'Score a perfect 100.',                     check: ctx => ctx.score >= 100 },
  { id: 'disaster_master',   label: 'Disaster Master',   desc: 'Score 90+ in all four biomes.',            check: ctx => ctx.bestByBiome && ['desert','mountain','snow','coast'].every(b => (ctx.bestByBiome[b] || 0) >= 90) }
];
