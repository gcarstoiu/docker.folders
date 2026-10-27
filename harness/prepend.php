<?PHP
/* simple.folders - local development harness.
 *
 * Stand-in for Unraid's /usr/local/emhttp/webGui/include/local_prepend.php,
 * which Unraid installs as php.ini's auto_prepend_file. It rejects EVERY POST
 * without a valid csrf_token with HTTP 403.
 *
 * Reproducing it here is deliberate: without it, plugin code that forgets the
 * token passes locally and 403s on real hardware. The behaviour below is
 * modelled on webgui master (7.4.0-rc.2.1), read 2026-10-27.
 *
 * NOT part of the plugin package. Never shipped.
 */

/* Guard: this may be pulled in both by -d auto_prepend_file and by
 * router.php, depending on the PHP build. */
if (defined('HARNESS_CSRF')) return;

/* Fixed token for the harness - the real one lives in state/var.ini. */
define('HARNESS_CSRF', '0123456789ABCDEF');

function csrf_terminate($reason) {
  if (!headers_sent()) {
    http_response_code(403);
    header('Content-Type: application/json');
  }
  exit(json_encode(['error' => "{$reason} csrf_token"]));
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
  /* Unraid accepts the token as a POST field (webGUI/plugin form posts) or as
   * an X-CSRF-Token header (XHR/JSON/octet-stream). Both must work. */
  $token = $_POST['csrf_token'] ?? ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? null);
  if ($token === null)                       csrf_terminate('missing');
  if (!hash_equals(HARNESS_CSRF, $token))    csrf_terminate('wrong');
  unset($_POST['csrf_token'], $_SERVER['HTTP_X_CSRF_TOKEN']);
}

/* Unraid guarantees these globals to every page and include. */
$docroot = $_SERVER['DOCUMENT_ROOT'];
$var = ['csrf_token' => HARNESS_CSRF, 'version' => getenv('HARNESS_UNRAID_VERSION') ?: '7.3.4'];
$display = ['theme' => preg_replace('/[^a-z]/', '', $_GET['theme'] ?? 'black'), 'locale' => ''];

/* Helpers that webGui/include/Wrappers.php provides to every page. Only the
 * ones the plugin actually calls are shimmed here. */
if (!function_exists('autov')) {
  /* Cache-busting asset URL: real Unraid appends the file's mtime. */
  function autov($file, $html = false) {
    $path = $_SERVER['DOCUMENT_ROOT'].$file;
    $v = file_exists($path) ? filemtime($path) : time();
    return $file.'?v='.$v;
  }
}
if (!function_exists('_var')) {
  function _var(&$array, $key, $default = '') {
    return $array[$key] ?? $default;
  }
}
if (!function_exists('my_logger')) {
  function my_logger($message, $tag = 'harness') {
    error_log("[$tag] $message");
  }
}

/* ---------------------------------------------------------------------------
 * Point the plugin's storage at harness/state instead of the flash drive, and
 * give it a fixture-backed container source instead of DockerClient.
 *
 * lib/Paths.php declares every one of these with "defined() ||", so defining
 * them first is the supported way to relocate them. Production never does.
 * ------------------------------------------------------------------------- */
$harness = __DIR__;
define('SF_CONFIG_DIR',          $harness.'/state/config');
define('SF_RUN_DIR',             $harness.'/state/run');
define('SF_DOCKER_MAN',          $harness.'/mock/plugins/dynamix.docker.manager');
define('SF_DOCKER_MAN_AUTOSTART',$harness.'/state/unraid-autostart');
define('SF_CONTAINER_SOURCE',    $harness.'/mock/container_source.php');

/* Icon catalogues served locally, so a test never depends on the real CDNs
 * being reachable. Same shape as production: an index URL plus a base the
 * icon paths hang off. */
$base = 'http://localhost:'.($_SERVER['SERVER_PORT'] ?? '8089').'/icondata/';
define('SF_ICON_SOURCES', [
  'dashboard-icons' => [
    'label' => 'Dashboard Icons',
    'base'  => $base.'dashboard-icons/',
    'index' => $base.'dashboard-icons/index.json',
    'host'  => 'localhost',
  ],
  'selfhst' => [
    'label' => 'selfh.st icons',
    'base'  => $base.'selfhst/',
    'index' => $base.'selfhst/index.json',
    'host'  => 'localhost',
  ],
]);

/* Seed the folder store from the fixtures on first run so the page opens
 * looking like design/screenshots/01-overview.png. */
if (!is_file(SF_CONFIG_DIR.'/folders.json')) {
  @mkdir(SF_CONFIG_DIR.'/icons', 0755, true);
  @copy($harness.'/fixtures/folders.json', SF_CONFIG_DIR.'/folders.json');
}
