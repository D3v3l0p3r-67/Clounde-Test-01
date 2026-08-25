// Panic Mode's waves: what they are made of, how long they take, and
// whether they can be cleared.
//
// This is the whole model, and it lives here rather than in a build tool
// because three different things need it and none of them may disagree
// about it: GameScene runs the waves, tools/panic_waves.mjs checks and
// converts them, and the tests re-check what shipped. No Node imports,
// no Phaser -- a browser, a build script and a test runner can all load
// it.
//
// A WAVE IS A RHYTHM
//
// Each wave is a beat length and a pattern of tokens, one token per
// beat, which reads as what it does:
//
//   { "beat": 3, "spawn": "r1 . r1 . x2 . h1 . |8" }
//
//   r1     drop a round ball of size 1, then wait one beat
//   .      wait one beat, dropping nothing
//   |8     HOLD here while the field still has balls on it, up to 8s
//
// A PATTERN IS THE SLOWEST THE WAVE CAN GO
//
// Waiting on an empty field is the least interesting thing this mode can
// ask of anyone, so it does not: a rest is skipped, and a hold released,
// once the field holds less than `skipRestUnderSec` of shooting -- the
// same measure the patterns themselves are costed in, so "nearly clear"
// means one straggler rather than a ball count.
//
// That is a rule about the FIELD, not about where a token sits, which is
// what keeps the notation readable: `.` still means the same thing
// everywhere, and what a pattern describes is the wave at its slowest.
//
// It cannot run away with itself either, and the reason is worth
// stating: skipping is only possible while the player is ahead, and it
// stops the instant they are not. A wave cannot compress itself into
// something its player was not already clearing.
//
// Ball tokens and rests both take exactly one beat -- that is what makes
// the pattern a grid you can read down a column of. A hold is not a beat
// at all: it is a condition, it takes zero time on a field that is
// already clear, and it never counts towards the wave's length.
//
// WHY A HOLD IS A SEPARATE TOKEN
//
// The trailing silence of a wave exists so the player can finish what is
// on the field. Making `.` mean "a beat, unless the field is empty, in
// which case skip it" would have been the obvious shortcut and it would
// have ruined the notation: a symbol whose meaning depends on where it
// sits cannot be read. So the two are separate, and what a pattern says
// is what happens.
//
// The hold's cap is not a nicety. A field nobody can clear would
// otherwise stop the mode dead, which is the same reason the rest that
// came before this had a maximum.
//
// WHAT IT COSTS, AND WHY THAT IS CHECKABLE
//
// Every hit replaces one ball with two of the next size down, so taking
// a ball off the field entirely is the whole tree beneath it: 2^N - 1
// shots. At `shotTimeSec` a shot, a wave's pattern costs a known number
// of seconds of shooting, and it hands them over across a known number
// of beats:
//
//   pressure = work / (beat * beats in the pattern)
//
// which is the share of the player's shooting time the ceiling claims.
// At 1.0 they must land every shot, forever, and never move. Everything
// below 1.0 is what is left for dodging, missing, and walking somewhere.
//
// Holds are left out of that denominator ON PURPOSE. A hold can only
// ever give the player more time, so counting it would make the check
// optimistic -- and a check you only pass because the player was
// struggling is not a check. The same goes for the seconds a ball spends
// squeezing through the ceiling: it delays the threat, so it is slack,
// and slack is not counted.

// Shots to clear a ball of this size away entirely -- the whole split
// tree, not the one hit that is being aimed right now.
export const shotsToClear = (size) => 2 ** size - 1;

// How long a ball of this radius takes to come the whole way through the
// ceiling, creeping at `ceilingSpeedPx` (see GameScene.spawnPanicBall).
// It has to travel its own diameter before any of it is loose.
export const emergeSec = (radius, ceilingSpeedPx) => (radius * 2) / ceilingSpeedPx;

const BALL_TOKEN = /^([a-z])([1-9])$/;
const HOLD_TOKEN = /^\|(\d+(?:\.\d+)?)?$/;

// A pattern string into the steps it means. Throws on a token it cannot
// read rather than skipping it: a typo that silently dropped a ball
// would be a wave quietly getting easier, which is exactly the kind of
// thing nobody notices.
export function parsePattern(spawn, shapeCode, holdMaxSec) {
  return String(spawn).trim().split(/\s+/).filter(Boolean).map((token) => {
    if (token === '.') return { kind: 'rest' };
    const hold = HOLD_TOKEN.exec(token);
    if (hold) return { kind: 'hold', maxSec: hold[1] === undefined ? holdMaxSec : Number(hold[1]) };
    const ball = BALL_TOKEN.exec(token);
    if (!ball) throw new Error(`"${token}" is not a ball, a rest (.) or a hold (|)`);
    const shape = shapeCode[ball[1]];
    if (!shape) throw new Error(`"${token}": no shape is coded "${ball[1]}"`);
    return { kind: 'ball', shape, size: Number(ball[2]) };
  });
}

