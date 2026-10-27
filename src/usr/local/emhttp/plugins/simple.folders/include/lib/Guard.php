<?PHP
/* simple.folders - request guarding, validation and JSON replies.
 * Copyright (C) 2026  gcarstoiu
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
 * they would be unreachable without it. sf_require_post() exists to reject
 * method confusion, not to replace that gate.
 */

/* ---------------------------------------------------------------------------
 * Error reporting
 *
 * Without this, any PHP warning or uncaught error produces a bare HTTP 500
 * with an HTML body, and the page can only say "Request failed (500)" - which
 * says nothing about what actually broke on the server.
 *
 * These handlers turn every failure into the same JSON envelope the rest of
 * the API uses, so the message reaches the UI and the browser console. The
 * detail is also written to syslog, where Unraid users already look.
 * ------------------------------------------------------------------------- */
function sf_install_error_handler(): void {
  /* Report everything, but never let PHP print it: a warning echoed into the
   * response would corrupt the JSON body. */
  error_reporting(E_ALL);
  ini_set('display_errors', '0');

  /* Catch stray output too. Unraid's Docker helpers shell out, and a failing
   * subprocess can write straight to stdout ("Couldn't create socket: ...").
   * A single byte before the JSON makes the response unparseable, and the
   * page can then only report "Request failed" - which is exactly the
   * unhelpful message this whole handler exists to avoid. Everything printed
   * before our reply is buffered, logged and discarded. */
  ob_start();

  set_exception_handler(function ($e) {
    sf_log('uncaught '.get_class($e).': '.$e->getMessage()
          .' in '.$e->getFile().':'.$e->getLine());
    sf_json([
      'ok'    => false,
      'error' => $e->getMessage(),
      'where' => basename($e->getFile()).':'.$e->getLine(),
    ], 500);
  });

  /* Warnings, notices and deprecations are LOGGED, not thrown.
   *
   * Unraid's own Docker code emits them routinely (an unreachable socket, an
   * undefined array key in a container's inspect payload) and carries on.
   * Promoting those to exceptions would make this plugin fail on pages where
   * the stock one works perfectly well. Returning true only stops PHP from
   * printing them into the response and corrupting the JSON body. */
  set_error_handler(function ($severity, $message, $file, $line) {
    if (!(error_reporting() & $severity)) return true;   // @-suppressed
    sf_log('warning: '.$message.' in '.basename($file).':'.$line);
    return true;
  });

  /* A fatal (out of memory, a hard parse failure in an include) bypasses both
   * handlers above, so catch it on the way out. */
  register_shutdown_function(function () {
    $error = error_get_last();
    if (!$error || !in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) return;
    sf_log('fatal: '.$error['message'].' in '.$error['file'].':'.$error['line']);
    sf_discard_stray_output();
    if (!headers_sent()) {
      http_response_code(500);
      header('Content-Type: application/json');
      echo json_encode([
        'ok'    => false,
        'error' => $error['message'],
        'where' => basename($error['file']).':'.$error['line'],
      ]);
    }
  });
}

function sf_log(string $message): void {
  @exec('logger -t simple.folders -- '.escapeshellarg($message));
}

/* Throw away anything printed before our reply, so the response body is the
 * JSON and nothing else. Whatever was captured goes to syslog instead. */
function sf_discard_stray_output(): void {
  if (!ob_get_level()) return;
  $stray = '';
  while (ob_get_level()) $stray .= (string)ob_get_clean();
  $stray = trim($stray);
  if ($stray !== '') sf_log('discarded stray output: '.substr($stray, 0, 400));
}

/* Reject anything that is not a POST. Mutating endpoints only. */
function sf_require_post(): void {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    sf_fail('This endpoint requires POST', 405);
  }
}

function sf_json($data, int $code = 200): void {
  sf_discard_stray_output();

  if (!headers_sent()) {
    http_response_code($code);
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
  }
  echo json_encode($data, JSON_UNESCAPED_SLASHES);
  exit;
}

function sf_fail(string $message, int $code = 400): void {
  sf_json(['ok' => false, 'error' => $message], $code);
}

