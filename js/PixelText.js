import { COLORS, VIRTUAL_W } from './constants.js';
import { INTRO_FONT_PATH, INTRO_FONT_FRAME, INTRO_FONT_CHARS } from './assets.js';
import { skinAsset, skinFont } from './skins.js';

// The DOM equivalent of LevelIntro.js's Phaser text -- every menu screen
// (main menu, options, level select, pause, game over, victory, high
// scores) renders its headings/buttons/labels through this instead of
// plain CSS text, so the whole game reads as one look: the same blocky
// bitmap font (assets/intro/font_alpha.webp) the HUD and level-intro
// screen already use, not a smooth vector font. Native controls that
// genuinely need to stay native (the high-score initials <input>, the
// mute checkbox, the volume sliders) are the deliberate exception -- see
// style.css instead.

const CELL_W = INTRO_FONT_FRAME.frameWidth;
const CELL_H = INTRO_FONT_FRAME.frameHeight;
const GAP = 1; // 1 font-pixel between characters, pre-scale

// A skin may carry its own DOM menu font at `res` times the base cell
// (see js/skins.js's skinFont): glyphs are drawn at that resolution and
// shown at the SAME on-screen size, so a smooth skin's text is genuinely
// smooth instead of upscaled 5x6 blocks -- while every width, gap and
// layout stays in base units and nothing else in this file changes
// meaning. res is 1 (and the font the base bitmap) unless a skin says
// otherwise; read lazily because the skin is only decided at boot,
// before the first text is ever rendered (see main.js's initSkins).
let fontImage = null;
let loadPromise = null;
let res = 1;

function ensureLoaded() {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve) => {
    const font = skinFont();
    res = font?.scale ?? 1;
    const img = new Image();
    img.onload = () => {
      fontImage = img;
      resolve();
    };
    img.src = font?.path ?? skinAsset(INTRO_FONT_PATH);
  });
  return loadPromise;
}

function drawInto(canvas, text) {
  const upper = String(text).toUpperCase();
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!fontImage) return;
  let x = 0;
  for (const ch of upper) {
    const idx = INTRO_FONT_CHARS.indexOf(ch);
    if (idx !== -1) {
      ctx.drawImage(fontImage, idx * CELL_W * res, 0, CELL_W * res, CELL_H * res,
        x, 0, CELL_W * res, CELL_H * res);
    }
    x += (CELL_W + GAP) * res;
  }
}

function widthFor(text) {
  const len = String(text).length;
  return len === 0 ? 0 : (len - 1) * (CELL_W + GAP) + CELL_W;
}

// Registry of every live pixel-text canvas, so a window resize can
// re-render them all at the new responsive scale (see rescaleAll()).
const registry = [];

// Named size tiers -- plain Phaser-style scale multipliers on top of the
// game canvas's own current CSS size (see gameCanvasScale()), matching
// the actual scale choices Hud.js/LevelIntro.js use for equivalent text
// (2 for small HUD digits/labels, 3 for the score/READY/GO!/LEVEL text)
// so the DOM overlay's text sits at the same visual size as its Phaser
// counterparts, and grows/shrinks in lockstep with the game canvas on
// resize/fullscreen rather than following an independent viewport
// heuristic.
const TIERS = { h1: 5, h2: 3, button: 2, body: 2 };

// The game canvas is sized by hand to one of a few fixed zoom levels (see
// DisplayZoom.js, GameConfig.js's scale.mode: NONE) -- read its actual
// rendered CSS size back out rather than re-deriving a competing guess
// from window.innerWidth/Height or the chosen zoom level, so this always
// matches exactly. Direct-child
// selector on purpose: Phaser injects its canvas straight into
// #game-container (GameConfig.js's `parent`), while every pixel-text
// canvas this module creates lives several levels deeper inside
// #ui-layer -- a plain "canvas" selector would match one of those
// instead, at whatever tiny size it happens to already be.
function gameCanvasScale() {
  const canvas = document.querySelector('#game-container > canvas');
  if (!canvas) return 2;
  const rect = canvas.getBoundingClientRect();
  return rect.width > 0 ? rect.width / VIRTUAL_W : 2;
}

