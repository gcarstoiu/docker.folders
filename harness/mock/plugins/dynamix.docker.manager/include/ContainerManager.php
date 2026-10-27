<?PHP
/* simple.folders harness - mock of Unraid's ContainerManager.php.
 *
 *   POST action=start|stop|pause|unpause
 *
 * Acts on EVERY container in the matching state, in the order recorded in
 * userprefs.cfg (reversed for stop). The plugin does not use this - folder
 * scoped bulk actions are sequential Events.php calls instead - but "Start
 * All"/"Stop All" in Classic view do, so it has to work.
 *
 * NOT part of the plugin package. Never shipped.
 */
require_once dirname(__DIR__, 3).'/state.php';

$action = $_POST['action'] ?? '';
$from = ['start' => 'stopped', 'stop' => 'running', 'pause' => 'running', 'unpause' => 'paused'][$action] ?? null;
$to   = ['start' => 'running', 'stop' => 'stopped', 'pause' => 'paused',  'unpause' => 'running'][$action] ?? null;
if (!$from) exit;

$containers = harness_load();
if ($action === 'stop') $containers = array_reverse($containers);

foreach ($containers as $ct) {
  if ($ct['state'] !== $from) continue;
  usleep((int)(harness_latency() * 200_000));
  harness_mutate($ct['id'], function ($c) use ($to) {
    $c['state'] = $to;
    if ($to === 'stopped') { $c['cpu'] = 0; $c['mem'] = 0; }
    return $c;
  });
}
