<?PHP
/* simple.folders - running Unraid's container update.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 *   POST action=start containers=<name,name,...>  -> { ok, job }
 *   GET  ?job=<id>                                -> { ok, finished, containers[] }
 *
 * WHY THIS SHELLS OUT
 * -------------------
 * Updating a container is pull + stop + remove + recreate from its user
 * template, restoring the previous running state. Unraid already does exactly
 * that in scripts/update_container, and doing it ourselves would mean
 * reimplementing xmlToCommand() and letting our copy drift from the
 * templates. So we run their script and watch it (DESIGN_SPEC.md 13.3).
 *
 * "Update" and "force update" are the SAME operation. The script always pulls
 * and recreates; core's own Update All differs only in which containers it
 * passes. The two menu items therefore differ only in their target list.
 *
 * Progress is tracked by polling this endpoint rather than by parsing the
 * script's nchan log: that log's text is translated on a non-English server,
 * so matching against it would silently stop working.
 */

require_once __DIR__.'/lib/Paths.php';
require_once __DIR__.'/lib/Guard.php';

/* Armed before any further include, so a failure inside Unraid's own
 * DockerClient.php is reported as JSON rather than a blank 500. */
sf_install_error_handler();

require_once __DIR__.'/lib/Containers.php';

sf_ensure_dirs();

/* ------------------------------------------------------------------------
 * GET: job status
 * ---------------------------------------------------------------------- */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
  $job = preg_replace('/[^a-f0-9]/', '', (string)($_GET['job'] ?? ''));
  if ($job === '') sf_fail('Missing job id');

  $state = sf_job_read($job);
  if ($state === null) sf_fail('That update job is no longer known');

  sf_json(['ok' => true] + sf_job_progress($state, $job));
}

/* ------------------------------------------------------------------------
 * POST: start a job
 * ---------------------------------------------------------------------- */
sf_require_post();

if (($_POST['action'] ?? '') !== 'start') sf_fail('Unknown action');

$names = [];
foreach (explode(',', (string)($_POST['containers'] ?? '')) as $raw) {
  $raw = trim($raw);
  if ($raw === '') continue;
  try { $names[] = sf_clean_container_name($raw); }
  catch (InvalidArgumentException $e) { sf_fail($e->getMessage()); }
}
if (!$names) sf_fail('No containers to update');

/* Only containers that actually exist, so a stale page cannot make the
 * script churn through names that are gone. */
$known = [];
foreach (sf_containers() as $ct) {
  $known[$ct['name']] = ['state' => $ct['state'], 'update' => (int)$ct['update']];
}
foreach ($names as $name) {
  if (!isset($known[$name])) sf_fail('No such container: '.$name);
}

$script = SF_DOCKER_MAN.'/scripts/update_container';
if (!is_file($script)) sf_fail('Unraid\'s update_container script is missing', 500);

$job = bin2hex(random_bytes(8));
$dir = SF_RUN_DIR.'/'.$job;
@mkdir($dir, 0755, true);

/* Snapshot the state and the update flag of every target, so progress can be
 * derived later by diffing against the live list. */
$before = [];
foreach ($names as $name) $before[$name] = $known[$name];

sf_write_atomic($dir.'/job.json', json_encode([
  'containers' => $names,
  'before'     => $before,
  'started'    => time(),
]));

/* The script takes names joined by "*", URL-encoded. It writes its progress
 * to nchan, not to stdout, so stdout only carries PHP errors - worth
 * keeping for diagnosis. Detached, because a pull can run for minutes and
 * must survive the browser navigating away. */
$arg = escapeshellarg(implode('*', array_map('rawurlencode', $names)));
$cmd = escapeshellcmd($script).' '.$arg
     .' > '.escapeshellarg($dir.'/out.log').' 2>&1'
     .'; echo $? > '.escapeshellarg($dir.'/exit');

exec('nohup sh -c '.escapeshellarg($cmd).' > /dev/null 2>&1 & echo $!', $out);

sf_ok(['job' => $job]);

/* ------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------- */

function sf_job_read(string $job): ?array {
  $file = SF_RUN_DIR.'/'.$job.'/job.json';
  if (!is_file($file)) return null;
  $data = json_decode((string)@file_get_contents($file), true);
  return is_array($data) ? $data : null;
}

/* Work out where the job is by comparing the live container list against the
 * snapshot taken when it started.
 *
 * A container being updated is removed and recreated, so it passes through
 * "not present" and comes back with update cleared. That transition is the
 * language-independent signal we key on.
 */
function sf_job_progress(array $state, string $job): array {
  $dir = SF_RUN_DIR.'/'.$job;
  $finished = is_file($dir.'/exit');

  $live = [];
  foreach (sf_containers() as $ct) $live[$ct['name']] = $ct;

  $rows = [];
  $activeSeen = false;

  foreach ($state['containers'] as $name) {
    $ct = $live[$name] ?? null;

    if ($finished) {
      if ($ct === null) {
        $rows[] = ['name' => $name, 'status' => 'failed', 'note' => 'missing after update'];
      } else {
        $wasRunning = (($state['before'][$name]['state'] ?? '') !== 'stopped');
        $rows[] = [
          'name'   => $name,
          'status' => 'done',
          'note'   => $wasRunning ? 'updated' : 'updated, left stopped',
        ];
      }
      continue;
    }

    /* Gone from the list: it is being recreated right now. */
    if ($ct === null) {
      $rows[] = ['name' => $name, 'status' => 'active', 'note' => 'recreating'];
      $activeSeen = true;
      continue;
    }

    /* Flag cleared while the job runs means this one is through. */
    if ((int)$ct['update'] === 0 && (int)($state['before'][$name]['update'] ?? 1) !== 0) {
      $rows[] = ['name' => $name, 'status' => 'done', 'note' => 'updated'];
      continue;
    }

    if (!$activeSeen) {
      $rows[] = ['name' => $name, 'status' => 'active', 'note' => 'pulling'];
      $activeSeen = true;
    } else {
      $rows[] = ['name' => $name, 'status' => 'queued', 'note' => 'queued'];
    }
  }

  /* Tidy up a finished job's scratch directory on the read that reports it,
   * so /var/tmp does not accumulate one directory per update forever. */
  if ($finished) sf_job_cleanup($dir);

  return ['finished' => $finished, 'containers' => $rows];
}

function sf_job_cleanup(string $dir): void {
  /* Keep it briefly so a slow poll still sees the result. */
  if (!is_file($dir.'/exit') || (time() - (int)@filemtime($dir.'/exit')) < 30) return;
  foreach (glob($dir.'/*') ?: [] as $file) @unlink($file);
  @rmdir($dir);
}
