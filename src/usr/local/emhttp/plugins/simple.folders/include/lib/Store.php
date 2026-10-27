<?PHP
/* simple.folders - folder definitions and membership resolution.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 * Shape on disk (DESIGN_SPEC.md 11):
 *
 *   { "version": 1, "folders": [ { id, name, color, icon, members[],
 *                                  delay, reverseStop, preview, rule,
 *                                  dashboard } ] }
 *
 * "members" is ordered and IS the start order. Containers are keyed by name,
 * not id: updating a container removes and recreates it, which changes its id
 * but keeps its name.
 *
 * Fold state is NOT stored here. It is a per-viewer preference and lives in
 * the browser (DESIGN_SPEC.md 11), so two people looking at the same server
 * do not fight over each other's open folders.
 */

require_once __DIR__.'/Paths.php';
require_once __DIR__.'/Guard.php';

const SF_SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------------
 * Load / save
 * ---------------------------------------------------------------------- */

function sf_store_load(): array {
  if (!is_file(SF_FOLDERS)) return [];

  $raw = json_decode((string)@file_get_contents(SF_FOLDERS), true);
  if (!is_array($raw) || !isset($raw['folders']) || !is_array($raw['folders'])) return [];

  $folders = [];
  foreach ($raw['folders'] as $f) {
    $folder = sf_store_normalise($f);
    if ($folder !== null) $folders[] = $folder;
  }
  return $folders;
}

function sf_store_save(array $folders): bool {
  sf_ensure_dirs();
  $payload = json_encode(
    ['version' => SF_SCHEMA_VERSION, 'folders' => array_values($folders)],
    JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
  );
  return sf_write_atomic(SF_FOLDERS, $payload."\n");
}

/* Coerce one stored folder into a known-good shape. Returns null for junk,
 * so a hand-edited or partially written file degrades to "that folder is
 * gone" rather than breaking the whole page. */
function sf_store_normalise($f): ?array {
  if (!is_array($f) || !isset($f['name'])) return null;

  try {
    $name = sf_clean_name((string)$f['name']);
  } catch (InvalidArgumentException $e) {
    return null;
  }

  $members = [];
  foreach ((array)($f['members'] ?? []) as $m) {
    try {
      $clean = sf_clean_container_name((string)$m);
      if (!in_array($clean, $members, true)) $members[] = $clean;   // order preserved
    } catch (InvalidArgumentException $e) {
      /* drop silently: the container name is unusable */
    }
  }

  $rule = '';
  try { $rule = sf_clean_rule((string)($f['rule'] ?? '')); }
  catch (InvalidArgumentException $e) { $rule = ''; }

  return [
    'id'          => preg_match('/^[a-z0-9-]{1,48}$/', (string)($f['id'] ?? '')) ? $f['id'] : 'f-'.sf_slug($name),
    'name'        => $name,
    'color'       => sf_clean_color((string)($f['color'] ?? 'slate')),
    'icon'        => sf_store_normalise_icon($f['icon'] ?? null),
    'members'     => $members,
    'delay'       => sf_clean_delay($f['delay'] ?? 0),
    'reverseStop' => sf_clean_bool($f['reverseStop'] ?? true),
    'preview'     => sf_clean_preview((string)($f['preview'] ?? 'status')),
    'rule'        => $rule,
    'dashboard'   => sf_clean_bool($f['dashboard'] ?? true),
  ];
}

/* icon.type is one of:
 *   glyph     - one of the built-in SVG glyphs,       {type,key}
 *   container - reuse a member container's own icon,  {type,name}
 *   web       - downloaded and stored locally,        {type,source,query,url,localFile}
 */
function sf_store_normalise_icon($icon): array {
  $fallback = ['type' => 'glyph', 'key' => 'folder'];
  if (!is_array($icon) || !isset($icon['type'])) return $fallback;

  switch ($icon['type']) {
    case 'glyph':
      $key = (string)($icon['key'] ?? 'folder');
      return ['type' => 'glyph', 'key' => preg_match('/^[a-z-]{1,24}$/', $key) ? $key : 'folder'];

    case 'container':
      try {
        return ['type' => 'container', 'name' => sf_clean_container_name((string)($icon['name'] ?? ''))];
      } catch (InvalidArgumentException $e) {
        return $fallback;
      }

    case 'web':
      /* localFile is a bare filename inside SF_ICON_DIR - never a path, so a
       * hand-edited store cannot point the icon route at /etc/shadow. */
      $file = basename((string)($icon['localFile'] ?? ''));
      if ($file === '' || !preg_match('/^[A-Za-z0-9._-]+$/', $file)) return $fallback;
      return [
        'type'      => 'web',
        'source'    => in_array($icon['source'] ?? '', ['dashboard-icons','selfhst','url','generated'], true)
                         ? $icon['source'] : 'url',
        'query'     => mb_substr((string)($icon['query'] ?? ''), 0, 64),
        'url'       => mb_substr((string)($icon['url'] ?? ''), 0, 500),
        'localFile' => $file,
      ];
  }
  return $fallback;
}

