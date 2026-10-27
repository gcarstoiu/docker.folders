<?PHP
/* simple.folders harness - mock of Unraid's UpdateConfig.php.
 *
 *   POST action=autostart container=<name> auto=true|false wait=<seconds>
 *   POST action=wait      container=<name> wait=<seconds>
 *
 * The real file rewrites /var/lib/docker/unraid-autostart, whose lines are
 * "<name> <wait>" in start order. Here that file is mocked at
 * harness/state/unraid-autostart so the plugin's autostart writes are visible.
 *
 * NOT part of the plugin package. Never shipped.
 */
require_once dirname(__DIR__, 3).'/state.php';

$action    = $_POST['action']    ?? '';
$container = $_POST['container'] ?? '';
$auto      = ($_POST['auto'] ?? 'false') === 'true';
$wait      = (int)($_POST['wait'] ?? 0);

if ($container) {
  harness_mutate($container, function ($c) use ($action, $auto, $wait) {
    if ($action === 'autostart') { $c['autostart'] = $auto; $c['wait'] = $wait; }
    if ($action === 'wait')      { $c['wait'] = $wait; }
    return $c;
  });
}

/* Rebuild the autostart file the way Unraid stores it. */
$lines = [];
foreach (harness_load() as $ct) {
  if (!empty($ct['autostart'])) $lines[] = $ct['name'].' '.(int)($ct['wait'] ?? 0);
}
file_put_contents(HARNESS_ROOT.'/state/unraid-autostart', implode(PHP_EOL, $lines).PHP_EOL);
