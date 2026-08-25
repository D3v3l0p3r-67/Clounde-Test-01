// Panic Mode's balance, checked as arithmetic rather than by playing it.
//
// The hand-written table this replaced was not merely hard, it was
// impossible, and it had been impossible since wave 1 -- which nobody
// noticed, because the numbers looked reasonable one wave at a time. The
// point of these tests is that the mode's playability is a property of
// the file, provable without a browser: a ball costs a known number of
// shots, a shot takes a known time, and a wave that asks for more
// shooting than there is time to do it in can only ever grow.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readJSON, readText, elements, exists } from './helpers.mjs';
import {
  checkWaves, parsePattern, patternBeats, patternBallSteps, waveWork, waveAt, bumpFor,
  shotsToClear, emergeSec, ballWork,
} from '../js/panicWaves.js';
import { ballElements, maxSizes } from '../tools/panic_waves.mjs';

const SPAWN = readJSON('levels/panic.json').panicSpawn;
const BALL = ballElements();
const MAX = maxSizes();
const steps = (wave) => parsePattern(wave.spawn, SPAWN.shapeCode, SPAWN.holdMaxSec);

test('a ball costs what the split rule says it costs', () => {
  // Every hit turns one ball into two of the next size down, so clearing
  // a size-N ball away entirely is the whole tree: 2^N - 1 shots. This is
  // the number every wave's cost is built from, so it is worth pinning
  // rather than trusting the formula to stay right.
  assert.deepEqual([1, 2, 3, 4, 5].map(shotsToClear), [1, 3, 7, 15, 31]);
});

test('a pattern says what it does', () => {
  const parsed = parsePattern('r1 . x2 |6 |', { r: 'round', x: 'hex' }, 8);
  assert.deepEqual(parsed, [
    { kind: 'ball', shape: 'round', size: 1 },
    { kind: 'rest' },
    { kind: 'ball', shape: 'hex', size: 2 },
    { kind: 'hold', maxSec: 6 },
    { kind: 'hold', maxSec: 8 }, // no number: the file's own default
  ]);
  // A hold is a condition, not a beat, and never counts towards length.
  assert.equal(patternBeats(parsed), 3);
  // A typo has to fail loudly. Silently skipping an unreadable token
  // would be a wave quietly getting easier, which nobody would notice.
  assert.throws(() => parsePattern('r1 q9', { r: 'round' }, 8), /no shape is coded "q"/);
  assert.throws(() => parsePattern('r1 nonsense', { r: 'round' }, 8), /not a ball/);
});

test('every wave can be cleared, at the tempo it ends up at', () => {
  const { problems, warnings } = checkWaves(SPAWN, BALL, MAX);
  assert.deepEqual(problems, []);
  assert.deepEqual(warnings, []);
});

test('the check is made against the floor beat, not the authored one', () => {
  // The set repeats faster each time round, so every wave eventually runs
  // at loop.minBeat -- passing at the beat a wave was written at and
  // failing three cycles later would not be passing. This is the property
  // that makes minBeat the mode's one safety number.
  const worst = SPAWN.waves
    .map((wave) => {
      const parsed = steps(wave);
      const beats = patternBeats(parsed);
      return beats ? waveWork(parsed, SPAWN.tuning) / (SPAWN.loop.minBeat * beats) : 0;
    })
    .reduce((max, p) => Math.max(max, p), 0);
  assert.ok(worst <= SPAWN.tuning.maxPressure, `hardest wave presses ${worst.toFixed(2)}`);
  // And it is worth reaching: a floor nothing comes close to would mean
  // the mode never actually gets hard.
  assert.ok(worst > SPAWN.tuning.maxPressure * 0.9,
    `the hardest wave only reaches ${worst.toFixed(2)} of a ${SPAWN.tuning.maxPressure} limit`);
});

