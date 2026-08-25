import { VIRTUAL_W, PLAYFIELD_H, GROUND_Y, BORDER_THICKNESS, GAME_STATES, COLORS, LEVEL_INTRO_SEC, LEVEL_INTRO_GO_SEC, LEVEL_INTRO_SET_SEC } from './constants.js';
import {
  PLAYER_CONFIG, WEAPON_TYPES, POWERUP_DROP_CHANCE,
  TIME_BONUS_POINTS_PER_SEC, TIME_BONUS_COUNTDOWN_PER_SEC, TIME_BONUS_TICK_SEC, LEVEL_TRANSITION,
  SHOT_SHAKE_SEC,
} from './config.js';
import { OBSTACLE_TYPES, POWERUP_TYPE_KEYS, POWERUP_TYPES, getBallElement, ballMaxSizes,
} from './elements.js';
import { Player } from './Player.js';
import { Ball } from './Ball.js';
import { Projectile } from './Projectile.js';
import { Bullet } from './Bullet.js';
import { Bonus } from './Bonus.js';
import { refreshObstacleSeams } from './Obstacle.js';
import { createWeaponState, EffectManager } from './weapons.js';
import { loadLevel as loadLevelData, playerSpawn, DEFAULT_PLAYER_SPAWN, LEVELS, PANIC_LEVEL } from './LevelManager.js';
import { AudioManager } from './audio.js';
import { UI } from './ui.js';
import { Hud } from './Hud.js';
import { LevelIntro } from './LevelIntro.js';
import { LevelClearCard } from './LevelClearCard.js';
import { LevelTransition } from './LevelTransition.js';
import { WorldMapInterlude } from './WorldMapInterlude.js';
import {
  regionForLevel, regionIndexForLevel, crossesRegion,
  daylightBackground, daylightPhaseForLevel,
} from './regions.js';
import { ScorePopup } from './ScorePopup.js';
import { Debug } from './debug.js';
import { Editor } from './editor.js';
import { touchInput, initTouchInput, consumeTouchPausePressed } from './input.js';
import { initKeyboard, readKeyboard, onPauseKey } from './keys.js';
import { waveAt, ballWork } from './panicWaves.js';
import * as storage from './storage.js';
import {
  obstacleTextureKey, FRAME_TILE_TEXTURE, PARTICLE_TEXTURE_KEY, backgroundTextureKey, DEFAULT_BACKGROUND,
  BULLET_HIT_TEXTURE_KEY, BULLET_HIT_ANIM_KEY,
  ballPopTextureKey, ballPopAnimKey,
  PLAYER_HIT_TEXTURE_KEY, PLAYER_HIT_ANIM_KEY,
  PLAYER_DUST_TEXTURE_KEY, PLAYER_DUST_ANIM_KEY,
  PLAYER_GHOST_TEXTURE_KEY, PLAYER_GHOST_ANIM_KEY,
} from './assets.js';
import { hexColor } from './colors.js';

// Shortest the cleared-level screen ever lasts, so the player's
// celebration animation (6 frames at 3fps = 2s, see assets.js's
// PLAYER_ANIM_FRAMES.levelclear) always finishes even when there's no
// time bonus to count off. A level with time left runs longer than this:
// the tally takes as long as it takes, and LEVEL_CLEAR_PAUSE_SEC is held
// after it before the next level loads.
const LEVEL_CLEAR_MIN_SEC = 2;
const LEVEL_CLEAR_PAUSE_SEC = 1;

// How long leftover shots/power-ups/score popups take to fade away once a
// level is cleared (see fadeOutLeftovers). Under LEVEL_CLEAR_MIN_SEC, so
// the fade always finishes before the next level can load.
const LEFTOVER_FADE_SEC = 1;
const HIT_FREEZE_SEC = 2;

// How many passes of popping the dynamite is allowed (see shatterBalls).
// Four is enough to take the biggest ball there is down to the smallest;
// this is one more than that, and exists so a ball element added later
// with a bigger size cannot turn the loop into an endless one.
const MAX_SHATTER_PASSES = 6;

// How fast a Panic Mode ball creeps while it is still coming through the
// ceiling (px/s), when the level does not say (panic.json's
// panicSpawn.ceilingSpeedPx). Slow on purpose: it is the one warning the
// player gets about where the next ball is arriving, and at this speed
// even the biggest takes a few seconds to squeeze out -- long enough to
// walk under it, or to shoot it before it is loose.
const PANIC_CEILING_SPEED = 16;

// How much faster the wait for the next Panic Mode ball passes while the
// down key is held, and the shortest gap between two balls that hurrying
// can produce (seconds). Four times is fast enough to be worth reaching
// for -- an opening 2.6s wait becomes 0.65s -- and the floor is what
// keeps the late waves, whose own interval is 1.3s, from arriving as one
// clump. See updatePanicSpawner.
const PANIC_HURRY_RATE = 4;
const PANIC_HURRY_MIN_GAP = 0.6;

// What a shot leaves behind when it does not say (see playShotImpact).
// A default only a HALF-UPDATED game can reach: this is an offline game,
// its files are cached one by one, and an update that lands a new caller
// beside an old shot would otherwise throw here every frame and freeze
// the picture. The service worker now installs a release whole (see its
// store()), so this should never be read -- and if it ever is, a spark is
// the mark every shot in the game used to leave, which is a far better
// answer than a frozen game.
const BULLET_IMPACT = { textureKey: BULLET_HIT_TEXTURE_KEY, animKey: BULLET_HIT_ANIM_KEY };

// The gap between those passes. Long enough that each one is a separate
// event to watch -- the field halving, again, and again -- and short
// enough that the whole charge is over in about a second and a half,
// which is still an instant next to the level clock.
const SHATTER_PASS_SEC = 0.5;

// The winged ghost that leaves when a life does (see spawnDeathGhost):
// how long it takes to beat its way up and fade, and how far it gets.
// Long enough to read as a departure and to fit several wingbeats, short
// enough to still be a beat rather than a cutscene. The hit freeze never
// ends before it does (see startHitFreeze), so the level never restarts
// out from under it.
const DEATH_GHOST_SEC = 1.2;
const DEATH_GHOST_RISE_PX = 150;

// One ball bounce, resolved from whichever set of contact flags the
// caller has -- the world-bounds event's own arguments, or an obstacle
// collision's body.touching (see the two call sites below).
//
// Exactly one axis changes DIRECTION per bounce: a corner hit (e.g. down
// AND left both true at once) picks vertical over horizontal rather than
// flipping both. Arcade still zeroes BOTH axes' velocity while resolving
// that corner collision though (see Ball.js), so the horizontal axis --
// even though it isn't supposed to change direction here -- has to be
// explicitly reasserted, or the ball is left motionless on it.
function resolveBallBounce(ball, { up, down, left, right }) {
  if (down) {
    ball.landOnTop();
    if (left || right) ball.reassertHorizontal();
  } else if (up) {
    ball.bounceOffBottom();
    if (left || right) ball.reassertHorizontal();
  } else if (left) {
    ball.bounceOffLeft();
  } else if (right) {
    ball.bounceOffRight();
  }
}

