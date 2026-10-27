<?PHP
/* simple.folders - folder icon search, download and serving.
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
 * Downloaded icons are stored under SF_ICON_DIR on the flash drive, so a
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

/* Armed before any further include, so a failure inside Unraid's own
 * DockerClient.php is reported as JSON rather than a blank 500. */
sf_install_error_handler();


const SF_ICON_MAX_BYTES = 512 * 1024;      // 512 KB is generous for an icon
const SF_ICON_TIMEOUT   = 12;

/* jsDelivr serves both collections from GitHub with predictable paths, and
 * each publishes an index of what it actually contains. Verified 2026-10-27:
 *
 *   dashboard-icons  tree.json   {"svg":["1337x.svg",...], "png":[...], ...}
 *                                2255 svg icons
 *   selfh.st         index.json  [{"Name","Reference","SVG","Tags",...}, ...]
 *                                2968 entries, 2503 with svg
 *
 * Searching those indexes is the whole point: the first version guessed
 * "<slug>.svg" on both CDNs and rendered an <img> for each without checking
 * it existed, so any name the catalogues do not carry (for instance "cobra",
 * which neither has) produced a row of broken images - and a name they do
 * carry, like "plex" with 19 real matches, still only ever offered three.
 *
 * jsDelivr's own file-listing API is not usable here: these repos exceed its
 * 50 MB package limit and it answers 403. */
defined('SF_ICON_SOURCES') || define('SF_ICON_SOURCES', [
  'dashboard-icons' => [
    'label' => 'Dashboard Icons',
    'base'  => 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/',
    'index' => 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/tree.json',
    'host'  => 'cdn.jsdelivr.net',
  ],
  'selfhst' => [
    'label' => 'selfh.st icons',
    'base'  => 'https://cdn.jsdelivr.net/gh/selfhst/icons@main/',
    'index' => 'https://cdn.jsdelivr.net/gh/selfhst/icons@main/index.json',
    'host'  => 'cdn.jsdelivr.net',
  ],
]);

/* The indexes are ~0.2 MB and ~0.9 MB. Cached in SF_RUN_DIR, which is tmpfs:
 * they are re-fetched after a reboot, and the flash drive is never written
 * to for something this disposable. */
const SF_INDEX_TTL   = 86400;          // a day
const SF_INDEX_MAX   = 8 * 1024 * 1024;
const SF_SEARCH_LIMIT = 36;

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

  $path = SF_ICON_DIR.'/'.$file;
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
sf_require_post();
sf_ensure_dirs();

$action = $_POST['action'] ?? '';

if ($action === 'search') {
  $query = trim((string)($_POST['query'] ?? ''));
  if ($query === '') sf_ok(['results' => [], 'query' => '']);

  $results = [];
  $offline = [];

  foreach (SF_ICON_SOURCES as $key => $source) {
    $index = sf_icon_index($key, $source);
    if ($index === null) { $offline[] = $source['label']; continue; }
    foreach (sf_icon_match($index, $query) as $hit) {
      $results[] = [
        'source'  => $key,
        'label'   => $hit['label'],
        'file'    => $hit['file'],
        'query'   => $hit['slug'],
        'url'     => $source['base'].$hit['path'],
        'preview' => $source['base'].$hit['path'],
        'rank'    => $hit['rank'],
      ];
    }
  }

  /* Best matches first, then alphabetical so the order is stable. */
  usort($results, function ($a, $b) {
    return $a['rank'] <=> $b['rank'] ?: strnatcasecmp($a['label'], $b['label']);
  });
  $total = count($results);
  $results = array_slice($results, 0, SF_SEARCH_LIMIT);
  foreach ($results as &$r) unset($r['rank']);
  unset($r);

  /* A monogram is always offered: it needs no network and always works, so
   * there is a usable choice even when nothing matched. */
  $slug = sf_icon_slug($query);
  $results[] = [
    'source'  => 'generated',
    'label'   => 'Generated',
    'file'    => $slug.'.svg',
    'query'   => $slug,
    'url'     => '',
    'preview' => '',
  ];

  sf_ok([
    'results' => $results,
    'total'   => $total,
    'shown'   => max(0, count($results) - 1),
    'query'   => $query,
    'offline' => $offline,
  ]);
}

if ($action === 'download') {
  $source = (string)($_POST['source'] ?? 'url');
  $query  = trim((string)($_POST['query'] ?? ''));

  /* The monogram is drawn here rather than fetched: no network, no licence
   * question, and it always succeeds. */
  if ($source === 'generated') {
    $letter = mb_strtoupper(mb_substr($query !== '' ? $query : 'F', 0, 1));
    $svg = sf_monogram($letter);
    $file = 'gen-'.substr(sha1($letter), 0, 10).'.svg';
    if (!sf_write_atomic(SF_ICON_DIR.'/'.$file, $svg)) sf_fail('Could not store the icon', 500);
    sf_ok(['file' => $file, 'host' => 'generated']);
  }

  $url = trim((string)($_POST['url'] ?? ''));
  if ($url === '') sf_fail('Enter an image URL');

  try {
    [$bytes, $ext, $host] = sf_fetch_icon($url, $source);
  } catch (RuntimeException $e) {
    sf_fail($e->getMessage());
  }

  $file = substr(sha1($url), 0, 16).'.'.$ext;
  if (!sf_write_atomic(SF_ICON_DIR.'/'.$file, $bytes)) sf_fail('Could not store the icon', 500);

  sf_ok(['file' => $file, 'host' => $host]);
}

