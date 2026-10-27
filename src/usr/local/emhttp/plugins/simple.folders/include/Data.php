<?PHP
/* simple.folders - the page's single read endpoint.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 *   GET include/Data.php  ->  { ok, folders[], containers[], loose[], stats{} }
 *
 * One request returns everything the table needs, so a refresh is atomic: the
 * folder list and the container list can never disagree about who is where.
 *
 * CPU and memory are absent on purpose - they arrive over the dockerload
 * nchan channel. See lib/Containers.php.
 */

require_once __DIR__.'/lib/Paths.php';
require_once __DIR__.'/lib/Guard.php';

/* Armed before any further include, so a failure inside Unraid's own
 * DockerClient.php is reported as JSON rather than a blank 500. */
sf_install_error_handler();

require_once __DIR__.'/lib/Store.php';
require_once __DIR__.'/lib/Containers.php';

$containers = sf_containers();
$folders    = sf_store_load();
$assigned   = sf_resolve_membership($folders, $containers);

/* Attach resolved membership to each folder, and record how each member got
 * there so the editor can show rule/label members as not directly removable. */
$outFolders = [];
foreach ($folders as $folder) {
  $members = sf_folder_members($folder, $assigned, $containers);

  $via = [];
  foreach ($members as $name) {
    $via[$name] = in_array($name, $folder['members'], true) ? 'explicit' : 'auto';
  }

  $outFolders[] = $folder + [
    'resolved' => $members,
    'via'      => $via,
  ];
}

/* Containers in no folder at all, in the order they will be listed under
 * "Not in a folder". */
$loose = [];
foreach ($containers as $ct) {
  if (!isset($assigned[$ct['name']])) $loose[] = $ct['name'];
}

/* Header summary line: "16 containers - 13 running - 3 folders - 4 updates ready" */
$running = 0; $updates = 0;
foreach ($containers as $ct) {
  if ($ct['state'] === 'running') $running++;
  if ($ct['update'] === 1)        $updates++;
}

sf_ok([
  'folders'    => $outFolders,
  'containers' => $containers,
  'loose'      => $loose,
  'assigned'   => $assigned,
  'stats'      => [
    'containers' => count($containers),
    'running'    => $running,
    'folders'    => count($outFolders),
    'updates'    => $updates,
  ],
  /* Unraid's own container start order, as recorded in the autostart file.
   * Global Start/Stop from the action bar follow it, so a manual "start
   * everything" matches what happens at boot. */
  'order'      => sf_autostart_order(),

  /* Lets the client notice a server-side change it did not make. */
  'revision'   => is_file(SF_FOLDERS) ? (int)@filemtime(SF_FOLDERS) : 0,
]);