// The steps that take a beat each. A hold is not one of them.
export const patternBeats = (steps) => steps.filter((s) => s.kind !== 'hold').length;

// Seconds of shooting one ball is worth: its whole split tree, at the
// working average, weighted by how hard that shape is to actually hit.
// The game measures the LIVE field with this too (see
// GameScene.fieldWork), which is what lets it tell "nearly clear" from
// "there is still a size-2 up there".
export function ballWork(shape, size, tuning) {
  return shotsToClear(size) * tuning.shotTimeSec * (tuning.shapeEffort[shape] ?? 1);
}

// Seconds of shooting the whole pattern asks for.
export function waveWork(steps, tuning) {
  return steps.reduce((sum, step) => (
    step.kind === 'ball' ? sum + ballWork(step.shape, step.size, tuning) : sum
  ), 0);
}

// The beats a pattern would take if every rest it can skip WERE skipped
// -- see the note on skipping in checkWaves. Ball steps always take
// their beat; rests only take one when there is something left to rest
// for.
export const patternBallSteps = (steps) => steps.filter((s) => s.kind === 'ball').length;

// How many sizes bigger the balls are on the `cycle`-th time round the
// set.
//
// Tempo alone is not a difficulty curve. The set used to repeat with only
// the beat tightening, which meant wave 100 was wave 4 again -- same
// size-1 balls, just sooner -- and the biggest balls in the game never
// appeared at all. Escalating the SIZE is the axis pressure cannot see: a
// wave that hands over its work as one size-5 ball is far harder to
// survive than one that hands over the same work as thirty-one size-1s,
// because the big one fills the screen with fragments at once while the
// small ones queue up.
export function bumpFor(cycle, loop) {
  return Math.min(loop.maxSizeBump ?? 0, Math.floor(cycle * (loop.sizeBumpPerCycle ?? 1)));
}

// The same pattern with bigger balls and fewer of them.
//
// Fewer is not a nicety, it is what keeps the wave affordable: one size
// up is a little over twice the shots, so the balls have to thin at about
// the same rate or the wave becomes an hour of shooting. Every second
// ball per size step, and what is dropped becomes a REST rather than
// disappearing -- the pattern keeps its length and its shape, and simply
// breathes more between bigger threats.
//
// `maxSize` is the largest size each shape actually has an element for
// (hex stops at 3), so a bump can never name a ball that does not exist.
function escalate(steps, bump, maxSize) {
  if (!bump) return steps;
  const keepEvery = 2 ** bump;
  let nth = -1;
  return steps.map((step) => {
    if (step.kind !== 'ball') return step;
    nth += 1;
    if (nth % keepEvery !== 0) return { kind: 'rest' };
    return { ...step, size: Math.min(step.size + bump, maxSize[step.shape] ?? step.size) };
  });
}

// Any wave number at all, however far past the authored set it is: the
// counter does not stop (see GameScene.nextPanicStep), so this cannot
// either.
//
// The beat is the LONGEST of three things, and the third is what makes
// the mode safe by construction rather than by inspection:
//
//   * the grid floor, minBeat
//   * the authored beat, tightened by beatScale once per cycle
//   * whatever the wave's own work needs to stay under maxPressure
//
// So tempo tightens while there is room, and the moment a size bump makes
// the wave cost more, the beat opens back up to pay for it. Bigger balls
// arriving less often is not a compromise here, it is the only shape the
// arithmetic allows.
export function waveAt(index, spawn, maxSize = {}) {
  const { waves, loop, tuning } = spawn;
  const cycle = Math.floor(index / waves.length);
  const wave = waves[index % waves.length];
  const bump = bumpFor(cycle, loop);
  const steps = escalate(parsePattern(wave.spawn, spawn.shapeCode, spawn.holdMaxSec), bump, maxSize);
  const beats = patternBeats(steps);
  const beat = Math.max(
    loop.minBeat,
    wave.beat * loop.beatScale ** cycle,
    beats ? waveWork(steps, tuning) / (tuning.maxPressure * beats) : 0,
  );
  return { steps, beat, cycle, bump };
}