sf_fail('Unknown action');

/* ------------------------------------------------------------------------
 * Catalogue indexes
 * ---------------------------------------------------------------------- */

function sf_icon_slug(string $text): string {
  $slug = strtolower(preg_replace('/[^a-zA-Z0-9]+/', '-', $text));
  return trim($slug, '-');
}

/* Fetch (and cache) one catalogue's index, normalised to a flat list of
 *   [slug, label, file, path]
 * Returns null when it cannot be had at all - offline, say - so the caller
 * can tell "no matches" apart from "could not look". */
function sf_icon_index(string $key, array $source): ?array {
  $cache = SF_RUN_DIR.'/index-'.$key.'.json';

  if (is_file($cache) && (time() - (int)@filemtime($cache)) < SF_INDEX_TTL) {
    $cached = json_decode((string)@file_get_contents($cache), true);
    if (is_array($cached)) return $cached;
  }

  $raw = sf_fetch_text($source['index'], SF_INDEX_MAX);
  if ($raw === null) {
    /* Serve a stale cache rather than nothing: a day-old icon list is far
     * more useful than an empty search. */
    if (is_file($cache)) {
      $cached = json_decode((string)@file_get_contents($cache), true);
      if (is_array($cached)) return $cached;
    }
    return null;
  }

  $parsed = json_decode($raw, true);
  if (!is_array($parsed)) return null;

  $entries = $key === 'selfhst'
    ? sf_index_selfhst($parsed)
    : sf_index_dashboard($parsed);

  sf_write_atomic($cache, json_encode($entries, JSON_UNESCAPED_SLASHES));
  return $entries;
}

/* dashboard-icons: {"svg":["plex.svg", ...], "png":[...], "webp":[...]}.
 * Only names - the filename stem is the label. svg is preferred; png covers
 * the icons that have no vector. */
function sf_index_dashboard(array $tree): array {
  $out = [];
  $seen = [];

  foreach (['svg', 'png'] as $ext) {
    foreach ((array)($tree[$ext] ?? []) as $file) {
      if (!is_string($file)) continue;
      $slug = substr($file, 0, -(strlen($ext) + 1));
      if ($slug === '' || isset($seen[$slug])) continue;
      $seen[$slug] = true;
      $out[] = [
        'slug'  => $slug,
        'label' => str_replace('-', ' ', $slug),
        'file'  => $file,
        'path'  => $ext.'/'.$file,
        'terms' => $slug,
      ];
    }
  }
  return $out;
}

/* selfh.st: [{"Name","Reference","SVG","PNG","Tags",...}]. Carries proper
 * display names and tags, so those are searched too. */
function sf_index_selfhst(array $list): array {
  $out = [];
  foreach ($list as $e) {
    if (!is_array($e) || empty($e['Reference'])) continue;
    $ref = (string)$e['Reference'];
    $ext = (($e['SVG'] ?? '') === 'Yes') ? 'svg' : ((($e['PNG'] ?? '') === 'Yes') ? 'png' : null);
    if ($ext === null) continue;

    $out[] = [
      'slug'  => $ref,
      'label' => (string)($e['Name'] ?? $ref),
      'file'  => $ref.'.'.$ext,
      'path'  => $ext.'/'.$ref.'.'.$ext,
      'terms' => strtolower($ref.' '.($e['Name'] ?? '').' '.($e['Tags'] ?? '')),
    ];
  }
  return $out;
}

/* Rank 0 exact, 1 prefix, 2 word start, 3 anywhere. */
function sf_icon_match(array $index, string $query): array {
  $q = strtolower(trim($query));
  if ($q === '') return [];
  $qSlug = sf_icon_slug($query);

  $hits = [];
  foreach ($index as $entry) {
    $slug  = strtolower($entry['slug']);
    $terms = strtolower($entry['terms'] ?? $entry['slug']);

    if ($slug === $q || $slug === $qSlug)          $rank = 0;
    elseif (strpos($slug, $qSlug) === 0)           $rank = 1;
    elseif (strpos(' '.$terms, ' '.$q) !== false)  $rank = 2;
    elseif (strpos($terms, $q) !== false)          $rank = 3;
    else continue;

    $entry['rank'] = $rank;
    $hits[] = $entry;
  }
  return $hits;
}

