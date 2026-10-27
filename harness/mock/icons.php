<?PHP
/* docker.folders harness - stand-in for the two icon CDNs.
 *
 *   /icondata/<source>/index.json   the catalogue index (trimmed fixtures)
 *   /icondata/<source>/<ext>/<file> a placeholder icon of that name
 *
 * Fixtures are real entries taken from each catalogue, cut down to a subset
 * around a few search terms - enough to exercise ranking, the "many matches"
 * path and the "nothing matched" path, without committing a megabyte of
 * someone else's index.
 *
 * NOT part of the plugin package. Never shipped.
 */
require_once __DIR__.'/state.php';

$source = preg_replace('/[^a-z-]/', '', $_GET['source'] ?? '');
$rest   = preg_replace('#[^A-Za-z0-9._/-]#', '', $_GET['rest'] ?? '');

$files = [
  'dashboard-icons' => HARNESS_ROOT.'/fixtures/icons/dashboard-icons.tree.json',
  'selfhst'         => HARNESS_ROOT.'/fixtures/icons/selfhst.index.json',
];

if ($rest === 'index.json') {
  if (!isset($files[$source]) || !is_file($files[$source])) { http_response_code(404); exit; }
  header('Content-Type: application/json');
  readfile($files[$source]);
  exit;
}

/* Any <ext>/<name>.<ext> under a known source resolves to a placeholder
 * bearing that name, so previews load and a download succeeds. */
if (preg_match('#^(svg|png)/([A-Za-z0-9._-]+)\\.(svg|png)$#', $rest, $m)) {
  $letter = strtoupper(substr($m[2], 0, 1));
  $hue = hexdec(substr(sha1($m[2]), 0, 2)) % 360;
  header('Content-Type: image/svg+xml');
  echo '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">'
     . '<rect width="64" height="64" rx="12" fill="hsl('.$hue.' 55% 45%)"/>'
     . '<text x="32" y="34" fill="#fff" font-family="sans-serif" font-size="30"'
     . ' font-weight="700" text-anchor="middle" dominant-baseline="central">'.$letter.'</text></svg>';
  exit;
}

http_response_code(404);
