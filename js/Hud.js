import { VIRTUAL_W, PLAYFIELD_H, HUD_H, GAME_STATES, COLORS } from './constants.js';
import { WEAPON_TYPES } from './config.js';
import { POWERUP_TYPES } from './elements.js';
import * as assets from './assets.js';
import * as storage from './storage.js';
import { hexColor } from './colors.js';

const ACCENT = hexColor(COLORS.accent);
const DANGER = hexColor(COLORS.danger);

const VISIBLE_STATES = new Set([
  GAME_STATES.PLAYING,
  GAME_STATES.PAUSED,
  GAME_STATES.LEVEL_INTRO,
  GAME_STATES.LEVEL_CLEAR,
  GAME_STATES.HIT_FREEZE,
]);

const MAX_LIVES_ICONS = 5;

// Every power-up type that can ever sit in EffectManager.active at once --
// the two instant ones (bonus_fruit, extra_life) never appear there (see
// weapons.js's EffectManager.apply), so 6 is the real maximum, not 8.
const MAX_POWERUP_SLOTS = 6;

// The HUD's own pixel-art layout below is authored at a fixed design
// width/height (all the individual x/y offsets -- 4, 74, 166, 196, 1, 14,
// 27, ... -- assume it), independent of VIRTUAL_W/HUD_H. Centering the
// whole container in whatever the actual (possibly larger) HUD bar is
// keeps that hand-laid design intact instead of stretching or
// re-anchoring every element.
const HUD_CONTENT_W = 384;
const HUD_CONTENT_H = 40;

// A left-anchored row of pooled digit Images, one call to setValue() per
// frame -- unused slots (beyond however many digits the current value
// needs) are just hidden, never destroyed/recreated.
class DigitRow {
  constructor(container, textureKey, frameWidth, maxDigits, x, y) {
    this.frameWidth = frameWidth;
    this.images = [];
    for (let i = 0; i < maxDigits; i++) {
      const img = container.scene.add.image(x + i * frameWidth, y, textureKey, 0).setOrigin(0, 0);
      container.add(img);
      this.images.push(img);
    }
  }

  // Right-hand digits only, and never more of them than there are slots:
  // a value too big for its row is shown as the largest that row CAN
  // draw. Dropping the leftmost digits instead -- which is what taking
  // str[i] straight did -- turns 100 into "10", so Panic Mode's hundredth
  // wave read as its tenth, and a run of any length looked stuck.
  // Clamping still under-reports, but it under-reports as a ceiling
  // ("this is as far as the row goes") rather than as a smaller number.
  setValue(n) {
    const most = 10 ** this.images.length - 1;
    const str = String(Math.min(most, Math.max(0, Math.floor(n))));
    for (let i = 0; i < this.images.length; i++) {
      const has = i < str.length;
      this.images[i].setVisible(has);
      if (has) this.images[i].setFrame(Number(str[i]));
    }
  }

  setTint(color) {
    for (const img of this.images) img.setTint(color);
  }

  setVisible(visible) {
    for (const img of this.images) img.setVisible(visible);
  }
}

