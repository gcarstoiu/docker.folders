<?PHP
/* docker.folders - exporting and importing folder definitions.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 *   GET  ?action=export            download folders.json
 *   POST action=import payload=<json>
 *
 * An import replaces every folder definition and NEVER touches a container:
 * nothing is started, stopped, removed or recreated. Containers are
 * referenced by name, so a backup restores onto a rebuilt server as long as
 * the container names match.
 */

require_once __DIR__.'/lib/Paths.php';
require_once __DIR__.'/lib/Guard.php';

/* Armed before any further include, so a failure inside Unraid's own
 * DockerClient.php is reported as JSON rather than a blank 500. */
df_install_error_handler();

require_once __DIR__.'/lib/Store.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
  if (($_GET['action'] ?? '') !== 'export') df_fail('Unknown action');

  $payload = json_encode([
    'version'    => DF_SCHEMA_VERSION,
    'exported'   => gmdate('c'),
    'folders'    => df_store_load(),
  ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

  header('Content-Type: application/json');
  header('Content-Disposition: attachment; filename="docker.folders-'.gmdate('Ymd-Hi').'.json"');
  header('Content-Length: '.strlen($payload));
  echo $payload;
  exit;
}

df_require_post();

if (($_POST['action'] ?? '') !== 'import') df_fail('Unknown action');

$raw = json_decode((string)($_POST['payload'] ?? ''), true);
if (!is_array($raw)) df_fail('That file is not valid JSON');

/* Accept both the export wrapper and a bare folders.json. */
$list = $raw['folders'] ?? null;
if (!is_array($list)) df_fail('That file does not contain any folders');

/* Run every entry through the same normaliser the store uses, so an
 * imported file cannot introduce a shape the rest of the code does not
 * expect. Entries that cannot be salvaged are dropped, not guessed at. */
$folders = [];
$seenIds = [];
$seenNames = [];
$skipped = 0;

foreach ($list as $entry) {
  $folder = df_store_normalise($entry);
  if ($folder === null) { $skipped++; continue; }

  /* Ids and names must stay unique, whatever the file says. */
  if (isset($seenNames[mb_strtolower($folder['name'])])) { $skipped++; continue; }
  if (isset($seenIds[$folder['id']])) $folder['id'] = df_unique_id($folders, $folder['name']);

  $seenIds[$folder['id']] = true;
  $seenNames[mb_strtolower($folder['name'])] = true;
  $folders[] = $folder;
}

/* One container, one folder - the file may not have respected that. */
$claimed = [];
foreach ($folders as $i => $folder) {
  $keep = [];
  foreach ($folder['members'] as $name) {
    if (isset($claimed[$name])) continue;
    $claimed[$name] = true;
    $keep[] = $name;
  }
  $folders[$i]['members'] = $keep;
}

if (!df_store_save($folders)) df_fail('Could not write to '.DF_FOLDERS, 500);

df_ok(['folders' => count($folders), 'skipped' => $skipped]);
