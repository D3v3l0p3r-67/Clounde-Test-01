// Registries for every ball/obstacle/power-up "element" -- populated by
// BootScene.populateElements() from elements/*.json (see assets.js's
// ELEMENTS_DIR/MAX_ELEMENT_FILES) before GameScene ever starts. Every
// array/object here is mutated in place (never reassigned), so existing
// importers (Ball.js, Obstacle.js, editor.js, debug.js, weapons.js, ui.js,
// Bonus.js, GameScene.js) keep the same reference the whole game long,
// same pattern as LevelManager's LEVELS.
//
// Adding a new ball size/shape, obstacle type, or power-up is purely a new
// elements/<id>.json file -- nothing here needs to change. A power-up's
// *behavior* is the one thing a JSON file can't express; each element
// instead names a `kind` from POWERUP_BEHAVIORS below (plus a `params`
// object for that kind's own numbers), so e.g. two power-ups that both
// freeze balls but for different durations can share the 'freeze_balls'
// kind and just differ in `durationMs`.

export const BALL_ELEMENTS = []; // [{id, shape, size, label, hasGravity, radius, speed, bounceVelocity, points, color, highlight, movement}]
export const BALL_SHAPE_KEYS = []; // distinct shapes across BALL_ELEMENTS, in first-seen order

// How a ball moves, beyond bouncing. Same mutable-registry shape as
// POWERUP_BEHAVIORS below: a ball element names one by its `movement`
// field, and nothing outside this object knows any of their names.
//
// A ball's kind is COLOUR-CODED, because you get one glance at it while
// it is already falling at you: red bounces plainly, green weaves, blue
// comes after you, purple is heavy and stays low. The colours are not
// chosen here -- tools/ball_variants.py turns the round ball's hue and
// writes each kind's art and element together, so what a ball looks like
// and what it does cannot come apart.
//
// `update` runs once per frame per ball, from GameScene.updatePlaying,
// AFTER the physics step. So it is free to set body.velocity.x outright:
// whatever a bounce did this frame has already happened. Two rules:
//
//   * Drive horizontal motion from ball.hDir, never from the velocity
//     that is there. Arcade zeroes the colliding axis before the bounce
//     callback runs (see Ball.js), so the velocity mid-collision is not
//     the direction the ball is going -- hDir is.
//   * Only change hDir if turning around is what the movement IS. A
//     weave whose velocity crosses zero has not changed direction, and
//     writing hDir from it would fight every wall bounce.
//
// Vertical motion is left alone by all of them: gravity, bounceVelocity
// and the landings are what make a ball a ball, and a movement that
// touched them would be a different entity rather than a variant.
//
// `init` sets up whatever `update` counts on, once, when the ball is
// built (and again on a split child, which is a new ball). Each movement
// keeps its own working number in ball.movementPhase and means something
// different by it -- there is exactly one, on purpose: a movement that
// needed its own state bag would be reaching past being a variant.
export const BALL_MOVEMENTS = {
  // The ordinary bouncer. Nothing to do -- its horizontal speed is
  // constant between bounces, which Arcade already maintains.
  standard: {
    update() {},
  },

  // Weaves across its own path. `movementPhase` is the angle of the
  // weave. The swing is bigger than the ball's own speed, so the velocity
  // does briefly reverse at each end and the path visibly doubles back --
  // while the average still carries it across the field.
  wave: {
    swing: 1.6,       // times its own horizontal speed
    periodSec: 0.85,
    init(ball) { ball.movementPhase = 0; },
    update(ball, dt) {
      ball.movementPhase += (dt * Math.PI * 2) / this.periodSec;
      ball.body.setVelocityX(ball.hDir * ball.hSpeed * (1 + this.swing * Math.sin(ball.movementPhase)));
    },
  },

  // Turns towards the player and keeps coming. `movementPhase` is where
  // it is in that turn, -1 (full left) to +1 (full right), which is both
  // its direction and how fast it is going: a hunter mid-turn is slow,
  // and one that has committed is at full speed.
  //
  // Deliberately about a second to reverse, and slower than a plain ball
  // to begin with (see tools/ball_variants.py), so it is something to be
  // outrun and led away rather than something that cannot be escaped.
  hunter: {
    turnPerSec: 2.2,
    // Starts committed to wherever it was already going, rather than
    // from a standstill it would have to accelerate out of.
    init(ball) { ball.movementPhase = ball.hDir; },
    update(ball, dt, scene) {
      const toward = Math.sign(scene.player.x - ball.x);
      if (toward !== 0) {
        ball.movementPhase = clamp(ball.movementPhase + toward * this.turnPerSec * dt, -1, 1);
        // hDir is what the wall bounces read, so a hunter that turned
        // mid-flight still bounces the way it is actually travelling.
        if (Math.abs(ball.movementPhase) > 0.05) ball.hDir = Math.sign(ball.movementPhase);
      }
      ball.body.setVelocityX(ball.hDir * ball.hSpeed * Math.abs(ball.movementPhase));
    },
  },
};

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

