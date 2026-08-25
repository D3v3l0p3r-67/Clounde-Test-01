import { OBSTACLE_TYPES, OBSTACLE_TYPE_KEYS, LADDER_TYPES, LADDER_TYPE_KEYS, POWERUP_TYPE_KEYS, BALL_ELEMENTS } from './elements.js';
import { AUDIO_CONFIG } from './audio.js';
import { WEAPON_TYPES, PLAYER_CONFIG } from './config.js';
import { LEVELS } from './LevelManager.js';
import { daylightBackgroundNames } from './regions.js';
import { VIRTUAL_W, VIRTUAL_H, COLORS } from './constants.js';
import { hexColor } from './colors.js';
import {
  ballTextureKey, ballTexturePath,
  ballPopTextureKey, ballPopTexturePath,
  PLAYER_TEXTURE_KEY, PLAYER_TEXTURE_PATH, PLAYER_FRAME,
  PLAYER_SHIELD_TEXTURE_KEY, PLAYER_SHIELD_TEXTURE_PATH,
  PLAYER_HIT_TEXTURE_KEY, PLAYER_HIT_TEXTURE_PATH, PLAYER_HIT_SIZE,
  PLAYER_DUST_TEXTURE_KEY, PLAYER_DUST_TEXTURE_PATH,
  PLAYER_DUST_SIZE, PLAYER_DUST_HEIGHT,
  PLAYER_GHOST_TEXTURE_KEY, PLAYER_GHOST_TEXTURE_PATH, PLAYER_GHOST_FRAME,
  BULLET_TEXTURE_KEY, BULLET_TEXTURE_PATH,
  BULLET_HIT_TEXTURE_KEY, BULLET_HIT_TEXTURE_PATH, BULLET_HIT_SIZE,
  BEAM_HIT_TEXTURE_KEY, BEAM_HIT_TEXTURE_PATH, BEAM_HIT_FRAME,
  obstacleTextureKey, obstacleTexturePath,
  ladderTextureKey, ladderTexturePath,
  WEAPON_SHOTS_KEY, WEAPON_SHOTS_PATH, WEAPON_SHOTS_FRAME,
  PARTICLE_TEXTURE_KEY, PARTICLE_TEXTURE_PATH,
  powerupTextureKey, powerupTexturePath,
  backgroundTextureKey, backgroundTexturePath, DEFAULT_BACKGROUND,
  WORLDMAP_TEXTURE_KEY, WORLDMAP_TEXTURE_PATH, PLANE_TEXTURE_KEY, PLANE_TEXTURE_PATH,
  audioPath,
  HUD_DIGITS_LARGE_KEY, HUD_DIGITS_LARGE_PATH, HUD_DIGITS_LARGE_FRAME,
  HUD_DIGITS_SMALL_KEY, HUD_DIGITS_SMALL_FRAME,
  LOADING_TEXTURE_KEY, PERCENT_TEXTURE_KEY,
  HUD_1P_KEY, HUD_1P_PATH, HUD_TIME_LABEL_KEY, HUD_TIME_LABEL_PATH,
  HUD_LEVEL_LABEL_KEY, HUD_LEVEL_LABEL_PATH, HUD_HI_LABEL_KEY, HUD_HI_LABEL_PATH,
  HUD_LIFE_KEY, HUD_LIFE_PATH, HUD_WEAPON_FRAME_KEY, HUD_WEAPON_FRAME_PATH,
  hudWeaponIconKey, hudWeaponIconPath,
  INTRO_FONT_KEY, INTRO_FONT_PATH, INTRO_FONT_FRAME,
} from './assets.js';
import { gameAnimations, ballPopFrameSize } from './animations.js';
import { skinAsset } from './skins.js';

// Shortest time the loading screen stays up before Game takes over -- see
// the hold at the end of create().
const LOADING_MIN_MS = 900;

