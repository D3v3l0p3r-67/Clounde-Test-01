import { STORAGE_PREFIX, SCHEMA_VERSION, DEFAULT_ZOOM } from './constants.js';

const KEYS = {
  highscores: STORAGE_PREFIX + 'highscores',
  settings: STORAGE_PREFIX + 'settings',
  levelEdits: STORAGE_PREFIX + 'levelEdits',
  progress: STORAGE_PREFIX + 'progress',
  levelTimes: STORAGE_PREFIX + 'levelTimes',
};

const MAX_HIGH_SCORES = 10;

const DEFAULT_SETTINGS = { schemaVersion: SCHEMA_VERSION, muted: false, sfxVolume: 0.8, musicVolume: 0.6, zoom: DEFAULT_ZOOM, skin: '' };
const DEFAULT_HIGH_SCORES = { schemaVersion: SCHEMA_VERSION, entries: [] };
// unlockedLevels is a count, not an index: 1 means only LEVELS[0] is
// playable from Start Level, 2 means LEVELS[0..1], etc. -- level 1 is
// always unlocked, everything else opens up as the level before it is
// cleared (see GameScene.levelClear's markLevelCleared call).
const DEFAULT_PROGRESS = { schemaVersion: SCHEMA_VERSION, unlockedLevels: 1 };

// Add an entry here (keyed by the version a payload is migrating FROM) when
// the schema changes in the future, e.g. migrations[1] = (data) => ({...}).
const migrations = {};

function readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function migrate(data, defaultShape) {
  if (!data || typeof data !== 'object') return structuredCloneJSON(defaultShape);
  let version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;
  let result = data;
  while (version < SCHEMA_VERSION && typeof migrations[version] === 'function') {
    result = migrations[version](result);
    version += 1;
  }
  return { ...result, schemaVersion: SCHEMA_VERSION };
}

function structuredCloneJSON(v) {
  return JSON.parse(JSON.stringify(v));
}

export function loadSettings() {
  const parsed = safeParse(readRaw(KEYS.settings));
  const migrated = migrate(parsed, DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...migrated };
}

export function saveSettings(partial) {
  const next = { ...loadSettings(), ...partial, schemaVersion: SCHEMA_VERSION };
  writeRaw(KEYS.settings, JSON.stringify(next));
  return next;
}

// The level editor's saved work, keyed by LEVEL NUMBER (the NN in
// levels/level_NN.json) rather than held in one shared scratch slot: the
// editor opens a specific campaign level and Save writes back to that
// same level. ElementsScene lays these over the shipped files at boot, so
// a saved level is the one the game then plays -- and clearing one (the
// editor's Revert) puts the shipped file back.
//
// Stored as one object rather than a key per level so a single read
// answers "which levels have been edited?", which the level list needs
// every time it opens.
export function loadLevelEdits() {
  const parsed = safeParse(readRaw(KEYS.levelEdits));
  const levels = parsed?.levels;
  return levels && typeof levels === 'object' ? levels : {};
}

export function loadLevelEdit(levelNumber) {
  return loadLevelEdits()[levelNumber] ?? null;
}

// Returns false when the write failed (a full or unavailable
// localStorage) -- the editor reports that rather than showing a save
// that silently didn't happen.
export function saveLevelEdit(levelNumber, def) {
  const levels = { ...loadLevelEdits(), [levelNumber]: def };
  return writeRaw(KEYS.levelEdits, JSON.stringify({ schemaVersion: SCHEMA_VERSION, levels }));
}

export function clearLevelEdit(levelNumber) {
  const levels = { ...loadLevelEdits() };
  delete levels[levelNumber];
  return writeRaw(KEYS.levelEdits, JSON.stringify({ schemaVersion: SCHEMA_VERSION, levels }));
}

export function loadProgress() {
  const parsed = safeParse(readRaw(KEYS.progress));
  const migrated = migrate(parsed, DEFAULT_PROGRESS);
  return { ...DEFAULT_PROGRESS, ...migrated };
}

// Called once a (non-custom) level is actually cleared -- unlocks the
// next one, if it isn't already. Safe to call repeatedly / out of order
// (e.g. replaying an already-cleared level from Start Level): it only
// ever raises unlockedLevels, never lowers it.
export function markLevelCleared(levelIndex) {
  const progress = loadProgress();
  const unlockedLevels = Math.max(progress.unlockedLevels, levelIndex + 2);
  writeRaw(KEYS.progress, JSON.stringify({ schemaVersion: SCHEMA_VERSION, unlockedLevels }));
  return unlockedLevels;
}

// Per-level records: how long the level took to clear, in seconds, and
// LOWER IS BETTER -- the one number the game already measures per level
// (the clock in the HUD) and the one a player can beat on a level they
// have already finished, which a score cannot be compared on as cleanly
// (a bigger score can just mean more power-ups happened to drop).
//
// Kept as { "<level index>": seconds }, its own key rather than a field on
// progress: a record survives everything else being reset, and a corrupt
// blob here costs the times, not the unlocks.
const DEFAULT_LEVEL_TIMES = { schemaVersion: SCHEMA_VERSION, times: {} };