export function ballMovement(name) {
  return BALL_MOVEMENTS[name] ?? BALL_MOVEMENTS.standard;
}

export const OBSTACLE_TYPES = {}; // type -> {label, destructible, hitPoints, color, tileTexture}
export const OBSTACLE_TYPE_KEYS = [];

export const POWERUP_TYPES = {}; // type -> {label, color, durationMs, instant, pickupSound, apply(game), revert(game)}
export const POWERUP_TYPE_KEYS = [];

// Ladders are climbable scenery, not obstacles: nothing collides with one
// (balls and shots pass straight through, and so does the player, which is
// what lets a ladder carry the player through a platform it ends against
// -- see Player.js). Its whole entry is therefore just a picture and the
// size of that picture. width/height are what the editor snaps and what
// Player.js measures the climb against, so they must stay whole obstacle
// blocks.
export const LADDER_TYPES = {}; // type -> {label, width, height, texture}
export const LADDER_TYPE_KEYS = [];

export function getBallElement(shape, size) {
  return BALL_ELEMENTS.find((el) => el.shape === shape && el.size === size);
}

// The largest size every shape has an element for, as one object --
// what Panic Mode's size escalation needs so a bump can never name a
// ball that does not exist (see js/panicWaves.js's escalate).
export function ballMaxSizes() {
  const out = {};
  for (const el of BALL_ELEMENTS) out[el.shape] = Math.max(out[el.shape] ?? 0, el.size);
  return out;
}

export function maxBallSize(shape) {
  return BALL_ELEMENTS.filter((el) => el.shape === shape).reduce((max, el) => Math.max(max, el.size), 0);
}

// One entry per power-up `kind` a JSON element can reference. Each is a
// plain (game, params) => void pair -- params comes straight from that
// element's own `params` object, so the same kind can back any number of
// differently-tuned power-ups (different duration, different magnitude).
export const POWERUP_BEHAVIORS = {
  instant_score: {
    apply(game, params) { game.score += params.amount; },
    revert() {},
  },
  // Additive, and relative to whatever weapon is in hand -- an absolute
  // value would NERF a weapon whose own base is higher (the machine gun
  // allows three volleys), and reverting to the harpoon's base would be
  // wrong for every other weapon. game.baseMaxActiveShots reads the
  // weapon actually being held (see GameScene).
  weapon_max_shots: {
    apply(game, params) { game.weaponState.maxActiveShots = game.baseMaxActiveShots + params.bonusShots; },
    revert(game) { game.weaponState.maxActiveShots = game.baseMaxActiveShots; },
  },
  player_speed_multiplier: {
    apply(game, params) { game.player.speedMultiplier = params.multiplier; },
    revert(game) { game.player.speedMultiplier = 1; },
  },
  extra_life: {
    apply(game) { game.lives += 1; },
    revert() {},
  },
  score_multiplier: {
    apply(game, params) { game.scoreMultiplier = params.multiplier; },
    revert(game) { game.scoreMultiplier = 1; },
  },
  freeze_balls: {
    apply(game) { game.ballsFrozen = true; },
    revert(game) { game.ballsFrozen = false; },
  },
  // Every ball on the field taken apart down to `params.downToSize` in
  // one go: not a clock but a single act, so there is nothing to revert.
  // The work is GameScene's (see shatterBalls) because a split is a split
  // -- the same popping a shot does, over and over until nothing bigger
  // than the smallest ball is left.
  shatter_balls: {
    apply(game, params) { game.shatterBalls(params.downToSize ?? 1); },
    revert() {},
  },
  // Slow motion for the balls and nothing else. A scale rather than a
  // set of velocities, because it has to hold for balls that do not
  // exist yet -- the halves a ball splits into while it is running, and
  // anything Panic Mode drops from the ceiling (see GameScene's per-ball
  // sync in updatePlaying and Ball.setSpeedScale).
  slow_balls: {
    apply(game, params) { game.ballSpeedScale = params.multiplier ?? 0.5; },
    revert(game) { game.ballSpeedScale = 1; },
  },
  player_shield: {
    apply(game) { game.player.shielded = true; },
    revert(game) { game.player.shielded = false; },
  },
  // -- Negative power-ups -------------------------------------------------
  //
  // Same machinery as every helpful one -- a kind, an apply/revert pair,
  // a durationMs on the element -- pointed the other way. All three work
  // on the ONE merged input path (GameScene.updatePlaying reshapes the
  // input object after readInput()), never on the entities: keyboard,
  // touch, and anything that might drive the player in the future are
  // all upstream of that point, so they are all affected alike, and
  // reverting is dropping a flag rather than un-editing physics.
  //
  // Re-picking one up while it runs REFRESHES it instead of stacking:
  // apply() is an idempotent flag-set and EffectManager overwrites the
  // expiry it holds for an already-active type (see weapons.js).

  // Left is right, up is down, for the duration. Shoot is deliberately
  // not swapped with anything -- there is nothing opposite to it, and a
  // trigger that stopped working would be disable_shooting's job.
  reverse_controls: {
    apply(game) { game.controlsReversed = true; },
    revert(game) { game.controlsReversed = false; },
  },
  // The trigger goes dead; walking, climbing and everything else stays.
  disable_shooting: {
    apply(game) { game.shootingDisabled = true; },
    revert(game) { game.shootingDisabled = false; },
  },
  // The player can neither move nor shoot -- gravity still applies, so a
  // frozen player finishes falling rather than hanging in the air. The
  // icy tint is the on-field half of the indication (the HUD countdown
  // is the other); revert clears it, and so does the level reload a lost
  // life causes (effects.reset runs every revert).
  freeze_player: {
    apply(game) { game.playerFrozen = true; game.player.setTint(0x9bd1f0); },
    revert(game) { game.playerFrozen = false; game.player.clearTint(); },
  },
  // Swapping the weapon in hand. Instant and for keeps: a weapon is what
  // the player is holding, not an effect running on a clock, so there is
  // nothing to revert -- the level's own weapon comes back when the level
  // does (see GameScene.loadLevel). `params.weapon` is a WEAPON_TYPES key.
  give_weapon: {
    apply(game, params) { game.setWeapon(params.weapon); },
    revert() {},
  },
};

