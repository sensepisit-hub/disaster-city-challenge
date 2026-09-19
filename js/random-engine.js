/* Disaster City Challenge - secure random utilities + anti-repeat history */

function secureRandom() {
  if (window.crypto && window.crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    window.crypto.getRandomValues(buf);
    return buf[0] / 4294967296;
  }
  return Math.random();
}

function secureRandomInt(min, max) {
  return Math.floor(secureRandom() * (max - min + 1)) + min;
}

function randomChoice(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[secureRandomInt(0, arr.length - 1)];
}

function weightedRandomChoice(items, weightFn) {
  const weights = items.map(weightFn);
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = secureRandom() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = secureRandomInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Picks a value from `options`, avoiding the most recent picks stored in
 * `recentHistory` (array, most recent last) when at least one alternative
 * exists. Falls back to any option if all are "recent" (small pools).
 */
function pickAvoidingRecent(options, recentHistory, lookback) {
  if (!options || options.length === 0) return null;
  const recent = recentHistory.slice(-lookback);
  const fresh = options.filter(o => !recent.includes(o));
  return randomChoice(fresh.length > 0 ? fresh : options);
}

const ScenarioHistory = {
  MAX_SIGNATURES: 5,

  signature(biome, disaster, direction, houses, highRises, prepTime) {
    return [biome, disaster, direction, houses, highRises, prepTime].join('|');
  },

  isTooSimilar(sig, historyList) {
    return historyList.includes(sig);
  },

  push(sig, historyList) {
    const next = historyList.concat([sig]);
    return next.slice(-ScenarioHistory.MAX_SIGNATURES);
  }
};