// The graphic status bar living in the dedicated HUD_H strip below the
// playfield (see constants.js) -- every label/digit/icon here is a real
// loaded image (see assets.js's HUD_* constants / BootScene's preload),
// never drawn text, so the whole thing is reskinned by swapping files.
// Layout (all coordinates local to this.container, which sits at
// (0, PLAYFIELD_H)):
//   "1-P" label, then a row of life icons, top-left.
//   Score: large digits, with HI (top score, smaller digits) directly
//   below it -- reads as one "current / best" column instead of HI
//   living apart from the score it's compared against.
//   Weapon frame + an icon centered inside it, 1.5x the digit-column
//   art's scale so the currently-held weapon reads as the HUD's focal
//   point. Always the weapon in hand -- nothing else is ever put in
//   there (see render).
//   TIME and LEVEL on the right, each a label + the smaller digit strip
//   so label and value line up at the same height.
//   A row of active power-up icons + remaining whole seconds along the
//   bottom, replacing the old DOM #powerup-indicators overlay -- pooled
//   the same way the life icons are, one slot per currently active
//   EffectManager entry.
export class Hud {
  constructor(scene) {
    this.scene = scene;
    const contentX = Math.max(0, (VIRTUAL_W - HUD_CONTENT_W) / 2);
    const contentY = PLAYFIELD_H + Math.max(0, (HUD_H - HUD_CONTENT_H) / 2);
    this.container = scene.add.container(contentX, contentY).setDepth(20);

    this.container.add(scene.add.image(4, 3, assets.HUD_1P_KEY).setOrigin(0, 0).setTint(ACCENT));

    this.lifeIcons = [];
    for (let i = 0; i < MAX_LIVES_ICONS; i++) {
      const icon = scene.add.image(4 + i * 12, 18, assets.HUD_LIFE_KEY).setOrigin(0, 0);
      this.container.add(icon);
      this.lifeIcons.push(icon);
    }

    const SCORE_X = 74;
    this.scoreRow = new DigitRow(this.container, assets.HUD_DIGITS_LARGE_KEY, assets.HUD_DIGITS_LARGE_FRAME.frameWidth, 6, SCORE_X, 2);
    this.scoreRow.setTint(ACCENT);

    const HI_Y = 22;
    this.container.add(scene.add.image(SCORE_X, HI_Y, assets.HUD_HI_LABEL_KEY).setOrigin(0, 0).setTint(ACCENT));
    this.hiRow = new DigitRow(this.container, assets.HUD_DIGITS_SMALL_KEY, assets.HUD_DIGITS_SMALL_FRAME.frameWidth, 6, SCORE_X + 20, HI_Y);
    this.hiRow.setTint(ACCENT);

    // 33x33/21x21 (1.5x the original 22x22/14x14 art) -- see
    // "Swapping HUD graphics" in the README. The icon keeps its default
    // center origin (like before), positioned at the frame's own center
    // so it stays centered regardless of either image's exact size.
    const WEAPON_X = 160;
    const WEAPON_Y = 4;
    this.weaponFrame = scene.add.image(WEAPON_X, WEAPON_Y, assets.HUD_WEAPON_FRAME_KEY).setOrigin(0, 0);
    this.container.add(this.weaponFrame);
    this.weaponIcon = scene.add.image(WEAPON_X + this.weaponFrame.width / 2, WEAPON_Y + this.weaponFrame.height / 2, assets.hudWeaponIconKey(Object.keys(WEAPON_TYPES)[0]));
    this.container.add(this.weaponIcon);
    this.lastWeaponIconKey = null;

    // TIME / LEVEL -- only two rows now that HI moved under the score,
    // so they get more vertical breathing room than the old cramped
    // three-row stack.
    const ROW1_Y = 8;
    const ROW2_Y = 22;
    const RIGHT_X = 210;

    this.timeLabel = scene.add.image(RIGHT_X, ROW1_Y, assets.HUD_TIME_LABEL_KEY).setOrigin(0, 0).setTint(ACCENT);
    this.container.add(this.timeLabel);
    this.timeRow = new DigitRow(this.container, assets.HUD_DIGITS_SMALL_KEY, assets.HUD_DIGITS_SMALL_FRAME.frameWidth, 3, RIGHT_X + 44, ROW1_Y);
    this.timeRow.setTint(ACCENT);

    // Panic Mode has no time limit (see loadLevel/currentLevelDef) -- it
    // shares the TIME row's slot with a small bar instead, showing the
    // current wave's completion (how far through its written pattern,
    // see GameScene.panicProgressPct) rather than leaving the slot empty.
    this.panicBarMaxW = 60;
    const PANIC_BAR_H = 6;
    this.panicBarBg = scene.add.rectangle(RIGHT_X, ROW1_Y + 4, this.panicBarMaxW, PANIC_BAR_H, 0x000000).setOrigin(0, 0).setStrokeStyle(1, ACCENT);
    this.panicBarFill = scene.add.rectangle(RIGHT_X + 1, ROW1_Y + 5, this.panicBarMaxW - 2, PANIC_BAR_H - 2, ACCENT).setOrigin(0, 0);
    this.container.add(this.panicBarBg);
    this.container.add(this.panicBarFill);

    // Three digits, not two: the campaign stops at 50, but Panic Mode's
    // wave counter runs past 100 and keeps going (see
    // GameScene.advancePanicProgress), and two slots turned that into
    // "10".
    this.container.add(scene.add.image(RIGHT_X, ROW2_Y, assets.HUD_LEVEL_LABEL_KEY).setOrigin(0, 0).setTint(ACCENT));
    this.levelRow = new DigitRow(this.container, assets.HUD_DIGITS_SMALL_KEY, assets.HUD_DIGITS_SMALL_FRAME.frameWidth, 3, RIGHT_X + 54, ROW2_Y);
    this.levelRow.setTint(ACCENT);

    // Active power-up row -- sits in HUD_H's spare vertical room below
    // the design block above (HUD_CONTENT_H < HUD_H), one pooled icon +
    // 2-digit countdown per slot, left-anchored like the 1-P/score
    // columns above it.
    const POWERUP_ROW_Y = 40;
    const POWERUP_SLOT_W = 44;
    this.powerupSlots = [];
    for (let i = 0; i < MAX_POWERUP_SLOTS; i++) {
      const slotX = 4 + i * POWERUP_SLOT_W;
      const icon = scene.add.image(slotX, POWERUP_ROW_Y, assets.powerupTextureKey('shield')).setOrigin(0, 0).setVisible(false);
      this.container.add(icon);
      const digits = new DigitRow(this.container, assets.HUD_DIGITS_SMALL_KEY, assets.HUD_DIGITS_SMALL_FRAME.frameWidth, 2, slotX + 20, POWERUP_ROW_Y + 3);
      digits.setTint(ACCENT);
      digits.setVisible(false);
      this.powerupSlots.push({ icon, digits });
    }

    this.lastState = null;
    this.topHighScore = storage.loadHighScores()[0]?.score ?? 0;
  }

