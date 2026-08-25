import { WEAPON_TYPES } from './config.js';
import { registerElement } from './elements.js';
import { LEVELS, SHIPPED_LEVELS, PANIC_LEVEL, isLevelDef } from './LevelManager.js';
import * as storage from './storage.js';
import { REGIONS } from './regions.js';
import { AUDIO_CONFIG } from './audio.js';
import {
  ELEMENTS_INDEX_PATH, ELEMENTS_INDEX_KEY, elementFileKey, elementFilePath,
  levelFileKey, levelFilePath, MAX_LEVEL_FILES,
  PANIC_LEVEL_KEY, PANIC_LEVEL_PATH,
  REGIONS_KEY, REGIONS_PATH,
  AUDIO_CONFIG_PATH, AUDIO_CONFIG_KEY,
  LOADING_TEXTURE_KEY, LOADING_TEXTURE_PATH, PERCENT_TEXTURE_KEY, PERCENT_TEXTURE_PATH,
  HUD_DIGITS_SMALL_KEY, HUD_DIGITS_SMALL_PATH, HUD_DIGITS_SMALL_FRAME,
} from './assets.js';
import { skinAsset } from './skins.js';

// Runs before BootScene so every ball/obstacle/power-up "element" (see
// elements.js/elements/*.json) and every level (see levels/*.json) is
// registered before BootScene has to decide which graphic files to load
// for them -- BootScene's preload() reads BALL_ELEMENTS/OBSTACLE_TYPES/
// POWERUP_TYPE_KEYS, so those need to already be populated by the time it
// runs, which means this has to be a separate scene (Phaser scenes boot
// strictly one after another; a same-scene two-wave preload would race).
export class ElementsScene extends Phaser.Scene {
  constructor() {
    super('Elements');
  }

  preload() {
    // The loading screen's own graphics, loaded here rather than with
    // everything else in BootScene: it has to be drawable BEFORE the big
    // load it reports progress on begins (see BootScene.showLoadingScreen).
    // Only these three -- a handful of KB against the rest of the game.
    this.load.image(LOADING_TEXTURE_KEY, skinAsset(LOADING_TEXTURE_PATH));
    this.load.image(PERCENT_TEXTURE_KEY, skinAsset(PERCENT_TEXTURE_PATH));
    this.load.spritesheet(HUD_DIGITS_SMALL_KEY, skinAsset(HUD_DIGITS_SMALL_PATH), HUD_DIGITS_SMALL_FRAME);

    // Elements are named for what they are (round-ball-1.json,
    // powerup-time-freeze.json, ...) with no fixed convention to probe
    // like levels, so their set is read from a small manifest instead --
    // see assets.js.
    this.load.json(ELEMENTS_INDEX_KEY, ELEMENTS_INDEX_PATH);

    // Levels DO follow a fixed level_NN name, so -- same as before -- just
    // probe a generous range and keep whichever files actually exist.
    for (let n = 1; n <= MAX_LEVEL_FILES; n++) {
      this.load.json(levelFileKey(n), levelFilePath(n));
    }

    this.load.json(PANIC_LEVEL_KEY, PANIC_LEVEL_PATH);

    // The campaign's route. Read here rather than in BootScene because
    // BootScene's preload has to already know which region backgrounds and
    // music tracks exist in order to load them.
    this.load.json(REGIONS_KEY, REGIONS_PATH);

    // Single self-contained config -- unlike elements/index.json (a
    // manifest naming OTHER files still to be loaded), audio.json already
    // holds every sound's full playback config, so it needs no second
    // wave: BootScene's preload() reads AUDIO_CONFIG (populated below) to
    // know which .ogg files to load, same as it already does for
    // BALL_ELEMENTS/OBSTACLE_TYPES/POWERUP_TYPE_KEYS.
    this.load.json(AUDIO_CONFIG_KEY, AUDIO_CONFIG_PATH);
  }

  create() {
    // A level saved in the in-game LEVEL EDITOR is stored under its level
    // number (see storage's levelEdits) and laid over the shipped file
    // here -- that is what makes the editor's Save change the level the
    // game actually plays, on a build nothing can write files back to.
    // The file itself is kept alongside it in SHIPPED_LEVELS, so the
    // editor's Revert has something to put back.
    const edits = storage.loadLevelEdits();
    for (let n = 1; n <= MAX_LEVEL_FILES; n++) {
      const key = levelFileKey(n);
      if (!this.cache.json.has(key)) continue;
      const shipped = this.cache.json.get(key);
      SHIPPED_LEVELS.push(shipped);
      // A stored edit that isn't a level definition at all (hand-edited
      // localStorage, a half-written value) is ignored rather than allowed
      // to break the campaign.
      const edit = edits[n];
      LEVELS.push(isLevelDef(edit) ? edit : shipped);
    }

    Object.assign(PANIC_LEVEL, this.cache.json.get(PANIC_LEVEL_KEY) || {});
    REGIONS.push(...(this.cache.json.get(REGIONS_KEY) || []));
    Object.assign(AUDIO_CONFIG, this.cache.json.get(AUDIO_CONFIG_KEY) || {});

    const elementIds = this.cache.json.get(ELEMENTS_INDEX_KEY) || [];
    for (const id of elementIds) {
      this.load.json(elementFileKey(id), elementFilePath(id));
    }
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      for (const id of elementIds) {
        const el = this.cache.json.get(elementFileKey(id));
        if (el) registerElement(el, WEAPON_TYPES.harpoon);
      }
      this.scene.start('Boot');
    });
    this.load.start();
  }
}