function sf_ok(array $data = []): void {
  sf_json(['ok' => true] + $data);
}

/* ------------------------------------------------------------------------
 * Validation
 *
 * Everything below returns a clean value or throws InvalidArgumentException.
 * Callers surface the message to the user, so messages are written for them.
 * ---------------------------------------------------------------------- */

/* Folder names are shown in menus, dialogs and toasts. Length is capped at 32
 * to match the editor's counter (DESIGN_SPEC.md 9). */
function sf_clean_name(string $raw): string {
  $name = trim(preg_replace('/\s+/u', ' ', $raw));
  if ($name === '')                      throw new InvalidArgumentException('Give the folder a name');
  if (mb_strlen($name) > 32)             throw new InvalidArgumentException('Folder names are limited to 32 characters');
  /* Control characters would corrupt the JSON store and the rendered HTML. */
  if (preg_match('/[\x00-\x1F\x7F]/u', $name)) throw new InvalidArgumentException('Folder names cannot contain control characters');
  return $name;
}

/* Ids are ours, generated from the name; they also serve as the Docker label
 * value, so keep them to a conservative character set. */
function sf_slug(string $name): string {
  $slug = strtolower(preg_replace('/[^a-zA-Z0-9]+/', '-', $name));
  $slug = trim($slug, '-');
  return $slug === '' ? 'folder' : substr($slug, 0, 40);
}

/* Container keys. DESIGN_SPEC.md 11 asks for a key that survives recreation:
 * the container NAME does, its id does not - "update" removes and recreates
 * the container, giving it a fresh id. So members are stored by name. */
function sf_clean_container_name(string $raw): string {
  $name = trim($raw);
  if (!preg_match('#^[a-zA-Z0-9][a-zA-Z0-9_.-]*$#', $name)) {
    throw new InvalidArgumentException('Not a valid container name: '.$name);
  }
  return $name;
}

/* The auto-add rule is user-supplied and compiled with preg_match. Validate it
 * before storing so a bad pattern cannot wedge every later render, and anchor
 * the delimiters ourselves so the user cannot inject modifiers such as /e. */
function sf_clean_rule(string $raw): string {
  $rule = trim($raw);
  if ($rule === '') return '';
  if (mb_strlen($rule) > 200) throw new InvalidArgumentException('That pattern is too long');
  if (@preg_match(sf_rule_regex($rule), '') === false) {
    throw new InvalidArgumentException('That is not a valid pattern');
  }
  return $rule;
}

/* Case-insensitive, unicode, and with the pattern quoted so a stray delimiter
 * in user input cannot escape. */
function sf_rule_regex(string $rule): string {
  return '#'.str_replace('#', '\#', $rule).'#iu';
}

function sf_clean_color(string $raw): string {
  $palette = ['slate','blue','teal','green','amber','orange','rose','violet'];
  return in_array($raw, $palette, true) ? $raw : 'slate';
}

function sf_clean_preview(string $raw): string {
  return in_array($raw, ['status','icons','count'], true) ? $raw : 'status';
}

/* Start delay, in seconds between consecutive container starts. */
function sf_clean_delay($raw): int {
  return max(0, min(300, (int)$raw));
}

function sf_clean_bool($raw): bool {
  return $raw === true || $raw === 'true' || $raw === 1 || $raw === '1';
}

/* ------------------------------------------------------------------------
 * Atomic writes. The flash drive is slow and the server can lose power; a
 * torn folders.json would lose every folder the user has.
 * ---------------------------------------------------------------------- */
function sf_write_atomic(string $path, string $contents): bool {
  $dir = dirname($path);
  if (!is_dir($dir) && !@mkdir($dir, 0755, true)) return false;

  $tmp = tempnam($dir, '.df');
  if ($tmp === false) return false;

  if (file_put_contents($tmp, $contents) === false) { @unlink($tmp); return false; }
  @chmod($tmp, 0644);

  if (!@rename($tmp, $path)) { @unlink($tmp); return false; }
  return true;
}
