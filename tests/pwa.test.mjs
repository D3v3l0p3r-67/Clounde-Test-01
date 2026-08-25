// The installable-app side of the game: the manifest a phone reads, the
// icons it shows, the tags in the HTML that iOS reads instead, and the
// list of files the service worker takes offline. All of it is static
// text and image headers, so all of it can be checked without a browser
// -- and all of it fails in exactly the way that is hardest to notice by
// playing the game, since the game itself runs perfectly with a broken
// manifest, a missing icon or a stale precache list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readJSON, readText, exists, listFiles, pngSize } from './helpers.mjs';

const MANIFEST = readJSON('manifest.webmanifest');
const HTML = readText('index.html');
const SW = readText('service-worker.js');
const PRECACHE = readJSON('sw-precache.json');
const PRECACHE_PATHS = Object.keys(PRECACHE.files);

test('the manifest says what an installed game needs to know', () => {
  assert.ok(MANIFEST.name && MANIFEST.short_name, 'needs both a name and a short_name');
  assert.ok(MANIFEST.short_name.length <= 12, 'short_name is what fits under a home-screen icon');
  assert.ok(MANIFEST.description, 'needs a description');
  // Relative, not "/": a GitHub Pages project site serves the game from
  // /<repo>/, and an absolute start_url would launch the domain root.
  assert.equal(MANIFEST.start_url, './');
  assert.equal(MANIFEST.scope, './');
  assert.equal(MANIFEST.display, 'fullscreen', 'the point of installing is losing the browser chrome');
  assert.equal(MANIFEST.orientation, 'landscape', 'the playfield is wider than it is tall');
  for (const key of ['theme_color', 'background_color']) {
    assert.match(MANIFEST[key], /^#[0-9a-f]{6}$/i, `${key} must be a hex colour`);
  }
});

test('every icon the manifest promises is there, and is the size it claims', () => {
  const purposes = new Map();
  for (const icon of MANIFEST.icons) {
    assert.ok(!icon.src.startsWith('/') && !icon.src.startsWith('http'),
      `icon "${icon.src}": must be relative, so a subdirectory install still finds it`);
    assert.ok(exists(icon.src), `icon "${icon.src}" has no file`);
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.deepEqual(pngSize(icon.src), { width, height }, `icon "${icon.src}": not ${icon.sizes}`);
    purposes.set(`${icon.purpose}-${icon.sizes}`, icon.src);
  }
  // Android crops a maskable icon to the launcher's own shape, and shows
  // a plain one uncropped -- a set with only one kind is wrong on half
  // the devices.
  for (const size of ['192x192', '512x512']) {
    assert.ok(purposes.has(`any-${size}`), `no plain ${size} icon`);
    assert.ok(purposes.has(`maskable-${size}`), `no maskable ${size} icon`);
  }
});

test('the icons the HTML asks for directly are there too', () => {
  assert.deepEqual(pngSize('assets/icons/apple-touch-icon.png'), { width: 180, height: 180 });
  assert.ok(exists('favicon.ico'), 'favicon.ico is requested by browsers whether it is linked or not');
});

test('index.html carries the tags that make it installable', () => {
  const required = [
    [/<link[^>]+rel="manifest"[^>]+href="manifest\.webmanifest"/, 'a link to the manifest'],
    [/<meta[^>]+name="theme-color"[^>]+content="([^"]+)"/, 'a theme-color'],
    [/<link[^>]+rel="apple-touch-icon"[^>]+href="assets\/icons\/apple-touch-icon\.png"/, 'the apple-touch-icon'],
    [/<meta[^>]+name="apple-mobile-web-app-capable"[^>]+content="yes"/, 'apple-mobile-web-app-capable'],
    [/<meta[^>]+name="apple-mobile-web-app-status-bar-style"/, 'apple-mobile-web-app-status-bar-style'],
    [/<meta[^>]+name="apple-mobile-web-app-title"/, 'apple-mobile-web-app-title'],
    [/<meta[^>]+name="viewport"[^>]+viewport-fit=cover/, 'viewport-fit=cover, for the safe-area insets'],
  ];
  for (const [pattern, what] of required) {
    assert.match(HTML, pattern, `index.html is missing ${what}`);
  }
  const theme = HTML.match(/<meta[^>]+name="theme-color"[^>]+content="([^"]+)"/)[1];
  assert.equal(theme.toLowerCase(), MANIFEST.theme_color.toLowerCase(),
    'the page and the manifest must agree on the theme colour');
});

