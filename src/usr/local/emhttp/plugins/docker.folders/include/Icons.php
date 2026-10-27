<?PHP
/* docker.folders - folder icon search, download and serving.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 *   GET  ?file=<name>                    serve a stored icon
 *   POST action=search   query=<text>    look up candidates
 *   POST action=download source=... url=...   fetch and store one
 *
 * Downloaded icons are stored under DF_ICON_DIR on the flash drive, so a
 * folder keeps its icon with no network and across reboots (spec 9).
 *
 * SECURITY
 * --------
 * The brief requires that icon URLs and downloaded files be validated on the
 * server and that SVG be sanitised before serving. Specifically:
 *
 *  - only https, only the two known icon hosts (or a direct image URL with an
 *    image extension), never a redirect to somewhere else
 *  - the response is size-capped and its real type is checked, not its
 *    extension or the Content-Type header
 *  - SVG is stripped of <script>, <foreignObject>, event handlers and any
 *    non-data/non-fragment URL reference before it is ever written
 *  - stored files are served with a restrictive CSP and nosniff, so even a
 *    sanitiser miss cannot execute in the webGUI's origin
 *  - requests never reach a private address, so this cannot be used to probe
 *    the LAN from the server
 */

require_once __DIR__.'/lib/Paths.php';
require_once __DIR__.'/lib/Guard.php';

const DF_ICON_MAX_BYTES = 512 * 1024;      // 512 KB is generous for an icon
const DF_ICON_TIMEOUT   = 12;

/* jsDelivr serves both collections from GitHub with predictable paths.
 * Verified reachable 2026-10-27. */
const DF_ICON_SOURCES = [
  'dashboard-icons' => [
    'label' => 'Dashboard Icons',
    'base'  => 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/',
    'host'  => 'cdn.jsdelivr.net',
  ],
  'selfhst' => [
    'label' => 'selfh.st icons',
    'base'  => 'https://cdn.jsdelivr.net/gh/selfhst/icons/',
    'host'  => 'cdn.jsdelivr.net',
  ],
];

/* ------------------------------------------------------------------------
 * GET: serve a stored icon
 * ---------------------------------------------------------------------- */
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
  /* basename() plus an allow-list: the stored name can never escape the
   * icon directory, whatever is in folders.json. */
  $file = basename((string)($_GET['file'] ?? ''));
  if ($file === '' || !preg_match('/^[A-Za-z0-9._-]+$/', $file)) {
    http_response_code(400); exit;
  }

  $path = DF_ICON_DIR.'/'.$file;
  if (!is_file($path)) { http_response_code(404); exit; }

  $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
  $types = ['png'=>'image/png','jpg'=>'image/jpeg','jpeg'=>'image/jpeg',
            'webp'=>'image/webp','ico'=>'image/x-icon','svg'=>'image/svg+xml'];
  if (!isset($types[$ext])) { http_response_code(404); exit; }

  header('Content-Type: '.$types[$ext]);
  header('Content-Length: '.filesize($path));
  header('X-Content-Type-Options: nosniff');
  header('Content-Security-Policy: default-src \'none\'; style-src \'unsafe-inline\'; sandbox');
  header('Cache-Control: public, max-age=86400');
  readfile($path);
  exit;
}

/* ------------------------------------------------------------------------
 * POST
 * ---------------------------------------------------------------------- */
df_require_post();
df_ensure_dirs();

$action = $_POST['action'] ?? '';

if ($action === 'search') {
  $query = trim((string)($_POST['query'] ?? ''));
  if ($query === '') df_ok(['results' => []]);

  /* Both collections name files after a slug of the app name. We cannot list
   * a CDN directory, so we offer the conventional path for each source and
   * let the browser's <img> show whether it resolved. */
  $slug = strtolower(preg_replace('/[^a-zA-Z0-9]+/', '-', $query));
  $slug = trim($slug, '-');
  if ($slug === '') df_ok(['results' => []]);

  $results = [];
  foreach (DF_ICON_SOURCES as $key => $source) {
    $results[] = [
      'source'  => $key,
      'label'   => $source['label'],
      'file'    => $slug.'.svg',
      'query'   => $slug,
      'url'     => $source['base'].'svg/'.$slug.'.svg',
      'preview' => $source['base'].'svg/'.$slug.'.svg',
    ];
  }

  /* Always offer a generated monogram, so there is a working choice even
   * with no network or no match (spec 9). */
  $results[] = [
    'source'  => 'generated',
    'label'   => 'Generated',
    'file'    => $slug.'.svg',
    'query'   => $slug,
    'url'     => '',
    'preview' => '',
  ];

  df_ok(['results' => $results]);
}

