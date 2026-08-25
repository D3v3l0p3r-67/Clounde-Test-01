// Writes sw-precache.json: every file the service worker takes into its
// cache so the game can be started and played with no network, each with
// a hash of its contents (see service-worker.js, which fetches this on
// install and copies the unchanged ones straight out of the previous
// cache rather than downloading the whole game again).
//
//     node tools/build_precache.mjs
//
// Run it whenever a file is added, renamed or removed from the game --
// the same moment you would bump the cache version in service-worker.js.
// tests/pwa.test.mjs fails if the list and the folder have drifted apart,
// so a forgotten run is caught before it becomes a game that only half
// works offline.
//
// Everything the browser fetches at runtime is included and nothing else:
// the admin site is PHP (it cannot work offline and does not belong to
// the game), and the tests, the tools and the docs are never fetched by
// anything. Music is in the list like every other sound -- it is the bulk
// of the download, but a game that goes quiet when the network does is
// not really working offline.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'sw-precache.json');
const WORKER = join(ROOT, 'service-worker.js');

// Files at the root of the game, and the folders it loads everything else
// from. Order matters only in that the shell comes first -- the service
// worker treats the first entries as the ones that MUST cache.
const ROOT_FILES = ['index.html', 'style.css', 'manifest.webmanifest', 'favicon.ico'];
const DIRS = ['js', 'assets', 'levels', 'elements', 'skins'];

// Never cached, wherever they turn up: editor/OS leftovers and source
// maps, none of which the game asks for.
const SKIP = /(^\.|\.map$|~$|\.DS_Store$)/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir)).sort()) {
    if (SKIP.test(entry)) continue;
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

const files = [...ROOT_FILES, ...DIRS.flatMap((dir) => walk(dir))]
  // Relative, with no leading slash: the game has to work from a
  // subdirectory (GitHub Pages project sites serve it from /<repo>/), so
  // every path here is resolved against the service worker's own scope.
  .map((path) => path.split(sep).join('/'));

// Per file, a hash of its contents. The worker diffs this against the
// manifest of the cache it is replacing: a release that changes one
// sprite then costs one sprite to install, not the whole 7MB game --
// which matters on the phone this is meant to be installed on.
const fileHashes = {};
for (const path of files) {
  fileHashes[path] = createHash('sha256').update(readFileSync(join(ROOT, path))).digest('hex').slice(0, 16);
}

// The cache is named after what is IN it: a hash over every precached
// file's contents, written into the worker itself. Two things follow, and
// both are the point.
//
// The old cache is dropped whenever any file changes. A service worker
// serves its cache first -- that is what makes the game work offline --
// so a version that only moves when someone remembers to bump it means
// players keep whatever they downloaded the first time. That is not
// hypothetical: the player sprite was redrawn three times over before
// anyone noticed the game was still handing out the first one.
//
// And the worker's own bytes change with it, which is what makes a
// browser notice at all: it re-fetches service-worker.js and only
// installs it if it differs from the copy it is running.
const hash = createHash('sha256');
for (const path of files) hash.update(path).update(fileHashes[path]);
const version = `super-pang-${hash.digest('hex').slice(0, 12)}`;

writeFileSync(OUT, `${JSON.stringify({ version, files: fileHashes }, null, 2)}\n`);

const worker = readFileSync(WORKER, 'utf8');
const updated = worker.replace(/const CACHE_VERSION = '[^']*';/, `const CACHE_VERSION = '${version}';`);
if (!updated.includes(`'${version}'`)) throw new Error('service-worker.js has no CACHE_VERSION line to write');
writeFileSync(WORKER, updated);

console.log(`${relative(ROOT, OUT)}: ${files.length} files`);
console.log(`${relative(ROOT, WORKER)}: ${version}`);