test('the service worker registers relatively and versions its cache', () => {
  const pwa = readText('js/pwa.js');
  assert.match(pwa, /register\(SERVICE_WORKER\)/, 'js/pwa.js has to register the worker');
  assert.match(pwa, /const SERVICE_WORKER = '\.\/service-worker\.js'/,
    'the registration path must be relative, for a subdirectory install');
  assert.match(SW, /const CACHE_VERSION = 'super-pang-[0-9a-f]{12}';/,
    'the cache version is generated from the precached files -- see tools/build_precache.mjs');
  // Nothing in the worker may be rooted at the domain: everything is
  // resolved against its own scope.
  assert.doesNotMatch(SW, /['"]\/[a-z]/i, 'the worker must not use absolute paths');
});

// The runtime files: everything the browser fetches while playing. Kept
// in step with tools/build_precache.mjs, which writes the list -- this is
// the check that the tool was rerun after a file was added or removed.
function runtimeFiles(dir = '') {
  const out = [];
  for (const entry of listFiles(dir || '.').sort()) {
    if (/^\./.test(entry)) continue;
    const rel = dir ? `${dir}/${entry}` : entry;
    if (statSync(join(ROOT, rel)).isDirectory()) {
      if (!dir && !['js', 'assets', 'levels', 'elements', 'skins'].includes(entry)) continue;
      out.push(...runtimeFiles(rel));
    } else if (dir || ['index.html', 'style.css', 'manifest.webmanifest', 'favicon.ico'].includes(entry)) {
      out.push(rel);
    }
  }
  return out;
}

test('the precache list is exactly the files the game loads', () => {
  const listed = new Set(PRECACHE_PATHS);
  const onDisk = new Set(runtimeFiles());
  for (const path of listed) {
    assert.ok(onDisk.has(path),
      `sw-precache.json lists "${path}", which is not a file the game loads -- rerun tools/build_precache.mjs`);
  }
  for (const path of onDisk) {
    assert.ok(listed.has(path),
      `"${path}" is loaded by the game but not in sw-precache.json -- rerun tools/build_precache.mjs`);
  }
  assert.ok(listed.size > 100, `only ${listed.size} files precached -- that cannot be the whole game`);
});

test('the cache is named after what is in it, file by file', () => {
  // The worker answers from its cache first, so a version that does not
  // move with the files means players keep the release they first
  // downloaded. The tool writes a hash of every precached file into the
  // worker; this recomputes it, so forgetting to rerun the tool fails
  // here rather than quietly shipping a game that still hands out the old
  // sprites -- which is precisely how three redrawn player sprites
  // reached nobody.
  const hash = createHash('sha256');
  for (const path of PRECACHE_PATHS) {
    const digest = createHash('sha256').update(readFileSync(join(ROOT, path))).digest('hex').slice(0, 16);
    assert.equal(PRECACHE.files[path], digest,
      `sw-precache.json's hash for "${path}" is stale -- rerun tools/build_precache.mjs`);
    hash.update(path).update(digest);
  }
  const expected = `super-pang-${hash.digest('hex').slice(0, 12)}`;
  assert.equal(PRECACHE.version, expected, 'sw-precache.json\'s own version is stale');
  const actual = SW.match(/const CACHE_VERSION = '([^']*)'/)[1];
  assert.equal(actual, expected,
    'service-worker.js\'s CACHE_VERSION is stale -- rerun tools/build_precache.mjs');
});

test('an install takes a whole release, not a mixture of two', () => {
  // The bug this guards against did not look like a caching problem: the
  // game froze the moment a machine gun was fired, because the caller and
  // the file it called had come from different releases. cache.add()
  // fetches through the browser's ordinary HTTP cache, so files still
  // inside their max-age arrive from the LAST deploy while the rest
  // arrive from this one.
  // Comments dropped first: store()'s own comment names cache.add() as
  // the thing it replaces, and that sentence is worth keeping.
  const code = SW.split('\n').filter((line) => !/^\s*(\/\/|\*)/.test(line)).join('\n');
  assert.doesNotMatch(code, /cache\.add(All)?\(/,
    "cache.add() fetches through the HTTP cache -- store() with cache:'reload' is what installs one whole release");
  assert.match(SW, /fetch\(url\(path\), \{ cache: 'reload' \}\)/,
    'every precached file must be fetched straight from the network');

  // And a file carried over from the previous cache is checked before it
  // is trusted: the manifest records what the last install MEANT to
  // store, so without this a single bad copy is copied forward release
  // after release and never fetched again.
  assert.match(SW, /crypto\.subtle\.digest\('SHA-256'/,
    'the delta install must verify the bytes it carries over');
  const slice = SW.match(/\.join\(''\)\.slice\(0, (\d+)\)/);
  assert.ok(slice, "the worker's digest has to be cut to the manifest's hash length");
  assert.equal(Number(slice[1]), PRECACHE.files['index.html'].length,
    'the worker cuts its hash to a different length than tools/build_precache.mjs writes');
});

test('the precache list is relative and holds nothing server-side', () => {
  for (const path of PRECACHE_PATHS) {
    assert.ok(!path.startsWith('/') && !path.startsWith('.') && !path.includes('://'),
      `"${path}": paths are relative to the worker's scope`);
    assert.ok(!/^(admin|tests|tools|\.github)\//.test(path),
      `"${path}": not part of the game the browser loads`);
  }
  // The shell the worker insists on caching has to be in the list too --
  // it is the one part whose absence means a blank screen offline.
  for (const path of ['index.html', 'style.css', 'js/main.js', 'js/vendor/phaser.min.js', 'manifest.webmanifest']) {
    assert.ok(PRECACHE_PATHS.includes(path), `the shell file "${path}" is not precached`);
  }
});