// Runs after ElementsScene, which has already populated BALL_ELEMENTS/
// OBSTACLE_TYPES/POWERUP_TYPE_KEYS (see elements.js) -- this scene's only
// job is to load every graphic file those registries call for (see
// assets.js for each one's naming/path convention) and, for the player,
// wire the loaded frames into Phaser animations. Nothing is drawn
// procedurally, so swapping any graphic is purely a file replacement, no
// code changes.
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    this.showLoadingScreen();
    // Every path below goes through skinAsset(): the active skin's copy
    // where its manifest lists one, the base file otherwise (js/skins.js).
    // Keys never change -- a skin swaps what is UNDER a key, so no entity
    // knows or cares which skin is loaded.

    for (const el of BALL_ELEMENTS) {
      // Hex balls spin (see Ball.js/assets.js's HEX_SPIN_FRAMES) so their
      // own texture is a spritesheet; round balls are one static image.
      if (el.shape === 'hex') {
        this.load.spritesheet(ballTextureKey(el.shape, el.size), skinAsset(ballTexturePath(el.shape, el.size)), { frameWidth: el.radius * 2, frameHeight: el.radius * 2 });
      } else {
        this.load.image(ballTextureKey(el.shape, el.size), skinAsset(ballTexturePath(el.shape, el.size)));
      }

      const popFrameSize = ballPopFrameSize(el.radius);
      this.load.spritesheet(ballPopTextureKey(el.shape, el.size), skinAsset(ballPopTexturePath(el.shape, el.size)), { frameWidth: popFrameSize, frameHeight: popFrameSize });
    }

    this.load.spritesheet(PLAYER_TEXTURE_KEY, skinAsset(PLAYER_TEXTURE_PATH), PLAYER_FRAME);
    this.load.spritesheet(PLAYER_SHIELD_TEXTURE_KEY, skinAsset(PLAYER_SHIELD_TEXTURE_PATH), { frameWidth: PLAYER_CONFIG.shieldSize, frameHeight: PLAYER_CONFIG.shieldSize });
    this.load.spritesheet(PLAYER_HIT_TEXTURE_KEY, skinAsset(PLAYER_HIT_TEXTURE_PATH), { frameWidth: PLAYER_HIT_SIZE, frameHeight: PLAYER_HIT_SIZE });
    this.load.spritesheet(PLAYER_DUST_TEXTURE_KEY, skinAsset(PLAYER_DUST_TEXTURE_PATH), { frameWidth: PLAYER_DUST_SIZE, frameHeight: PLAYER_DUST_HEIGHT });
    this.load.spritesheet(PLAYER_GHOST_TEXTURE_KEY, skinAsset(PLAYER_GHOST_TEXTURE_PATH), PLAYER_GHOST_FRAME);
    this.load.image(BULLET_TEXTURE_KEY, skinAsset(BULLET_TEXTURE_PATH));
    this.load.spritesheet(BULLET_HIT_TEXTURE_KEY, skinAsset(BULLET_HIT_TEXTURE_PATH), { frameWidth: BULLET_HIT_SIZE, frameHeight: BULLET_HIT_SIZE });
    this.load.spritesheet(BEAM_HIT_TEXTURE_KEY, skinAsset(BEAM_HIT_TEXTURE_PATH), BEAM_HIT_FRAME);
    this.load.image(WORLDMAP_TEXTURE_KEY, skinAsset(WORLDMAP_TEXTURE_PATH));
    this.load.image(PLANE_TEXTURE_KEY, skinAsset(PLANE_TEXTURE_PATH));

    const tileNames = new Set(OBSTACLE_TYPE_KEYS.map((type) => OBSTACLE_TYPES[type].tileTexture));
    for (const name of tileNames) {
      this.load.image(obstacleTextureKey(name), skinAsset(obstacleTexturePath(name)));
    }

    const ladderNames = new Set(LADDER_TYPE_KEYS.map((type) => LADDER_TYPES[type].texture));
    for (const name of ladderNames) {
      this.load.image(ladderTextureKey(name), skinAsset(ladderTexturePath(name)));
    }

    this.load.spritesheet(WEAPON_SHOTS_KEY, skinAsset(WEAPON_SHOTS_PATH), WEAPON_SHOTS_FRAME);
    this.load.image(PARTICLE_TEXTURE_KEY, skinAsset(PARTICLE_TEXTURE_PATH));

    for (const type of POWERUP_TYPE_KEYS) {
      this.load.image(powerupTextureKey(type), skinAsset(powerupTexturePath(type)));
    }

    // DEFAULT_BACKGROUND is always loaded (the level editor's own starting
    // background, before any level-specific one is chosen), plus every
    // distinct `background` a loaded level actually names, plus every
    // region's frame at each of its five times of day -- a campaign level
    // picks one of those by where it falls in its region (see regions.js's
    // daylightPhaseForLevel), so all five have to be loaded before the
    // region's first level starts.
    const backgroundNames = new Set([
      DEFAULT_BACKGROUND,
      ...LEVELS.map((lvl) => lvl.background).filter(Boolean),
      ...daylightBackgroundNames(),
    ]);
    for (const name of backgroundNames) {
      this.load.image(backgroundTextureKey(name), skinAsset(backgroundTexturePath(name)));
    }

    // AUDIO_CONFIG is already fully populated by ElementsScene (audio.json
    // is self-contained, no manifest indirection needed -- see
    // ElementsScene.js) -- each sound is loaded under its own config key
    // name, so AudioManager can play it back by that same name.
    //
    // Music is deliberately NOT loaded here. The 13 tracks are 4.7MB
    // against 141KB for every sound effect in the game, only one of them
    // ever plays at a time, and eight of them belong to continents a run
    // may never reach -- so waiting for all of them before the menu can
    // open is most of the first load spent on audio that may never be
    // heard. AudioManager fetches a track the first time it is asked for
    // and GameScene warms the next continent's up during the world-map
    // interlude, which is several seconds of cover (see audio.js's
    // ensureMusicLoaded / GameScene.loadLevel).
    for (const [name, cfg] of Object.entries(AUDIO_CONFIG)) {
      if (cfg.category === 'music') continue;
      this.load.audio(name, skinAsset(audioPath(cfg.file)));
    }

    this.load.spritesheet(HUD_DIGITS_LARGE_KEY, skinAsset(HUD_DIGITS_LARGE_PATH), HUD_DIGITS_LARGE_FRAME);
    // HUD_DIGITS_SMALL is deliberately NOT loaded here -- ElementsScene
    // already loaded it, because this scene's own loading screen prints
    // its progress percentage with it (see showLoadingScreen below).
    this.load.image(HUD_1P_KEY, skinAsset(HUD_1P_PATH));
    this.load.image(HUD_TIME_LABEL_KEY, skinAsset(HUD_TIME_LABEL_PATH));
    this.load.image(HUD_LEVEL_LABEL_KEY, skinAsset(HUD_LEVEL_LABEL_PATH));
    this.load.image(HUD_HI_LABEL_KEY, skinAsset(HUD_HI_LABEL_PATH));
    this.load.image(HUD_LIFE_KEY, skinAsset(HUD_LIFE_PATH));
    this.load.image(HUD_WEAPON_FRAME_KEY, skinAsset(HUD_WEAPON_FRAME_PATH));
    for (const type of Object.keys(WEAPON_TYPES)) {
      this.load.image(hudWeaponIconKey(type), skinAsset(hudWeaponIconPath(type)));
    }

    this.load.spritesheet(INTRO_FONT_KEY, skinAsset(INTRO_FONT_PATH), INTRO_FONT_FRAME);
  }

  // The first-load screen: the splash image (see assets.js's
  // LOADING_TEXTURE_KEY) with a progress bar and a live percentage under
  // it, all drawn from the three graphics ElementsScene loaded ahead of
  // this scene. Built in preload() -- before this scene's own load starts
  // -- so it is already on screen for the load it reports on, and torn
  // down by Phaser itself when this scene stops and Game takes over.
  //
  // The percentage is composed from the HUD's own small digit strip plus a
  // "%" glyph, keeping to the same "no drawn text, only loaded images"
  // rule the HUD and level-intro follow.
  showLoadingScreen() {
    this.loadingShownAt = this.time.now; // see the hold in create()
    this.add.image(VIRTUAL_W / 2, VIRTUAL_H / 2, LOADING_TEXTURE_KEY).setDepth(0);

    const BAR_W = 400;
    const BAR_H = 14;
    const barX = (VIRTUAL_W - BAR_W) / 2;
    const barY = 452;

    this.add.rectangle(barX, barY, BAR_W, BAR_H, 0x000000, 0.65).setOrigin(0, 0).setDepth(1)
      .setStrokeStyle(2, hexColor(COLORS.accent));
    const fill = this.add.rectangle(barX + 2, barY + 2, 0, BAR_H - 4, hexColor(COLORS.accent))
      .setOrigin(0, 0).setDepth(2);

    // Pooled: at most 3 digits ("100") plus the % sign, shown/hidden as
    // the number's width changes rather than recreated each update.
    const digitW = HUD_DIGITS_SMALL_FRAME.frameWidth;
    const pctY = barY + BAR_H + 8;
    const digits = [0, 1, 2].map((i) => this.add.image(0, pctY, HUD_DIGITS_SMALL_KEY, 0)
      .setOrigin(0, 0).setDepth(2).setVisible(false));
    const percentSign = this.add.image(0, pctY, PERCENT_TEXTURE_KEY).setOrigin(0, 0).setDepth(2);

    const render = (value) => {
      const str = String(value);
      const totalW = str.length * digitW + digitW;
      let x = (VIRTUAL_W - totalW) / 2;
      for (let i = 0; i < digits.length; i++) {
        const has = i < str.length;
        digits[i].setVisible(has);
        if (!has) continue;
        digits[i].setFrame(Number(str[i]));
        digits[i].x = x;
        x += digitW;
      }
      percentSign.x = x;
      fill.width = (BAR_W - 4) * (value / 100);
    };

    render(0);
    this.load.on(Phaser.Loader.Events.PROGRESS, (value) => render(Math.round(value * 100)));
    this.load.once(Phaser.Loader.Events.COMPLETE, () => render(100));
  }

  create() {
    // Every animation in the game, straight out of the registry that also
    // tells the admin tool how to play each sheet back (js/animations.js)
    // -- so a rate is written down once and both agree by construction.
    // Nothing here decides anything: it is one anims.create per entry.
    for (const anim of gameAnimations(BALL_ELEMENTS)) {
      this.anims.create({
        key: anim.key,
        frames: anim.frames.map((frame) => ({ key: anim.textureKey, frame })),
        frameRate: anim.frameRate,
        repeat: anim.loop ? -1 : 0,
      });
    }

    // Hold the finished loading screen briefly before handing over. On a
    // fast (or cached) load the whole thing can complete in a few frames,
    // and blinking a splash + "100%" past the player for two frames reads
    // as a glitch rather than as a loading screen. Only ever ADDS time on
    // an already-instant load -- a slow one has long since passed this.
    const remaining = Math.max(0, LOADING_MIN_MS - (this.time.now - this.loadingShownAt));
    if (remaining === 0) this.scene.start('Game');
    else this.time.delayedCall(remaining, () => this.scene.start('Game'));
  }

}
