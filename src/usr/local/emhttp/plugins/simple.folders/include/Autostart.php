<?PHP
/* simple.folders - writing folder start order into Unraid's autostart file.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 *   POST action=apply [id=<folder id>]     reorder the autostart file
 *
 * DESIGN_SPEC.md 13.9: folder start order DRIVES Unraid's own order rather
 * than shadowing it. /var/lib/docker/unraid-autostart holds one
 * "<name> <wait>" line per autostarted container, in start order, and the
 * array start script walks it top to bottom. So applying a folder's order
 * means rewriting that file - after which a boot starts containers in the
 * same order, and with the same delays, as the folder's own "Start all".
 *
 * Containers that belong to no folder keep their existing relative order and
 * are appended, so this never reorders anything the user did not ask about.
 */

require_once __DIR__.'/lib/Paths.php';
require_once __DIR__.'/lib/Guard.php';

/* Armed before any further include, so a failure inside Unraid's own
 * DockerClient.php is reported as JSON rather than a blank 500. */
sf_install_error_handler();

require_once __DIR__.'/lib/Store.php';
require_once __DIR__.'/lib/Containers.php';

sf_require_post();

if (($_POST['action'] ?? '') !== 'apply') sf_fail('Unknown action');

$file = SF_DOCKER_MAN_AUTOSTART;
if (!is_file($file)) sf_fail('Unraid\'s autostart file does not exist yet', 409);

$containers = sf_containers();
$folders    = sf_store_load();
$assigned   = sf_resolve_membership($folders, $containers);

/* Current contents: [name => wait], in the order Unraid has them. */
$current = [];
foreach ((array)@file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
  $parts = preg_split('/\s+/', trim($line), 2);
  if (($parts[0] ?? '') === '') continue;
  $current[$parts[0]] = isset($parts[1]) ? (int)$parts[1] : 0;
}

$lines = [];
$placed = [];

/* Folders first, in folder order, each member in its start order. The
 * folder's delay becomes the wait on every member after the first - which is
 * exactly what "starts N s apart" means at boot. */
foreach ($folders as $folder) {
  $members = sf_folder_members($folder, $assigned, $containers);
  $position = 0;

  foreach ($members as $name) {
    if (!array_key_exists($name, $current)) continue;   // not set to autostart
    $wait = $position === 0 ? 0 : (int)$folder['delay'];
    $lines[] = $name.' '.$wait;
    $placed[$name] = true;
    $position++;
  }
}

/* Then everything else, in the order Unraid already had. */
foreach ($current as $name => $wait) {
  if (isset($placed[$name])) continue;
  $lines[] = $name.' '.(int)$wait;
}

if (!sf_write_atomic($file, implode(PHP_EOL, $lines).PHP_EOL)) {
  sf_fail('Could not write '.$file, 500);
}

sf_ok(['lines' => count($lines)]);
