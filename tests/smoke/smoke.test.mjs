// The tests that need a real browser: does the game start, does every
// level it ships actually run, and do the few things a player does in the
// first minute still work.
//
//     npm install && npm run test:smoke
//
// Everything in ../ answers its question WITHOUT running the game, which
// is what makes that suite fast. This one exists because the bugs that
// have actually reached players were all of the other kind -- a
// spritesheet whose frames had moved, a ladder with no headroom at the
// top, a countdown that opened over a level still sliding off screen.
// None of those are visible in a JSON file; all of them are visible
// within a second of the game being on screen.
//
// It is deliberately shallow. It is not here to replace playing the game,
// it is here to notice that the game is broken -- so it presses on
// everything once rather than on anything twice, and each test says what
// a player would have seen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openGame } from './game.mjs';
import { levelFiles } from '../helpers.mjs';

const LEVEL_COUNT = levelFiles().length;

// One browser for the file. Starting Chromium costs more than every test
// in here put together, and none of them leaves the game in a state the
// next one cannot set up from.
let game;
test.before(async () => { game = await openGame(); });
test.after(async () => { await game?.close(); });

// Anything thrown or logged as an error since the last check, cleared as
// it is read so each test only ever reports its own.
function drainErrors() {
  const found = game.errors.splice(0, game.errors.length);
  return found.join('\n');
}

test('the game boots into its menu with nothing thrown', async () => {
  const state = await game.scene((s) => s.state);
  assert.equal(state, 'MENU', 'the game should come up on the main menu');
  assert.equal(drainErrors(), '', 'nothing may be thrown or logged as an error on the way in');
});

test('every level in the campaign loads and runs', async () => {
  // The one test worth the whole file. A level is data, and the data
  // tests already check its shape -- what they cannot check is that it
  // BUILDS: that its background loaded under the name it asks for, that
  // its obstacles and balls become real objects, and that a few frames of
  // the real update loop over them throws nothing.
  const report = await game.scene(async (s, count) => {
    const out = [];
    for (let i = 0; i < count; i++) {
      s.levelIndex = i;
      s.loadLevel(i);
      s.state = 'PLAYING';
      // Two frames: one to build, one to simulate over what was built.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      out.push({
        level: i + 1,
        name: s.currentLevelDef?.name ?? null,
        balls: s.balls.countActive(true),
        obstacles: s.obstacles.countActive(true),
        // The texture the background image actually ended up on. A level
        // naming one that never loaded shows here as the fallback
        // Phaser hands out, which no level should ever be sitting on.
        background: s.backgroundImage.texture.key,
        playerX: Math.round(s.player.x),
        playerY: Math.round(s.player.y),
      });
    }
    return out;
  }, LEVEL_COUNT);

  assert.equal(report.length, LEVEL_COUNT);
  for (const level of report) {
    assert.ok(level.name, `level ${level.level}: no name -- it did not load`);
    // A level with nothing to pop is already cleared the frame it opens.
    assert.ok(level.balls > 0, `level ${level.level} (${level.name}): no balls`);
    assert.ok(level.playerX > 0 && level.playerY > 0,
      `level ${level.level} (${level.name}): player at ${level.playerX},${level.playerY}`);
    assert.notEqual(level.background, '__MISSING',
      `level ${level.level} (${level.name}): its background never loaded`);
  }
  assert.equal(drainErrors(), '', 'loading every level threw or logged something');
});

