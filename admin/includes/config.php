<?php
// Shared constants for the PHP half of the admin tool (see save.php/
// auth.php). Kept separate from auth.php so both index.php (which needs
// the project root/allowed dirs for nothing, actually -- just CSRF/login)
// and save.php (which needs the write whitelist) can include only what
// they need.

declare(strict_types=1);

// admin/ lives one level inside the project root -- everything the admin
// tool ever reads or writes (elements/, levels/, assets/) is relative to
// this, never to admin/ itself.
define('PROJECT_ROOT', realpath(__DIR__ . '/../..'));

// Every top-level folder save.php is allowed to write into. Deliberately
// does NOT include "admin" itself -- an admin tool that could overwrite
// its own PHP source (or upload new PHP anywhere) would defeat its own
// login gate. Matches exactly what js/assets.js's path helpers already
// generate (elements/*.json, levels/level_NN.json, assets/**).
define('ALLOWED_SAVE_DIRS', ['elements', 'levels', 'assets', 'skins']);

// Every file extension the game's own asset pipeline ever produces (see
// the root README's "Swapping graphics"/"Swapping sounds") -- nothing
// else is ever a legitimate save target, and this is what actually
// blocks someone from using the save endpoint to drop a .php file
// somewhere the web server would execute it.
define('ALLOWED_SAVE_EXTENSIONS', ['json', 'webp', 'png', 'ogg']);

// Generous but bounded -- the biggest legitimate asset today (a level
// background image) is a few KB; this just guards against something
// wildly wrong being uploaded.
define('MAX_UPLOAD_BYTES', 5 * 1024 * 1024);

// Which account PHP is actually running as. This is most of diagnosing a
// "saves will fail" permission problem and isn't something the admin can
// look up from a browser -- it's the account that has to own (or have
// group write on) the save directories. posix_* isn't compiled into
// every PHP build, so degrade gracefully rather than fataling.
function webServerUser(): string {
    if (function_exists('posix_geteuid') && function_exists('posix_getpwuid')) {
        $info = @posix_getpwuid(@posix_geteuid());
        if (!empty($info['name'])) {
            return $info['name'];
        }
    }
    $env = getenv('APACHE_RUN_USER') ?: getenv('USER');
    return ($env !== false && $env !== '') ? $env : 'the web server user';
}

// Per-directory write check plus the owner/mode behind it, so the admin
// UI can explain WHY a directory isn't writable (almost always: it's
// owned by the account that uploaded the files, not the one PHP runs as)
// instead of only reporting the symptom.
function saveDirStatus(): array {
    $rows = [];
    foreach (ALLOWED_SAVE_DIRS as $dir) {
        $path = PROJECT_ROOT . '/' . $dir;
        $exists = is_dir($path);
        $owner = '?';
        if ($exists && function_exists('posix_getpwuid')) {
            $info = @posix_getpwuid(@fileowner($path));
            if (!empty($info['name'])) {
                $owner = $info['name'];
            }
        }
        $rows[] = [
            'dir' => $dir,
            'exists' => $exists,
            'writable' => $exists && is_writable($path),
            'owner' => $owner,
            'mode' => $exists ? substr(sprintf('%o', fileperms($path)), -4) : '----',
        ];
    }
    return $rows;
}