/* ------------------------------------------------------------------------
 * Membership
 * ---------------------------------------------------------------------- */

/* Work out which folder each container belongs to.
 *
 * A container belongs to AT MOST ONE folder (DESIGN_SPEC.md 9). Three sources
 * feed membership, in descending priority:
 *
 *   1. explicit  - ticked in the folder editor
 *   2. label     - the container carries simple.folders=<folder id>
 *   3. rule      - the container name matches the folder's regex
 *
 * Within a priority, the folder listed first wins, so the result does not
 * depend on hash order. Returns [containerName => folderId].
 */
function sf_resolve_membership(array $folders, array $containers): array {
  $assigned = [];

  /* 1. explicit members, in folder order then member order */
  foreach ($folders as $folder) {
    foreach ($folder['members'] as $name) {
      if (!isset($assigned[$name])) $assigned[$name] = $folder['id'];
    }
  }

  /* 2. label - the current one, or the one used before the rename */
  foreach ($containers as $ct) {
    $name = $ct['name'];
    if (isset($assigned[$name])) continue;
    $label = $ct['labels'][SF_LABEL] ?? ($ct['labels'][SF_LABEL_LEGACY] ?? null);
    if ($label === null) continue;
    foreach ($folders as $folder) {
      if ($folder['id'] === $label || sf_slug($folder['name']) === sf_slug((string)$label)) {
        $assigned[$name] = $folder['id'];
        break;
      }
    }
  }

  /* 3. rule */
  foreach ($folders as $folder) {
    if ($folder['rule'] === '') continue;
    $regex = sf_rule_regex($folder['rule']);
    foreach ($containers as $ct) {
      $name = $ct['name'];
      if (isset($assigned[$name])) continue;
      if (@preg_match($regex, $name) === 1) $assigned[$name] = $folder['id'];
    }
  }

  return $assigned;
}

/* Produce each folder's ordered member list for rendering and for bulk
 * actions. Explicit members keep their stored order (that is the start
 * order); containers pulled in by label or rule are appended, name-sorted, so
 * their position is at least stable between reloads. */
function sf_folder_members(array $folder, array $assigned, array $containers): array {
  $byName = [];
  foreach ($containers as $ct) $byName[$ct['name']] = true;

  $ordered = [];
  foreach ($folder['members'] as $name) {
    if (isset($byName[$name]) && ($assigned[$name] ?? null) === $folder['id']) $ordered[] = $name;
  }

  $extra = [];
  foreach ($assigned as $name => $fid) {
    if ($fid !== $folder['id'] || in_array($name, $ordered, true)) continue;
    if (isset($byName[$name])) $extra[] = $name;
  }
  natcasesort($extra);

  return array_merge($ordered, array_values($extra));
}

/* ------------------------------------------------------------------------
 * Mutation helpers (used by Folders.php)
 * ---------------------------------------------------------------------- */

function sf_find_folder(array $folders, string $id): ?int {
  foreach ($folders as $i => $f) if ($f['id'] === $id) return $i;
  return null;
}

/* A folder id must be unique and stable. Derive it from the name and add a
 * counter only when that collides. */
function sf_unique_id(array $folders, string $name, ?string $keep = null): string {
  $base = 'f-'.sf_slug($name);
  $taken = [];
  foreach ($folders as $f) if ($f['id'] !== $keep) $taken[$f['id']] = true;

  if (!isset($taken[$base])) return $base;
  for ($n = 2; $n < 1000; $n++) {
    if (!isset($taken["$base-$n"])) return "$base-$n";
  }
  return $base.'-'.substr(bin2hex(random_bytes(4)), 0, 6);
}

/* Names are compared case-insensitively for the duplicate check the editor
 * reports ("Another folder already uses this name"). */
function sf_name_taken(array $folders, string $name, ?string $exceptId = null): bool {
  foreach ($folders as $f) {
    if ($f['id'] === $exceptId) continue;
    if (mb_strtolower($f['name']) === mb_strtolower($name)) return true;
  }
  return false;
}

/* Remove containers from every folder except $keepId. Enforces the
 * one-folder-per-container rule when the editor saves. */
function sf_detach_members(array $folders, array $names, string $keepId): array {
  foreach ($folders as $i => $folder) {
    if ($folder['id'] === $keepId) continue;
    $folders[$i]['members'] = array_values(array_filter(
      $folder['members'],
      fn($m) => !in_array($m, $names, true)
    ));
  }
  return $folders;
}