// Dispatches a loaded elements/*.json payload into the right registry
// above -- called once per file by BootScene.populateElements(). `harpoon`
// is WEAPON_TYPES.harpoon (see config.js), passed through for any behavior
// that needs a weapon's own numbers without importing config.js here (kept
// element-registry-only).
export function registerElement(el, harpoon) {
  if (el.category === 'ball') {
    BALL_ELEMENTS.push(el);
    if (!BALL_SHAPE_KEYS.includes(el.shape)) BALL_SHAPE_KEYS.push(el.shape);
  } else if (el.category === 'obstacle') {
    OBSTACLE_TYPES[el.type] = {
      label: el.label,
      destructible: el.destructible,
      hitPoints: el.hitPoints == null ? Infinity : el.hitPoints,
      color: el.color,
      tileTexture: el.tileTexture,
      // The bevel drawn around a piece made of this material -- light
      // where the shape faces up or left, dark where it faces down or
      // right (see Obstacle.js's drawObstacleEdges). Defaulted from
      // `color` rather than required, so an obstacle written before these
      // existed still gets an edge rather than a white one.
      edgeLight: el.edgeLight ?? el.color,
      edgeDark: el.edgeDark ?? el.color,
      // How well the player's feet hold on this material, 1 being every
      // surface the game had before this existed: they go exactly as
      // fast as the key is held and stop the frame it is let go. Below 1
      // the footing is slippery -- the icy wall is 0.12 -- and Player.js
      // eases towards the speed being asked for instead of taking it
      // (see its slide()). Defaulted rather than required, so an
      // obstacle written before ice existed still behaves as it always
      // did.
      grip: el.grip ?? 1,
    };
    OBSTACLE_TYPE_KEYS.push(el.type);
  } else if (el.category === 'ladder') {
    LADDER_TYPES[el.type] = {
      label: el.label,
      width: el.width,
      height: el.height,
      texture: el.texture,
    };
    LADDER_TYPE_KEYS.push(el.type);
  } else if (el.category === 'powerup') {
    const behavior = POWERUP_BEHAVIORS[el.kind];
    const params = el.params || {};
    POWERUP_TYPES[el.type] = {
      label: el.label,
      // Kept as well as used, so a level can rule out a CLASS of power-up
      // -- "no other weapons" is `give_weapon`, and stays right when a
      // fourth weapon is added (see GameScene.dropPowerupTypes).
      kind: el.kind,
      // A power-up the player does NOT want. Data, not behavior: the
      // black ring on its icon is drawn from this by the icon tools, the
      // HUD shows its countdown in danger red, and a level could exclude
      // the whole class the way panic excludes weapons.
      negative: el.negative === true,
      color: el.color,
      durationMs: el.durationMs,
      instant: el.instant,
      pickupSound: el.pickupSound || 'itempick',
      apply: (game) => behavior.apply(game, params, harpoon),
      revert: (game) => behavior.revert(game, params, harpoon),
    };
    POWERUP_TYPE_KEYS.push(el.type);
  }
}
