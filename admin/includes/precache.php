<?php
// Keeping the offline copy honest after a save.
//
// The service worker answers from its cache FIRST, and it only rebuilds
// that cache when service-worker.js's CACHE_VERSION changes -- which is a
// hash of every precached file's contents, written by
// tools/build_precache.mjs at release time. A file written through this
// admin tool never went through that tool, so nothing told any browser
// that anything had changed: the game went on serving the sprite it had
// downloaded first, through hard reloads and all, because a hard reload
// empties the HTTP cache and not the worker's.
//
// So a save does here exactly what the tool would have done for that one
// file: rehash it, write the hash into sw-precache.json, recompute the
// manifest's own version and put it in the worker. The next time any
// browser loads the game it fetches service-worker.js, sees different
// bytes, installs -- copying the 300-odd unchanged files straight out of
// the cache it already has and fetching only what actually changed -- and
// the page reloads itself once (see js/pwa.js).
//
// It must produce the SAME version string the tool would, byte for byte,
// or the next release run would look like a change that is not one:
//   per file   sha256 of its contents, first 16 hex characters
//   overall    sha256 over each path followed by its hash, first 12,
//              prefixed "super-pang-", in the manifest's own file order
// (see tools/build_precache.mjs, which is the original of both).

declare(strict_types=1);

const PRECACHE_FILE = 'sw-precache.json';
const WORKER_FILE = 'service-worker.js';

// Refreshes the offline manifest for one just-written file. Returns
// [updated, reason] -- never throws and never fails a save: the file the
// admin asked for IS on disk, and an offline copy that lags is a smaller
// problem than a save that reports failure after succeeding.
function refreshPrecache(string $path): array {
    return updatePrecache($path, false);
}

// The other direction, for delete.php: a deleted file still listed in
// the manifest would make every future install try to fetch a 404.
function removeFromPrecache(string $path): array {
    return updatePrecache($path, true);
}

function updatePrecache(string $path, bool $remove): array {
    $manifestPath = PROJECT_ROOT . '/' . PRECACHE_FILE;
    $workerPath = PROJECT_ROOT . '/' . WORKER_FILE;
    $target = PROJECT_ROOT . '/' . $path;

    if (!is_file($manifestPath) || !is_file($workerPath)) {
        return [false, 'no service worker on this host'];
    }
    if (!is_writable($manifestPath) || !is_writable($workerPath)) {
        return [false, 'sw-precache.json / service-worker.js are not writable'];
    }

    // One save at a time: two admins saving at once would otherwise read
    // the same manifest, and the second write would drop the first one's
    // hash while claiming a version that covers it.
    $lock = @fopen($manifestPath, 'r+');
    if ($lock === false) {
        return [false, 'could not open sw-precache.json'];
    }
    if (!flock($lock, LOCK_EX)) {
        fclose($lock);
        return [false, 'could not lock sw-precache.json'];
    }

    try {
        $manifest = json_decode((string)stream_get_contents($lock), true);
        if (!is_array($manifest) || !isset($manifest['files']) || !is_array($manifest['files'])) {
            return [false, 'sw-precache.json is not a manifest'];
        }

        if ($remove) {
            unset($manifest['files'][$path]);
        } else {
            $hash = @hash_file('sha256', $target);
            if ($hash === false) {
                return [false, 'could not read the file that was just written'];
            }
            // A file the manifest has never heard of is appended rather
            // than refused -- the next release run puts it in the tool's
            // own walk order, and until then it is cached like
            // everything else.
            $manifest['files'][$path] = substr($hash, 0, 16);
        }

        $overall = hash_init('sha256');
        foreach ($manifest['files'] as $file => $digest) {
            hash_update($overall, $file);
            hash_update($overall, $digest);
        }
        $version = 'super-pang-' . substr(hash_final($overall), 0, 12);
        $manifest['version'] = $version;

        $worker = (string)file_get_contents($workerPath);
        $rewritten = preg_replace(
            "/const CACHE_VERSION = '[^']*';/",
            "const CACHE_VERSION = '" . $version . "';",
            $worker,
            1,
            $count
        );
        if ($rewritten === null || $count !== 1) {
            return [false, 'service-worker.js has no CACHE_VERSION line to write'];
        }

        // The manifest first: a worker naming a version the manifest does
        // not have would install against the wrong list of hashes and
        // refetch the whole game.
        rewind($lock);
        ftruncate($lock, 0);
        fwrite($lock, encodeManifest($manifest));
        fflush($lock);
        if (file_put_contents($workerPath, $rewritten) === false) {
            return [false, 'could not write service-worker.js'];
        }
        return [true, $version];
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

// Byte-identical to what JSON.stringify(manifest, null, 2) + "\n" writes,
// so a save and a release run produce the same file rather than a diff
// made of whitespace: PHP indents with four spaces where JavaScript uses
// two, and escapes the slashes in every path.
function encodeManifest(array $manifest): string {
    $json = json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $json = preg_replace_callback('/^(?: {4})+/m', static function (array $m): string {
        return str_repeat(' ', strlen($m[0]) / 2);
    }, (string)$json);
    return $json . "\n";
}
