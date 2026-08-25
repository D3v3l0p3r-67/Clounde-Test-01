// Skins: what the game LOOKS like, chosen at boot and never entangled
// with what it does.
//
// The base `assets/` tree is itself the default skin -- the pixel art the
// game shipped with. A skin never replaces that tree; it OVERLAYS it: a
// folder `skins/<id>/` mirroring the assets/ layout, plus a `skin.json`
// manifest listing exactly which files it provides. Every loader in the
// game routes its paths through skinAsset() below, which answers with the
// skin's copy when the manifest lists one and the base file otherwise.
//
// That per-file fallback is the whole safety story. A skin that covers
// three files reskins three things; whatever it does not cover is served
// from assets/ exactly as before, so a missing or half-finished skin can
// never take the game down -- the worst it can do is look mixed. And
// because an override must sit at the SAME relative path as the file it
// replaces, it necessarily has the base file's format, layout and pixel
// dimensions checked against it (tests/skins.test.mjs) -- which is what
// keeps hitboxes, physics and layout identical across skins: gameplay
// reads sizes from configs and elements, never from a skin.
//
// Beyond files, a manifest may carry:
//   style      CSS custom properties ("--panel": "#1c2333", ...) applied
//              to the document, which is how the DOM menus, buttons and
//              panels are themed -- style.css already reads everything
//              through these variables.
//   colors     the JS-side palette (constants.js's COLORS): what the
//              canvas itself paints with -- HUD tints, the sky gradient,
//              danger red. Only keys COLORS already has are applied.
//   render     { pixelArt: false } marks a skin drawn smooth rather than
//              blocky: Phaser switches to linear texture filtering and a
//              `skin-smooth` body class lifts the CSS `image-rendering:
//              pixelated` rules (see style.css), so the art scales soft
//              instead of chunky.
//   font       { file, scale } -- a higher-resolution replacement for the
//              DOM menu font, drawn by PixelText.js at `scale` times the
//              base cell and shown at the same on-screen size, i.e. the
//              same layout with more pixels in it. Phaser's own in-canvas
//              intro font is overridden like any other file instead
//              (same cell size), so the two never disagree about layout.
//
// Which skin is active: the player's saved choice (Options -> DISPLAY),
// if that skin still exists and is enabled; otherwise the registry's
// `default`; otherwise the first enabled skin; otherwise the bare base
// assets. Changing skin means reloading the page -- every texture in
// Phaser would need re-fetching anyway, and a reload is the one way that
// is guaranteed to leave no stale texture behind.
//
// initSkins() runs BEFORE the Phaser game is constructed (see main.js)
// and never throws: on a host with no skins/ folder at all, the game
// boots exactly as it did before skins existed.

import * as storage from './storage.js';
import { COLORS } from './constants.js';

export const SKINS_DIR = 'skins/';
export const SKINS_INDEX_PATH = 'skins/index.json';

// The skin every fallback below bottoms out at. Its manifest overrides
// nothing -- the base assets ARE this skin -- which is also why it is
// marked `system` and the admin tool refuses to delete it.
export const BASE_SKIN_ID = 'pixel';

const state = {
  registry: { default: BASE_SKIN_ID, skins: [BASE_SKIN_ID] },
  manifests: new Map(), // id -> skin.json contents, for every skin that fetched
  activeId: BASE_SKIN_ID,
  overrides: new Set(), // "assets/..." paths the active skin provides
};

async function fetchJSON(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

function enabledIds() {
  return state.registry.skins.filter((id) => {
    const manifest = state.manifests.get(id);
    return manifest && manifest.enabled !== false;
  });
}

// Chooses and applies the active skin. Called once, before the game is
// built; everything after that only reads.
export async function initSkins() {
  try {
    const registry = await fetchJSON(SKINS_INDEX_PATH);
    if (Array.isArray(registry.skins) && registry.skins.length) state.registry = registry;
  } catch {
    // No skins/ on this host: the base assets, exactly as always.
    return;
  }

  // Every manifest, not just the active one: the options picker needs the
  // names, and they are a few hundred bytes each. One that fails to fetch
  // simply is not offered.
  await Promise.all(state.registry.skins.map(async (id) => {
    try {
      state.manifests.set(id, await fetchJSON(`${SKINS_DIR}${id}/skin.json`));
    } catch { /* not available -- skipped by enabledIds() */ }
  }));

  const enabled = enabledIds();
  const saved = storage.loadSettings().skin;
  state.activeId = enabled.includes(saved) ? saved
    : enabled.includes(state.registry.default) ? state.registry.default
      : enabled[0] ?? BASE_SKIN_ID;

  const manifest = state.manifests.get(state.activeId);
  if (!manifest) return;
  state.overrides = new Set(manifest.overrides ?? []);

  for (const [key, value] of Object.entries(manifest.style ?? {})) {
    if (key.startsWith('--')) document.documentElement.style.setProperty(key, value);
  }
  // The JS-side palette: what the canvas paints with (HUD tints, the sky
  // gradient GameScene draws, danger red...). Only keys COLORS already
  // has -- a skin retunes the palette, it does not grow one. Applied
  // before the Phaser game is even constructed, so every scene reads the
  // skinned values; the one exception is a module that converted a color
  // at import time, which keeps the base value (LevelTransition does --
  // an acceptable seam, noted rather than hidden).
  for (const [key, value] of Object.entries(manifest.colors ?? {})) {
    if (key in COLORS) COLORS[key] = value;
  }
  document.body.classList.add(`skin-${state.activeId}`);
  if (manifest.render?.pixelArt === false) document.body.classList.add('skin-smooth');
}

// Every asset load in the game goes through this: the skin's copy when it
// has one, the base file otherwise. Safe before initSkins() -- it just
// answers with the base file.
export function skinAsset(path) {
  return state.overrides.has(path) ? `${SKINS_DIR}${state.activeId}/${path}` : path;
}

export function activeSkinId() {
  return state.activeId;
}

export function activeSkin() {
  return state.manifests.get(state.activeId) ?? { id: BASE_SKIN_ID, name: 'Pixel' };
}

// For the options picker: every skin that can actually be chosen.
export function availableSkins() {
  return enabledIds().map((id) => ({ id, name: state.manifests.get(id)?.name ?? id }));
}

// The DOM menu font the active skin wants, resolved to a real path --
// null means the base bitmap font at its base scale (see PixelText.js).
export function skinFont() {
  const font = activeSkin().font;
  if (!font?.file) return null;
  return { path: `${SKINS_DIR}${state.activeId}/${font.file}`, scale: font.scale ?? 1 };
}

// Saves the choice and reloads: a skin swap replaces textures Phaser has
// already handed to live sprites, and a fresh boot is the one path that
// cannot leave a stale one behind.
export function chooseSkin(id) {
  storage.saveSettings({ skin: id });
  window.location.reload();
}