test('the player walks, shoots, and pops what it hits', async () => {
  await game.scene((s) => { s.beginRun(0, null); });
  await game.page.waitForFunction(() => window.game.scene.getScene('Game').state === 'PLAYING', null, { timeout: 30000 });

  // Real key events through the real input layer, not a poke at the
  // entity: the binding, the input state and the movement code are all
  // part of what "the player walks" means.
  const startX = await game.scene((s) => s.player.x);
  await game.page.keyboard.down('ArrowRight');
  await game.frames(30);
  await game.page.keyboard.up('ArrowRight');
  const movedX = await game.scene((s) => s.player.x);
  assert.ok(movedX > startX + 10, `player barely moved: ${startX} -> ${movedX}`);

  // A ball may well catch the player around any of this, which freezes
  // the level and restarts it -- and a frozen player cannot shoot. That
  // can happen in the very gap between confirming PLAYING and the key
  // landing, so the press is retried rather than trusted once: each
  // attempt waits play out, fires, and checks. What is being tested --
  // that a shoot press in play fires a shot -- is exactly what the loop
  // settles.
  let fired = false;
  for (let attempt = 0; attempt < 5 && !fired; attempt++) {
    await game.page.waitForFunction(
      () => window.game.scene.getScene('Game').state === 'PLAYING', null, { timeout: 30000 },
    );
    await game.page.keyboard.press('Space');
    await game.frames(3);
    fired = await game.scene((s) => s.projectiles.countActive(true) > 0);
    if (!fired) await game.frames(30); // let a mid-press hit finish its freeze
  }
  assert.ok(fired, 'pressing shoot fired nothing, five attempts running');

  // And a shot that reaches a ball pops it. Driven through popBall rather
  // than by waiting for a hit, because where the balls happen to be is
  // not what this is testing.
  const popped = await game.scene((s) => {
    const before = { balls: s.balls.countActive(true), score: s.score };
    s.popBall(s.balls.getChildren()[0]);
    return { before, score: s.score };
  });
  assert.ok(popped.score > popped.before.score, 'popping a ball scored nothing');
  assert.equal(drainErrors(), '');
});

// Every weapon marks stopping on something it cannot break. The machine
// gun always did; the beams did not, and the difference was invisible in
// any file -- it is one sprite, alive for two frames of a 14fps
// animation, which is exactly the kind of thing only a running game can
// answer. Note what this does NOT do: screenshot it. A screenshot round
// trip takes longer than the puff lives, so the picture comes back empty
// however well the game is working. Reading the display list is both
// faster and the actual question.
test('every weapon leaves a mark where it stops on what it cannot break', async () => {
  const LEVEL = {
    id: 1,
    name: 'Impact',
    timeLimitSec: 90,
    background: 'default',
    obstacles: [{ type: 'platform', x: 384, y: 200, w: 64, h: 16 }],
    balls: [{ shape: 'round', size: 1, x: 100, y: 60, vx: -100 }],
    playerStart: { x: 408, y: 400 },
  };

  // ...and each leaves ITS OWN mark: the beams a grey cloud, the machine
  // gun its teal spark (see the weapons table in the README).
  for (const [weapon, texture] of [['harpoon', 'beam-hit'], ['grapple', 'beam-hit'], ['machinegun', 'bullet-hit']]) {
    await game.scene((s, level) => { s.startCustomLevel(level); }, LEVEL);
    await game.page.waitForFunction(
      () => window.game.scene.getScene('Game').state === 'PLAYING', null, { timeout: 30000 },
    );
    // Straight up from under the block, with the shot lock cleared so the
    // shot goes the instant it is asked for.
    await game.scene((s, w) => { s.setWeapon(w); s.player.shotLock = 0; s.tryFire(); }, weapon);

    let marks = [];
    for (let i = 0; i < 60 && !marks.length; i++) {
      await game.frames(1);
      marks = await game.scene((s) => s.children.list
        .filter((c) => ['bullet-hit', 'beam-hit'].includes(c.texture?.key))
        .map((c) => c.texture.key));
    }
    assert.ok(marks.length > 0, `${weapon}: nothing marked the block it stopped on`);
    assert.deepEqual([...new Set(marks)], [texture], `${weapon}: marked it with the wrong thing`);
  }
  assert.equal(drainErrors(), '');
});

