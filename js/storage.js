/* Disaster City Challenge - versioned localStorage access with safe JSON handling */

const STORAGE_KEYS = {
  activeSession: 'disaster_city_active_session_v1',
  results: 'disaster_city_results_v1',
  settings: 'disaster_city_settings_v1',
  achievements: 'disaster_city_achievements_v1'
};

function safeParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

function safeGet(key, fallback) {
  try {
    return safeParse(window.localStorage.getItem(key), fallback);
  } catch (e) {
    return fallback;
  }
}

function safeSet(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

function safeRemove(key) {
  try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
}

const Storage = {
  loadSettings() {
    return Object.assign({ sound: true, reducedEffects: false }, safeGet(STORAGE_KEYS.settings, {}));
  },
  saveSettings(settings) { safeSet(STORAGE_KEYS.settings, settings); },

  loadResults() {
    return safeGet(STORAGE_KEYS.results, { missions: [] });
  },
  saveResult(entry) {
    const data = Storage.loadResults();
    data.missions.push(entry);
    safeSet(STORAGE_KEYS.results, data);
    return data;
  },
  resetResults() { safeSet(STORAGE_KEYS.results, { missions: [] }); },

  loadAchievements() {
    return safeGet(STORAGE_KEYS.achievements, { unlocked: [] });
  },
  saveAchievements(data) { safeSet(STORAGE_KEYS.achievements, data); },

  loadActiveSession() { return safeGet(STORAGE_KEYS.activeSession, null); },
  saveActiveSession(session) { safeSet(STORAGE_KEYS.activeSession, session); },
  clearActiveSession() { safeRemove(STORAGE_KEYS.activeSession); },

  resetCurrentMission() { Storage.clearActiveSession(); }
};
