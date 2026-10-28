<?PHP
/* simple.folders - the container display order.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 *   POST action=set names=<name,name,...>
 *
 * Writes Unraid's own userprefs.cfg - the file its lock-and-drag on the
 * stock Docker page maintains - so both tables agree on the order. One
 * <index>="<name>" line per container.
 *
 * WHY NOT CALL UNRAID'S OWN UserPrefs.php
 * ---------------------------------------
 * Because it does two things, and only one of them is wanted here. As well
 * as saving the display order it re-sorts /var/lib/docker/unraid-autostart
 * to match, which would silently undo the START order a folder owns - the
 * whole point of a folder's "starts 5 s apart" and its ordered member list.
 *
 * So this writes the display order and nothing else. Start order stays with
 * the folders, where the user set it, and is written by Autostart.php.
 */

require_once __DIR__.'/lib/Paths.php';
require_once __DIR__.'/lib/Guard.php';

sf_install_error_handler();

require_once __DIR__.'/lib/Containers.php';

sf_require_post();

if (($_POST['action'] ?? '') !== 'set') sf_fail('Unknown action');

$wanted = [];
foreach (explode(',', (string)($_POST['names'] ?? '')) as $raw) {
  $raw = trim($raw);
  if ($raw === '') continue;
  try { $wanted[] = sf_clean_container_name($raw); }
  catch (InvalidArgumentException $e) { sf_fail($e->getMessage()); }
}
if (!$wanted) sf_fail('No order given');

/* Only containers that exist, and each one once. Anything the client did not
 * mention keeps a place at the end, so a stale page cannot drop a container
 * out of the ordering altogether. */
$live = [];
foreach (sf_containers() as $ct) $live[$ct['name']] = true;

$ordered = [];
foreach ($wanted as $name) {
  if (isset($live[$name]) && !in_array($name, $ordered, true)) $ordered[] = $name;
}
foreach (array_keys($live) as $name) {
  if (!in_array($name, $ordered, true)) $ordered[] = $name;
}

$lines = [];
foreach ($ordered as $i => $name) {
  /* Same shape UserPrefs.php writes: the index is the key. */
  $lines[] = $i.'="'.$name.'"';
}

if (!sf_write_atomic(SF_USER_PREFS, implode("\n", $lines)."\n")) {
  sf_fail('Could not write '.SF_USER_PREFS, 500);
}

sf_ok(['count' => count($ordered)]);