// A grapple hanging from the ceiling holds the player's only shot for its
// whole four seconds. Pressing fire in the meantime used to do nothing at
// all, which reads as the button being broken rather than the weapon
// being busy -- so each refused press now shakes it down sooner, up to a
// second and a half over the life of that one beam.
test('rattling the trigger brings a hanging grapple down sooner', async () => {
  await game.scene((s) => {
    s.startCustomLevel({
      id: 1,
      name: 'Grapple',
      timeLimitSec: 90,
      background: 'default',
      obstacles: [],
      balls: [{ shape: 'round', size: 1, x: 100, y: 60, vx: -100 }],
      playerStart: { x: 400, y: 400 },
    });
  });
  await game.page.waitForFunction(
    () => window.game.scene.getScene('Game').state === 'PLAYING', null, { timeout: 30000 },
  );
  await game.scene((s) => { s.setWeapon('grapple'); s.player.shotLock = 0; s.tryFire(); });

  let hanging = false;
  for (let i = 0; i < 90 && !hanging; i++) {
    await game.frames(1);
    hanging = await game.scene((s) => s.projectiles.getChildren()[0]?.isAnchored ?? false);
  }
  assert.ok(hanging, 'the grapple never caught the ceiling');

  // Six presses in ONE call, so what the clock loses to the presses is not
  // confused with what it loses to time passing between them.
  const shaken = await game.scene((s) => {
    const before = s.projectiles.getChildren()[0].stickLeft;
    for (let i = 0; i < 6; i++) { s.player.shotLock = 0; s.tryFire(); }
    const after = s.projectiles.getChildren()[0].stickLeft;
    for (let i = 0; i < 6; i++) { s.player.shotLock = 0; s.tryFire(); }
    return { taken: before - after, andSixMore: after - s.projectiles.getChildren()[0].stickLeft };
  });
  assert.ok(shaken.taken > 1.4 && shaken.taken < 1.6,
    `six presses took ${shaken.taken.toFixed(2)}s off the hang, not the 1.5s they are worth`);
  assert.ok(shaken.andSixMore < 0.01,
    `the shake budget did not hold: six more presses took another ${shaken.andSixMore.toFixed(2)}s`);
  assert.equal(drainErrors(), '');
});

test('losing a life sends the ghost up and restarts the level', async () => {
  // Its own run, and its own clean slate for it. A hit leaves the player
  // invulnerable for PLAYER_CONFIG.invulnMs, so a ball that happened to
  // catch them during the test before this one would make the hit below
  // do nothing at all -- and this would fail for a reason that has
  // nothing to do with ghosts.
  await game.scene((s) => { s.beginRun(0, null); });
  await game.page.waitForFunction(() => window.game.scene.getScene('Game').state === 'PLAYING', null, { timeout: 30000 });

  const flight = await game.scene(async (s) => {
    const ghost = () => s.children.list.find((c) => c.texture?.key === 'player-ghost');
    s.lives = 3;
    s.player.invulnTimer = 0;
    const startY = s.player.y;
    s.hitPlayer();
    const spawned = !!ghost();
    await new Promise((r) => setTimeout(r, 600));
    const mid = ghost();
    return {
      spawned,
      state: s.state,
      rose: mid ? Math.round(startY - mid.y) : null,
      lives: s.lives,
    };
  });
  assert.ok(flight.spawned, 'no ghost was spawned by a lost life');
  assert.equal(flight.state, 'HIT_FREEZE', 'the level should be frozen while the ghost leaves');
  assert.ok(flight.rose > 20, `the ghost is not rising (${flight.rose}px after 600ms)`);
  assert.equal(flight.lives, 2, 'a hit should cost exactly one life');

  await game.page.waitForFunction(
    () => window.game.scene.getScene('Game').state === 'LEVEL_INTRO', null, { timeout: 10000 },
  );
  assert.equal(drainErrors(), '');
});

test('clearing a level carries the run into the next one', async () => {
  // The whole hand-off in one go: celebration, tally, transition, and the
  // countdown that must not open until the transition has finished (see
  // GameScene.advanceLevel -- the rules suite pins the arithmetic, this
  // checks the real thing ends up on the next level).
  await game.scene((s) => {
    s.beginRun(0, null);
  });
  await game.page.waitForFunction(() => window.game.scene.getScene('Game').state === 'PLAYING', null, { timeout: 30000 });
  await game.scene((s) => {
    s.balls.clear(true, true);
    s.levelClear({ recordTime: false });
  });
  await game.page.waitForFunction(
    () => window.game.scene.getScene('Game').levelIndex === 1, null, { timeout: 20000 },
  );
  const after = await game.scene((s) => ({ level: s.levelIndex + 1, state: s.state, balls: s.balls.countActive(true) }));
  assert.equal(after.level, 2);
  assert.ok(after.balls > 0, 'the next level arrived empty');
  assert.equal(drainErrors(), '');
});