  render() {
    const g = this.scene;
    if (g.state !== this.lastState) {
      this.lastState = g.state;
      // Cheap re-read on state changes only -- covers a high score just
      // submitted on the previous run showing up here on the next one.
      this.topHighScore = storage.loadHighScores()[0]?.score ?? 0;
    }

    // PAUSED is a HUD-visible state, but a pause opened from the level
    // editor (see GameScene.pauseFromEditor) isn't a run -- score/lives/
    // time would just be leftovers from whatever was played last, which
    // is worse than showing nothing, and the editor never shows a HUD.
    const visible = VISIBLE_STATES.has(g.state) && !g.pausedFromEditor;
    this.container.setVisible(visible);
    if (!visible) return;

    // The frame shows the WEAPON, and only ever the weapon. A running
    // rapid_shot used to take the frame over, which hid the one thing it
    // is for -- and hid it exactly when the answer matters, since what a
    // rapid shot does depends on which weapon it is speeding up. It is
    // already in the power-up row along the bottom, with the seconds it
    // has left, which is where an effect on a clock belongs.
    const weaponIconKey = assets.hudWeaponIconKey(g.weaponType);
    if (weaponIconKey !== this.lastWeaponIconKey) {
      this.lastWeaponIconKey = weaponIconKey;
      this.weaponIcon.setTexture(weaponIconKey);
    }

    this.scoreRow.setValue(g.score);
    // Panic Mode (and any other level with no timeLimitSec) has no
    // countdown to show -- leaving it at remainingLevelTime's 0 fallback
    // would otherwise sit there in permanent DANGER-red, implying time's
    // about to run out when it's actually unlimited.
    const hasTimeLimit = !!g.currentLevelDef?.timeLimitSec;
    this.timeLabel.setVisible(hasTimeLimit);
    this.timeRow.setVisible(hasTimeLimit);
    if (hasTimeLimit) {
      this.timeRow.setValue(g.remainingLevelTime);
      this.timeRow.setTint(g.remainingLevelTime <= 10 ? DANGER : ACCENT);
    }

    const showPanicBar = !hasTimeLimit && g.isPanicMode;
    this.panicBarBg.setVisible(showPanicBar);
    this.panicBarFill.setVisible(showPanicBar);
    if (showPanicBar) this.panicBarFill.displayWidth = Math.max(1, this.panicBarMaxW * (g.panicProgressPct / 100));

    this.levelRow.setValue(g.isPanicMode ? g.panicWaveIndex + 1 : g.levelIndex + 1);
    this.hiRow.setValue(Math.max(this.topHighScore, g.score));

    for (let i = 0; i < this.lifeIcons.length; i++) this.lifeIcons[i].setVisible(i < g.lives);

    // Iterated straight off the Map rather than spread into an array
    // first -- this runs every frame, and the array was pure garbage.
    let slotIndex = 0;
    for (const [type, expiresAt] of g.effects.active) {
      if (slotIndex >= this.powerupSlots.length) break;
      const slot = this.powerupSlots[slotIndex++];
      slot.icon.setVisible(true);
      slot.icon.setTexture(assets.powerupTextureKey(type));
      slot.digits.setValue(Math.max(0, Math.ceil((expiresAt - g.elapsedMs) / 1000)));
      // A negative effect's clock is a countdown to RELIEF, and it reads
      // in the same danger red the level clock turns when it is the
      // threat -- the icon's black ring says which kind this is from
      // across the bar, the colour says it up close.
      slot.digits.setTint(POWERUP_TYPES[type].negative ? DANGER : ACCENT);
    }
    for (let i = slotIndex; i < this.powerupSlots.length; i++) {
      this.powerupSlots[i].icon.setVisible(false);
      this.powerupSlots[i].digits.setVisible(false);
    }
  }
}