/* A plain text GET with a size cap, used for the catalogue indexes. */
function sf_fetch_text(string $url, int $max): ?string {
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,      // the CDN redirects to a versioned path
    CURLOPT_MAXREDIRS      => 3,
    CURLOPT_TIMEOUT        => 25,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_USERAGENT      => 'simple.folders (Unraid plugin)',
    CURLOPT_ENCODING       => '',        // these indexes gzip well
    CURLOPT_NOPROGRESS     => false,
    CURLOPT_PROGRESSFUNCTION => function ($res, $dlTotal, $dlNow) use ($max) {
      return ($dlTotal > $max || $dlNow > $max) ? 1 : 0;
    },
  ]);
  $body = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  curl_close($ch);

  if ($body === false || $code !== 200 || $body === '') return null;
  return $body;
}

/* ------------------------------------------------------------------------
 * Fetching
 * ---------------------------------------------------------------------- */

/** @return array{0:string,1:string,2:string} [bytes, extension, host] */
function sf_fetch_icon(string $url, string $source): array {
  $parts = parse_url($url);
  if (!$parts || empty($parts['host'])) {
    throw new RuntimeException('That is not a usable link');
  }
  $host = $parts['host'];

  /* A URL this plugin produced from a catalogue index is trusted as far as
   * its shape goes: it came from the library's own manifest, so it needs no
   * extension guessing and no public-DNS check. It must still be on that
   * library's base URL - which is https in production. */
  $fromCatalogue = isset(SF_ICON_SOURCES[$source])
    && strpos($url, SF_ICON_SOURCES[$source]['base']) === 0;

  if (!$fromCatalogue) {
    /* A URL the user pasted. Anywhere public, but it has to look like a
     * direct image link, and it must not be an address on this LAN. */
    if (($parts['scheme'] ?? '') !== 'https') {
      throw new RuntimeException('Only https image links are accepted');
    }
    if (isset(SF_ICON_SOURCES[$source]) && $host !== SF_ICON_SOURCES[$source]['host']) {
      throw new RuntimeException('That link is not from '.SF_ICON_SOURCES[$source]['label']);
    }
    $path = strtolower(parse_url($url, PHP_URL_PATH) ?: '');
    if (!preg_match('/\.(png|svg|jpe?g|webp|ico)$/', $path)) {
      throw new RuntimeException('The link must end in .png, .svg, .jpg, .jpeg, .webp or .ico');
    }
    sf_assert_public_host($host);
  }

  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    /* A pasted URL must not redirect: it could leave the host we checked.
     * A catalogue URL may - jsDelivr redirects to a versioned path. */
    CURLOPT_FOLLOWLOCATION => $fromCatalogue,
    CURLOPT_MAXREDIRS      => 3,
    CURLOPT_TIMEOUT        => SF_ICON_TIMEOUT,
    CURLOPT_CONNECTTIMEOUT => 6,
    CURLOPT_USERAGENT      => 'simple.folders (Unraid plugin)',
    CURLOPT_PROTOCOLS      => $fromCatalogue ? (CURLPROTO_HTTPS | CURLPROTO_HTTP) : CURLPROTO_HTTPS,
    /* Stop reading the moment the response exceeds the cap, rather than
     * buffering an arbitrarily large body first. */
    CURLOPT_NOPROGRESS     => false,
    CURLOPT_PROGRESSFUNCTION => function ($res, $dlTotal, $dlNow) {
      return ($dlTotal > SF_ICON_MAX_BYTES || $dlNow > SF_ICON_MAX_BYTES) ? 1 : 0;
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
  if (strlen($body) > SF_ICON_MAX_BYTES)     throw new RuntimeException('That image is larger than 512 KB');

  /* Identify by content, never by the extension or the Content-Type header. */
  $ext = sf_sniff_image($body);
  if ($ext === null) throw new RuntimeException('That file is not a PNG, JPEG, WebP, ICO or SVG');

  if ($ext === 'svg') $body = sf_sanitise_svg($body);

  return [$body, $ext, $host];
}

/* Refuse to fetch from anything that is not a public address, so this
 * endpoint cannot be turned into a LAN scanner against the server itself. */
function sf_assert_public_host(string $host): void {
  /* An address written as a literal needs checking, not resolving - a DNS
   * lookup of "192.168.1.1" returns nothing and would otherwise be reported
   * as "could not resolve", which hides the actual reason it was refused. */
  if (filter_var($host, FILTER_VALIDATE_IP)) {
    if (!filter_var($host, FILTER_VALIDATE_IP,
          FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
      throw new RuntimeException('That address is not public');
    }
    return;
  }

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
function sf_sniff_image(string $bytes): ?string {
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
function sf_sanitise_svg(string $svg): string {
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
function sf_monogram(string $letter): string {
  $safe = htmlspecialchars($letter, ENT_QUOTES | ENT_XML1, 'UTF-8');
  /* Hue derived from the letter so the same name always gets the same tile. */
  $hue = hexdec(substr(sha1($letter), 0, 2)) % 360;

  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">'
       . '<rect width="64" height="64" rx="14" fill="hsl('.$hue.' 42% 24%)"/>'
       . '<text x="32" y="33" fill="hsl('.$hue.' 70% 82%)" font-family="system-ui,sans-serif"'
       . ' font-size="32" font-weight="600" text-anchor="middle" dominant-baseline="central">'
       . $safe.'</text></svg>';
}
