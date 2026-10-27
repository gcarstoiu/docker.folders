<?PHP
/* docker.folders - local development harness.
 *
 * Mutable container state shared by every mock endpoint. Seeded from
 * harness/fixtures/containers.json on first use, then persisted to
 * harness/state/containers.json so actions survive across requests the way
 * real containers do.
 *
 * NOT part of the plugin package. Never shipped.
 */

define('HARNESS_ROOT', dirname(__DIR__));
define('HARNESS_STATE', HARNESS_ROOT.'/state/containers.json');
define('HARNESS_FIXTURES', HARNESS_ROOT.'/fixtures/containers.json');

/* Artificial latency (seconds) per simulated docker action, so the sequential
 * job engine in the UI is exercised against something that actually takes
 * time. Override with HARNESS_LATENCY=0 for fast test runs. */
function harness_latency(): float {
  $env = getenv('HARNESS_LATENCY');
  return $env === false ? 0.6 : (float)$env;
}

/* Containers whose next action must fail, as "name:action" or "name:*".
 * Set HARNESS_FAIL="sonarr:stop,radarr:*" to exercise the error paths. */
function harness_should_fail(string $name, string $action): bool {
  $spec = getenv('HARNESS_FAIL');
  if (!$spec) return false;
  foreach (explode(',', $spec) as $rule) {
    [$n, $a] = array_pad(explode(':', trim($rule), 2), 2, '*');
    if ($n === $name && ($a === '*' || $a === $action)) return true;
  }
  return false;
}

function harness_load(): array {
  if (!file_exists(HARNESS_STATE)) {
    @mkdir(dirname(HARNESS_STATE), 0755, true);
    $seed = json_decode(file_get_contents(HARNESS_FIXTURES), true);
    harness_save($seed['containers']);
    return $seed['containers'];
  }
  $raw = json_decode(file_get_contents(HARNESS_STATE), true);
  return is_array($raw) ? $raw : [];
}

function harness_save(array $containers): void {
  @mkdir(dirname(HARNESS_STATE), 0755, true);
  /* Write-replace so a concurrent read never sees a half-written file. */
  $tmp = HARNESS_STATE.'.tmp';
  file_put_contents($tmp, json_encode($containers, JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES));
  rename($tmp, HARNESS_STATE);
}

/* Mutate one container under an exclusive lock and return the new state. */
function harness_mutate(string $key, callable $fn) {
  $lock = fopen(HARNESS_STATE.'.lock', 'c');
  flock($lock, LOCK_EX);
  try {
    $containers = harness_load();
    $found = null;
    foreach ($containers as $i => $ct) {
      if ($ct['id'] === $key || $ct['name'] === $key) { $found = $i; break; }
    }
    if ($found === null) return null;
    $result = $fn($containers[$found]);
    if (is_array($result)) {
      $containers[$found] = $result;
      harness_save($containers);
    }
    return $containers[$found];
  } finally {
    flock($lock, LOCK_UN);
    fclose($lock);
  }
}

function harness_find(string $key): ?array {
  foreach (harness_load() as $ct) {
    if ($ct['id'] === $key || $ct['name'] === $key) return $ct;
  }
  return null;
}

/* Jitter the live CPU/memory figures so the dockerload stream looks alive. */
function harness_jitter(array $ct): array {
  if ($ct['state'] !== 'running') { $ct['cpu'] = 0; $ct['mem'] = 0; return $ct; }
  $ct['cpu'] = round(max(0.1, $ct['cpu'] * (0.85 + mt_rand(0, 300) / 1000)), 1);
  $ct['mem'] = (int)($ct['mem'] * (0.97 + mt_rand(0, 60) / 1000));
  return $ct;
}