test('erasing progress takes the scores and leaves the settings', async () => {
  // Worth a browser test more than most things here: it is the one
  // button in the game that destroys something, and what it must NOT
  // take is as much of the point as what it must.
  await game.page.evaluate(() => {
    localStorage.setItem('balloonBuster.highscores', JSON.stringify({ schemaVersion: 1, entries: [{ id: 'x', name: 'ABC', score: 9999, level: 5, date: '2026-01-01' }] }));
    localStorage.setItem('balloonBuster.progress', JSON.stringify({ schemaVersion: 1, unlockedLevels: 12 }));
    localStorage.setItem('balloonBuster.levelTimes', JSON.stringify({ schemaVersion: 1, times: { 0: 12.5 } }));
    localStorage.setItem('balloonBuster.settings', JSON.stringify({ schemaVersion: 1, muted: true }));
    localStorage.setItem('balloonBuster.levelEdits', JSON.stringify({ levels: { 7: { id: 7, name: 'MINE' } } }));
  });
  const keys = () => game.page.evaluate(
    () => Object.keys(localStorage).filter((k) => k.startsWith('balloonBuster.')).sort(),
  );

  await game.scene((s) => s.showOptions());
  await game.frames(3);

  // ERASE PROGRESS is a door, not an action (see the README's Options
  // notes): opening the screen does nothing, and CANCEL has to leave
  // every last thing alone.
  await game.page.click('#btn-erase');
  await game.frames(2);
  assert.equal(await game.scene((s) => s.state), 'ERASE', 'ERASE PROGRESS should only open the screen that asks');
  assert.equal((await keys()).length, 5, 'opening the erase screen erased something');
  await game.page.click('#btn-close-erase');
  await game.frames(2);
  assert.equal((await keys()).length, 5, 'cancelling erased something');

  await game.page.click('#btn-erase');
  await game.frames(2);
  await game.page.click('#btn-erase-yes');
  await game.frames(2);
  assert.deepEqual(await keys(), ['balloonBuster.levelEdits', 'balloonBuster.settings'],
    'erasing progress must take the scores, the unlocks and the times -- and nothing else');

  await game.page.click('#btn-close-erase');
  await game.frames(2);
  await game.page.click('#btn-erase');
  await game.frames(2);
  assert.equal(await game.page.evaluate(() => document.getElementById('erase-done').classList.contains('hidden')), true,
    'reopening the erase screen should not still be announcing a previous erase');
  await game.page.click('#btn-close-erase');
  await game.frames(2);
  await game.scene((s) => s.goToMenu());
  assert.equal(drainErrors(), '');
});

test('the editor can start a level from nothing', async () => {
  // New has to leave nothing of what was open -- not just the placed
  // things (Clear already does that) but the level's name, time,
  // background and weapon, which is the whole difference between the two.
  // And it must ask first, because it discards more than any other button
  // in that panel.
  const click = (label) => game.page.evaluate((text) => {
    const button = [...document.querySelectorAll('#editor-panel button')]
      .find((b) => b.textContent === text && b.offsetParent !== null);
    if (!button) return false;
    button.click();
    return true;
  }, label);
  const level = () => game.scene((s) => ({
    balls: s.editor.balls.size,
    blocks: s.editor.blocks.size,
    weapon: s.editor.weapon,
    time: s.editor.timeInput.value,
    name: s.editor.sourceDef?.name,
  }));
  // The panel is a fixed band across the HUD strip, so the question has
  // to fit in the height the panel already has.
  const panelHeight = () => game.page.evaluate(() => document.getElementById('editor-panel').scrollHeight);

  await game.scene((s) => s.editLevel(11)); // level 12, which has content
  await game.frames(6);
  const before = await level();
  assert.ok(before.blocks > 0 && before.balls > 0, 'this test needs a level with something in it');
  const restingHeight = await panelHeight();

  assert.ok(await click('New'), 'no New button in the editor');
  await game.frames(2);
  assert.equal(await panelHeight(), restingHeight, 'asking must not push the panel out of its band');
  assert.ok(await click('Cancel'));
  await game.frames(2);
  assert.deepEqual(await level(), before, 'cancelling changed the level');

  await click('New');
  assert.ok(await click('Blank it'));
  await game.frames(2);
  assert.deepEqual(await level(), {
    balls: 0, blocks: 0, weapon: 'harpoon', time: '60', name: 'Level 12',
  }, 'New must leave nothing of the level that was open');

  const def = await game.scene((s) => s.editor.buildDef());
  assert.deepEqual(def.obstacles, []);
  assert.deepEqual(def.balls, []);
  assert.equal(def.id, 12, 'a blank level still belongs to the slot it was started in');
  assert.equal(def.playerStart, undefined, 'a blank level has no start placed yet');

  await game.scene((s) => s.exitEditor());
  await game.frames(2);
  assert.equal(drainErrors(), '');
});

