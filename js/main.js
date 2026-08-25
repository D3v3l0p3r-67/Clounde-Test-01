import { GAME_CONFIG } from './GameConfig.js';
import { applyZoom, activeZoom, watchViewport } from './DisplayZoom.js';
import { registerServiceWorker } from './pwa.js';
import { initSkins, activeSkin } from './skins.js';

// Makes the game installable and playable offline (see service-worker.js).
// Registered before the game is built, but the worker's own install waits
// for the window's load event, so filling its cache never competes with
// the first screen appearing.
registerServiceWorker();

// The active skin has to be known before a single texture is fetched --
// every loader routes its paths through it (see js/skins.js) -- so the
// game is constructed from initSkins()'s continuation. It never throws
// and costs one small JSON fetch on a host with skins, nothing without.
async function boot() {
  await initSkins();
  // A skin drawn smooth rather than blocky turns Phaser's nearest-
  // neighbour texture filtering off; the matching CSS side of the same
  // switch is the `skin-smooth` body class initSkins() sets.
  if (activeSkin().render?.pixelArt === false) GAME_CONFIG.pixelArt = false;

  // Phaser owns the loop, canvas, and renderer entirely from here on --
  // there is no manual requestAnimationFrame code left in this project.
  // Exposed on window for devtools/debugging, same as most Phaser
  // projects.
  window.game = new Phaser.Game(GAME_CONFIG);

  window.game.events.once(Phaser.Core.Events.READY, () => {
    applyZoom(activeZoom());
    watchViewport();
  });
}
boot();

// Scale mode is NONE (see GameConfig.js) -- the canvas is sized by hand to
// one of exactly three fixed zoom levels instead of continuously fitting
// the window (see DisplayZoom.js). #game-container is sized to match
// exactly, so #ui-layer's CSS `inset: 0` always lines up with the canvas
// with no letterboxing gap to correct for.
// activeZoom rather than the stored preference: a window too small for
// the chosen size (a phone in landscape, typically) is fitted to instead,
// so no part of the playfield -- or of the touch controls anchored to it
// -- can end up off the screen. watchViewport keeps a fitted canvas
// fitted through rotation, resize and fullscreen.

