<?php
// Deletes ONE file under skins/ -- the only folder the admin tool may
// remove anything from. Saving can touch elements/levels/assets too
// (see save.php), but deleting is a different kind of power: a deleted
// level or base asset is the game broken, while a deleted skin file is
// at worst a skin gone -- the game's per-file fallback serves the base
// art in its place (see js/skins.js). So the whitelist here is
// deliberately narrower than save.php's, not shared with it.
//
// Two refusals beyond the path shape:
//   - skins/index.json: the registry is edited, never deleted.
//   - any file of a skin whose manifest says "system": true -- the
//     pixel skin is the base game and the sleek skin ships with it;
//     the rule the admin UI shows ("delete, if not a system skin") is
//     enforced here rather than trusted to the client.
declare(strict_types=1);
require_once __DIR__ . '/includes/auth.php';
require_once __DIR__ . '/includes/precache.php';

header('Content-Type: application/json');

function fail(int $status, string $message): never {
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $message]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail(405, 'POST only.');
}
if (!isLoggedIn()) {
    fail(401, 'Not logged in.');
}
if (!checkCsrf($_POST['csrf'] ?? null)) {
    fail(403, 'Missing or invalid CSRF token -- reload the admin page and try again.');
}

$path = (string)($_POST['path'] ?? '');

// Same shape discipline as save.php: path-safe characters only (nowhere
// for ".." to hide), rooted in skins/, one of the extensions the skin
// pipeline produces.
if (!preg_match('#^skins(/[A-Za-z0-9._-]+)+\.(json|webp|png|ogg)$#', $path)) {
    fail(400, 'Path not allowed: ' . $path);
}
if ($path === 'skins/index.json') {
    fail(400, 'The registry is edited, never deleted.');
}

// The system rule, read from the skin's own manifest. The manifest is
// the LAST file a full skin deletion removes, so it is still there to
// answer for every earlier file -- and refusing when it cannot be read
// fails safe rather than open.
if (preg_match('#^skins/([A-Za-z0-9._-]+)/#', $path, $m)) {
    $manifestPath = PROJECT_ROOT . '/skins/' . $m[1] . '/skin.json';
    if (is_file($manifestPath)) {
        $manifest = json_decode((string)file_get_contents($manifestPath), true);
        if (!is_array($manifest)) {
            fail(500, 'skins/' . $m[1] . '/skin.json is unreadable -- refusing to delete from it.');
        }
        if (($manifest['system'] ?? false) === true) {
            fail(403, 'Skin "' . $m[1] . '" is a system skin and cannot be deleted.');
        }
    }
}

$target = PROJECT_ROOT . '/' . $path;
$real = realpath($target);
if ($real === false) {
    fail(404, 'No such file: ' . $path);
}
if (strpos($real, PROJECT_ROOT . DIRECTORY_SEPARATOR) !== 0) {
    fail(400, 'Resolved path escapes the project root.');
}
if (!unlink($real)) {
    fail(500, 'Could not delete ' . $path);
}

[$precacheUpdated, $precacheInfo] = removeFromPrecache($path);

echo json_encode([
    'ok' => true,
    'path' => $path,
    'precacheUpdated' => $precacheUpdated,
    'precacheInfo' => $precacheInfo,
]);