test('a save with no admin tool says it is local, and does it', async () => {
  // These tests are served by tests/smoke/server.mjs, which is Node and
  // has no PHP -- so the file save cannot work. The editor has to say
  // that plainly rather than reporting a save only this browser can see
  // as though it had reached the project.
  await game.scene((s) => s.editLevel(11));
  await game.frames(6);
  await game.scene((s) => { s.editor.setBlock(160, 336, 'crate', null); s.editor.save(); });
  await game.page.waitForFunction(
    () => !/SAVING/.test(window.game.scene.getScene('Game').editor.statusMessage || ''), null, { timeout: 15000 },
  );
  const status = await game.scene((s) => s.editor.statusMessage);
  assert.match(status, /THIS BROWSER ONLY/, `save should own up to being local, said: ${status}`);

  // Contains, not equals: the erase-progress test above deliberately
  // leaves an edit of its own behind, and this one has no business
  // caring about that.
  const savedLevels = await game.page.evaluate(
    () => Object.keys(JSON.parse(localStorage.getItem('balloonBuster.levelEdits') || '{"levels":{}}').levels || {}),
  );
  assert.ok(savedLevels.includes('12'),
    `the local save is the fallback -- it has to actually be there, found ${JSON.stringify(savedLevels)}`);

  await game.scene((s) => s.exitEditor());
  await game.frames(2);
  assert.equal(drainErrors(), '');
});

test('balls are picked by name, in a panel that fits', async () => {
  await game.scene((s) => s.editLevel(0));
  await game.frames(6);

  // Every kind by its full name, not an abbreviation. Five kinds, three
  // of whose names begin with the same letter -- as buttons they read
  // R1, HX1, HU1, HA1, and thirteen of the twenty-three were "H" before
  // even that.
  const kinds = await game.page.evaluate(() => {
    const select = [...document.querySelectorAll('#editor-panel select')]
      .find((s) => [...s.options].some((o) => o.text === 'Round'));
    return select ? [...select.options].map((o) => o.text) : null;
  });
  assert.ok(kinds, 'no ball kind picker in the editor');
  assert.deepEqual(kinds, ['Round', 'Hex', 'Wave', 'Hunter', 'Heavy']);
  for (const name of kinds) assert.ok(name.length > 2, `${name} is an abbreviation, not a name`);

  // Choosing one selects the ball brush, so picking a ball and then
  // having to click Ball as well is not a step anyone has to take.
  await game.page.evaluate(() => {
    const select = [...document.querySelectorAll('#editor-panel select')]
      .find((s) => [...s.options].some((o) => o.text === 'Round'));
    select.value = 'hunter';
    select.dispatchEvent(new Event('change'));
  });
  await game.frames(2);
  assert.equal(await game.scene((s) => s.editor.brush), 'ball-hunter-5');

  // Hex has three sizes where the others have five, so the size list has
  // to follow the kind rather than offer one that has no element.
  await game.page.evaluate(() => {
    const select = [...document.querySelectorAll('#editor-panel select')]
      .find((s) => [...s.options].some((o) => o.text === 'Round'));
    select.value = 'hex';
    select.dispatchEvent(new Event('change'));
  });
  await game.frames(2);
  assert.equal(await game.scene((s) => s.editor.brush), 'ball-hex-3');

  // With the counts showing, not a status message left over from the
  // test above: a message is a whole sentence and is SUPPOSED to lose
  // its tail (see style.css) -- the counts are what must fit.
  await game.scene((s) => s.editor.showStatusMessage('', 0));
  await game.frames(2);

  // And the whole panel has to be usable without dragging it sideways:
  // it is a fixed band exactly as wide as the canvas, and anything past
  // its edge -- Save, Play, a brush -- can only be reached by scrolling.
  const panel = await game.page.evaluate(() => {
    const el = document.getElementById('editor-panel');
    const status = el.querySelector('.panel-status');
    return {
      content: el.scrollWidth, visible: el.clientWidth,
      tall: el.scrollHeight, band: el.clientHeight,
      countsClipped: status.scrollWidth > status.clientWidth,
      clippedSelects: [...el.querySelectorAll('select')]
        .filter((s) => s.scrollWidth > s.clientWidth)
        .map((s) => s.options[s.selectedIndex].text),
    };
  });
  assert.ok(panel.content <= panel.visible,
    `the editor panel needs ${panel.content}px of the ${panel.visible}px it has`);
  assert.ok(panel.tall <= panel.band,
    `the editor panel needs ${panel.tall}px of the ${panel.band}px band it sits in`);
  assert.equal(panel.countsClipped, false, 'the counts readout is cut off');
  assert.deepEqual(panel.clippedSelects, [], 'a picker is too narrow to read its own value');

  await game.scene((s) => s.exitEditor());
  await game.frames(2);
  assert.equal(drainErrors(), '');
});