if ($action === 'download') {
  $source = (string)($_POST['source'] ?? 'url');
  $query  = trim((string)($_POST['query'] ?? ''));

  /* The monogram is drawn here rather than fetched: no network, no licence
   * question, and it always succeeds. */
  if ($source === 'generated') {
    $letter = mb_strtoupper(mb_substr($query !== '' ? $query : 'F', 0, 1));
    $svg = df_monogram($letter);
    $file = 'gen-'.substr(sha1($letter), 0, 10).'.svg';
    if (!df_write_atomic(DF_ICON_DIR.'/'.$file, $svg)) df_fail('Could not store the icon', 500);
    df_ok(['file' => $file, 'host' => 'generated']);
  }

  $url = trim((string)($_POST['url'] ?? ''));
  if ($url === '') df_fail('Enter an image URL');

  try {
    [$bytes, $ext, $host] = df_fetch_icon($url, $source);
  } catch (RuntimeException $e) {
    df_fail($e->getMessage());
  }

  $file = substr(sha1($url), 0, 16).'.'.$ext;
  if (!df_write_atomic(DF_ICON_DIR.'/'.$file, $bytes)) df_fail('Could not store the icon', 500);

  df_ok(['file' => $file, 'host' => $host]);
}

df_fail('Unknown action');

/* ------------------------------------------------------------------------
 * Fetching
 * ---------------------------------------------------------------------- */

/** @return array{0:string,1:string,2:string} [bytes, extension, host] */
function df_fetch_icon(string $url, string $source): array {
  $parts = parse_url($url);
  if (!$parts || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])) {
    throw new RuntimeException('Only https image links are accepted');
  }
  $host = $parts['host'];

  /* A known collection must stay on its own host. A pasted URL may be
   * anywhere public, but must look like a direct image link - the spec lists
   * the accepted extensions. */
  if (isset(DF_ICON_SOURCES[$source])) {
    if ($host !== DF_ICON_SOURCES[$source]['host']) {
      throw new RuntimeException('That link is not from '.DF_ICON_SOURCES[$source]['label']);
    }
  } else {
    $path = strtolower(parse_url($url, PHP_URL_PATH) ?: '');
    if (!preg_match('/\.(png|svg|jpe?g|webp|ico)$/', $path)) {
      throw new RuntimeException('The link must end in .png, .svg, .jpg, .jpeg, .webp or .ico');
    }
  }

  df_assert_public_host($host);

  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,          // a redirect could leave the allowed host
    CURLOPT_TIMEOUT        => DF_ICON_TIMEOUT,
    CURLOPT_CONNECTTIMEOUT => 6,
    CURLOPT_USERAGENT      => 'docker.folders (Unraid plugin)',
    CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,
    /* Stop reading the moment the response exceeds the cap, rather than
     * buffering an arbitrarily large body first. */
    CURLOPT_NOPROGRESS     => false,
    CURLOPT_PROGRESSFUNCTION => function ($res, $dlTotal, $dlNow) {
      return ($dlTotal > DF_ICON_MAX_BYTES || $dlNow > DF_ICON_MAX_BYTES) ? 1 : 0;
    },
  ]);

  $body = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  $err  = curl_error($ch);
  curl_close($ch);

  if ($body === false) throw new RuntimeException($err ? 'Download failed: '.$err : 'Download failed');
  if ($code === 404)   throw new RuntimeException('No icon at that address');
  if ($code !== 200)   throw new RuntimeException('The server answered '.$code);
  if (strlen($body) === 0)                   throw new RuntimeException('That file is empty');
  if (strlen($body) > DF_ICON_MAX_BYTES)     throw new RuntimeException('That image is larger than 512 KB');

  /* Identify by content, never by the extension or the Content-Type header. */
  $ext = df_sniff_image($body);
  if ($ext === null) throw new RuntimeException('That file is not a PNG, JPEG, WebP, ICO or SVG');

  if ($ext === 'svg') $body = df_sanitise_svg($body);

  return [$body, $ext, $host];
}

/* Refuse to fetch from anything that is not a public address, so this
 * endpoint cannot be turned into a LAN scanner against the server itself. */
