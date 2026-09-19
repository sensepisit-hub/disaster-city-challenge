# Disaster City Challenge

**Build Smart. Survive the Disaster.**

An offline educational strategy game about geography, natural disasters, and
urban planning. Children tap houses and high-rises directly onto one of four
fixed physical terrain models (Desert, Mountain, Snow, Coast), simulated
internally on a 25×25 continuous grid, then watch a deterministic disaster
simulation decide which buildings survive based on terrain, elevation, hazard
direction, and placement choices.

Pure HTML5 / CSS3 / vanilla JavaScript. No build step, no backend, no
external images/audio/CDN. Works fully offline, from `file://` or a local
server.

## Running it

- **Open directly:** double-click `index.html`.
- **Local server (optional):** `python -m http.server 8000` then visit `http://localhost:8000`.

No accounts, API keys, or internet connection required either way.

## File structure

```
index.html                 All screens (markup)
styles.css                 Cinematic theme, layout, animation, responsive/accessibility rules
js/random-engine.js        Secure random helpers + anti-repeat history
js/biome-data.js           Four FIXED biome terrain fields (25x25 = 625 cells each), bilinear-interpolated
                            from small authored control maps - deterministic, never regenerated per game
js/game-data.js            Buildings, disasters, directions, intensity levels, scoring weights, ranks
js/storage.js              Versioned localStorage access with safe JSON parsing
js/icons.js                Inline SVG icon library (buildings, status badges, rank badges, UI glyphs - no emoji)
js/audio.js                Web Audio API generated sound effects (no audio files)
js/effects.js              Canvas particle systems (rain/snow/sand/waves) + terrain/card art
js/simulation-engine.js    Cellular-automaton hazard propagation (water flow / debris flow) + damage calc
js/scoring.js              Survival/placement/completion scoring, ranks, educational report generation
js/game-state.js           State machine, scenario generation, continuous placement, pause/resume, persistence
js/calibration.js          DEV-ONLY: runDifficultyCalibration() - measures random vs. skilled survival rates
js/app.js                  DOM wiring, continuous-terrain rendering, main animation loop
```

## Game loop

Choose biome → random disaster + direction + threat level + building mission
are generated → choose preparation time (45/60/90s) → briefing → tap the
terrain to place buildings (or pause, or start the disaster early) → cinematic
lock-in → disaster simulation (pausable, 1×/2× speed) → disaster response
report → play again.

## The 25×25 simulation grid

Each biome's terrain (elevation, slope, stability, flood/landslide/avalanche
risk, natural protection, buildable/non-buildable, plus biome-specific fields
like `tsunamiExposure` or `avalanchePotential`) lives on a 625-cell grid,
generated once via bilinear interpolation of a small 5×5 authored control map
(`js/biome-data.js`). This is fixed and deterministic - never regenerated
between games. The player never sees the raw grid (`Settings → Show
Simulation Grid` reveals it for teachers/developers); the map renders as a
continuous, bilinearly-smoothed terrain image instead. Building placement is
continuous (`{ normalizedX, normalizedY }`, 0–1), snapped only internally to
the nearest cell for simulation lookups - this also doubles as the intended
hook for a future camera/object-detection integration (see below).

## How the disaster simulation works

`js/simulation-engine.js` runs a small cellular-automaton flow model for
water and debris/snow hazards (mass moves from the fixed hazard source toward
lower-elevation neighbors over ~30–65 steps), blended with a static
terrain-risk field so danger scales with distance/elevation/shelter rather
than an arbitrary shape. Earthquakes use radial falloff from a randomly
chosen fault-zone epicenter, amplified by local ground stability. Wind
hazards use a directional-alignment formula. A small regional exposure floor
ensures no cell is ever *exactly* zero-risk during a severe/extreme disaster.
Building outcome is `exposure − buildingResistance`, thresholded per hazard
kind into safe/damaged/destroyed - no `Math.random()` in the outcome, so the
same scenario + same placements always produces the same result (pausing,
resuming, or changing simulation speed never changes it).

## Scoring (out of 100)

- **Building Survival (60 pts):** weighted by building type (house=1,
  high-rise=2) × survival multiplier (safe=1.0, damaged=0.5, destroyed=0.0).
- **Strategic Placement (25 pts):** weighted quality of each building's cell
  exposure at simulation start, same weights.
- **Mission Completion (15 pts):** proportional to required buildings placed
  before the disaster struck.

Ranks: 90–100 Disaster Master · 75–89 City Protector · 55–74 Smart Planner ·
35–54 Risk Learner · 0–34 Rebuild & Retry.

## Difficulty calibration

Run `runDifficultyCalibration()` from the browser console (or via `js/calibration.js`
directly in Node) to measure, per biome/disaster: median weighted survival
under **random** placement, a **good** (terrain-visible-cues) heuristic, and
a **smart** (omniscient) heuristic. It never runs automatically during play.

## LocalStorage keys

- `disaster_city_active_session_v1` - in-progress mission (survives refresh)
- `disaster_city_results_v1` - permanent mission history
- `disaster_city_settings_v1` - sound / reduced-effects / debug-grid settings
- `disaster_city_achievements_v1` - unlocked achievements

## Refresh / resume / pause

The active session stores absolute timestamps (`endsAt` for preparation,
`accumulatedMs` + `segmentStartedAt` for simulation), never a raw countdown -
so refreshing never resets a timer, and pausing (preparation or simulation)
freezes progress exactly, with no "lost" or "gained" time on resume.

## Future upgrade: automatic physical building detection

`GameState.placeBuilding(normalizedX, normalizedY)` already accepts
continuous 0–1 coordinates matching the physical sandbox - the intended hook
for a future top-down camera + lightweight object-detection model (trained on
the two physical building miniatures) to call directly instead of a tap.
