<?PHP
/* simple.folders - reading the container list.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 * WHY THIS DOES NOT PARSE THE DOCKER PAGE
 * ---------------------------------------
 * The obvious shortcut is to scrape the rows that
 * dynamix.docker.manager/include/DockerContainers.php renders. Don't: that
 * file's markup changed substantially between Unraid 7.2.1 and 7.4, and it is
 * the single biggest reason folder plugins break on upgrade.
 *
 * Instead we call the same PHP classes that file calls - DockerClient and
 * DockerTemplates - whose public methods have been stable across the same
 * range. We also read the raw /containers/json payload once, because
 * getDockerContainers() drops arbitrary labels and we need ours.
 *
 * CPU and memory are deliberately NOT read here. "docker stats" costs a
 * second or more per call; the page subscribes to the dockerload nchan channel
 * instead and fills those columns as samples arrive.
 */

require_once __DIR__.'/Paths.php';

/* The harness points this at a fixture reader. Production never defines it. */
if (defined('SF_CONTAINER_SOURCE') && is_file(SF_CONTAINER_SOURCE)) {
  require_once SF_CONTAINER_SOURCE;
}

/* ---------------------------------------------------------------------------
 * DockerClient.php MUST be required here, at file scope - never from inside a
 * function.
 *
 * It declares $dockerManPaths, $driver, $docroot and $dockercfg at ITS top
 * level, and thirteen of its methods reach for them with `global`. An include
 * takes the scope of whatever included it, so requiring it inside a function
 * makes those four function-locals instead of globals, every `global` lookup
 * resolves to null, and the class fails at runtime with no useful message.
 * ------------------------------------------------------------------------- */
if (!function_exists('sf_containers_source')) {
  $dfDockerClient = SF_DOCKER_MAN.'/include/DockerClient.php';

  /* DockerClient derives $docroot from this when it is not already set. */
  $_SERVER['DOCUMENT_ROOT'] = $_SERVER['DOCUMENT_ROOT'] ?: '/usr/local/emhttp';
  $docroot = $docroot ?? $_SERVER['DOCUMENT_ROOT'];

  if (is_file($dfDockerClient)) {
    require_once $dfDockerClient;
  }
  unset($dfDockerClient);
}

/* Return every container, name-sorted, in the shape the UI consumes.
 *
 *   [ name, id, image, state, update, port, autostart, wait, webui,
 *     icon, template, shell, labels{} ]
 *
 * state  : running | paused | stopped
 * update : 0 up to date | 1 update ready | 2 rebuild ready | 3 unknown
 */
function sf_containers(): array {
  if (function_exists('sf_containers_source')) return sf_containers_source();

  /* Required at file scope above; see the note there for why. */
  if (!class_exists('DockerClient')) {
    throw new RuntimeException(
      'Unraid\'s Docker manager was not found at '.SF_DOCKER_MAN.
      '. Is the Docker service enabled?'
    );
  }

  $DockerClient    = new DockerClient();
  $DockerTemplates = new DockerTemplates();

  $containers = $DockerClient->getDockerContainers();

  /* An empty list is legitimate - a server can genuinely have no containers.
   * It is only an error when the Docker service itself is not up, so
   * distinguish the two rather than silently rendering "0 containers" when
   * the real problem is that dockerd is stopped. */
  if (!$containers) {
    if (!is_file('/var/run/dockerd.pid')) {
      throw new RuntimeException('The Docker service is not running. Start it in Settings - Docker.');
    }
    return [];
  }

  /* getAllInfo() resolves icon, WebUI URL, autostart, update status and the
   * user template for every container in one pass. */
  $allInfo = $DockerTemplates->getAllInfo();

  /* Labels are not exposed by getDockerContainers(), so take them from the
   * raw list endpoint - one call, not one inspect per container. */
  $labels = [];
  foreach ((array)$DockerClient->getDockerJSON('/containers/json?all=1') as $raw) {
    $name = ltrim($raw['Names'][0] ?? '', '/');
    if ($name !== '') $labels[$name] = (array)($raw['Labels'] ?? []);
  }

  /* Per-container autostart wait, as stored in Unraid's autostart file:
   * one "<name> <seconds>" line per container, in start order. */
  $waits = sf_autostart_waits();

  $out = [];
  foreach ($containers as $ct) {
    $name = $ct['Name'];
    $info = $allInfo[$name] ?? [];

    $state = !empty($info['paused']) ? 'paused'
           : (!empty($info['running']) ? 'running' : 'stopped');

    /* getAllInfo() encodes update status as a string; map it to the same
     * integers core's docker[] array uses so both sides agree.
     * 2 means "rebuild ready" - the image is there but the container was
     * built against a network that no longer exists. */
    $updated = $info['updated'] ?? null;
    $update  = substr($ct['NetworkMode'], -4) === ':???' ? 2
             : ($updated === 'true' ? 0 : ($updated === 'false' ? 1 : 3));

    $out[] = [
      'name'      => $name,
      'id'        => $ct['Id'],
      'image'     => $ct['Image'],
      'state'     => $state,
      'update'    => $update,
      'port'      => sf_primary_port($ct),
      'autostart' => !empty($info['autostart']),
      'wait'      => $waits[$name] ?? 0,
      'webui'     => html_entity_decode($info['url'] ?? ''),
      'icon'      => $info['icon'] ?? '',
      'template'  => $info['template'] ?? '',
      'shell'     => $info['shell'] ?? '',
      'labels'    => $labels[$name] ?? [],
    ];
  }

  usort($out, fn($a, $b) => strnatcasecmp($a['name'], $b['name']));
  return $out;
}

/* The port shown in the Port column: the first published (host) port, falling
 * back to the first exposed one. Returns null when the container publishes
 * nothing, which the UI renders as an em dash. */
function sf_primary_port(array $ct): ?int {
  $ports = $ct['Ports'] ?? [];
  if (!is_array($ports)) return null;

  foreach ($ports as $port) {
    if (is_array($port) && !empty($port['PublicPort'])) return (int)$port['PublicPort'];
  }
  foreach ($ports as $key => $port) {
    if (is_array($port) && !empty($port['PrivatePort'])) return (int)$port['PrivatePort'];
    if (is_numeric($key)) return (int)$key;
  }
  return null;
}

/* Parse /var/lib/docker/unraid-autostart into [name => wait seconds].
 * Line format is "<name> <seconds>"; the seconds part is optional. */
function sf_autostart_waits(): array {
  $file = SF_DOCKER_MAN_AUTOSTART;
  if (!is_file($file)) return [];

  $waits = [];
  foreach ((array)@file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
    $parts = preg_split('/\s+/', trim($line), 2);
    if ($parts[0] === '') continue;
    $waits[$parts[0]] = isset($parts[1]) ? (int)$parts[1] : 0;
  }
  return $waits;
}

/* The autostart file's order is Unraid's own container start order, and
 * DESIGN_SPEC.md 13.9 makes folder start order drive it rather than shadow it. */
function sf_autostart_order(): array {
  $file = SF_DOCKER_MAN_AUTOSTART;
  if (!is_file($file)) return [];

  $order = [];
  foreach ((array)@file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
    $name = preg_split('/\s+/', trim($line), 2)[0];
    if ($name !== '') $order[] = $name;
  }
  return $order;
}