function df_assert_public_host(string $host): void {
  $ips = [];
  foreach ((array)@dns_get_record($host, DNS_A | DNS_AAAA) as $record) {
    if (!empty($record['ip']))   $ips[] = $record['ip'];
    if (!empty($record['ipv6'])) $ips[] = $record['ipv6'];
  }
  if (!$ips) {
    $resolved = @gethostbyname($host);
    if ($resolved && $resolved !== $host) $ips[] = $resolved;
  }
  if (!$ips) throw new RuntimeException('Could not resolve '.$host);

  foreach ($ips as $ip) {
    if (!filter_var($ip, FILTER_VALIDATE_IP,
          FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
      throw new RuntimeException('That address is not public');
    }
  }
}

/* Magic-number sniffing. Returns the extension or null. */
function df_sniff_image(string $bytes): ?string {
  if (strncmp($bytes, "\x89PNG\r\n\x1a\n", 8) === 0)  return 'png';
  if (strncmp($bytes, "\xFF\xD8\xFF", 3) === 0)       return 'jpg';
  if (strncmp($bytes, "\x00\x00\x01\x00", 4) === 0)   return 'ico';
  if (strncmp($bytes, 'RIFF', 4) === 0 && substr($bytes, 8, 4) === 'WEBP') return 'webp';

  /* SVG is text: require an <svg> root within the first part of the file,
   * allowing an XML declaration, a doctype, comments or a BOM before it. */
  $head = ltrim(substr($bytes, 0, 2048), "\xEF\xBB\xBF \t\r\n");
  if (stripos($head, '<svg') !== false
      && preg_match('/^(<\?xml[^>]*\?>|<!DOCTYPE[^>]*>|<!--.*?-->|\s)*<svg[\s>]/is', $head)) {
    return 'svg';
  }
  return null;
}

/* Strip everything executable or externally referencing out of an SVG.
 *
 * This is a conservative allow-list on top of a blocklist: scripts and
 * foreign content are removed outright, every on* attribute goes, and any
 * URL reference that is not a same-document fragment or a data: image is
 * dropped. Serving happens with a sandbox CSP as well, so this is defence in
 * depth rather than the only barrier. */
function df_sanitise_svg(string $svg): string {
  /* Elements that can execute or embed arbitrary content. */
  $svg = preg_replace('#<\s*(script|foreignObject|iframe|embed|object|audio|video|animate|set|handler)\b[^>]*>.*?<\s*/\s*\1\s*>#is', '', $svg);
  $svg = preg_replace('#<\s*(script|foreignObject|iframe|embed|object|use|image|animate|set|handler)\b[^>]*/\s*>#is', '', $svg);

  /* Processing instructions and entity declarations (XXE, billion laughs). */
  $svg = preg_replace('#<!DOCTYPE[^>]*(\[[^\]]*\])?[^>]*>#is', '', $svg);
  $svg = preg_replace('#<\?(?!xml)[^>]*\?>#is', '', $svg);
  $svg = preg_replace('#<!ENTITY[^>]*>#is', '', $svg);

  /* Event handlers, in both quoting styles and unquoted. */
  $svg = preg_replace('#\son[a-z]+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)#is', '', $svg);

  /* Any href/src/xlink:href that is not a fragment or a data: image. */
  $svg = preg_replace_callback(
    '#\s(?:xlink:)?(?:href|src)\s*=\s*("([^"]*)"|\'([^\']*)\'|([^\s>]+))#is',
    function ($m) {
      $value = trim($m[2] !== '' ? $m[2] : ($m[3] !== '' ? $m[3] : $m[4]));
      if ($value !== '' && ($value[0] === '#' || stripos($value, 'data:image/') === 0)) return $m[0];
      return '';
    },
    $svg
  );

  /* javascript: hiding in a style or presentation attribute. */
  $svg = preg_replace('#(javascript|vbscript)\s*:#i', '', $svg);

  return $svg;
}

/* A letter on a tinted tile - the "Generated" option (spec 9). */
function df_monogram(string $letter): string {
  $safe = htmlspecialchars($letter, ENT_QUOTES | ENT_XML1, 'UTF-8');
  /* Hue derived from the letter so the same name always gets the same tile. */
  $hue = hexdec(substr(sha1($letter), 0, 2)) % 360;

  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">'
       . '<rect width="64" height="64" rx="14" fill="hsl('.$hue.' 42% 24%)"/>'
       . '<text x="32" y="33" fill="hsl('.$hue.' 70% 82%)" font-family="system-ui,sans-serif"'
       . ' font-size="32" font-weight="600" text-anchor="middle" dominant-baseline="central">'
       . $safe.'</text></svg>';
}
