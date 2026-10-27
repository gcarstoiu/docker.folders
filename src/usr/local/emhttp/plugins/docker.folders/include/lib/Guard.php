<?PHP
/* docker.folders - request guarding, validation and JSON replies.
 * Copyright (C) 2026  george
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 * CSRF NOTE
 * ---------
 * Unraid installs webGui/include/local_prepend.php as php.ini's
 * auto_prepend_file. It rejects every POST without a valid csrf_token with a
 * 403 before our code runs, so these endpoints do not re-check the token -
 * they would be unreachable without it. df_require_post() exists to reject
 * method confusion, not to replace that gate.
 */

/* Reject anything that is not a POST. Mutating endpoints only. */
function df_require_post(): void {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    df_fail('This endpoint requires POST', 405);
  }
}

function df_json($data, int $code = 200): void {
  if (!headers_sent()) {
    http_response_code($code);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
  }
  echo json_encode($data, JSON_UNESCAPED_SLASHES);
  exit;
}

function df_fail(string $message, int $code = 400): void {
  df_json(['ok' => false, 'error' => $message], $code);
}

function df_ok(array $data = []): void {
  df_json(['ok' => true] + $data);
}

/* ------------------------------------------------------------------------
 * Validation
 *
 * Everything below returns a clean value or throws InvalidArgumentException.
 * Callers surface the message to the user, so messages are written for them.
 * ---------------------------------------------------------------------- */

/* Folder names are shown in menus, dialogs and toasts. Length is capped at 32
 * to match the editor's counter (DESIGN_SPEC.md 9). */
function df_clean_name(string $raw): string {
  $name = trim(preg_replace('/\s+/u', ' ', $raw));
  if ($name === '')                      throw new InvalidArgumentException('Give the folder a name');
  if (mb_strlen($name) > 32)             throw new InvalidArgumentException('Folder names are limited to 32 characters');
  /* Control characters would corrupt the JSON store and the rendered HTML. */
  if (preg_match('/[\x00-\x1F\x7F]/u', $name)) throw new InvalidArgumentException('Folder names cannot contain control characters');
  return $name;
}

/* Ids are ours, generated from the name; they also serve as the Docker label
 * value, so keep them to a conservative character set. */
function df_slug(string $name): string {
  $slug = strtolower(preg_replace('/[^a-zA-Z0-9]+/', '-', $name));
  $slug = trim($slug, '-');
  return $slug === '' ? 'folder' : substr($slug, 0, 40);
}

/* Container keys. DESIGN_SPEC.md 11 asks for a key that survives recreation:
 * the container NAME does, its id does not - "update" removes and recreates
 * the container, giving it a fresh id. So members are stored by name. */
function df_clean_container_name(string $raw): string {
  $name = trim($raw);
  if (!preg_match('#^[a-zA-Z0-9][a-zA-Z0-9_.-]*$#', $name)) {
    throw new InvalidArgumentException('Not a valid container name: '.$name);
  }
  return $name;
}

/* The auto-add rule is user-supplied and compiled with preg_match. Validate it
 * before storing so a bad pattern cannot wedge every later render, and anchor
 * the delimiters ourselves so the user cannot inject modifiers such as /e. */
function df_clean_rule(string $raw): string {
  $rule = trim($raw);
  if ($rule === '') return '';
  if (mb_strlen($rule) > 200) throw new InvalidArgumentException('That pattern is too long');
  if (@preg_match(df_rule_regex($rule), '') === false) {
    throw new InvalidArgumentException('That is not a valid pattern');
  }
  return $rule;
}

/* Case-insensitive, unicode, and with the pattern quoted so a stray delimiter
 * in user input cannot escape. */
function df_rule_regex(string $rule): string {
  return '#'.str_replace('#', '\#', $rule).'#iu';
}

function df_clean_color(string $raw): string {
  $palette = ['slate','blue','teal','green','amber','orange','rose','violet'];
  return in_array($raw, $palette, true) ? $raw : 'slate';
}

function df_clean_preview(string $raw): string {
  return in_array($raw, ['status','icons','count'], true) ? $raw : 'status';
}

/* Start delay, in seconds between consecutive container starts. */
function df_clean_delay($raw): int {
  return max(0, min(300, (int)$raw));
}

function df_clean_bool($raw): bool {
  return $raw === true || $raw === 'true' || $raw === 1 || $raw === '1';
}

/* ------------------------------------------------------------------------
 * Atomic writes. The flash drive is slow and the server can lose power; a
 * torn folders.json would lose every folder the user has.
 * ---------------------------------------------------------------------- */
function df_write_atomic(string $path, string $contents): bool {
  $dir = dirname($path);
  if (!is_dir($dir) && !@mkdir($dir, 0755, true)) return false;

  $tmp = tempnam($dir, '.df');
  if ($tmp === false) return false;

  if (file_put_contents($tmp, $contents) === false) { @unlink($tmp); return false; }
  @chmod($tmp, 0644);

  if (!@rename($tmp, $path)) { @unlink($tmp); return false; }
  return true;
}