// Everything a wave table has to be true of. Returns problems (a mode
// that cannot be played) and warnings (a mode that plays differently
// from how it reads) separately, because only one of the two should stop
// a build.
//
// `ball(shape, size)` gives the element behind a token, or null.
export function checkWaves(spawn, ball, maxSize = {}) {
  const problems = [];
  const warnings = [];
  const { tuning, loop } = spawn;

  spawn.waves.forEach((wave, i) => {
    const where = `wave ${i + 1}`;
    let steps;
    try {
      steps = parsePattern(wave.spawn, spawn.shapeCode, spawn.holdMaxSec);
    } catch (err) {
      problems.push(`${where}: ${err.message}`);
      return;
    }
    const beats = patternBeats(steps);
    if (beats === 0) {
      // A wave of nothing but holds never ends: no beats means no time
      // passing, and the wave only moves on when its pattern is spent.
      if (!steps.some((s) => s.kind === 'hold')) problems.push(`${where}: has no steps at all`);
      else if (steps.length !== 1) problems.push(`${where}: holds only -- a breather is one hold, not several`);
      return;
    }

    // The tightest a ball is ever followed by another one, in seconds at
    // the floor beat -- measured between CONSECUTIVE BALL STEPS rather
    // than against the beat itself. On a fine grid most beats are rests,
    // so comparing a ball's emergence to one beat would flag every
    // pattern in the file while saying nothing about what actually
    // happens in it.
    let tightest = Infinity;
    let lastBall = null;
    steps.forEach((step, at) => {
      if (step.kind !== 'ball') return;
      const el = ball(step.shape, step.size);
      if (!el) {
        problems.push(`${where}: there is no ${step.shape} ball of size ${step.size}`);
        return;
      }
      if (lastBall) {
        const gap = (at - lastBall.at) * loop.minBeat;
        tightest = Math.min(tightest, gap - emergeSec(lastBall.radius, spawn.ceilingSpeedPx));
      }
      lastBall = { at, radius: el.radius };
    });

    // Checked at the floor beat, not the authored one: every wave ends up
    // there, so that is the case that has to hold. Passing at the beat it
    // was written at and failing three cycles later is not passing.
    const work = waveWork(steps, tuning);
    const pressure = work / (loop.minBeat * beats);
    if (pressure > tuning.maxPressure) {
      problems.push(`${where}: at the ${loop.minBeat}s floor beat its pressure is ${pressure.toFixed(2)},`
        + ` over the ${tuning.maxPressure} limit -- ${work.toFixed(1)}s of shooting handed over in`
        + ` ${(loop.minBeat * beats).toFixed(1)}s, so the field can only grow`);
    }

    // A ball still coming through the ceiling when the next one starts:
    // the ceiling extrudes a stream rather than dropping things. Legible
    // rather than broken, hence a warning.
    if (tightest < 0) {
      warnings.push(`${where}: two balls land ${Math.abs(tightest).toFixed(1)}s closer than the first one`
        + ` takes to come through the ceiling, once the beat is at its ${loop.minBeat}s floor`);
    }
    if (steps[steps.length - 1].kind !== 'hold') {
      // The last ball of a pattern is still emerging when the beats run
      // out, so without a hold the next wave starts on top of it.
      warnings.push(`${where}: ends on a ${steps[steps.length - 1].kind} rather than a hold,`
        + ' so the next wave starts while its last ball is still coming through');
    }
  });

  // Every cycle the set escalates through, not just the one it was
  // written at. A bump changes the balls, so it changes the emergence
  // gaps and the beat -- and a wave that is fine as authored can still
  // turn into a five-minute crawl three bumps later.
  const lastCycle = Math.ceil((loop.maxSizeBump ?? 0) / (loop.sizeBumpPerCycle ?? 1));
  for (let cycle = 0; cycle <= lastCycle; cycle++) {
    spawn.waves.forEach((_, i) => {
      const at = cycle * spawn.waves.length + i;
      let resolved;
      try {
        resolved = waveAt(at, spawn, maxSize);
      } catch {
        return; // the pattern itself already failed above
      }
      const beats = patternBeats(resolved.steps);
      if (!beats) return;
      const where = `wave ${i + 1} on cycle ${cycle}`;
      const pressure = waveWork(resolved.steps, tuning) / (resolved.beat * beats);
      if (pressure > tuning.maxPressure + 1e-9) {
        problems.push(`${where}: pressure ${pressure.toFixed(2)} is over the ${tuning.maxPressure} limit`);
      }
      // A wave nobody would sit through is as broken as one nobody can
      // clear, it just fails in the other direction.
      const seconds = resolved.beat * beats;
      if (seconds > (loop.maxWaveSec ?? Infinity)) {
        problems.push(`${where}: lasts ${Math.round(seconds)}s, past the ${loop.maxWaveSec}s a wave may take`
          + ` -- its balls got big enough that paying for them takes all day`);
      }
      let last = null;
      resolved.steps.forEach((step, at2) => {
        if (step.kind !== 'ball') return;
        const el = ball(step.shape, step.size);
        if (!el) { problems.push(`${where}: there is no ${step.shape} ball of size ${step.size}`); return; }
        if (last) {
          const gap = (at2 - last.at) * resolved.beat - emergeSec(last.radius, spawn.ceilingSpeedPx);
          if (gap < 0) {
            warnings.push(`${where}: two balls land ${Math.abs(gap).toFixed(1)}s closer than the first`
              + ' takes to come through the ceiling');
          }
        }
        last = { at: at2, radius: el.radius };
      });
    });
  }

  if (!(loop.beatScale > 0 && loop.beatScale <= 1)) {
    problems.push(`loop.beatScale ${loop.beatScale} must be over 0 and at most 1 -- above 1 would slow down`);
  }
  if (!(tuning.maxPressure < 1)) {
    problems.push('tuning.maxPressure of 1 or more is a mode that cannot be cleared by definition');
  }
  return { problems, warnings };
}