function responsiveScale(tier) {
  return Math.max(0.5, (TIERS[tier] ?? 2) * gameCanvasScale());
}

// Renders `text` as a <canvas class="pixel-text">, sized (via width/
// height + a CSS pixel size) for immediate insertion into the DOM. Safe
// to call before the font image has finished loading -- draws blank and
// fills in once ensureLoaded() resolves. `tier` picks a responsive scale
// (see TIERS); pass a plain number instead to force a fixed scale.
export function renderPixelText(text, tier = 'body', color = COLORS.text) {
  ensureCanvasObserver();
  const scale = typeof tier === 'number' ? tier : responsiveScale(tier);
  const canvas = document.createElement('canvas');
  canvas.className = 'pixel-text';
  canvas.width = Math.max(1, widthFor(text) * res);
  canvas.height = CELL_H * res;
  // Style size is in BASE units: a skin font at 3x the resolution shows
  // at exactly the size the 1x font would, only sharper.
  canvas.style.width = `${(canvas.width / res) * scale}px`;
  canvas.style.height = `${(canvas.height / res) * scale}px`;

  const entry = { canvas, text, tier, color };
  registry.push(entry);
  paint(entry);
  if (!fontImage) ensureLoaded().then(() => paint(entry));
  return canvas;
}

function paint(entry) {
  drawInto(entry.canvas, entry.text);
  if (entry.color) tint(entry.canvas, entry.color);
}

// Font glyphs are plain white -- recolor via source-in, the canvas
// equivalent of Phaser's setTint(), so one asset serves every color this
// UI needs (accent gold headings, plain text, danger red, ...).
function tint(canvas, color) {
  const ctx = canvas.getContext('2d');
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
}

// Replaces `el`'s entire content with a rendered pixel-text canvas --
// also sets aria-label to the original string, since a canvas has no
// text for assistive tech to read. Returns the canvas.
export function setPixelText(el, text, tier = 'body', color = COLORS.text) {
  el.innerHTML = '';
  el.setAttribute('aria-label', String(text));
  const canvas = renderPixelText(text, tier, color);
  el.appendChild(canvas);
  return canvas;
}

function rescaleAll() {
  // Prune entries dropped from the DOM (e.g. a rebuilt list) while we're
  // already iterating, so the registry doesn't grow forever.
  for (let i = registry.length - 1; i >= 0; i--) {
    const entry = registry[i];
    if (!entry.canvas.isConnected) {
      registry.splice(i, 1);
      continue;
    }
    const scale = typeof entry.tier === 'number' ? entry.tier : responsiveScale(entry.tier);
    entry.canvas.style.width = `${(entry.canvas.width / res) * scale}px`;
    entry.canvas.style.height = `${(entry.canvas.height / res) * scale}px`;
  }
}

let rescaleQueued = false;
function scheduleRescale() {
  if (rescaleQueued) return;
  rescaleQueued = true;
  requestAnimationFrame(() => {
    rescaleQueued = false;
    rescaleAll();
  });
}

// The primary trigger: watches the actual game canvas element (not the
// browser window) for size changes, so this reacts correctly to
// everything that can change gameCanvasScale() -- a fullscreen toggle, or
// DisplayZoom.js applying its first zoom level shortly after boot (which
// lands *after* ui.js's very first setPixelText() calls during GameScene.
// create(), since those run synchronously before main.js's READY handler
// gets a chance to set the canvas's final CSS size -- without this, that
// first paint could be stuck at whatever transient size the canvas had at
// that instant, forever, on a session where the zoom is never changed).
// Falls back to a plain window resize listener if ResizeObserver isn't
// available at all.
let canvasObserverStarted = false;
function ensureCanvasObserver() {
  if (canvasObserverStarted) return;
  const canvas = document.querySelector('#game-container > canvas');
  if (!canvas) return; // not created yet -- retried on the next render call
  canvasObserverStarted = true;
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(scheduleRescale).observe(canvas);
  } else {
    window.addEventListener('resize', scheduleRescale);
  }
}