test('a guaranteed drop goes on what can be broken open, and shows there', async () => {
  await game.scene((s) => s.editLevel(0));
  await game.frames(6);

  const placed = await game.scene((s) => {
    const editor = s.editor;
    editor.clearAll();
    editor.selectedPowerup = 'shield';
    editor.placeBlock(160, 336, 'crate');
    editor.selectedPowerup = null;
    editor.placeBlock(192, 336, 'crate');
    editor.selectedPowerup = 'extra_life';
    editor.placeBlock(224, 336, 'crate');
    // A wall, with a drop still chosen. Nothing ever destroys one, so it
    // must not take the drop -- and a level that saved it would fail the
    // rule in tests/levels.test.mjs that says exactly this.
    editor.selectedPowerup = 'shield';
    editor.placeBlock(256, 336, 'platform');
    return {
      obstacles: editor.buildDef().obstacles.map((o) => `${o.type}${o.powerup ? `:${o.powerup}` : ''}`),
      markers: editor.dropIcons.size,
    };
  });
  assert.deepEqual(placed.obstacles, ['crate:shield', 'crate', 'crate:extra_life', 'platform']);
  assert.equal(placed.markers, 2, 'a block holding a drop has to be visible as one');

  // Round trip: a level read back shows its drops too, or the editor
  // cannot be used to check what a level already holds.
  const reloaded = await game.scene((s) => {
    const def = s.editor.buildDef();
    s.editor.clearAll();
    s.editor.loadDef(def);
    return { markers: s.editor.dropIcons.size, obstacles: s.editor.buildDef().obstacles.length };
  });
  assert.equal(reloaded.markers, 2, 'a loaded level does not show which blocks hold drops');
  assert.equal(reloaded.obstacles, 4);

  // ...and erasing a block takes its marker with it.
  const erased = await game.scene((s) => {
    s.editor.eraseAt(160, 336);
    return s.editor.dropIcons.size;
  });
  assert.equal(erased, 1, 'erasing a block left its drop marker behind');

  await game.scene((s) => s.exitEditor());
  await game.frames(2);
  assert.equal(drainErrors(), '');
});

test('pausing and leaving stops the run without breaking it', async () => {
  // Its own run, like every test above: leaning on whatever the previous
  // one happened to leave behind is how a suite starts failing for
  // reasons that have nothing to do with what it is testing.
  await game.scene((s) => { s.beginRun(0, null); });
  await game.page.waitForFunction(() => window.game.scene.getScene('Game').state === 'PLAYING', null, { timeout: 30000 });
  await game.page.keyboard.press('Escape');
  await game.frames(3);
  assert.equal(await game.scene((s) => s.state), 'PAUSED');

  await game.page.keyboard.press('Escape');
  await game.frames(3);
  assert.equal(await game.scene((s) => s.state), 'PLAYING', 'Escape should hand play back');

  await game.scene((s) => s.goToMenu());
  await game.frames(3);
  assert.equal(await game.scene((s) => s.state), 'MENU');
  assert.equal(drainErrors(), '');
});
