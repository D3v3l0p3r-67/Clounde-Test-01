// The skin system's contract, checked without a browser (see js/skins.js
// for the system itself).
//
// The one that matters most is the dimension rule: an override must be
// the exact pixel size of the base file it replaces. Gameplay never
// reads a skin -- but art at the wrong size would DRAW at the wrong
// size, and "the sleek ball is bigger than its hitbox" is precisely the
// kind of bug that ships unnoticed because every skin looks right on its
// own. Checked here for every override of every skin, so it cannot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { statSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, readJSON, readText, exists, imageSize } from './helpers.mjs';

const REGISTRY = readJSON('skins/index.json');
const MANIFESTS = new Map(REGISTRY.skins.map((id) => [id, readJSON(`skins/${id}/skin.json`)]));

test('the registry names real skins and a usable default', () => {
  assert.ok(Array.isArray(REGISTRY.skins) && REGISTRY.skins.length >= 1);
  for (const [id, manifest] of MANIFESTS) {
    assert.equal(manifest.id, id, `skins/${id}/skin.json says its id is "${manifest.id}"`);
    assert.ok(manifest.name, `skin "${id}" needs a name for the picker`);
  }
  const fallback = MANIFESTS.get(REGISTRY.default);
  assert.ok(fallback, `the default skin "${REGISTRY.default}" is not in the registry`);
  assert.notEqual(fallback.enabled, false, 'the default skin must be enabled');
});

test('the pixel skin IS the base game', () => {
  // The current look survives as a skin by construction, not by porting:
  // zero overrides means the base assets, untouched. System, so the
  // admin tool refuses to delete it; anything else here would mean the
  // original look could quietly drift or vanish.
  const pixel = MANIFESTS.get('pixel');
  assert.ok(pixel, 'the pixel skin must exist');
  assert.equal(pixel.system, true);
  assert.deepEqual(pixel.overrides ?? [], [], 'the pixel skin overrides nothing -- assets/ is the skin');
});

test('every override mirrors a base file at its exact pixel size', () => {
  for (const [id, manifest] of MANIFESTS) {
    for (const path of manifest.overrides ?? []) {
      assert.ok(path.startsWith('assets/'), `${id}: "${path}" is not an assets/ path`);
      assert.ok(exists(path), `${id} overrides "${path}", which has no base file to fall back to`);
      const override = `skins/${id}/${path}`;
      assert.ok(exists(override), `${id}'s manifest lists "${path}" but ${override} is missing`);
      if (/\.(png|webp)$/.test(path)) {
        assert.deepEqual(imageSize(override), imageSize(path),
          `${override} is not the base file's size -- it would draw at the wrong scale`);
      }
    }
  }
});

test('no skin carries files its manifest does not declare', () => {
  // The manifest is what the game loads by; a file on disk the manifest
  // has never heard of is dead weight that LOOKS like part of the skin.
  // Same contract as sw-precache.json: regenerate, do not hand-drift.
  const walk = (dir) => {
    const out = [];
    for (const entry of readdirSync(join(ROOT, dir)).sort()) {
      const rel = `${dir}/${entry}`;
      if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
      else out.push(rel);
    }
    return out;
  };
  for (const [id, manifest] of MANIFESTS) {
    const assetsDir = `skins/${id}/assets`;
    if (!existsSync(join(ROOT, assetsDir))) continue;
    const declared = new Set((manifest.overrides ?? []).map((p) => `skins/${id}/${p}`));
    for (const file of walk(assetsDir)) {
      assert.ok(declared.has(file), `${file} is on disk but not in ${id}'s manifest -- the game will never load it`);
    }
  }
});

test('a declared menu font exists and carries a whole-number scale', () => {
  for (const [id, manifest] of MANIFESTS) {
    if (!manifest.font) continue;
    assert.ok(exists(`skins/${id}/${manifest.font.file}`), `${id}'s font file is missing`);
    assert.ok(Number.isInteger(manifest.font.scale) && manifest.font.scale >= 1,
      `${id}'s font scale must be a whole number of base cells`);
  }
});

test('the loaders actually route through the skin', () => {
  // The engine is only real if every path goes through it: a loader that
  // bypasses skinAsset() is an asset no skin can ever touch, and the way
  // that regresses is someone adding a load call without the wrap.
  const boot = readText('js/BootScene.js');
  for (const line of boot.split('\n')) {
    if (!/this\.load\.(image|spritesheet|audio)\(/.test(line)) continue;
    assert.match(line, /skinAsset\(/, `an unskinned load slipped into BootScene: ${line.trim()}`);
  }
  for (const file of ['js/ElementsScene.js', 'js/PixelText.js', 'js/audio.js']) {
    assert.match(readText(file), /skinAsset|skinFont/, `${file} does not route through the skin`);
  }
  assert.match(readText('js/storage.js'), /skin: ''/, 'settings must carry the saved skin choice');
  assert.match(readText('tools/build_precache.mjs'), /'skins'/, 'skins/ must be precached for offline play');
});