// The whole game lives in this one Scene. Phaser owns the loop (update()
// is called once per rendered frame with a real delta), rendering (every
// GameObject below draws itself -- there is no manual render() pass),
// input (keyboard via Phaser's own Keyboard plugin), and collision
// detection (Arcade Physics colliders/overlaps). We keep explicit control
// only where the deterministic Pang-style feel requires it: the velocity
// values assigned to Player/Ball/Projectile, and the exact bounce
// response applied in the collision callbacks below.
export class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
  }

  create() {
    this.audio = new AudioManager(this);
    const settings = storage.loadSettings();
    this.audio.applySettings(settings);
    const originalResume = this.audio.resumeContext.bind(this.audio);
    this.audio.resumeContext = () => {
      originalResume();
      this.audio.applySettings(storage.loadSettings());
    };

    this.state = GAME_STATES.MENU;
    this.score = 0;
    this.lives = PLAYER_CONFIG.startLives;
    this.levelIndex = 0;
    this.scoreMultiplier = 1;
    this.ballsFrozen = false;
    // Slow motion for the balls (the hourglass power-up, see elements.js's
    // slow_balls). Held on the scene rather than on the balls, so a ball
    // that appears while it is running is slowed too -- every ball reads
    // it once a frame in updatePlaying.
    this.ballSpeedScale = 1;
    // A dynamite going off, one size of ball per pass (see shatterBalls).
    // Zero passes left means nothing is running.
    this.shatterPassesLeft = 0;
    this.shatterTimer = 0;
    this.shatterDownToSize = 1;
    this.elapsedMs = 0;
    this.levelTimer = 0;
    this.stateTimer = 0;
    // Cleared-level time-bonus tally -- see levelClear/updateLevelClear.
    this.timeBonusSecondsLeft = 0;
    this.timeBonusPartialPoint = 0;
    this.timeBonusTickTimer = 0;
    this.introLeadInSec = 0; // see startLevelIntro/beginRun
    this.levelClearElapsed = 0;
    this.levelClearPhase = 'pause';
    // How long the level just cleared took, and whether that beat its
    // record -- what the cleared-level card shows (see LevelClearCard.js).
    // null outside a clear, and on a clear with no record to keep.
    this.clearTimeSec = null;
    this.clearIsRecord = false;
    this.justSubmittedEntry = null;
    this.lastOutcome = null;
    this.isCustomLevel = false;
    this.customLevelDef = null;
    this.isPanicMode = false;
    this.pausedFromEditor = false;
    // Which campaign level the LEVEL EDITOR has open (an index into
    // LEVELS), and the unsaved buffer a playtest of it left behind --
    // playtesting replaces everything in the scene, so this is what lets
    // coming back from one carry on editing instead of re-reading the
    // level and dropping every unsaved change. See editLevel/Editor.play.
    this.editorLevelIndex = 0;
    this.editorDraft = null;
    // Which list the level-select screen is showing: 'play' (Start Level)
    // or 'edit' (pick the level to open in the editor). Same screen and
    // the same fifty levels -- see ui.js's renderLevelSelect.
    this.levelSelectMode = 'play';
    this.panicWaveIndex = 0;
    this.panicStep = -1;
    this.panicHoldLeft = 0;
    this.weaponType = 'harpoon';
    this.volleyCounter = 0; // see fireVolley -- ids only need to be distinct
    this.scorePopups = []; // live ScorePopup instances -- see popBall/updatePlaying
    // Tracks last frame's shoot input so a held key only ever fires once
    // per press (see updatePlaying).
    this.wasShooting = false;
    // Same, for the two climb controls -- see updatePlaying.
    this.wasUp = false;
    this.wasDown = false;

    this.cameras.main.setBackgroundColor(COLORS.bgTop);
    this.drawBackground();
    this.drawBorder();

    // Inset by the border's thickness (BORDER_THICKNESS) on top/left/
    // right so a ball/player actually bounces off the border's visible
    // inner face instead of the (invisible) canvas edge underneath it --
    // without this the ball would visually travel BORDER_THICKNESS px
    // into the border tiles before bouncing. The bottom is unaffected:
    // the bottom border sits just past GROUND_Y already (see drawBorder),
    // so GROUND_Y is already exactly the border's inner face there.
    const bt = BORDER_THICKNESS;
    this.physics.world.setBounds(bt, bt, VIRTUAL_W - bt * 2, GROUND_Y - bt);
    this.physics.world.on('worldbounds', this.onWorldBounds, this);

    this.obstacles = this.physics.add.staticGroup();
    // Plain (non-physics) Groups on purpose: Phaser.Physics.Arcade.Group
    // re-applies its own group-wide physics defaults (velocity 0, gravity
    // 0, collideWorldBounds false, ...) to every member's body on add(),
    // which would silently stomp the per-instance velocity/gravity each
    // Ball/Projectile/Bonus sets up for itself in its own constructor.
    // Plain Groups are still valid collider/overlap targets in Arcade
    // Physics -- only bodies matter, not which Group class holds them.
    this.balls = this.add.group();
    // Ladders collide with nothing at all (see Ladder.js) -- this group
    // exists so they are cleared with everything else on a level change,
    // and so Player.js has somewhere to look them up.
    this.ladders = this.add.group();
    this.projectiles = this.add.group();
    this.powerups = this.add.group();

    this.player = new Player(this);

    this.weaponState = createWeaponState();
    this.effects = new EffectManager();

    this.physics.add.collider(this.balls, this.obstacles, this.onBallHitObstacle, null, this);
    this.physics.add.overlap(this.projectiles, this.balls, this.onProjectileHitBall, null, this);
    this.physics.add.overlap(this.projectiles, this.obstacles, this.onProjectileHitObstacle, null, this);
    // Solid, not an overlap -- an intact obstacle physically blocks the
    // player like the border does; only once its blocks are actually shot
    // down (removed from this.obstacles, see onProjectileHitObstacle) does
    // that space open up. No callback needed, Arcade's own separation is
    // the entire effect.
    // The process callback is what lets the player walk UP a low ledge: an
    // obstacle it can step onto (see Player.canStepOnto) is skipped rather
    // than collided with, and Player.followGround lifts the feet onto it.
    // Anything taller, or without headroom above it, still blocks.
    // A climber passes through obstacles outright, which is what lets a
    // ladder carry the player up through the platform it ends against.
    this.physics.add.collider(this.player, this.obstacles, null,
      (playerGO, obstacleGO) => !playerGO.ladder && !playerGO.canStepOnto(obstacleGO.body), this);
    this.physics.add.overlap(this.player, this.balls, this.onPlayerHitBall, null, this);
    this.physics.add.overlap(this.player, this.powerups, this.onPlayerCollectPowerup, null, this);
    this.physics.add.overlap(this.projectiles, this.powerups, this.onProjectileHitPowerup, null, this);
    // A dropped power-up can land on an obstacle instead of falling all
    // the way to the ground -- see onPowerupHitObstacle/Bonus.js.
    this.physics.add.collider(this.powerups, this.obstacles, this.onPowerupHitObstacle, null, this);

    // Keyboard comes from js/keys.js rather than Phaser's own plugin,
    // because every game key is rebindable (see the CONTROLS screen) and
    // a binding is the physical KeyboardEvent.code the player pressed.
    initKeyboard();
    // Event-based rather than a per-frame poll, so the toggle reacts the
    // instant the browser reports the keydown -- not gated behind this
    // scene's own render-frame cadence.
    onPauseKey(() => this.handlePauseKey());
    // Losing the window pauses a run, onto the same screen Escape opens.
    // Both signals are needed, because they are different situations and
    // Phaser handles them differently. HIDDEN (the tab switched away)
    // already stops its game loop, so nothing simulates while you are
    // gone -- but coming back would drop you straight into a live ball
    // with no warning. BLUR (another window in front, the game still on
    // screen) does NOT stop the loop: the level clock would go on running
    // while nobody is playing, which is the one that actually costs you
    // the level. Neither has a matching resume: coming back is a decision
    // the player makes on the pause screen, not one focus makes for them.
    for (const event of [Phaser.Core.Events.BLUR, Phaser.Core.Events.HIDDEN]) {
      this.game.events.on(event, () => this.pauseFromFocusLoss());
    }
    initTouchInput();

    this.buildBurstEmitters();

    this.debugGraphics = this.add.graphics();
    this.debugGraphics.setDepth(100);

    this.ui = new UI(this, this.audio, storage);
    this.ui.showTouchControlsIfNeeded();
    this.ui.setupMobileFullscreen();
    this.ui.setupInstallOffers();
    this.hud = new Hud(this);
    this.levelIntro = new LevelIntro(this);
    this.levelClearCard = new LevelClearCard(this);
    this.transition = new LevelTransition(this);
    this.worldMap = new WorldMapInterlude(this);
    this.debug = new Debug(this);
    this.editor = new Editor(this);
  }

  drawBackground() {
    // Per-level background image (see setLevelBackground, called from
    // loadLevel) covers the sky area a flat gradient fill used to occupy
    // here; the floor strip and HUD bar below stay solid color on every
    // level, drawn by the Graphics object below as before.
    this.backgroundImage = this.add.image(0, 0, backgroundTextureKey(DEFAULT_BACKGROUND))
      .setOrigin(0, 0)
      .setDisplaySize(VIRTUAL_W, GROUND_Y)
      .setDepth(0);

    const g = this.add.graphics();
    g.fillStyle(hexColor(COLORS.ground), 1);
    g.fillRect(0, GROUND_Y, VIRTUAL_W, PLAYFIELD_H - GROUND_Y);
    g.fillStyle(hexColor(COLORS.groundEdge), 1);
    g.fillRect(0, GROUND_Y, VIRTUAL_W, 2);
    // Dedicated HUD bar below the bordered playfield (see constants.js
    // HUD_H) -- Hud.js draws the actual stat graphics into this same
    // strip (its container sits at y = PLAYFIELD_H).
    g.fillStyle(hexColor(COLORS.hudBg), 1);
    g.fillRect(0, PLAYFIELD_H, VIRTUAL_W, this.game.config.height - PLAYFIELD_H);
    g.fillStyle(hexColor(COLORS.accent), 1);
    g.fillRect(0, PLAYFIELD_H, VIRTUAL_W, 2);
    g.setDepth(0);
  }

  // The two particle bursts the game ever plays -- a normal one (a ball or
  // an obstacle breaking) and a smaller, shorter one (a power-up being
  // collected) -- built ONCE here and re-fired for the rest of the
  // session. Only the tint changes per burst, which is why two fixed
  // emitters cover it rather than one reconfigured on the fly.
  //
  // Building one per burst instead (and destroying it on a timer 500ms
  // later) meant a whole emitter, its particle pool and a fresh death-zone
  // Geom for every ball popped -- the most frequent event in the game.
  //
  // Kept tight and short-lived on purpose: a wide/fast/long-lived burst
  // visibly drifts away from the hit point before it fades, which reads as
  // "the effect isn't where the ball was" even though it started exactly
  // there.
  buildBurstEmitters() {
    // A burst near the ground can otherwise drift (via gravityY + its own
    // outward speed) below GROUND_Y and render in the HUD strip, which
    // nothing else in the game is ever allowed to do -- kill any particle
    // the instant it leaves the playfield rectangle.
    const deathZone = { type: 'onLeave', source: new Phaser.Geom.Rectangle(0, 0, VIRTUAL_W, GROUND_Y) };
    const make = (lifespan, speed, scale) => this.add.particles(0, 0, PARTICLE_TEXTURE_KEY, {
      lifespan, speed, scale, alpha: { start: 1, end: 0 }, gravityY: 60, emitting: false, deathZone,
    }).setDepth(7);
    this.burstNormal = make(280, { min: 15, max: 45 }, { start: 2, end: 0 });
    this.burstSmall = make(220, { min: 10, max: 25 }, { start: 1.5, end: 0 });
  }

  // The tiled frame the ball/player can never cross -- identical on every
  // level (drawn once here, not level data) and sized to the exact
  // playfield rectangle physics.world.setBounds uses. Top/left/right hug
  // the inside of the world bounds (there's no room outside them --
  // canvas edge and world bound are the same line there); the bottom
  // strip instead sits just past GROUND_Y, in the decorative floor strip
  // below the world bounds, so it doesn't need its own space carved out
  // of the playfield.
  drawBorder() {
    const t = BORDER_THICKNESS;
    const wallTexture = obstacleTextureKey(FRAME_TILE_TEXTURE);
    const strips = [
      this.add.tileSprite(0, 0, VIRTUAL_W, t, wallTexture),
      this.add.tileSprite(0, 0, t, GROUND_Y, wallTexture),
      this.add.tileSprite(VIRTUAL_W - t, 0, t, GROUND_Y, wallTexture),
      this.add.tileSprite(0, GROUND_Y, VIRTUAL_W, PLAYFIELD_H - GROUND_Y, wallTexture),
    ];
    for (const strip of strips) {
      strip.setOrigin(0, 0);
      strip.setDepth(0.5);
    }

    // The material has no edge of its own any more (see Obstacle.js), so
    // the frame gets the same bevel the obstacles get: light where it
    // faces the playfield from above or the left, dark where it faces it
    // from below or the right. Without it the frame is a flat band and
    // the playfield has no visible edge at all.
    const wall = OBSTACLE_TYPES.platform;
    const light = hexColor(wall.edgeLight ?? '#ffffff');
    const dark = hexColor(wall.edgeDark ?? '#000000');
    // Each line covers the face it belongs to AND NO MORE. The two
    // horizontal ones used to run the full width of the canvas, which
    // took them straight across both side walls -- a light line at the
    // floor and a dark one at the ceiling, cutting each wall in two at
    // exactly the height where the frame turns a corner. The frame then
    // read as four separate bands butted together rather than as one
    // piece, which is the opposite of what a bevel is for. They stop at
    // the walls now (one pixel INTO them, so the corners close rather
    // than leaving a gap where the horizontal and the vertical nearly
    // meet).
    // The four INNER faces are not drawn here: a wall built against the
    // frame is one surface with it, so where that line runs depends on
    // what has been built and it is redrawn with the obstacles instead
    // (see Obstacle.js's drawFrameEdges).
    const edges = this.add.graphics().setDepth(0.6);

    // The frame's OUTER faces, which is what
    // makes it read as one raised object rather than as a band that
    // happens to stop. It is the rule every obstacle already follows (see
    // Obstacle.js's drawObstacleEdges): light where a shape faces up or
    // left, dark where it faces down or right, around the whole of it.
    // The frame used to be the one thing in the playfield lit on the
    // inside only -- which is exactly the difference you could see by
    // painting wall over it in the editor and watching the border gain an
    // edge it did not have.
    edges.lineStyle(1, light, 1);
    edges.lineBetween(0, 0.5, VIRTUAL_W, 0.5);                      // the top of the frame
    edges.lineBetween(0.5, 0, 0.5, PLAYFIELD_H);                    // its left side
    edges.lineStyle(1, dark, 1);
    edges.lineBetween(VIRTUAL_W - 0.5, 0, VIRTUAL_W - 0.5, PLAYFIELD_H);      // its right side
    edges.lineBetween(0, PLAYFIELD_H - 0.5, VIRTUAL_W, PLAYFIELD_H - 0.5);    // and its bottom
  }

  get currentLevelDef() {
    if (this.isCustomLevel) return this.customLevelDef;
    if (this.isPanicMode) return PANIC_LEVEL;
    return LEVELS[this.levelIndex];
  }

  get remainingLevelTime() {
    // While a cleared level is tallying its time bonus, the HUD's clock
    // follows the draining bonus counter instead of the (now frozen) level
    // timer -- that's what makes the time visibly count down into the
    // score (see updateLevelClear).
    if (this.state === GAME_STATES.LEVEL_CLEAR) return Math.max(0, Math.ceil(this.timeBonusSecondsLeft));
    const def = this.currentLevelDef;
    if (!def || !def.timeLimitSec) return 0;
    return Math.max(0, Math.ceil(def.timeLimitSec - this.levelTimer));
  }

  // How many shots the weapon in hand allows on its own, before any
  // power-up. Read by the rapid_shot behavior, which adds to it rather
  // than replacing it.
  // Puts a different weapon in the player's hands: the level's own weapon
  // is only where a level STARTS (see loadLevel), and a weapon power-up
  // or the debug panel can change it from there.
  //
  // createWeaponState rebuilds from the new weapon's base values, which
  // would silently drop a power-up that is still running -- so whatever is
  // active is re-applied over the fresh state. Every durable effect's
  // apply() is a plain setter and instant ones are never held in `active`,
  // so re-running them is safe.
  setWeapon(type) {
    if (!WEAPON_TYPES[type]) return;
    this.weaponType = type;
    this.weaponState = createWeaponState(type);
    // A level may hand out extra shots for its whole length rather than
    // for a power-up's twelve seconds (Panic Mode's harpoon carries one:
    // see levels/panic.json's weaponBonusShots). Applied before the timed
    // effects so a rapid_shot picked up on top of it still wins -- its
    // own apply() reads baseMaxActiveShots and overwrites this.
    this.weaponState.maxActiveShots += this.currentLevelDef?.weaponBonusShots ?? 0;
    for (const active of this.effects.active.keys()) POWERUP_TYPES[active].apply(this);
  }

  // What "no power-up running" means for this weapon ON THIS LEVEL. The
  // level's own bonus belongs in here, not just in the initial state:
  // weapon_max_shots sets maxActiveShots from this and puts it back here
  // when it expires (see elements.js), so leaving the bonus out meant a
  // rapid_shot picked up in Panic Mode did nothing at all for twelve
  // seconds and then confiscated the harpoon's second shot for the rest
  // of the run. Measured before the fix: 2 shots, 2 during, 1 after.
  get baseMaxActiveShots() {
    return WEAPON_TYPES[this.weaponType].baseMaxActiveShots
      + (this.currentLevelDef?.weaponBonusShots ?? 0);
  }

  get weaponLabel() {
    const parts = [];
    if (this.effects.active.has('rapid_shot')) parts.push('RAPID');
    parts.push(WEAPON_TYPES[this.weaponType].label.toUpperCase());
    return parts.join(' ');
  }

  // Empties every entity group, destroying the members rather than just
  // removing them from the group -- shared by the editor entry/exit
  // paths here and by LevelManager's own level (re)load.
  clearEntities() {
    // A level-clear fade (see fadeOutLeftovers) normally finishes well
    // before this runs, but quitting or restarting mid-fade would leave
    // a tween animating an object that no longer exists -- so drop any
    // tween still targeting these before destroying them.
    this.tweens.killTweensOf([...this.projectiles.getChildren(), ...this.powerups.getChildren()]);
    this.obstacles.clear(true, true);
    // The bevel is drawn around the SHAPE the blocks form (see
    // Obstacle.js's drawObstacleEdges), so it outlives the blocks unless
    // it is cleared with them.
    this.obstacleEdges?.clear();
    this.ladders.clear(true, true);
    this.balls.clear(true, true);
    this.projectiles.clear(true, true);
    this.powerups.clear(true, true);
    // A dynamite is spread over a second and a half (see shatterBalls),
    // so it can still have passes to go when the level it was set off in
    // ends -- and it must not go on popping into the next one.
    this.shatterPassesLeft = 0;
  }

  // Shared fresh-run setup behind all four entry points below: what a new
  // run resets (score, lives, multiplier, effects, ...) is identical for
  // every one of them, only WHICH level definition gets loaded differs.
  // `customDef` is the editor's own level object, or null for an ordinary
  // run through LEVELS; `panicMode` selects PANIC_LEVEL instead -- either
  // way, everything else (currentLevelDef, restartLevel, advanceLevel,
  // levelClear's unlock bookkeeping) branches on the isCustomLevel/
  // isPanicMode flags set here.
  beginRun(levelIndex, customDef, panicMode = false) {
    // Quitting to the menu mid-transition leaves the overlay up; starting
    // anything new clears it.
    this.transition.stop();
    this.worldMap.stop();
    this.score = 0;
    this.lives = PLAYER_CONFIG.startLives;
    this.levelIndex = levelIndex;
    this.scoreMultiplier = 1;
    this.ballsFrozen = false;
    this.ballSpeedScale = 1;
    this.justSubmittedEntry = null;
    this.isCustomLevel = customDef !== null;
    this.customLevelDef = customDef;
    this.isPanicMode = panicMode;
    // Only a genuinely fresh run starts back at wave 1 -- a same-run
    // restart after losing a life (restartLevel(), which calls loadLevel()
    // directly rather than through here) deliberately leaves this alone,
    // so the run picks back up on whatever wave it was on (see loadLevel's
    // own panicStep/panicStepEndsAt reset for what DOES restart on a hit).
    this.panicWaveIndex = 0;
    this.effects.reset(this);
    // The run-start fanfare used to play straight over the countdown's own
    // cues. The countdown now waits it out: its title card is up (the
    // LEVEL/name rows) while the fanfare rings, and READY only sounds once
    // it's finished. Only a NEW run gets this -- advancing or restarting a
    // level within one doesn't replay the fanfare, so those intros start
    // immediately as before.
    const fanfare = this.audio.play('superpang');
    this.loadLevel(panicMode ? PANIC_LEVEL : (customDef ?? levelIndex));
    this.startLevelIntro(fanfare?.duration ?? 0);
  }

  startNewGame() {
    this.beginRun(0, null);
  }

  // Entry point for the menu's Start Level screen -- identical setup to
  // startNewGame(), just at an arbitrary (already-unlocked, see
  // storage.isLevelUnlocked) level index instead of always 0.
  startAtLevel(levelIndex) {
    this.beginRun(levelIndex, null);
  }

  // Level editor entry point: same setup again, but playing a single
  // editor-authored level instead of indexing into LEVELS.
  startCustomLevel(def) {
    this.beginRun(0, def);
  }

  // Endless survival mode: no fixed ball set and no time limit -- balls
  // instead drop from the ceiling on a timer defined by PANIC_LEVEL's own
  // panicSpawn wave table (levels/panic.json), escalating in size/speed
  // the longer the run lasts (see updatePanicSpawner). Ends the same way
  // an ordinary run does, by running out of lives.
  startPanicMode() {
    this.beginRun(0, null, true);
  }

  // Opens the editor on a campaign level, from the level list (see
  // showLevelSelect('edit')). A fresh pick starts from that level as it
  // stands, so any buffer left by a previous session's playtest goes.
  editLevel(levelIndex) {
    this.editorLevelIndex = levelIndex;
    this.editorDraft = null;
    this.enterEditor();
  }

  enterEditor() {
    this.audio.stopMusic();
    this.clearEntities();
    // Editing isn't a run of anything -- clear both run-mode flags so a
    // playtest that came before (which set isCustomLevel, see beginRun)
    // can't leave the pause menu offering run-only actions like RESTART
    // LEVEL while what's actually on screen is the editor.
    this.isCustomLevel = false;
    this.isPanicMode = false;
    this.pausedFromEditor = false;
    this.state = GAME_STATES.EDITOR;
    this.physics.pause();
    this.editor.enable(this.editorLevelIndex, this.editorDraft);
  }

  // Escape while editing opens the same pause menu gameplay uses (it did
  // nothing at all before), with a LEVEL EDITOR entry back to editing --
  // see ui.js's setScreen. The editor's panel is hidden while the menu is
  // up so the two aren't stacked on screen at once; disable() only hides
  // UI, so the level being edited stays in the scene untouched, unsaved
  // edits included (see Editor.reshowPanel).
  pauseFromEditor() {
    this.editor.disable();
    this.pausedFromEditor = true;
    this.pause();
  }

  // Back to editing from the pause menu, by either route: resuming an
  // editor session Escape interrupted (the level is still in the scene, so
  // just show the panel again), or leaving a playtest (which replaced the
  // scene's contents, so the editor reloads -- from the draft the playtest
  // was started from, saved or not, see editorDraft).
  returnToEditor() {
    if (this.pausedFromEditor) {
      this.pausedFromEditor = false;
      this.editor.reshowPanel();
      this.state = GAME_STATES.EDITOR;
      return; // physics stays paused, exactly as enterEditor leaves it
    }
    this.enterEditor();
  }

  exitEditor() {
    this.editor.disable();
    this.clearEntities();
    this.goToMenu();
  }

  // Balls and the player must stay frozen for the whole "3, 2, 1, GO!"
  // countdown -- Arcade Physics keeps stepping every frame regardless of
  // scene state unless explicitly paused, so without this balls would
  // already be falling/bouncing while the countdown is still on screen.
  // `leadInSec` holds the countdown (and its cues) for that long first,
  // showing only the LEVEL/name title card -- used to let the run-start
  // fanfare finish before READY interrupts it (see beginRun).
  startLevelIntro(leadInSec = 0) {
    this.state = GAME_STATES.LEVEL_INTRO;
    this.stateTimer = LEVEL_INTRO_SEC;
    this.introLeadInSec = leadInSec;
    this.physics.pause();
    // One cue per countdown word. READY sounds as the countdown proper
    // opens -- here, or when the lead-in expires (see update's LEVEL_INTRO
    // case); SET and GO! fire from there too, at the exact thresholds
    // LevelIntro.js swaps the text at, so word and sound always land
    // together however long the countdown is.
    this.setSoundPlayed = false;
    this.goSoundPlayed = false;
    if (leadInSec <= 0) this.audio.play('ready');
  }

  // Fully (re)loads the current level: balls, obstacles, projectiles,
  // on-field power-ups, player position, weapon state, active temporary
  // effects, and the level timer. Score and lives are untouched, so this
  // is safe both when advancing levels and when the current level
  // restarts after a life is lost. `idxOrDef` is a LEVELS index normally,
  // or the editor's own level definition object for a custom level.
  loadLevel(idxOrDef) {
    const def = loadLevelData(this, idxOrDef);
    for (const popup of this.scorePopups) popup.destroy();
    this.scorePopups = [];
    this.player.reset(playerSpawn(def) || DEFAULT_PLAYER_SPAWN);
    this.weaponType = def.weapon && WEAPON_TYPES[def.weapon] ? def.weapon : 'harpoon';
    this.weaponState = createWeaponState(this.weaponType);
    // Extra shots the LEVEL grants, for its whole length rather than for
    // a power-up's twelve seconds -- Panic Mode's harpoon carries one
    // (levels/panic.json's weaponBonusShots), which is what makes it the
    // rapid harpoon the mode is built around. Applied here as well as in
    // setWeapon because loading a level does not go through it, and
    // reading `def` rather than currentLevelDef because loadLevelData may
    // not have published it yet.
    this.weaponState.maxActiveShots += def.weaponBonusShots ?? 0;
    // A campaign level takes its look and its music from the continent
    // it is played on (see js/regions.js), not from its own file -- that's
    // what makes five levels in a row feel like one place. The look also
    // moves through the day as the region is played: the same view of the
    // same place, lit for the time of day this level falls at. Editor/
    // custom levels and Panic Mode aren't on the itinerary and keep the
    // background their own file names.
    const region = typeof idxOrDef === 'number' ? regionForLevel(idxOrDef) : null;
    this.backgroundImage.setTexture(backgroundTextureKey(region?.background
      ? daylightBackground(region.background, daylightPhaseForLevel(idxOrDef))
      : (def.background || DEFAULT_BACKGROUND)));
    this.effects.reset(this);
    this.levelTimer = 0;
    // Panic Mode only (see updatePanicSpawner/panicWave) -- the run
    // restarts the CURRENT wave's pattern from its first step. All of it
    // resets on every load, including a post-hit restart, so a life lost
    // replays the wave you were actually on ("that level's balls start
    // falling again") rather than dumping progress. panicWaveIndex itself
    // is deliberately NOT touched here -- see beginRun().
    //
    // panicStep is -1 because nothing has been entered yet: the first
    // nextPanicStep() makes it 0, and initialDelaySec is how long the run
    // waits before that happens.
    this.panicStep = -1;
    this.panicStepStartedAt = 0;
    this.panicStepEndsAt = def.panicSpawn?.initialDelaySec ?? 0;
    this.panicWaveCache = null;
    // A hold in progress does not survive a life being lost -- the field
    // is cleared by the restart anyway, which is everything the pause was
    // there to allow.
    this.panicHoldLeft = 0;
    this.hurryUpPlayed = false;
    this.hurryMusicPlayed = false;
    // A key still held from before this level started (e.g. mashed
    // through the level-clear screen) shouldn't read as a fresh press.
    this.wasShooting = true;
    // Stored, not started yet: music only actually starts once the balls
    // do (LEVEL_INTRO -> PLAYING, see update()), never during the frozen
    // "READY"/"GO!" countdown. A campaign level plays its continent's
    // track; Panic Mode and editor playtests, being off the itinerary,
    // keep the two generic ones.
    this.pendingMusicName = region?.music ?? (this.isPanicMode ? 'music02' : 'music01');
    // Warm it now rather than at the moment it is due. Music is fetched on
    // demand (see BootScene's preload / audio.js's ensureMusicLoaded), and
    // everything between here and the first ball moving -- the fanfare,
    // READY/SET/GO, and on a continent change the whole world-map flight
    // -- is cover for that fetch. The hurry-up track has no such cover
    // (it cuts in at 15 seconds left, mid-play), so it is warmed here too;
    // it is the smallest track in the game.
    this.audio.ensureMusicLoaded(this.pendingMusicName);
    if (def.timeLimitSec) this.audio.ensureMusicLoaded('music_hurry');
    return def;
  }

  restartLevel() {
    if (this.isCustomLevel) this.loadLevel(this.customLevelDef);
    else if (this.isPanicMode) this.loadLevel(PANIC_LEVEL);
    else this.loadLevel(this.levelIndex);
    this.startLevelIntro();
  }

  advanceLevel() {
    if (this.isCustomLevel) {
      // A level opened via the editor's Play button is a playtest, not a
      // real run -- clearing it doesn't end anything (there's no "next
      // level" to go to and no victory to record), it just pauses on the
      // same menu Escape would, restart included (see ui.js's setScreen),
      // so the level's own author can immediately go again.
      this.pause();
    } else if (this.levelIndex + 1 < LEVELS.length) {
      // The one real level-to-level step in a campaign run, and the only
      // place a transition belongs: the screen is hidden, the next level
      // is built underneath it, and it is drawn back off (see
      // js/LevelTransition.js). Finishing the run doesn't get one -- there
      // is no next level to reveal, only the victory screen, which is DOM
      // and sits above the canvas the effect is drawn on anyway.
      const from = this.levelIndex;
      const to = from + 1;
      this.transition.start(LEVEL_TRANSITION, () => {
        this.levelIndex = to;
        this.loadLevel(to);
        // Crossing to a new continent: the transition uncovers onto the
        // world map instead of onto the level, and the level's own intro
        // waits until the plane has landed and the map has faded.
        if (crossesRegion(from, to)) {
          this.audio.stopMusic();
          // The new level has to WAIT under the map, not play under it.
          // Arcade steps every frame regardless of the state machine, and
          // startLevelIntro -- whose pause normally covers this -- only
          // fires once the plane has landed: measured, that left the
          // freshly-placed balls under live physics for the interlude's
          // whole four-plus seconds, so the map faded out onto balls
          // hundreds of pixels from their authored spawns, visibly in
          // flight before READY. Paused here, they sit at their spawns
          // behind the map and the countdown's own resume drops them
          // from exactly where the level file says they start.
          this.physics.pause();
          // No lead-in needed here: the interlude runs for seconds after
          // the transition has ended, so by the time this fires the new
          // level has long been in place.
          this.worldMap.start(regionIndexForLevel(from), regionIndexForLevel(to),
            () => this.startLevelIntro());
        } else {
          // The countdown waits out the rest of the transition. This runs
          // at the COVERED moment, not at the end of the effect -- and for
          // a sliding effect (which has nothing to hide behind until the
          // next level exists) that moment is its very first frame. Started
          // plainly, READY would sound, and SET and GO! would tick down,
          // over a level still sliding off the screen. The lead-in holds
          // the countdown and every one of its cues while showing the
          // LEVEL/name card, exactly as it does for the run-start fanfare.
          this.startLevelIntro(this.transition.remainingSec);
        }
      });
    } else {
      this.finishRun('victory');
    }
  }

  // `recordTime` is what clearing a level by playing it does. It is only
  // ever false for a clear that did not involve playing -- the debug
  // panel's jump-to-end (js/debug.js), where the fraction of a second
  // between arriving and clearing would otherwise stand as that level's
  // record from then on.
  levelClear({ recordTime = true } = {}) {
    const def = this.currentLevelDef;
    // The time bonus is no longer added in one jump -- it's counted off
    // second by second during LEVEL_CLEAR so the clock visibly drains
    // into the score (see updateLevelClear).
    this.timeBonusSecondsLeft = def.timeLimitSec
      ? Math.max(0, def.timeLimitSec - this.levelTimer)
      : 0;
    this.timeBonusPartialPoint = 0;
    this.timeBonusTickTimer = 0; // ticks from the very first tally frame
    this.levelClearElapsed = 0;
    this.levelClearPhase = this.timeBonusSecondsLeft > 0 ? 'tally' : 'pause';
    // Custom/editor levels aren't part of LEVELS and never unlock anything.
    if (!this.isCustomLevel) storage.markLevelCleared(this.levelIndex);
    // The level's record: how long this attempt took. levelTimer restarts
    // with the level (including after a life is lost, see loadLevel), so
    // this is the run the player just made, not the sum of their tries --
    // the same number the HUD's clock was showing.
    this.clearTimeSec = !recordTime || this.isCustomLevel || this.isPanicMode ? null : this.levelTimer;
    this.clearIsRecord = this.clearTimeSec !== null
      && storage.saveLevelTime(this.levelIndex, this.clearTimeSec).isRecord;
    this.audio.stopMusic();
    this.audio.play('levelcomplete');
    // Celebrate standing still rather than coasting onward: physics keeps
    // running through LEVEL_CLEAR while update() no longer feeds the
    // player input, so without this it would keep sliding at whatever
    // speed it happened to be moving at when the last ball popped.
    this.player.playLevelClearAnim();
    this.fadeOutLeftovers();
    this.state = GAME_STATES.LEVEL_CLEAR;
    this.stateTimer = LEVEL_CLEAR_PAUSE_SEC;
  }

  // The cleared-level screen: first the leftover clock is counted off into
  // the score a bit at a time (the HUD's TIME row reads timeBonusSecondsLeft
  // while this runs, see remainingLevelTime, so one visibly drains as the
  // other climbs), then LEVEL_CLEAR_PAUSE_SEC of stillness, and only then
  // does the next level load. Points accrue fractionally and are handed to
  // the score in whole units, so the HUD's integer readout climbs smoothly
  // instead of in one jump at the end.
  updateLevelClear(dt) {
    this.levelClearElapsed += dt;

    if (this.levelClearPhase === 'tally') {
      const drained = Math.min(this.timeBonusSecondsLeft, TIME_BONUS_COUNTDOWN_PER_SEC * dt);
      this.timeBonusSecondsLeft -= drained;
      this.timeBonusPartialPoint += drained * TIME_BONUS_POINTS_PER_SEC;
      const whole = Math.floor(this.timeBonusPartialPoint);
      this.score += whole;
      this.timeBonusPartialPoint -= whole;

      // The counting sound, on its own fixed interval so it ticks at a
      // steady rate rather than once per frame (frame-rate dependent) or
      // once per point (thousands a second).
      // Reset rather than subtract the interval: after a dropped frame the
      // timer can be several intervals overdue, and carrying that debt
      // forward would fire a burst of ticks catching up.
      this.timeBonusTickTimer -= dt;
      if (this.timeBonusTickTimer <= 0) {
        this.audio.play('scoretick');
        this.timeBonusTickTimer = TIME_BONUS_TICK_SEC;
      }

      if (this.timeBonusSecondsLeft > 0) return;
      this.timeBonusSecondsLeft = 0;
      this.levelClearPhase = 'pause';
      this.stateTimer = LEVEL_CLEAR_PAUSE_SEC;
      return;
    }

    this.stateTimer -= dt;
    // The minimum keeps a short tally (or none at all) from cutting the
    // player's 2s celebration animation short.
    // Once the transition is running it owns the handover -- the state
    // stays LEVEL_CLEAR until it has the screen covered, so without this
    // the advance would be re-triggered on every frame until then.
    if (this.transition.active || this.worldMap.active) return;
    if (this.stateTimer <= 0 && this.levelClearElapsed >= LEVEL_CLEAR_MIN_SEC) this.advanceLevel();
  }

  // Anything still lying around when the level ends -- a shot mid-flight,
  // uncollected power-ups -- fades away over LEFTOVER_FADE_SEC instead of
  // blinking out of existence the instant the level does. Their bodies go
  // first, so a power-up can't still be collected (or a beam still pop
  // something) while it's visibly on its way out. The fade is deliberately
  // shorter than LEVEL_CLEAR_MIN_SEC so it always finishes before the next
  // level loads and clearEntities() takes the objects away underneath it.
  fadeOutLeftovers() {
    for (const go of [...this.projectiles.getChildren(), ...this.powerups.getChildren()]) {
      if (go.body) go.body.enable = false;
      this.tweens.add({
        targets: go,
        alpha: 0,
        duration: LEFTOVER_FADE_SEC * 1000,
        onComplete: () => go.destroy(),
      });
    }
    // The last ball's "+N" is still on screen at this exact moment (that
    // pop is what cleared the level), so it fades on the same clock rather
    // than hanging frozen -- update() stops driving popups outside PLAYING.
    for (const popup of this.scorePopups) popup.fadeOut(LEFTOVER_FADE_SEC * 1000);
  }

  finishRun(outcome) {
    // A run can end while a transition is mid-flight (the last level
    // cleared into a game over on the timer, say) -- drop the overlay
    // rather than leave the playfield covered under the end screen.
    this.transition.stop();
    this.worldMap.stop();
    this.audio.stopMusic();
    this.lastOutcome = outcome;
    if (outcome === 'gameover') this.audio.play('gameover');
    else {
      this.audio.play('levelcomplete');
      this.player.playVictoryAnim();
    }

    if (storage.qualifiesForHighScore(this.score)) {
      this.state = GAME_STATES.HIGH_SCORE_ENTRY;
    } else {
      this.state = outcome === 'gameover' ? GAME_STATES.GAME_OVER : GAME_STATES.VICTORY;
    }
  }

  goToMenu() {
    // Quitting straight from an Escape-in-the-editor pause has to finish
    // that exit properly -- pauseFromEditor only hid the panel, so the
    // level being edited is still sitting in the scene and would otherwise
    // stay visible behind the main menu.
    if (this.pausedFromEditor) {
      this.pausedFromEditor = false;
      this.clearEntities();
    }
    this.audio.stopMusic();
    this.state = GAME_STATES.MENU;
  }

  showHighScores() {
    this.justSubmittedEntry = null;
    this.state = GAME_STATES.HIGH_SCORE_TABLE;
  }

  showOptions() {
    this.state = GAME_STATES.OPTIONS;
  }

  // The two halves of the settings, each on a screen of its own -- what
  // the game sounds like, and what it looks like. Options is a list of
  // doors rather than a page of controls, which is what CONTROLS already
  // was and what kept that screen readable.
  showSound() {
    this.state = GAME_STATES.SOUND;
  }

  showDisplay() {
    this.state = GAME_STATES.DISPLAY;
  }

  // Which of the three ways to play, on a screen that says what each one
  // is -- "PANIC MODE" on a button tells a first-time player nothing.
  showPlay() {
    this.state = GAME_STATES.PLAY;
  }

  // Erasing is irreversible, so it gets a screen rather than a button:
  // opening it only says what would be lost (see ui.js's erase-warning),
  // and nothing is written until YES is pressed there.
  showErase() {
    this.state = GAME_STATES.ERASE;
  }

  // Rebinding the game's keys, on a screen of its own rather than in the
  // options list: six actions with two keys each is a table, not a row of
  // settings (see ui.js's renderKeyList).
  showKeyConfig() {
    this.state = GAME_STATES.KEY_CONFIG;
  }

  showLevelSelect(mode = 'play') {
    this.levelSelectMode = mode;
    this.state = GAME_STATES.LEVEL_SELECT;
  }

  submitHighScore(name) {
    const { entry } = storage.saveHighScore({ name, score: this.score, level: this.levelIndex + 1 });
    this.justSubmittedEntry = entry;
    this.state = GAME_STATES.HIGH_SCORE_TABLE;
  }

  pause() {
    this.physics.pause();
    this.audio.pauseMusic();
    this.state = GAME_STATES.PAUSED;
  }

  resumeFromPause() {
    // Resuming a pause that came from the editor means going back to
    // editing, not starting to play whatever level was loaded before.
    if (this.pausedFromEditor) {
      this.returnToEditor();
      return;
    }
    this.physics.resume();
    this.audio.resumeMusic();
    this.state = GAME_STATES.PLAYING;
  }

  resume() {
    if (this.state === GAME_STATES.PAUSED) this.resumeFromPause();
  }

  togglePause() {
    if (this.state === GAME_STATES.PLAYING) this.pause();
    else if (this.state === GAME_STATES.PAUSED) this.resumeFromPause();
  }

  handlePauseKey() {
    if (this.state === GAME_STATES.EDITOR) this.pauseFromEditor();
    else if (this.state === GAME_STATES.PLAYING || this.state === GAME_STATES.PAUSED) this.togglePause();
  }

  // The window went away mid-run (see create). Only actual play is worth
  // freezing: a menu and the editor have nothing running, an already-open
  // pause screen is where this would put you anyway, and pausing the
  // level intro would cut its countdown short (leaving the pause screen
  // goes straight to PLAYING).
  pauseFromFocusLoss() {
    if (this.state === GAME_STATES.PLAYING) this.pause();
  }

  update(time, delta) {
    const dt = Math.min(delta, 250) / 1000;

    if (consumeTouchPausePressed()) this.handlePauseKey();

    switch (this.state) {
      case GAME_STATES.LEVEL_INTRO:
        // A transition still playing keeps the countdown held for however
        // long it has left -- re-read every frame rather than trusted from
        // the one estimate taken when the level was swapped in
        // (advanceLevel). The two clocks are ticked at different points in
        // the frame (this one here, the transition's at the end of
        // update), so an estimate alone drifts a frame or two ahead and
        // lets READY open over the last sliver of the effect.
        if (this.transition.active) {
          this.introLeadInSec = Math.max(this.introLeadInSec, this.transition.remainingSec);
        }
        // Lead-in: hold the countdown (and the physics freeze) while the
        // run-start fanfare finishes, then open with READY.
        if (this.introLeadInSec > 0) {
          this.introLeadInSec -= dt;
          if (this.introLeadInSec <= 0) this.audio.play('ready');
          break;
        }
        this.stateTimer -= dt;
        // The same thresholds LevelIntro.js uses to swap the countdown
        // word, so each sound lands on the frame its word appears.
        if (!this.setSoundPlayed && this.stateTimer <= LEVEL_INTRO_GO_SEC + LEVEL_INTRO_SET_SEC) {
          this.setSoundPlayed = true;
          this.audio.play('set');
        }
        if (!this.goSoundPlayed && this.stateTimer <= LEVEL_INTRO_GO_SEC) {
          this.goSoundPlayed = true;
          this.audio.play('go');
        }
        if (this.stateTimer <= 0) {
          this.physics.resume();
          this.state = GAME_STATES.PLAYING;
          // Music starts exactly when the balls do, never during the
          // frozen countdown -- see loadLevel()'s pendingMusicName.
          this.audio.playMusic(this.pendingMusicName);
        }
        break;
      case GAME_STATES.PLAYING:
        this.updatePlaying(dt);
        break;
      case GAME_STATES.HIT_FREEZE:
        this.stateTimer -= dt;
        if (this.stateTimer <= 0) {
          if (this.pendingGameOver) this.finishRun('gameover');
          else this.restartLevel();
        }
        break;
      case GAME_STATES.LEVEL_CLEAR:
        this.updateLevelClear(dt);
        break;
      default:
        break;
    }

    this.debug.render(this.debugGraphics);
    this.editor.render();
    this.ui.render();
    this.hud.render();
    this.levelIntro.render();
    this.levelClearCard.render();
    // Ticked outside the state switch, and last: the transition spans the
    // very change of state it wraps (LEVEL_CLEAR out, LEVEL_INTRO in), so
    // it can't belong to either case, and it has to paint over everything
    // the frame already drew.
    this.transition.update(dt);
    this.worldMap.update(dt);
  }

  // `up` is both the climb control and (as it always has been) the shoot
  // key -- which of the two a press means is decided in updatePlaying,
  // once Player.update has said whether it had a ladder to spend it on.
  // `shoot` here is therefore only the keys that mean nothing else, so
  // that shooting still works with both hands on the ladder.
  // The keyboard (whatever it is currently bound to, see keys.js) and the
  // touch overlay (see input.js) folded into one set of booleans, so
  // nothing downstream has to know which of the two a player is using.
  readInput() {
    const keyboard = readKeyboard();
    return {
      left: keyboard.left || touchInput.left,
      right: keyboard.right || touchInput.right,
      up: keyboard.up || touchInput.up,
      down: keyboard.down || touchInput.down,
      shoot: keyboard.shoot || touchInput.shoot,
    };
  }

  updatePlaying(dt) {
    this.elapsedMs += dt * 1000;
    this.levelTimer += dt;
    this.effects.update(this, this.elapsedMs);
    this.updateShatter(dt);

    // Running out of time is exactly the same hit as a ball touching the
    // player (see onTimeUp/hitPlayer) -- checked every frame the clock
    // stays expired, same as an overlapping ball would keep re-triggering
    // onPlayerHitBall, so shield/invulnerability behave identically.
    if (this.currentLevelDef?.timeLimitSec && this.levelTimer >= this.currentLevelDef.timeLimitSec) {
      this.onTimeUp();
      if (this.state !== GAME_STATES.PLAYING) return; // hitPlayer() may have frozen/ended the run
    }

    // 15s left: switch the background music itself to the more urgent
    // loop (independent of the short one-shot ping below, at its own
    // later/shorter threshold).
    if (!this.hurryMusicPlayed && this.currentLevelDef?.timeLimitSec && this.remainingLevelTime > 0 && this.remainingLevelTime <= 15) {
      this.audio.playMusic('music_hurry');
      this.hurryMusicPlayed = true;
    }

    if (!this.hurryUpPlayed && this.currentLevelDef?.timeLimitSec && this.remainingLevelTime > 0 && this.remainingLevelTime <= 10) {
      this.audio.play('hurryup');
      this.hurryUpPlayed = true;
    }

    const inputState = this.readInput();
    // Getting ON a ladder is a press, never a hold: holding up to climb
    // one must not grab the next one the moment the player walks past its
    // foot, and holding down on top of one must not re-mount it.
    inputState.upPressed = inputState.up && !this.wasUp;
    inputState.downPressed = inputState.down && !this.wasDown;
    this.wasUp = inputState.up;
    this.wasDown = inputState.down;

    // Read AFTER the input, because holding down is what hurries it along.
    if (this.isPanicMode) this.updatePanicSpawner(dt, inputState.down);

    this.player.update(dt, inputState);

    // One shot per press, for every weapon and power-up alike: the input
    // has to be released and pressed again before it fires again, so
    // holding the key/button down does nothing. What rapid_shot changes is
    // only how many shots may be in the air at once (weaponState
    // .maxActiveShots, see tryFire) -- never how the trigger itself reads.
    //
    // One trigger, not two: up used to fire as well as climb, which meant
    // the scene had to work out which of the two a press was meant for,
    // and a ladder underfoot made shooting unreliable. Up climbs now (see
    // keys.js's DEFAULT_BINDINGS).
    if (inputState.shoot && !this.wasShooting) this.tryFire();
    this.wasShooting = inputState.shoot;

    // Last 3s of time_freeze: blink the (harmless, see onPlayerHitBall)
    // frozen balls as a warning the freeze is about to end; reset alpha
    // once it actually does.
    const freezeExpiresAt = this.effects.active.get('time_freeze');
    const freezeWarning = this.ballsFrozen && freezeExpiresAt !== undefined && freezeExpiresAt - this.elapsedMs <= 3000;
    for (const ball of this.balls.getChildren()) {
      ball.body.moves = !this.ballsFrozen;
      ball.setAlpha(freezeWarning ? (Math.floor(this.elapsedMs / 90) % 2 === 0 ? 0.35 : 1) : 1);
      ball.setFrozen(this.ballsFrozen);
      // Every frame, for every ball, because this is what reaches the ones
      // that were not here when the hourglass was picked up: the halves a
      // ball splits into, and whatever Panic Mode drops from the ceiling.
      // A no-op whenever the scale has not changed for that ball.
      ball.setSpeedScale(this.ballSpeedScale);
      // Physics has already stepped by the time scene update runs, so this
      // captures the speed the ball is travelling at going INTO the next
      // step -- i.e. its impact speed, which Arcade wipes before the
      // collision callback can read it (see Ball.rememberVerticalSpeed).
      ball.rememberVerticalSpeed();
      // ...and for the same reason, this is where a ball that moves in
      // some way beyond bouncing gets its say (see elements.js's
      // BALL_MOVEMENTS): after the step, so setting the horizontal
      // velocity here lands on top of whatever a bounce did rather than
      // under it. Not while frozen -- a movement is motion.
      if (!this.ballsFrozen) ball.updateMovement(dt, this);
      // Panic Mode ceiling-drop balls (see spawnPanicBall) spawn centered
      // on the ceiling border's own inner edge, depth-sorted behind it and
      // with world-bounds collision off, so they visibly slide out from
      // under/through the border instead of just appearing already fully
      // below it -- restored to normal once the whole ball has cleared it.
      // Out from under the ceiling, all of it: it stops creeping and
      // becomes an ordinary ball in the same instant -- drawn in front of
      // the border again, held by the world bounds again, given its
      // normal sideways drift, and handed its vertical motion back (its
      // own gravity picks up from the 16px/s it was already doing, so
      // nothing jumps).
      if (ball.emergeY !== undefined && ball.body.y >= ball.emergeY) {
        ball.setDepth(3);
        ball.body.setCollideWorldBounds(true);
        ball.emergeY = undefined;
        ball.activateDrift();
        ball.resumeNormalFall();
      }
    }
    for (const pu of this.powerups.getChildren()) pu.update(dt);

    // Laser beams grow upward from the muzzle they were fired at until
    // something stops them -- a ball/obstacle overlap (handled by the
    // collision callbacks) or the ceiling, which updateBeam reports by
    // returning false. Iterated over a copy since destroy() mutates the
    // group's own child list mid-loop.
    for (const proj of [...this.projectiles.getChildren()]) {
      if (!proj.updateBeam(dt)) proj.destroy();
    }

    for (let i = this.scorePopups.length - 1; i >= 0; i--) {
      const popup = this.scorePopups[i];
      popup.update(dt);
      if (popup.dead) this.scorePopups.splice(i, 1);
    }

    // Panic Mode is endless -- it has no "all balls cleared" win condition
    // (the ceiling spawner just keeps going, see updatePanicSpawner), only
    // the ordinary run-out-of-lives loss.
    if (this.state === GAME_STATES.PLAYING && !this.isPanicMode && this.balls.countActive(true) === 0) {
      this.levelClear();
    }
  }

  // Panic Mode's active wave, whatever number the run has reached: a
  // beat length and a list of steps, resolved from the authored set by
  // js/panicWaves.js (which also decides what the set does once the run
  // outlasts it -- it repeats, a little faster each time round).
  //
  // Cached because it parses a pattern string, and this is read every
  // frame. The wave index is the whole cache key: nothing else about a
  // wave can change while it is the one being played.
  get panicWave() {
    const spawn = this.currentLevelDef?.panicSpawn;
    if (!spawn?.waves?.length) return null;
    if (this.panicWaveCache?.index !== this.panicWaveIndex) {
      this.panicWaveCache = { index: this.panicWaveIndex, ...waveAt(this.panicWaveIndex, spawn, ballMaxSizes()) };
    }
    return this.panicWaveCache;
  }

  // 0-100 through the current wave's pattern, for the HUD's progress bar
  // (see Hud.js). How far through the PATTERN, not how many balls have
  // been popped: a wave is a written rhythm now, and it is over when the
  // rhythm is over.
  get panicProgressPct() {
    const wave = this.panicWave;
    if (!wave || !wave.steps.length) return 0;
    return Math.min(100, Math.floor(100 * Math.max(0, this.panicStep) / wave.steps.length));
  }

  // One step of the current wave's pattern per beat.
  //
  // `hurry` is the down key held, which in Panic Mode means nothing else:
  // there is no ladder to climb down (levels/panic.json has no obstacles
  // at all), so the key was simply dead. What a player waiting out a rest
  // actually wants is the next ball -- an empty field is not a rest, it
  // is a wave that isn't advancing and a clock that is -- and holding
  // down now asks for it, running the beat at PANIC_HURRY_RATE times its
  // normal speed for as long as it is held.
  //
  // It is also how a sharp player still outruns the pattern. Progress
  // used to be gated on balls popped, so shooting well brought the harder
  // waves sooner; a written rhythm cannot do that on its own, and this is
  // where that went. What it cannot do is empty a whole wave onto the
  // field at once -- PANIC_HURRY_MIN_GAP is how close together two steps
  // may land however hard the key is held.
  updatePanicSpawner(dt, hurry) {
    const wave = this.panicWave;
    if (!wave) return;
    if (this.panicHoldLeft > 0) { this.updatePanicHold(dt, hurry); return; }
    // Nothing left to rest FOR: a rest waits out its beat only while the
    // field still has something on it worth waiting for. Standing on an
    // empty screen watching a clock is the least interesting thing this
    // mode can ask of anyone, and the pattern is written as the wave at
    // its SLOWEST, not as a promise about the clock.
    //
    // It cannot run away with itself: skipping is only possible while the
    // player is ahead, and the moment they are not the rests come back.
    // A wave cannot compress itself into something its player was not
    // already clearing. The floor is the same one the down key gets, so
    // a skip can never drop two balls on top of each other either.
    if (wave.steps[this.panicStep]?.kind === 'rest' && this.panicFieldIsClear()
      && this.levelTimer >= this.panicStepStartedAt + PANIC_HURRY_MIN_GAP) {
      this.nextPanicStep();
      return;
    }
    if (hurry) {
      this.panicStepEndsAt = Math.max(this.panicStepStartedAt + PANIC_HURRY_MIN_GAP,
        this.panicStepEndsAt - dt * (PANIC_HURRY_RATE - 1));
    }
    if (this.levelTimer >= this.panicStepEndsAt) this.nextPanicStep();
  }

  // A hold step (`|` in a pattern): the ceiling stops sending anything
  // down, so what is on the field is all there is and it can actually be
  // finished.
  //
  // It ends the moment the field IS clear -- that is the whole point of
  // it, and there is nothing to wait for once it has happened -- or after
  // the step's own cap, whichever comes first, because a field nobody can
  // finish would otherwise stop the mode dead. Holding down drains it at
  // the same rate it hurries a beat: a player who does not want the pause
  // should not have to sit through it.
  updatePanicHold(dt, hurry) {
    this.panicHoldLeft -= dt * (hurry ? PANIC_HURRY_RATE : 1);
    if (this.panicHoldLeft > 0 && !this.panicFieldIsClear()) return;
    this.panicHoldLeft = 0;
    this.nextPanicStep();
  }

  // Whether the field is clear ENOUGH to stop waiting on it -- what both
  // a rest and a hold ask before they take any time.
  //
  // Measured in the seconds of shooting still owed rather than in balls,
  // because a ball is not a unit of anything: one size-2 is three shots
  // and a whole split tree, one size-1 is a straggler to walk under. It
  // is the same measure the patterns are costed in (see panicWaves.js's
  // ballWork), so "nearly clear" means the same thing to the game as it
  // does to the file.
  panicFieldIsClear() {
    const spawn = this.currentLevelDef?.panicSpawn;
    if (!spawn) return true;
    let owed = 0;
    for (const ball of this.balls.getChildren()) {
      if (!ball.active) continue;
      owed += ballWork(ball.shape, ball.size, spawn.tuning);
      if (owed > spawn.skipRestUnderSec) return false;
    }
    return true;
  }

  // Onto the next step, and onto the next WAVE when the pattern is spent
  // -- which is what ends a wave now. The counter is not stopped by the
  // end of the authored set (see panicWaves.js's waveAt): a run that
  // outlasts it still has a next milestone and a bar moving towards it.
  nextPanicStep() {
    this.panicStep += 1;
    if (this.panicStep >= this.panicWave.steps.length) {
      this.panicWaveIndex += 1;
      this.panicStep = 0;
    }
    const wave = this.panicWave;
    const step = wave.steps[this.panicStep];
    this.panicStepStartedAt = this.levelTimer;
    if (step.kind === 'hold') {
      // Not a beat: a hold takes no time at all on a field that is
      // already clear, and never counts towards the wave's length (which
      // is why the pressure check leaves it out -- see panicWaves.js).
      this.panicHoldLeft = step.maxSec;
      this.panicStepEndsAt = Infinity;
      return;
    }
    if (step.kind === 'ball') this.spawnPanicBall(step, this.currentLevelDef.panicSpawn);
    this.panicStepEndsAt = this.levelTimer + wave.beat;
  }

  // Picks one (shape, size) from the wave's weighted `shapes` list and
  // drops it in at a random x with its BOTTOM edge flush against the
  // ceiling border's inner face -- i.e. entirely hidden above/within the
  // border strip at spawn, none of it poking into the playfield yet (see
  // the emergeY check in updatePlaying) -- so it visibly slides out
  // through the border as it falls, rather than just appearing already
  // mostly exposed.
  //
  // While ANY of it is still in the ceiling it creeps: gravity off, a
  // constant `ceilingSpeedPx` (16px/s) downward, which is slow enough to
  // watch and to shoot at, and continuous rather than a wait followed by
  // a jump. A ball squeezing out of the ceiling is the one moment in
  // Panic Mode that says where the next threat is coming from, so it is
  // worth the second it takes -- and a bigger ball takes proportionally
  // longer, because there is more of it to come through.
  //
  // The instant the whole ball has cleared the border it is an ordinary
  // ball: normal drift, normal fall (see updatePlaying's emergeY check),
  // its own gravity taking it from the 16px/s it was already doing.
  spawnPanicBall(choice, spawn) {
    const el = getBallElement(choice.shape, choice.size);
    const bt = BORDER_THICKNESS;
    const x = Phaser.Math.Between(bt + el.radius, VIRTUAL_W - bt - el.radius);
    const y = bt - el.radius;
    const ball = new Ball(this, choice.shape, choice.size, x, y, 0, spawn.ceilingSpeedPx ?? PANIC_CEILING_SPEED);
    // Gravity would otherwise accelerate the descent, missing both the
    // fixed height and the fixed time -- overridden with a constant
    // velocity for the whole pre-release descent instead (see above).
    ball.body.setAllowGravity(false);
    // World bounds sit at exactly y = bt -- collision would otherwise
    // immediately shove a ball spawned above that line back down, undoing
    // the "still emerging through the ceiling" look before it even starts.
    ball.body.setCollideWorldBounds(false);
    ball.setDepth(0.4); // below the ceiling border's own depth (0.5) while emerging
    ball.emergeY = bt; // body.y (top edge) reaching this means the whole ball has cleared the border
    this.balls.add(ball);
  }

  tryFire() {
    const base = WEAPON_TYPES[this.weaponType];
    if (base.volley) {
      this.fireVolley(base);
      return;
    }
    const activeCount = this.projectiles.countActive(true);
    if (activeCount >= this.weaponState.maxActiveShots) {
      // Nothing can be fired -- but a grapple hanging from the ceiling is
      // what is usually holding the slot, and a player pressing again is
      // asking for it back. Each press shakes it loose a little sooner
      // (see Projectile.shakeLoose and config.js's SHOT_SHAKE_SEC), which
      // is the difference between a weapon that is busy and a button that
      // does nothing.
      for (const proj of this.projectiles.getChildren()) {
        if (proj.active && proj.shakeLoose?.(SHOT_SHAKE_SEC)) {
          this.audio.play('weaponhold');
          break;
        }
      }
      return;
    }
    // The beam spans the player: its foot is planted at their FEET (not
    // at the ground line -- standing on a platform or holding a ladder,
    // those are different heights, and anchoring to the ground would
    // sprout the shot from the floor far below them), and its head starts
    // at the muzzle, the same height above the feet a shot has always
    // appeared at.
    const tipX = this.player.x;
    const tipY = this.player.y - PLAYER_CONFIG.spriteHeight / 2;
    const proj = new Projectile(
      this, tipX, tipY, this.player.feetY, base.width, base.shotSpeed, this.weaponState.pierce, this.weaponType,
      base.ceilingStickSec ?? 0, base.ceilingReleaseWarnSec ?? 0,
    );
    this.projectiles.add(proj);
    // "Special/rapid" shot sound while a weapon power-up is boosting the
    // harpoon (rapid_shot: more shots in the air at once); the plain
    // harpoon sound otherwise.
    this.audio.play(this.effects.active.has('rapid_shot') ? 'weaponshootm' : 'weaponshoot');
    this.player.playShotAnim();
  }

  // The machine gun: one press puts up a fanned volley of bullets rather
  // than a single beam. What the weapon limits is how many VOLLEYS are in
  // the air, not how many bullets -- counting bullets would mean the first
  // press alone used the whole allowance up.
  fireVolley(base) {
    const live = new Set();
    for (const p of this.projectiles.getChildren()) {
      if (p.active && p.volleyId !== undefined) live.add(p.volleyId);
    }
    if (live.size >= this.weaponState.maxActiveShots) return;

    const { count, spreadDeg, spacingPx } = base.volley;
    const id = ++this.volleyCounter;
    const muzzleY = this.player.y - PLAYER_CONFIG.spriteHeight / 2;
    for (let i = 0; i < count; i++) {
      // Spread evenly about straight up: with 4 bullets that is -1.5, -0.5,
      // +0.5, +1.5 steps, so the fan stays symmetric and no bullet goes
      // straight up the middle.
      const offset = i - (count - 1) / 2;
      const angle = Phaser.Math.DegToRad(offset * spreadDeg);
      const bullet = new Bullet(
        this, this.player.x + offset * spacingPx, muzzleY,
        angle, base.shotSpeed, this.weaponState.pierce, id,
      );
      this.projectiles.add(bullet);
    }
    this.audio.play(this.effects.active.has('rapid_shot') ? 'weaponshootm' : 'weaponshoot');
    this.player.playShotAnim();
  }

  // The splash a shot leaves where it stops on something it cannot break
  // -- the ceiling, a side wall, or an indestructible obstacle. Every
  // weapon gets it: the bullets always did, and a beam ending at the
  // ceiling is the same event, which is why it looked like less of one.
  // (The artwork is still named for the bullet it was drawn for; what it
  // draws is a puff, and nothing about it was bullet-shaped.)
  playShotImpact(x, y, impact = BULLET_IMPACT) {
    const sprite = this.add.sprite(x, y, impact.textureKey);
    // Centred by default -- the bullet's spark straddles the point it
    // struck, which is what a chip flying off looks like. A shot whose
    // mark hangs from the surface instead says so (originY 0, see
    // Projectile's impact).
    sprite.setOrigin(0.5, impact.originY ?? 0.5);
    sprite.setDepth(6);
    sprite.play(impact.animKey);
    sprite.once('animationcomplete', () => sprite.destroy());
  }

  // The puff a landing kicks up, at the feet that landed (see
  // Player.followGround), and the thud that goes with it -- one call, so
  // the sound can't be triggered anywhere the dust isn't. Anchored by its
  // BOTTOM edge so the cloud sits on the surface rather than straddling
  // it, and drawn just under the player (depth 4) so they stand in it
  // rather than behind it.
  playLandingDust(x, feetY) {
    this.audio.play('playerland');
    const sprite = this.add.sprite(x, feetY, PLAYER_DUST_TEXTURE_KEY).setOrigin(0.5, 1);
    sprite.setDepth(3.8);
    sprite.play(PLAYER_DUST_ANIM_KEY);
    sprite.once('animationcomplete', () => sprite.destroy());
  }

  // `quiet` leaves the pop sound out, and `rollDrop` false leaves out the
  // random chance of a power-up -- both for a pop that is one of many in
  // the same instant (see shatterBalls), where the sound would be thirty
  // copies of itself and the rolls would rain drops over the field. A
  // drop the level itself put on that ball still comes out: that one was
  // authored, not rolled for.
  popBall(ball, { quiet = false, rollDrop = true } = {}) {
    const awarded = Math.round(ball.points * this.scoreMultiplier);
    this.score += awarded;
    if (!quiet) this.audio.play('balldestroy');
    this.playBallPopEffect(ball.x, ball.y, ball.shape, ball.size);
    this.scorePopups.push(new ScorePopup(this, ball.x, ball.y, awarded, ball.color, ball.radius));

    const children = ball.getSplitChildren();
    const forcedPowerup = ball.forcedPowerup;
    ball.destroy();
    for (const spec of children) {
      const child = new Ball(this, spec.shape, spec.size, spec.x, spec.y, spec.vx, spec.vy);
      this.balls.add(child);
    }

    // A ball the level editor tagged with a powerup guarantees that drop
    // (bypassing the random roll below) -- see Ball.js's forcedPowerup.
    const pool = this.dropPowerupTypes();
    const dropType = forcedPowerup
      || (rollDrop && pool.length && Math.random() < POWERUP_DROP_CHANCE
        ? pool[Math.floor(Math.random() * pool.length)] : null);
    if (dropType) {
      const bonus = new Bonus(this, dropType, ball.x, ball.y);
      this.powerups.add(bonus);
    }
  }

  // What a popped ball may drop here. Every power-up there is, minus any
  // whose KIND the level rules out -- `excludePowerupKinds` in the level
  // file. Panic Mode rules out `give_weapon`: the mode is built around
  // one weapon, and a machine gun falling out of a ball would quietly
  // rewrite the arithmetic the whole thing is balanced on (see
  // js/panicWaves.js).
  //
  // By kind rather than by name so it stays right when a weapon is added.
  // Cached per level because a pop is a common event and this answer only
  // changes when the level does.
  dropPowerupTypes() {
    const exclude = this.currentLevelDef?.excludePowerupKinds;
    if (!exclude?.length) return POWERUP_TYPE_KEYS;
    if (this.dropPoolFor !== this.currentLevelDef) {
      this.dropPoolFor = this.currentLevelDef;
      this.dropPool = POWERUP_TYPE_KEYS.filter((type) => !exclude.includes(POWERUP_TYPES[type].kind));
    }
    return this.dropPool;
  }

  // The dynamite (see elements.js's shatter_balls): every ball on the
  // field taken down to the smallest size there is -- ONE SIZE AT A TIME.
  //
  // Passes rather than recursion, because popping a ball REPLACES it with
  // two smaller ones: each pass takes the field as it stands, pops
  // everything still too big, and the next pass looks at what that left
  // behind. A size-5 ball is four passes -- 5 to 4, 4 to 3, 3 to 2, 2 to
  // 1 -- and sixteen smallest balls at the end of it.
  //
  // The SHATTER_PASS_SEC between them is the whole effect. Run back to
  // back inside one frame, sixteen balls simply appeared where one had
  // been and there was nothing to watch; spaced out, it is a charge going
  // off in stages, each bang visibly halving what is left. Driven from
  // updatePlaying (see updateShatter) rather than from a timer, so it
  // stops dead while the game is paused or a life is being lost, and
  // clearEntities cancels whatever is still pending when the level ends.
  shatterBalls(downToSize = 1) {
    this.shatterDownToSize = downToSize;
    // Capped so a ball element added later, with a size bigger than any
    // that exists today, cannot leave this running for ever.
    this.shatterPassesLeft = MAX_SHATTER_PASSES;
    this.shatterPass(); // the first bang belongs to the pickup, not to half a second after it
  }

  updateShatter(dt) {
    if (this.shatterPassesLeft <= 0) return;
    this.shatterTimer -= dt;
    if (this.shatterTimer <= 0) this.shatterPass();
  }

  // One size off every ball that still has one to lose. Every pop scores,
  // bursts and splits exactly as a shot's would -- it IS the same pop --
  // but quietly and without rolling for drops, with a single bang for the
  // whole pass instead of a dozen copies of the pop sound over each other
  // (see popBall).
  shatterPass() {
    const tooBig = this.balls.getChildren().filter((ball) => ball.active && ball.size > this.shatterDownToSize);
    if (!tooBig.length) {
      this.shatterPassesLeft = 0;
      return;
    }
    for (const ball of tooBig) this.popBall(ball, { quiet: true, rollDrop: false });
    this.audio.play('walldestroy');
    this.shatterPassesLeft -= 1;
    this.shatterTimer = SHATTER_PASS_SEC;
  }

  // A 2-frame pop animation, one image per (shape, size) ball -- see
  // assets.js's ballPopTexturePath/ballPopAnimKey -- played once exactly
  // where the ball was, in place of the generic tinted-particle burst
  // spawnBurst() still uses for obstacles/power-ups.
  playBallPopEffect(x, y, shape, size) {
    const sprite = this.add.sprite(x, y, ballPopTextureKey(shape, size));
    sprite.setDepth(6);
    sprite.play(ballPopAnimKey(shape, size));
    sprite.once('animationcomplete', () => sprite.destroy());
  }

  spawnBurst(x, y, colorHex, count, small = false) {
    const emitter = small ? this.burstSmall : this.burstNormal;
    emitter.setParticleTint(hexColor(colorHex));
    emitter.explode(count, x, y);
  }

  // -- Collision handlers -------------------------------------------------

  // Only balls reach here now: the laser beam doesn't move (it grows in
  // place, see Projectile.js), so it never collides with the world bounds
  // -- reaching the ceiling is length-capped in updateBeam instead.
  onWorldBounds(body, up, down, left, right) {
    const go = body.gameObject;
    if (go instanceof Ball) resolveBallBounce(go, { up, down, left, right });
  }

  // Arcade's body.touching exposes the same up/down/left/right contact
  // flags the world-bounds event passes as arguments, so both bounce
  // sites resolve through the one helper above.
  onBallHitObstacle(ballGO) {
    resolveBallBounce(ballGO, ballGO.body.touching);
  }

  onProjectileHitObstacle(projGO, obstacleGO) {
    if (!projGO.active) return;
    // An already-hanging beam keeps hold of what it caught -- it mustn't
    // spend itself, or chip away at anything, on a second contact.
    if (projGO.isAnchored) return;
    // Nor on the surface the player is standing on: a beam climbs, so only
    // what is above its foot is in its way (see Projectile.blockedBy).
    if (!projGO.blockedBy(obstacleGO.body)) return;
    // A grapple catches under an indestructible block exactly as it does
    // under the ceiling: a block it can never shoot through is something
    // to hang from, not something to waste the shot on. Destructible
    // blocks still take the hit and stop the shot, so the grapple can't be
    // used to dodge breaking them open.
    if (!obstacleGO.def.destructible) {
      // Where the shot actually stopped: a bullet's tip or a beam's head,
      // and never past the block's underside, which is as far as either
      // of them got. Played before the grapple is given its chance to
      // catch hold, so that catching hold is marked too -- it is the same
      // contact either way.
      const point = projGO.tip ?? projGO.head;
      this.playShotImpact(point.x, Math.max(obstacleGO.body.bottom, point.y), projGO.impact);
      if (projGO.anchorAt(obstacleGO.body.bottom)) return;
    }
    projGO.destroy();
    const forcedPowerup = obstacleGO.forcedPowerup;
    const { def } = obstacleGO;
    // Read while the blocks still exist: takeHit() destroys them, which
    // takes their bodies with them.
    const piece = this.pieceBlocks(obstacleGO);
    const bounds = blocksBounds(piece);
    const destroyed = obstacleGO.takeHit();
    if (destroyed) {
      // A breakable obstacle goes down as ONE THING. A 64x16 crate is
      // four bodies because that is how it collides and how a shape stays
      // solid while part of it is gone -- but a player shooting it is
      // shooting a crate, not a quarter of one, and watching three
      // quarters of it hang in the air was the surprise. Every block the
      // level authored as one obstacle goes with the block that was hit
      // (see LevelManager's pieceId).
      for (const block of piece) {
        if (block !== obstacleGO && block.active) block.destroy();
      }
      this.audio.play('walldestroy');
      // Spread over the whole piece rather than fired all at once from
      // its middle: a beam coming apart along its length reads as the
      // beam breaking, and the particle budget is the same either way.
      const perBlock = Math.max(3, Math.min(10, Math.round(60 / piece.length)));
      for (const block of piece) {
        this.spawnBurst(block.x + block.width / 2, block.y + block.height / 2, def.color, perBlock);
      }
      // The destroyed blocks may have been shielding a neighbor's face
      // from ever registering a collision (see Obstacle.js's
      // refreshObstacleSeams) -- recompute now that they're actually
      // gone, or a ball/the player could pass straight through where they
      // used to be.
      refreshObstacleSeams(this.obstacles);
      // A crate the level tagged with a powerup drops it the moment it is
      // shot down -- see Obstacle.js's forcedPowerup. Once per obstacle,
      // from the middle of what just broke.
      if (forcedPowerup) {
        this.powerups.add(new Bonus(this, forcedPowerup, bounds.x, bounds.y));
      }
    }
  }

  // Every active block of the obstacle this one belongs to, itself
  // included. A block with no piece (the level editor paints those) is a
  // piece of one.
  pieceBlocks(block) {
    if (block.pieceId === null || block.pieceId === undefined) return [block];
    return this.obstacles.getChildren().filter((other) => other.active && other.pieceId === block.pieceId);
  }

  onProjectileHitBall(projGO, ballGO) {
    if (!projGO.active || !ballGO.active) return;
    this.popBall(ballGO);
    if (projGO.registerHit()) projGO.destroy();
  }

  onPlayerHitBall(playerGO, ballGO) {
    if (this.state !== GAME_STATES.PLAYING || !ballGO.active) return;
    if (this.ballsFrozen) return; // time_freeze: frozen balls can't hurt the player
    this.playPlayerHitEffect(playerGO, ballGO);
    this.hitPlayer();
  }

  // The impact burst, played where the ball actually touched -- the
  // counterpart to playBallPopEffect below, which marks the other kind of
  // collision. The contact point is taken as the point on the ball's rim
  // facing the player rather than either body's centre: at the frame the
  // overlap fires, that lands on the surface the two met at, so a big ball
  // bursts at its edge instead of from somewhere inside itself.
  playPlayerHitEffect(playerGO, ballGO) {
    const dx = playerGO.x - ballGO.x;
    const dy = playerGO.y - ballGO.y;
    const dist = Math.hypot(dx, dy) || 1;
    const sprite = this.add.sprite(
      ballGO.x + (dx / dist) * ballGO.radius,
      ballGO.y + (dy / dist) * ballGO.radius,
      PLAYER_HIT_TEXTURE_KEY,
    );
    sprite.setDepth(7); // above the player (4) and the ball-pop burst (6)
    sprite.play(PLAYER_HIT_ANIM_KEY);
    sprite.once('animationcomplete', () => sprite.destroy());
  }

  // Running out of time counts as exactly the same hit as a ball touching
  // the player -- shield absorbs it the same way, otherwise it costs a
  // life and freezes the same way (see updatePlaying's timeLimitSec
  // check). Kept as its own entry point (rather than folding into
  // onPlayerHitBall) since there's no ball/overlap involved.
  onTimeUp() {
    if (this.state !== GAME_STATES.PLAYING) return;
    this.hitPlayer();
  }

  hitPlayer() {
    // Debug mode's Invincible toggle (the I key, or the button in its
    // VIEW group). Everything that can cost a life comes through here --
    // a ball touching the player and the clock running out both do -- so
    // this one line is the whole of it, and it is the only place that
    // needs to know the switch exists. Deliberately before the shield
    // too: an invincible player does not spend a shield on a hit that
    // was never going to land.
    if (this.debug?.invincible) return;

    const hadShield = this.player.shielded;
    const lostLife = this.player.takeHit();
    if (!lostLife && hadShield) {
      this.effects.active.delete('shield');
      this.audio.play('itemshieldloose');
    }

    if (lostLife) {
      this.audio.stopMusic();
      this.audio.play('playerlifeloose');
      // A playtest from the editor has unlimited lives -- it's there to
      // test the level layout, not to be beaten, so a hit just restarts
      // it (below) rather than ever costing a real life or ending in
      // game over.
      if (!this.isCustomLevel) this.lives -= 1;
      this.player.playDeadAnim();
      this.spawnDeathGhost();
      this.startHitFreeze(!this.isCustomLevel && this.lives <= 0);
    }
  }

  // The life leaving: a winged ghost of the player beats its way up out of
  // the body still lying there in its dead frame, and is gone before the
  // level restarts or the run ends.
  //
  // Drawn at the player's own position, which is all the lining-up it
  // needs: the ghost's cell is the player's cell widened by the wings and
  // otherwise identical, and the figure inside it is the very same dead
  // art (see assets.js and tools/ghost_sprite.py). So it begins as an
  // exact, washed-out copy of the body lying under it and rises off it.
  //
  // A tween rather than a physics body, deliberately: startHitFreeze
  // pauses the physics on the very next line, so anything with a velocity
  // would simply hang in the air. Tweens are not paused with it, which is
  // what lets this one thing keep moving in an otherwise frozen picture --
  // and is most of why it reads as a spirit rather than as a sprite.
  spawnDeathGhost() {
    const ghost = this.add.sprite(this.player.x, this.player.y, PLAYER_GHOST_TEXTURE_KEY);
    ghost.setDepth(8); // above the player (4) and every impact burst (6-7)
    ghost.play(PLAYER_GHOST_ANIM_KEY);
    this.tweens.add({
      targets: ghost,
      y: ghost.y - DEATH_GHOST_RISE_PX,
      // Held at full strength at first and fading away over the back of
      // the flight: it has to be seen to leave, and only then to be gone.
      // (Full strength is already see-through -- the art itself is, so
      // this fades a ghost out rather than fading a player to a ghost.)
      alpha: { from: 1, to: 0, ease: 'Quad.easeIn' },
      duration: DEATH_GHOST_SEC * 1000,
      ease: 'Sine.easeOut',
      onComplete: () => ghost.destroy(),
    });
  }

  // Freeze-frame everything (player, balls, projectiles) for a beat after
  // a hit lands, before restarting the level or ending the run -- same
  // physics.pause() mechanism as LEVEL_INTRO/PAUSED, so nothing simulates
  // while the frozen picture is on screen.
  startHitFreeze(isGameOver) {
    this.pendingGameOver = isGameOver;
    this.state = GAME_STATES.HIT_FREEZE;
    // Never shorter than the ghost's flight: the restart (or the game
    // over screen) waits for the life to finish leaving, so shortening
    // the freeze can't cut it off mid-air.
    this.stateTimer = Math.max(HIT_FREEZE_SEC, DEATH_GHOST_SEC);
    this.physics.pause();
  }

  // Landed on top of an obstacle instead of the ground -- stop it there
  // (Bonus.update's own floorY snap only ever fires if it never hits
  // anything on the way down). Only the vertical case matters: a bonus
  // has no horizontal velocity, so it can't arrive at a side face.
  onPowerupHitObstacle(bonusGO, obstacleGO) {
    // Which block it landed on matters, not just that it landed: shooting
    // that block open has to drop the power-up on down (see Bonus.restOn).
    if (bonusGO.body.touching.down) bonusGO.restOn(obstacleGO);
  }

  onPlayerCollectPowerup(playerGO, bonusGO) {
    if (!bonusGO.active) return;
    this.collectPowerup(bonusGO);
  }

  // Shooting a dropped power-up collects it too, same as walking into it.
  onProjectileHitPowerup(projGO, bonusGO) {
    if (!projGO.active || !bonusGO.active) return;
    this.collectPowerup(bonusGO);
    if (projGO.registerHit()) projGO.destroy();
  }

  collectPowerup(bonusGO) {
    this.effects.apply(bonusGO.type, this, this.elapsedMs);
    this.audio.play(bonusGO.def.pickupSound);
    this.spawnBurst(bonusGO.x, bonusGO.y, bonusGO.def.color, 8, true);
    bonusGO.destroy();
  }
}

// The middle of a set of blocks, and how far they reach -- where a
// drop appears when the obstacle holding it breaks.
function blocksBounds(blocks) {
  const left = Math.min(...blocks.map((b) => b.x));
  const top = Math.min(...blocks.map((b) => b.y));
  const right = Math.max(...blocks.map((b) => b.x + b.width));
  const bottom = Math.max(...blocks.map((b) => b.y + b.height));
  return { x: (left + right) / 2, y: (top + bottom) / 2, width: right - left, height: bottom - top };
}
