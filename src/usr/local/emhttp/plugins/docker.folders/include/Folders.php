<?PHP
/* docker.folders - creating, editing, moving and deleting folders.
 * Copyright (C) 2026  george
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
require_once __DIR__.'/lib/Store.php';
require_once __DIR__.'/lib/Containers.php';

df_require_post();

$action  = $_POST['action'] ?? '';
$folders = df_store_load();

try {
  switch ($action) {

    /* ------------------------------------------------------------------ */
    case 'save':
      $input = json_decode((string)($_POST['folder'] ?? ''), true);
      if (!is_array($input)) df_fail('Malformed folder payload');

      $name = df_clean_name((string)($input['name'] ?? ''));
      $id   = (string)($input['id'] ?? '');
      $editing = $id !== '' && df_find_folder($folders, $id) !== null;

      if (df_name_taken($folders, $name, $editing ? $id : null)) {
        df_fail('Another folder already uses this name');
      }

      $members = [];
      foreach ((array)($input['members'] ?? []) as $m) {
        $clean = df_clean_container_name((string)$m);
        if (!in_array($clean, $members, true)) $members[] = $clean;   // order = start order
      }

      $folder = [
        'id'          => $editing ? $id : df_unique_id($folders, $name),
        'name'        => $name,
        'color'       => df_clean_color((string)($input['color'] ?? 'slate')),
        'icon'        => df_store_normalise_icon($input['icon'] ?? null),
        'members'     => $members,
        'delay'       => df_clean_delay($input['delay'] ?? 0),
        'reverseStop' => df_clean_bool($input['reverseStop'] ?? true),
        'preview'     => df_clean_preview((string)($input['preview'] ?? 'status')),
        'rule'        => df_clean_rule((string)($input['rule'] ?? '')),
        'dashboard'   => df_clean_bool($input['dashboard'] ?? true),
      ];

      /* A container belongs to at most one folder (spec 9): saving here
       * takes these members away from wherever else they were. */
      $folders = df_detach_members($folders, $members, $folder['id']);

      if ($editing) {
        $folders[df_find_folder($folders, $id)] = $folder;
      } else {
        $folders[] = $folder;                                          // new folders go last
      }

      if (!df_store_save($folders)) df_fail('Could not write to '.DF_FOLDERS, 500);
      df_ok(['id' => $folder['id']]);
      break;

    /* ------------------------------------------------------------------ */
    case 'delete':
      $index = df_find_folder($folders, (string)($_POST['id'] ?? ''));
      if ($index === null) df_fail('That folder no longer exists');

      array_splice($folders, $index, 1);

      if (!df_store_save($folders)) df_fail('Could not write to '.DF_FOLDERS, 500);
      df_ok();
      break;

    /* ------------------------------------------------------------------ */
    case 'move':
      $index = df_find_folder($folders, (string)($_POST['id'] ?? ''));
      if ($index === null) df_fail('That folder no longer exists');

      $to = ($_POST['direction'] ?? '') === 'up' ? $index - 1 : $index + 1;
      if ($to < 0 || $to >= count($folders)) df_ok();                  // already at the end

      $moved = array_splice($folders, $index, 1);
      array_splice($folders, $to, 0, $moved);

      if (!df_store_save($folders)) df_fail('Could not write to '.DF_FOLDERS, 500);
      df_ok();
      break;

    /* ------------------------------------------------------------------
     * Move one container between folders, from its own menu.
     * An empty target folder means "remove from its folder".
     * ------------------------------------------------------------------ */
    case 'assign':
      $container = df_clean_container_name((string)($_POST['container'] ?? ''));
      $target    = (string)($_POST['folder'] ?? '');

      if ($target !== '' && df_find_folder($folders, $target) === null) {
        df_fail('That folder no longer exists');
      }

      $folders = df_detach_members($folders, [$container], $target);

      if ($target !== '') {
        $index = df_find_folder($folders, $target);
        if (!in_array($container, $folders[$index]['members'], true)) {
          $folders[$index]['members'][] = $container;                  // appended: starts last
        }
      } else {
        /* Removing from a folder only drops the explicit membership. If a
         * rule or a Docker label would pull the container straight back in,
         * the menu item would appear to do nothing - so say what is holding
         * it instead of silently failing. */
        foreach ($folders as $f) {
          if ($f['rule'] !== '' && @preg_match(df_rule_regex($f['rule']), $container) === 1) {
            df_fail('"'.$container.'" is added by the auto-add rule on "'.$f['name']
                   .'". Edit that rule to remove it.');
          }
        }

        foreach (df_containers() as $ct) {
          if ($ct['name'] !== $container) continue;
          $label = $ct['labels'][DF_LABEL] ?? null;
          if ($label !== null && $label !== '') {
            df_fail('"'.$container.'" carries the Docker label '.DF_LABEL.'="'.$label
                   .'". Remove that label from the container template to take it out.');
          }
        }
      }

      if (!df_store_save($folders)) df_fail('Could not write to '.DF_FOLDERS, 500);
      df_ok();
      break;

    /* ------------------------------------------------------------------ */
    default:
      df_fail('Unknown action');
  }
} catch (InvalidArgumentException $e) {
  df_fail($e->getMessage());
}