test('the difficulty ramp actually ramps', () => {
  const pressure = (wave) => {
    const parsed = steps(wave);
    const beats = patternBeats(parsed);
    return beats ? waveWork(parsed, SPAWN.tuning) / (wave.beat * beats) : null;
  };
  const played = SPAWN.waves.map(pressure).filter((p) => p !== null);
  assert.ok(played[played.length - 1] > played[0] * 2,
    `last wave ${played[played.length - 1].toFixed(2)} against first ${played[0].toFixed(2)}`);
  // And it starts somewhere a player can breathe: the opening wave of the
  // table this replaced demanded 128% of what anyone could shoot.
  assert.ok(played[0] <= 0.35, `the opening wave claims ${(played[0] * 100).toFixed(0)}% already`);
});

test('no ball is still coming through the ceiling when the next one starts', () => {
  // A ball creeps through the border at ceilingSpeedPx and has to travel
  // its own diameter before any of it is loose. What matters is the gap
  // between CONSECUTIVE BALLS, not the beat: on a fine grid most beats
  // are rests, and comparing one beat to an emergence would say nothing
  // about what actually happens in the pattern.
  for (const wave of SPAWN.waves) {
    let last = null;
    steps(wave).forEach((step, at) => {
      if (step.kind !== 'ball') return;
      const el = BALL(step.shape, step.size);
      assert.ok(el, `no ${step.shape} ball of size ${step.size}`);
      if (last) {
        const gap = (at - last.at) * SPAWN.loop.minBeat;
        const needs = emergeSec(last.radius, SPAWN.ceilingSpeedPx);
        assert.ok(gap >= needs,
          `"${wave.spawn}": two balls ${gap.toFixed(1)}s apart at the floor beat,`
          + ` but the first needs ${needs.toFixed(1)}s to get through the ceiling`);
      }
      last = { at, radius: el.radius };
    });
  }
});

test('the run never runs out of waves', () => {
  // The counter does not stop at the end of the authored set, so waveAt
  // has to answer for any number at all -- and answer faster each time
  // round, down to the floor.
  const n = SPAWN.waves.length;
  assert.equal(waveAt(0, SPAWN, MAX).cycle, 0);
  assert.equal(waveAt(n, SPAWN, MAX).cycle, 1);
  // A later cycle is not the same wave again: the balls get bigger and
  // fewer, which is the only escalation left once the tempo has nothing
  // to give. Wave 100 used to be wave 4 with size-1 balls.
  const late = waveAt(n * 8 + 2, SPAWN, MAX);
  const early = waveAt(2, SPAWN, MAX);
  const size = (w) => Math.max(...w.steps.filter((s) => s.kind === 'ball').map((s) => s.size));
  assert.ok(size(late) > size(early), 'a later cycle has to bring bigger balls');
  assert.equal(bumpFor(999, SPAWN.loop), SPAWN.loop.maxSizeBump, 'the bump has to stop somewhere');
});

