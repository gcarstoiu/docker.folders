<?PHP
/* simple.folders harness - mock of Unraid's DockerUpdate.php.
 *
 * The real file downloads templates and refreshes every container's
 * update-available flag, then returns nothing. "Check for updates" in the UI
 * is a bare POST to it followed by a reload.
 *
 * Here it re-randomises which containers have updates, so the UI's
 * check -> badge -> update flow can be exercised repeatedly.
 *
 * NOT part of the plugin package. Never shipped.
 */
require_once dirname(__DIR__, 3).'/state.php';

usleep((int)(harness_latency() * 2_000_000));

$only = $_POST['containers'] ?? '';            // harness extra: scope the check
$scope = $only ? explode(',', $only) : null;

$containers = harness_load();
foreach ($containers as $i => $ct) {
  if ($scope && !in_array($ct['name'], $scope, true)) continue;
  /* Keep existing updates pending; occasionally surface a new one. */
  if (empty($ct['update'])) $containers[$i]['update'] = mt_rand(1, 100) <= 20 ? 1 : 0;
}
harness_save($containers);