// Anything slower than this is not a run, it's a stuck tab -- and no level
// has a clock anywhere near it (the longest is under three minutes).
const MAX_LEVEL_TIME_SEC = 3600;

export function loadLevelTimes() {
  const parsed = safeParse(readRaw(KEYS.levelTimes));
  const migrated = migrate(parsed, DEFAULT_LEVEL_TIMES);
  const times = migrated.times;
  if (!times || typeof times !== 'object') return {};
  // Filtered on the way out rather than trusted: a hand-edited or
  // half-written entry would otherwise show as a record no run can beat.
  const clean = {};
  for (const [index, seconds] of Object.entries(times)) {
    if (Number.isFinite(seconds) && seconds > 0 && seconds <= MAX_LEVEL_TIME_SEC) clean[index] = seconds;
  }
  return clean;
}

// The record for one level, or null when it has never been cleared here.
export function bestLevelTime(levelIndex) {
  return loadLevelTimes()[levelIndex] ?? null;
}

// Records a finished level's time. Only a faster one is written, so this
// is safe to call on every clear, including a replay of a level whose
// record already stands. Returns what the record is now and whether THIS
// run set it (which is what the cleared-level screen announces).
export function saveLevelTime(levelIndex, seconds) {
  const previous = bestLevelTime(levelIndex);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_LEVEL_TIME_SEC) {
    return { best: previous, isRecord: false };
  }
  // Hundredths: the HUD counts whole seconds, but two runs of a short
  // level can easily land in the same second, and a record that cannot be
  // beaten by a hair isn't much of a record.
  const time = Math.round(seconds * 100) / 100;
  if (previous !== null && previous <= time) return { best: previous, isRecord: false };
  const times = { ...loadLevelTimes(), [levelIndex]: time };
  writeRaw(KEYS.levelTimes, JSON.stringify({ schemaVersion: SCHEMA_VERSION, times }));
  return { best: time, isRecord: true };
}

// A level time as the game shows it: M:SS.hh, with the hundredths that
// separate two close runs -- or just M:SS where there is no room for them
// (the level list, where the record shares a narrow row with the level's
// name). Every glyph in it (digits, ":", ".") is one the pixel font can
// draw (see assets.js's INTRO_FONT_CHARS), because this is drawn with that
// font on the level-intro and cleared-level cards.
export function formatLevelTime(seconds, precise = true) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  // Counted in whole hundredths from here, so 59.999s reads as 1:00.00
  // rather than as a carry that has to be caught a digit at a time.
  const total = Math.round(seconds * 100);
  const minutes = Math.floor(total / 6000);
  const secs = String(Math.floor((total % 6000) / 100)).padStart(2, '0');
  return precise ? `${minutes}:${secs}.${String(total % 100).padStart(2, '0')}` : `${minutes}:${secs}`;
}

export function isLevelUnlocked(levelIndex) {
  return levelIndex < loadProgress().unlockedLevels;
}

export function loadHighScores() {
  const parsed = safeParse(readRaw(KEYS.highscores));
  const migrated = migrate(parsed, DEFAULT_HIGH_SCORES);
  const entries = Array.isArray(migrated.entries) ? migrated.entries : [];
  return entries.slice(0, MAX_HIGH_SCORES);
}

export function qualifiesForHighScore(score) {
  const scores = loadHighScores();
  if (scores.length < MAX_HIGH_SCORES) return true;
  return score > scores[scores.length - 1].score;
}

// Everything the game has recorded about how the player has DONE: the
// high score table, how far the campaign is unlocked, and every level's
// record time. Offered on the options screen (see ui.js), because a
// player who cannot clear what they have done is stuck with it forever --
// and the debug panel and the level editor can both write into these.
//
// What it deliberately leaves alone is everything that is a PREFERENCE
// rather than an achievement: volume, mute, display size, key bindings
// (those have their own reset, on the controls screen), and the level
// editor's saved work -- which is somebody's authoring, not their score,
// and would be a cruel thing to take away under this name.
//
// Listed one key at a time rather than by clearing the whole namespace,
// so a key added later has to be thought about here before it can be
// erased by accident.
const ERASABLE_KEYS = ['highscores', 'progress', 'levelTimes'];

export function eraseProgress() {
  for (const name of ERASABLE_KEYS) {
    try {
      localStorage.removeItem(KEYS[name]);
    } catch {
      // Same as every other write here: a browser refusing storage is
      // not a reason to fall over, it just means nothing was saved to
      // erase.
    }
  }
}

export function saveHighScore({ name, score, level }) {
  const scores = loadHighScores();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: (name || 'AAA').toUpperCase().slice(0, 3) || 'AAA',
    score,
    level,
    date: new Date().toISOString(),
  };
  scores.push(entry);
  scores.sort((a, b) => b.score - a.score);
  const truncated = scores.slice(0, MAX_HIGH_SCORES);
  writeRaw(KEYS.highscores, JSON.stringify({ schemaVersion: SCHEMA_VERSION, entries: truncated }));
  return { entries: truncated, entry };
}