test('the game walks the pattern, and nothing still counts pops', () => {
  const scene = readText('js/GameScene.js');
  assert.match(scene, /waveAt\(this\.panicWaveIndex, spawn/, 'GameScene must resolve waves through the model');
  assert.match(scene, /nextPanicStep\(\)/, 'and step through the pattern');
  assert.match(scene, /panicHoldLeft/, 'and hold where a pattern says to');
  // popTarget/intervalSec/restEveryWaves were the old model's, and a
  // leftover reader would silently read undefined.
  for (const gone of ['popTarget', 'intervalSec', 'panicPopCount', 'restEveryWaves', 'panicRestLeft']) {
    assert.doesNotMatch(scene, new RegExp(gone), `GameScene still mentions ${gone}`);
  }
});

// A run of the mode, stepped exactly as GameScene steps it, against a
// player who clears `rate` seconds of shooting per second. 1.0 is the
// player the cost model assumes.
//
// This exists because rest-skipping took the safety property out of
// reach of arithmetic alone. With rests skippable the mode is a feedback
// loop: while the player is behind, the rests play and the wave runs at
// its authored pressure (under the limit, so the backlog drains); while
// they are ahead, the rests vanish and it runs at the pressure of its
// ball steps alone (over 1, so the backlog grows). It settles around the
// skip threshold, and it can only settle because the AUTHORED pressure
// is under 1 -- which is the thing checkWaves checks. This is the test
// that the loop really does settle.
function simulate(spawn, rate, waves) {
  const MIN_GAP = 0.6;
  const dt = 1 / 60;
  let t = 0, waveIndex = 0, step = -1, endsAt = spawn.initialDelaySec, startedAt = 0, hold = 0;
  let cache = null, owed = 0, peak = 0;
  const wave = () => {
    if (cache?.index !== waveIndex) cache = { index: waveIndex, ...waveAt(waveIndex, spawn, MAX) };
    return cache;
  };
  const clear = () => owed <= spawn.skipRestUnderSec;
  const next = () => {
    step += 1;
    if (step >= wave().steps.length) { waveIndex += 1; step = 0; }
    const w = wave(), s = w.steps[step];
    startedAt = t;
    if (s.kind === 'hold') { hold = s.maxSec; endsAt = Infinity; return; }
    if (s.kind === 'ball') owed += ballWork(s.shape, s.size, spawn.tuning);
    endsAt = t + w.beat;
  };
  while (waveIndex < waves && t < 40000) {
    t += dt;
    owed = Math.max(0, owed - dt * rate);
    peak = Math.max(peak, owed);
    if (hold > 0) { hold -= dt; if (!(hold > 0 && !clear())) { hold = 0; next(); } }
    else if (wave().steps[step]?.kind === 'rest' && clear() && t >= startedAt + MIN_GAP) next();
    else if (t >= endsAt) next();
  }
  return { minutes: t / 60, peak, finished: waveIndex >= waves };
}

test('skipping rests cannot run away with the field', () => {
  // Three cycles of the set, for players from below the model's
  // assumption to far above it. What must hold is that the backlog stays
  // BOUNDED -- if skipping could outpace recovery, a better player would
  // be buried by their own speed, which would be an absurd mode.
  // Far enough to pass through every size bump, since that is where one
  // ball stops being a small debt: a size-5 is the whole split tree at
  // once. The bound is therefore not a round number but the most that CAN
  // be owed -- a field at the skip threshold plus one biggest ball -- with
  // a little slack for the frame the two overlap on.
  const cycles = Math.ceil(SPAWN.loop.maxSizeBump / SPAWN.loop.sizeBumpPerCycle) + 2;
  const biggest = Math.max(...SPAWN.waves.flatMap((w) => steps(w)
    .filter((s) => s.kind === 'ball')
    .map((s) => ballWork(s.shape, Math.min(s.size + SPAWN.loop.maxSizeBump, MAX[s.shape]), SPAWN.tuning))));
  for (const rate of [0.7, 1, 1.5, 3]) {
    const run = simulate(SPAWN, rate, SPAWN.waves.length * cycles);
    assert.ok(run.finished, `a player clearing ${rate}x never got through ${cycles} cycles`);
    assert.ok(run.peak < SPAWN.skipRestUnderSec + biggest * 1.5,
      `a player clearing ${rate}x fell ${run.peak.toFixed(1)}s behind, past the`
      + ` ${(SPAWN.skipRestUnderSec + biggest * 1.5).toFixed(1)}s one big ball can explain`);
  }
});

test('the authored pattern is what makes recovery possible', () => {
  // The ball steps alone -- every rest skipped -- run OVER the limit, and
  // that is fine: reaching that state means the field is clear, i.e. the
  // player is ahead. What matters is that the pattern they fall back to
  // when they are not ahead can dig them out again, which is the
  // maxPressure check. If the authored pressure were also over 1 there
  // would be no way back and the mode would be the old broken one.
  for (const wave of SPAWN.waves) {
    const parsed = steps(wave);
    const beats = patternBeats(parsed);
    if (!beats) continue;
    const work = waveWork(parsed, SPAWN.tuning);
    assert.ok(work / (SPAWN.loop.minBeat * beats) < 1,
      `wave with pattern "${wave.spawn}" cannot recover at the floor beat`);
    assert.ok(patternBallSteps(parsed) < beats,
      `pattern "${wave.spawn}" is all balls -- it has no rests to fall back on`);
  }
});

test('a long run reaches the biggest balls the game has', () => {
  // The complaint this answers: standing on wave 100 and still being sent
  // size-1 balls. The set loops, so without escalation wave 100 is
  // whichever early wave it lands on, forever.
  const biggest = Math.max(...Object.values(MAX));
  const at100 = waveAt(99, SPAWN, MAX);
  const sizes = at100.steps.filter((s) => s.kind === 'ball').map((s) => s.size);
  assert.ok(sizes.length, 'wave 100 has to send something');
  assert.equal(Math.max(...sizes), biggest,
    `wave 100 tops out at size ${Math.max(...sizes)} of a possible ${biggest}`);
});

test('no cycle turns a wave into something nobody would sit through', () => {
  // Bigger balls have to arrive less often to stay clearable, so a bump
  // pushes the beat back up -- far enough and a wave becomes a crawl with
  // one ball in it. loop.maxWaveSec is where that stops being acceptable.
  const cycles = Math.ceil(SPAWN.loop.maxSizeBump / SPAWN.loop.sizeBumpPerCycle) + 1;
  for (let cycle = 0; cycle <= cycles; cycle++) {
    for (let i = 0; i < SPAWN.waves.length; i++) {
      const w = waveAt(cycle * SPAWN.waves.length + i, SPAWN, MAX);
      const beats = patternBeats(w.steps);
      if (!beats) continue;
      assert.ok(w.beat * beats <= SPAWN.loop.maxWaveSec,
        `wave ${i + 1} on cycle ${cycle} lasts ${Math.round(w.beat * beats)}s`);
    }
  }
});

test('Panic Mode is red balls only', () => {
  // One shape, so the difficulty ramp has to be carried by size and
  // density -- there is no weaving or hunting variant to lean on.
  assert.deepEqual(Object.values(SPAWN.shapeCode), ['round']);
  for (const wave of SPAWN.waves) {
    for (const step of steps(wave)) {
      if (step.kind === 'ball') assert.equal(step.shape, 'round', `"${wave.spawn}" is not all round`);
    }
  }
});

test('the harpoon there carries a second shot for the whole run', () => {
  const level = readJSON('levels/panic.json');
  assert.equal(level.weapon, 'harpoon');
  assert.ok(level.weaponBonusShots >= 1, 'Panic Mode is played with a rapid harpoon');
  assert.match(readText('js/GameScene.js'), /weaponBonusShots/,
    'nothing reads weaponBonusShots, so the level would quietly get the plain harpoon');
});

test('nothing that touches the weapon drops there', () => {
  // rapid_shot is excluded because the harpoon already carries its extra
  // shot. Before that, picking one up did nothing for twelve seconds and
  // then took the level's bonus away for the rest of the run -- which is
  // fixed underneath (baseMaxActiveShots counts the level's bonus, so
  // apply and revert both land on the right number), so this is now a
  // design choice rather than a workaround.
  const level = readJSON('levels/panic.json');
  assert.ok(level.excludePowerupKinds?.includes('weapon_max_shots'));
  assert.match(readText('js/GameScene.js'),
    /baseMaxActiveShots[\s\S]{0,400}weaponBonusShots/,
    'baseMaxActiveShots must count the level bonus, or reverting a weapon power-up steals it');
});

test('no other weapon can fall out of a ball there', () => {
  // Excluded by KIND, not by name, so a fourth weapon power-up is ruled
  // out the day it is added rather than the day someone remembers.
  const level = readJSON('levels/panic.json');
  assert.ok(level.excludePowerupKinds?.includes('give_weapon'));
  const weapons = elements().powerups.filter((el) => el.kind === 'give_weapon');
  assert.ok(weapons.length >= 2, 'there should be weapon power-ups for this to exclude');
  // And everything else still drops: the mode is meant to hand out
  // shields, clocks and dynamite as usual.
  const rest = elements().powerups.filter((el) => !level.excludePowerupKinds.includes(el.kind));
  assert.ok(rest.length >= 6, `only ${rest.length} power-ups would be left to drop`);
  const scene = readText('js/GameScene.js');
  assert.match(scene, /excludePowerupKinds/, 'nothing reads the exclusion');
  assert.match(scene, /dropPowerupTypes\(\)/, 'the drop roll has to go through the filtered pool');
});

test('its pause screen offers two things and nothing else', () => {
  // True of every run now, not just Panic Mode: pausing is carry on or
  // leave. Only a level opened from the editor keeps more, because
  // "restart this one" and "back to editing" are somewhere to go.
  const ui = readText('js/ui.js');
  const from = ui.indexOf('if (state === GAME_STATES.PAUSED)');
  const paused = ui.slice(from, ui.indexOf('GAME_STATES.GAME_OVER', from));
  assert.ok(from > 0 && paused.length > 200, 'could not find the pause branch to check');
  for (const id of ['btn-pause-restart', 'btn-pause-editor']) {
    assert.match(paused, new RegExp(`'${id}'[\\s\\S]{0,160}isCustomLevel`),
      `${id} is no longer gated on the editor`);
  }
  // The Fullscreen button is gone from that screen for good -- a settings
  // toggle is not a move, and leaving dead markup around invites it back.
  assert.doesNotMatch(readText('index.html'), /btn-fullscreen-pause/);
  assert.doesNotMatch(ui, /btn-fullscreen-pause/);
});

test('negative power-ups: flags, refresh-not-stack, and clean revert', () => {
  // The three negatives ride the exact machinery every helpful power-up
  // uses -- registerElement + EffectManager -- so this drives that
  // machinery with a stub game and checks the CONTRACT the pickups
  // promise: the flag goes up on apply, re-applying while active
  // refreshes the one expiry instead of stacking a second effect, and
  // expiry reverts the flag.
  const negatives = elements().powerups.filter((el) => el.negative === true);
  assert.deepEqual(negatives.map((el) => el.type).sort(),
    ['disable_shooting', 'freeze_player', 'reverse_controls']);
  for (const el of negatives) {
    assert.ok(el.durationMs > 0, `${el.type} must run on a clock`);
    assert.equal(el.instant, false, `${el.type} cannot be instant -- there would be nothing to suffer`);
  }
  // Freeze is the harshest, so it must be the shortest -- the durations
  // themselves live in the element files, configurable, not here.
  const byType = Object.fromEntries(negatives.map((el) => [el.type, el.durationMs]));
  assert.ok(byType.freeze_player < byType.disable_shooting, 'freeze must be shorter than disable');
  assert.ok(byType.freeze_player < byType.reverse_controls, 'freeze must be shorter than reverse');

  // Icons exist in both skins (the black ring itself is looked at in the
  // tools, not measurable here).
  for (const el of negatives) {
    assert.ok(exists(`assets/powerups/${el.type}.webp`), `${el.type}: no base icon`);
    assert.ok(exists(`skins/sleek/assets/powerups/${el.type}.webp`), `${el.type}: no sleek icon`);
  }

  // And the game actually reads the flags at the one merged input point.
  const scene = readText('js/GameScene.js');
  for (const flag of ['playerFrozen', 'controlsReversed', 'shootingDisabled']) {
    assert.match(scene, new RegExp(`this\\.${flag}`), `nothing in GameScene reads ${flag}`);
  }
});
