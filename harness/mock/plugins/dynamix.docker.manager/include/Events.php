<?PHP
/* simple.folders harness - mock of Unraid's
 * /usr/local/emhttp/plugins/dynamix.docker.manager/include/Events.php
 *
 * Contract copied from webgui master (7.4.0-rc.2.1), read 2026-10-27. It is
 * byte-identical back to 7.2.1, which is why the plugin depends on it.
 *
 *   POST action=start|stop|restart|pause|resume|remove_container|remove_all
 *        container=<container id>
 *   -> {"success": true} | {"success": "<error message>"} | {"error": "..."}
 *
 * Note the quirk the real file has: failures come back as {"success": "msg"},
 * NOT {"error": ...}. Client code must treat success!==true as a failure.
 *
 * NOT part of the plugin package. Never shipped.
 */
require_once dirname(__DIR__, 3).'/state.php';

header('Content-Type: application/json');

$action    = $_POST['action']    ?? '';
$container = $_POST['container'] ?? '';

if (!$action || !$container) {
  die(json_encode(['error' => 'Missing parameters']));
}

$ct = harness_find($container);
if (!$ct) {
  die(json_encode(['success' => 'Container not found.  Try reloading this page to fix.']));
}

if (harness_should_fail($ct['name'], $action)) {
  die(json_encode(['success' => "Error: simulated failure on {$action} of {$ct['name']}"]));
}

/* Simulate the time docker actually takes. */
usleep((int)(harness_latency() * 1_000_000));

/* State machine mirroring dockerd's. Anything not allowed from the current
 * state returns an error string, as the real endpoint does. */
$transitions = [
  'start'   => ['stopped' => 'running'],
  'stop'    => ['running' => 'stopped', 'paused' => 'stopped'],
  'restart' => ['running' => 'running'],
  'pause'   => ['running' => 'paused'],
  'resume'  => ['paused'  => 'running'],
];

switch ($action) {
  case 'start': case 'stop': case 'restart': case 'pause': case 'resume':
    $from = $ct['state'];
    if (!isset($transitions[$action][$from])) {
      die(json_encode(['success' => "Error: cannot {$action} a {$from} container"]));
    }
    $to = $transitions[$action][$from];
    harness_mutate($container, function ($c) use ($to) {
      $c['state'] = $to;
      if ($to === 'stopped') { $c['cpu'] = 0; $c['mem'] = 0; }
      /* A container coming back up gets plausible figures again. */
      if ($to === 'running' && $c['mem'] == 0) {
        $c['cpu'] = round(mt_rand(1, 30) / 10, 1);
        $c['mem'] = mt_rand(30, 500) * 1024 * 1024;
      }
      return $c;
    });
    die(json_encode(['success' => true]));

  case 'remove_container':
  case 'remove_all':
    $all = array_values(array_filter(harness_load(), fn($c) => $c['id'] !== $ct['id']));
    harness_save($all);
    die(json_encode(['success' => true]));

  default:
    die(json_encode(['error' => "Unknown action '{$action}'"]));
}
