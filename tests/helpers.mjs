// Shared helpers: where the project's files are, and how to read them.
// Deliberately plain Node -- no test framework, no build step, no
// node_modules. The game itself has no dependencies and neither does its
// test suite (see tests/README.md).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function readJSON(relativePath) {
  return JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8'));
}

export function exists(relativePath) {
  return existsSync(join(ROOT, relativePath));
}

export function readText(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

export function listFiles(relativeDir) {
  return readdirSync(join(ROOT, relativeDir));
}

// A PNG says its own size in the IHDR chunk, which is always the first
// one: 8 bytes of signature, 8 of chunk header, then width and height as
// big-endian 32-bit integers. Cheaper (and dependency-free) than decoding
// the image to ask how big it is.
export function pngSize(relativePath) {
  const buffer = readFileSync(join(ROOT, relativePath));
  if (buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error(`${relativePath}: not a PNG`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// PNG or WebP, whichever the file actually is -- the skin tests compare
// an override's pixel size against its base file, and the game's art is
// mostly WebP. Covers all three WebP layouts: lossy (VP8), lossless
// (VP8L, which PIL writes for the generated skins) and extended (VP8X).
export function imageSize(relativePath) {
  const buffer = readFileSync(join(ROOT, relativePath));
  if (buffer.toString('ascii', 1, 4) === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error(`${relativePath}: neither PNG nor WebP`);
  }
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const b = buffer.subarray(21, 25);
    return {
      width: 1 + (b[0] | ((b[1] & 0x3f) << 8)),
      height: 1 + ((b[1] >> 6) | (b[2] << 2) | ((b[3] & 0x0f) << 10)),
    };
  }
  if (chunk === 'VP8X') {
    const w = buffer[24] | (buffer[25] << 8) | (buffer[26] << 16);
    const h = buffer[27] | (buffer[28] << 8) | (buffer[29] << 16);
    return { width: w + 1, height: h + 1 };
  }
  throw new Error(`${relativePath}: unknown WebP layout "${chunk}"`);
}

// Every levels/level_NN.json, in order, with the number the filename
// claims -- which several rules below check the contents against.
export function levelFiles() {
  return listFiles('levels')
    .filter((name) => /^level_\d{2}\.json$/.test(name))
    .sort()
    .map((name) => ({
      name,
      number: Number(name.slice('level_'.length, -'.json'.length)),
      def: readJSON(`levels/${name}`),
    }));
}

// The 16px cells an obstacle covers, exactly the way LevelManager builds
// it: a plain { x, y, w, h } tiles into whole blocks, and a stepped shape
// lists its own blocks as [dx, dy] offsets instead.
export function obstacleCells(o, blockSize) {
  if (o.cells) return o.cells.map(([dx, dy]) => [o.x + dx, o.y + dy]);
  const cells = [];
  for (let dy = 0; dy < o.h; dy += blockSize) {
    for (let dx = 0; dx < o.w; dx += blockSize) cells.push([o.x + dx, o.y + dy]);
  }
  return cells;
}

// The element registry as the game builds it at boot (see js/elements.js),
// flattened by category so the level rules can ask "is this a real ball
// shape/size?" the same way the game would.
export function elements() {
  const all = readJSON('elements/index.json').map((id) => readJSON(`elements/${id}.json`));
  return {
    all,
    balls: all.filter((el) => el.category === 'ball'),
    obstacles: all.filter((el) => el.category === 'obstacle'),
    ladders: all.filter((el) => el.category === 'ladder'),
    powerups: all.filter((el) => el.category === 'powerup'),
  };
}
