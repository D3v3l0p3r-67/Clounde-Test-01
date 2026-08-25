// Every "Save" action in this admin tool goes through here, and there is
// exactly one destination: the PHP backend (save.php), which writes into
// the project's own files at the fixed location the server already knows
// (PROJECT_ROOT, see includes/config.php). Nothing here asks the admin
// where the project lives, and there is deliberately no client-side
// fallback: an earlier version quietly downloaded the file instead
// whenever the server save failed, which made a failed save look exactly
// like a successful one. Now a save either lands on the server or throws
// with the server's own reason, which each tab surfaces as "Save
// failed: ...".

const CSRF_TOKEN = document.querySelector('meta[name="admin-csrf"]')?.content ?? '';

// `rootRelativePath` is slash-separated, relative to the project root
// (e.g. "elements/round-ball-1.json", "assets/balls/ball_round_1.webp").
// `content` is either a string (JSON/text files) or a Blob/File (images,
// audio). Resolves with the server's answer on success -- which includes
// whether it managed to tell the game's offline copy that something moved
// (see includes/precache.php) -- and throws on any failure.
export async function saveFile(rootRelativePath, content) {
  const formData = new FormData();
  formData.append('path', rootRelativePath);
  formData.append('csrf', CSRF_TOKEN);
  const blob = content instanceof Blob ? content : new Blob([content], { type: 'application/octet-stream' });
  formData.append('file', blob, rootRelativePath.split('/').pop());

  const res = await fetch('save.php', { method: 'POST', body: formData, credentials: 'same-origin' });
  let data;
  try {
    data = await res.json();
  } catch {
    // Not JSON -- a PHP fatal, a proxy error page, or the session having
    // expired into a redirect. Report the status rather than a parse error.
    throw new Error(`server returned HTTP ${res.status} (not JSON -- is PHP running?)`);
  }
  if (!res.ok || !data.ok) throw new Error(data.error || `server returned HTTP ${res.status}`);
  return data;
}

// The one folder the admin tool may delete from is skins/ -- see
// delete.php for why deleting is narrower than saving. Throws with the
// server's reason on refusal (a system skin, a missing file), same
// contract as saveFile above.
export async function deleteFile(rootRelativePath) {
  const formData = new FormData();
  formData.append('path', rootRelativePath);
  formData.append('csrf', CSRF_TOKEN);
  const res = await fetch('delete.php', { method: 'POST', body: formData, credentials: 'same-origin' });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`server returned HTTP ${res.status} (not JSON -- is PHP running?)`);
  }
  if (!res.ok || !data.ok) throw new Error(data.error || `server returned HTTP ${res.status}`);
  return data;
}
