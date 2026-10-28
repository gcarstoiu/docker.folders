<?PHP
/* simple.folders harness - request router for PHP's built-in server.
 *
 * Maps the paths the plugin uses on a real Unraid box onto this repository:
 *
 *   /plugins/simple.folders/*            -> src/usr/local/emhttp/plugins/simple.folders/*
 *   /plugins/dynamix.docker.manager/*    -> harness/mock/plugins/dynamix.docker.manager/*
 *   /webGui/*                            -> harness/mock/webGui/*
 *   /sub/<channel>                       -> harness/mock/sub.php   (nchan stand-in)
 *   /_reset                              -> wipe mutable state
 *   /                                    -> harness/mock/index.php (Docker page shell)
 *
 * NOT part of the plugin package. Never shipped.
 */
/* Unraid installs the CSRF gate via php.ini's auto_prepend_file. PHP's
 * built-in server does not reliably apply -d auto_prepend_file to requests,
 * so require it here instead - the router handles every request, so the
 * effect is the same global one. */
require_once __DIR__.'/prepend.php';

$root   = __DIR__;
$plugin = dirname($root).'/src/usr/local/emhttp/plugins/simple.folders';
$path   = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

/* ---- nchan stand-in --------------------------------------------------- */
if (preg_match('#^/sub/([a-z0-9_-]+)#i', $path, $m)) {
  $_GET['channel'] = $m[1];
  require $root.'/mock/sub.php';
  return true;
}

/* ---- reset ------------------------------------------------------------ */
if ($path === '/_reset') {
  /* Recursive: folder definitions live in state/config/ and update jobs in
   * state/run/, so unlinking only the top-level files left them behind. */
  $wipe = function ($dir) use (&$wipe) {
    foreach (glob($dir.'/*') ?: [] as $f) {
      is_dir($f) ? $wipe($f) : @unlink($f);
    }
    @rmdir($dir);
  };
  $wipe($root.'/state');
  header('Location: /');
  return true;
}

/* ---- static + php under the mapped prefixes --------------------------- */
$map = [
  '/plugins/simple.folders'         => $plugin,
  '/plugins/dynamix.docker.manager' => $root.'/mock/plugins/dynamix.docker.manager',
  '/webGui'                         => $root.'/mock/webGui',
];

foreach ($map as $prefix => $dir) {
  if (strpos($path, $prefix.'/') !== 0) continue;

  $rel = substr($path, strlen($prefix) + 1);

  /* Unraid's autov() appends a cache-busting query, and some callers append
     a version segment; strip anything that is not a real path. */
  $rel = preg_replace('#\.\.+#', '.', $rel);
  $file = $dir.'/'.$rel;

  if (!is_file($file)) { http_response_code(404); echo "not found: $path"; return true; }

  if (substr($file, -4) === '.php') {
    $_SERVER['DOCUMENT_ROOT'] = $root.'/mock';
    require $file;
    return true;
  }

  $types = [
    'css' => 'text/css', 'js' => 'application/javascript', 'json' => 'application/json',
    'svg' => 'image/svg+xml', 'png' => 'image/png', 'woff' => 'font/woff', 'woff2' => 'font/woff2',
  ];
  $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
  header('Content-Type: '.($types[$ext] ?? 'application/octet-stream'));
  header('Cache-Control: no-store');
  readfile($file);
  return true;
}

/* ---- set a container label (tests only) -------------------------------- */
if ($path === '/_label') {
  require_once $root.'/mock/state.php';
  $ct    = (string)($_GET['container'] ?? '');
  $key   = (string)($_GET['key'] ?? '');
  $value = (string)($_GET['value'] ?? '');
  harness_mutate($ct, function ($c) use ($key, $value) {
    $c['labels'] = $c['labels'] ?? [];
    if ($value === '') unset($c['labels'][$key]); else $c['labels'][$key] = $value;
    return $c;
  });
  header('Content-Type: application/json');
  echo json_encode(['ok' => true]);
  return true;
}

/* ---- icon catalogue stand-in ------------------------------------------ */
if (preg_match('#^/icondata/([a-z-]+)/(.+)$#', $path, $m)) {
  $_GET['source'] = $m[1];
  $_GET['rest']   = $m[2];
  require $root.'/mock/icons.php';
  return true;
}

/* ---- the Docker page -------------------------------------------------- */
if ($path === '/' || $path === '/index.php' || $path === '/Docker') {
  $_SERVER['DOCUMENT_ROOT'] = $root.'/mock';
  require $root.'/mock/index.php';
  return true;
}

http_response_code(404);
echo "not found: $path";
return true;
