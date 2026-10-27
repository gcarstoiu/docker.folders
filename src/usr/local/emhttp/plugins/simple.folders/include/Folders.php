<?PHP
/* simple.folders - creating, editing, moving and deleting folders.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 *   POST action=save   folder=<json>        create or update
 *   POST action=delete id=<folder id>
 *   POST action=move   id=<id> direction=up|down
 *   POST action=assign container=<name> folder=<id|"">
 *
 * DELETING A FOLDER NEVER TOUCHES A CONTAINER. Neither does editing one.
 * Only the definition in folders.json changes; every container keeps running
 * exactly as it was (DESIGN_SPEC.md 8, and the brief's standing rule).
 *
 * CSRF is enforced before this file runs - see lib/Guard.php.
 */

require_once __DIR__.'/lib/Paths.php';
require_once __DIR__.'/lib/Guard.php';

/* Armed before any further include, so a failure inside Unraid's own
 * DockerClient.php is reported as JSON rather than a blank 500. */
sf_install_error_handler();

require_once __DIR__.'/lib/Store.php';
require_once __DIR__.'/lib/Containers.php';

sf_require_post();

$action  = $_POST['action'] ?? '';
$folders = sf_store_load();

try {
  switch ($action) {

    /* ------------------------------------------------------------------ */
    case 'save':
      $input = json_decode((string)($_POST['folder'] ?? ''), true);
      if (!is_array($input)) sf_fail('Malformed folder payload');

      $name = sf_clean_name((string)($input['name'] ?? ''));
      $id   = (string)($input['id'] ?? '');
      $editing = $id !== '' && sf_find_folder($folders, $id) !== null;

      if (sf_name_taken($folders, $name, $editing ? $id : null)) {
        sf_fail('Another folder already uses this name');
      }

      $members = [];
      foreach ((array)($input['members'] ?? []) as $m) {
        $clean = sf_clean_container_name((string)$m);
        if (!in_array($clean, $members, true)) $members[] = $clean;   // order = start order
      }

      $folder = [
        'id'          => $editing ? $id : sf_unique_id($folders, $name),
        'name'        => $name,
        'color'       => sf_clean_color((string)($input['color'] ?? 'slate')),
        'icon'        => sf_store_normalise_icon($input['icon'] ?? null),
        'members'     => $members,
        'delay'       => sf_clean_delay($input['delay'] ?? 0),
        'reverseStop' => sf_clean_bool($input['reverseStop'] ?? true),
        'preview'     => sf_clean_preview((string)($input['preview'] ?? 'status')),
        'rule'        => sf_clean_rule((string)($input['rule'] ?? '')),
        'dashboard'   => sf_clean_bool($input['dashboard'] ?? true),
      ];

      /* A container belongs to at most one folder (spec 9): saving here
       * takes these members away from wherever else they were. */
      $folders = sf_detach_members($folders, $members, $folder['id']);

      if ($editing) {
        $folders[sf_find_folder($folders, $id)] = $folder;
      } else {
        $folders[] = $folder;                                          // new folders go last
      }

      if (!sf_store_save($folders)) sf_fail('Could not write to '.SF_FOLDERS, 500);
      sf_ok(['id' => $folder['id']]);
      break;

    /* ------------------------------------------------------------------ */
    case 'delete':
      $index = sf_find_folder($folders, (string)($_POST['id'] ?? ''));
      if ($index === null) sf_fail('That folder no longer exists');

      array_splice($folders, $index, 1);

      if (!sf_store_save($folders)) sf_fail('Could not write to '.SF_FOLDERS, 500);
      sf_ok();
      break;

    /* ------------------------------------------------------------------ */
    case 'move':
      $index = sf_find_folder($folders, (string)($_POST['id'] ?? ''));
      if ($index === null) sf_fail('That folder no longer exists');

      $to = ($_POST['direction'] ?? '') === 'up' ? $index - 1 : $index + 1;
      if ($to < 0 || $to >= count($folders)) sf_ok();                  // already at the end

      $moved = array_splice($folders, $index, 1);
      array_splice($folders, $to, 0, $moved);

      if (!sf_store_save($folders)) sf_fail('Could not write to '.SF_FOLDERS, 500);
      sf_ok();
      break;

    /* ------------------------------------------------------------------
     * Move one container between folders, from its own menu.
     * An empty target folder means "remove from its folder".
     * ------------------------------------------------------------------ */
    case 'assign':
      $container = sf_clean_container_name((string)($_POST['container'] ?? ''));
      $target    = (string)($_POST['folder'] ?? '');

      if ($target !== '' && sf_find_folder($folders, $target) === null) {
        sf_fail('That folder no longer exists');
      }

      $folders = sf_detach_members($folders, [$container], $target);

      if ($target !== '') {
        $index = sf_find_folder($folders, $target);
        if (!in_array($container, $folders[$index]['members'], true)) {
          $folders[$index]['members'][] = $container;                  // appended: starts last
        }
      } else {
        /* Removing from a folder only drops the explicit membership. If a
         * rule or a Docker label would pull the container straight back in,
         * the menu item would appear to do nothing - so say what is holding
         * it instead of silently failing. */
        foreach ($folders as $f) {
          if ($f['rule'] !== '' && @preg_match(sf_rule_regex($f['rule']), $container) === 1) {
            sf_fail('"'.$container.'" is added by the auto-add rule on "'.$f['name']
                   .'". Edit that rule to remove it.');
          }
        }

        foreach (sf_containers() as $ct) {
          if ($ct['name'] !== $container) continue;
          foreach ([SF_LABEL, SF_LABEL_LEGACY] as $key) {
            $label = $ct['labels'][$key] ?? null;
            if ($label !== null && $label !== '') {
              sf_fail('"'.$container.'" carries the Docker label '.$key.'="'.$label
                     .'". Remove that label from the container template to take it out.');
            }
          }
        }
      }

      if (!sf_store_save($folders)) sf_fail('Could not write to '.SF_FOLDERS, 500);
      sf_ok();
      break;

    /* ------------------------------------------------------------------
     * Set a folder's member order outright.
     *
     * "move up / move down" can express any reordering one step at a time;
     * a drag cannot, so it needs to post the whole list. Only containers
     * already explicitly in this folder are accepted - a drag must not be
     * able to pull in a container that is only here because of a rule or a
     * label, since the order of those is derived, not stored.
     * ------------------------------------------------------------------ */
    case 'reorder':
      $index = sf_find_folder($folders, (string)($_POST['id'] ?? ''));
      if ($index === null) sf_fail('That folder no longer exists');

      $wanted = [];
      foreach (explode(',', (string)($_POST['members'] ?? '')) as $raw) {
        $raw = trim($raw);
        if ($raw === '') continue;
        $wanted[] = sf_clean_container_name($raw);
      }

      $current = $folders[$index]['members'];
      $ordered = [];
      foreach ($wanted as $name) {
        if (in_array($name, $current, true) && !in_array($name, $ordered, true)) $ordered[] = $name;
      }
      /* Anything the client did not mention keeps its place at the end,
       * so a stale page cannot silently drop members. */
      foreach ($current as $name) {
        if (!in_array($name, $ordered, true)) $ordered[] = $name;
      }

      $folders[$index]['members'] = $ordered;
      if (!sf_store_save($folders)) sf_fail('Could not write to '.SF_FOLDERS, 500);
      sf_ok(['members' => $ordered]);
      break;

    /* ------------------------------------------------------------------
     * Set the order of the folders themselves.
     * ------------------------------------------------------------------ */
    case 'sort':
      $wanted = array_filter(array_map('trim', explode(',', (string)($_POST['ids'] ?? ''))));

      $byId = [];
      foreach ($folders as $f) $byId[$f['id']] = $f;

      $sorted = [];
      foreach ($wanted as $id) {
        if (isset($byId[$id])) { $sorted[] = $byId[$id]; unset($byId[$id]); }
      }
      foreach ($byId as $f) $sorted[] = $f;        // anything unmentioned, in place

      if (!sf_store_save($sorted)) sf_fail('Could not write to '.SF_FOLDERS, 500);
      sf_ok(['count' => count($sorted)]);
      break;

    /* ------------------------------------------------------------------
     * Move a container into a folder AT a position - what a drop onto a
     * particular row means, as opposed to "assign", which appends.
     * ------------------------------------------------------------------ */
    case 'insert':
      $container = sf_clean_container_name((string)($_POST['container'] ?? ''));
      $target    = (string)($_POST['folder'] ?? '');
      $at        = max(0, (int)($_POST['index'] ?? 0));

      if ($target === '') sf_fail('No destination folder given');
      if (sf_find_folder($folders, $target) === null) sf_fail('That folder no longer exists');

      $folders = sf_detach_members($folders, [$container], '');
      $index = sf_find_folder($folders, $target);

      $members = $folders[$index]['members'];
      $at = min($at, count($members));
      array_splice($members, $at, 0, [$container]);
      $folders[$index]['members'] = $members;

      if (!sf_store_save($folders)) sf_fail('Could not write to '.SF_FOLDERS, 500);
      sf_ok();
      break;

    /* ------------------------------------------------------------------ */
    default:
      sf_fail('Unknown action');
  }
} catch (InvalidArgumentException $e) {
  sf_fail($e->getMessage());
}
