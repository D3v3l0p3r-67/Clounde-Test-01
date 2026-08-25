<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/auth.php';
requireLogin();
$csrf = csrfToken();

// Where saves land is fixed in code (PROJECT_ROOT, see includes/
// config.php) -- the admin never picks a folder. What CAN go wrong is the
// web server user not being allowed to write there, so check that up
// front and explain it once, rather than letting every individual Save
// fail with the same permission error one at a time.
$dirStatus = saveDirStatus();
$blocked = array_values(array_filter($dirStatus, fn($d) => !$d['writable']));
$phpUser = webServerUser();
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Balloon Buster -- Admin</title>
<meta name="description" content="Edit Balloon Buster's graphics, sounds, elements, and levels.">
<meta name="admin-csrf" content="<?= htmlspecialchars($csrf, ENT_QUOTES) ?>">
<link rel="stylesheet" href="style.css">
</head>
<body>

<div id="app">
  <header>
    <h1>Balloon Buster -- Admin</h1>
    <div id="fs-status">
      <?php if ($blocked): ?>
        <span class="fs-warning">Saves will fail &mdash; see below</span>
      <?php else: ?>
        <span>Saves write to <code><?= htmlspecialchars(PROJECT_ROOT, ENT_QUOTES) ?></code></span>
      <?php endif; ?>
    </div>
    <a id="btn-logout" href="logout.php">Log out</a>
  </header>

  <nav id="tabs">
    <button class="tab-btn active" data-tab="graphics">Graphics</button>
    <button class="tab-btn" data-tab="sounds">Sounds</button>
    <button class="tab-btn" data-tab="elements">Elements</button>
    <button class="tab-btn" data-tab="levels">Levels</button>
    <button class="tab-btn" data-tab="skins">Skins</button>
  </nav>

  <main>
    <?php if ($blocked): ?>
      <div class="fs-fix">
        <h2>Saves will fail until the web server can write to the project</h2>
        <p>PHP is running as <code><?= htmlspecialchars($phpUser, ENT_QUOTES) ?></code>,
        but these folders under <code><?= htmlspecialchars(PROJECT_ROOT, ENT_QUOTES) ?></code>
        aren't writable by it:</p>
        <table>
          <tr><th>Folder</th><th>Owner</th><th>Mode</th><th>Problem</th></tr>
          <?php foreach ($blocked as $d): ?>
            <tr>
              <td><code><?= htmlspecialchars($d['dir'], ENT_QUOTES) ?></code></td>
              <td><code><?= htmlspecialchars($d['owner'], ENT_QUOTES) ?></code></td>
              <td><code><?= htmlspecialchars($d['mode'], ENT_QUOTES) ?></code></td>
              <td><?= $d['exists'] ? 'not writable' : 'missing' ?></td>
            </tr>
          <?php endforeach; ?>
        </table>
        <p>Give that account write access. Over SSH, as an administrator:</p>
        <pre><?php
          $paths = implode(' ', array_map(
              fn($d) => escapeshellarg(PROJECT_ROOT . '/' . $d['dir']),
              $blocked
          ));
          echo htmlspecialchars(
              "sudo chown -R " . escapeshellarg($phpUser) . " $paths\n"
              . "sudo chmod -R u+w $paths",
              ENT_QUOTES
          );
        ?></pre>
        <p class="note">On Synology DSM you can do the same without SSH:
        <strong>File Station</strong> &rarr; right-click each folder &rarr;
        <strong>Properties &rarr; Permission</strong> &rarr; add
        <code><?= htmlspecialchars($phpUser, ENT_QUOTES) ?></code> with
        Read/Write, and tick "Apply to this folder, sub-folders and files".
        Reload this page afterwards &mdash; the check re-runs on every load.</p>
      </div>
    <?php endif; ?>

    <section id="tab-graphics" class="tab-panel"></section>
    <section id="tab-sounds" class="tab-panel hidden"></section>
    <section id="tab-elements" class="tab-panel hidden"></section>
    <section id="tab-levels" class="tab-panel hidden"></section>
    <section id="tab-skins" class="tab-panel hidden"></section>
  </main>
</div>

<script type="module" src="js/main.js"></script>
</body>
</html>
