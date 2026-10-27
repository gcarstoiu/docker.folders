<?PHP
/* simple.folders harness - mock of Unraid's nchan endpoints (/sub/<channel>).
 *
 * On a real server nginx+nchan serves these, and the webGUI subscribes with
 * the bundled NchanSubscriber over a websocket. PHP's built-in server cannot
 * do websockets, so this implements the long-poll transport NchanSubscriber
 * also speaks: the client sends If-None-Match with the last message id, and we
 * block until a newer message exists, then return exactly one message with the
 * next id in Etag.
 *
 * Channels mocked:
 *   docker     - progress log written by scripts/update_container
 *   dockerload - "<id>;<cpu%>;<mem>/<limit>" lines, republished ~1/s
 *
 * NOT part of the plugin package. Never shipped.
 */
require_once __DIR__.'/state.php';

$channel = $_GET['channel'] ?? '';
$since   = (int)preg_replace('/\D/', '', $_SERVER['HTTP_IF_NONE_MATCH'] ?? '0');

header('Cache-Control: no-store');

/* ---------------------------------------------------------------------- */
if ($channel === 'dockerload') {
  /* Live stats. The real channel republishes roughly every second, so hold
   * the request briefly and then answer - that paces the client for us. */
  usleep(900_000);
  $lines = [];
  foreach (harness_load() as $ct) {
    $ct = harness_jitter($ct);
    if ($ct['state'] !== 'running') continue;
    $mem = $ct['mem'] >= 1073741824
      ? round($ct['mem'] / 1073741824, 2).'GiB'
      : round($ct['mem'] / 1048576).'MiB';
    $lines[] = "{$ct['id']};{$ct['cpu']}%;{$mem} / 16GiB";
  }
  header('Etag: '.($since + 1));
  echo implode("\n", $lines);
  exit;
}

/* ---------------------------------------------------------------------- */
if ($channel === 'docker') {
  $log = HARNESS_ROOT.'/state/nchan-docker.log';

  /* Block (bounded) until a message newer than $since shows up. */
  $deadline = microtime(true) + 25;
  while (microtime(true) < $deadline) {
    $messages = file_exists($log)
      ? array_values(array_filter(explode("\x1e", file_get_contents($log)), fn($m) => trim($m) !== ''))
      : [];
    if (count($messages) > $since) {
      header('Etag: '.($since + 1));
      echo trim($messages[$since], "\n");
      exit;
    }
    usleep(120_000);
  }

  /* Nothing new - 304 keeps the subscriber polling without emitting a message. */
  http_response_code(304);
  exit;
}

http_response_code(404);
