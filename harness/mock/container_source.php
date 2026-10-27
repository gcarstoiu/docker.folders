<?PHP
/* docker.folders harness - container source adapter.
 *
 * lib/Containers.php calls df_containers_source() when DF_CONTAINER_SOURCE is
 * defined, instead of talking to DockerClient. This maps the harness fixture
 * state onto the exact shape df_containers() returns on a real server, so the
 * plugin code under test is identical either way.
 *
 * NOT part of the plugin package. Never shipped.
 */
require_once __DIR__.'/state.php';

function df_containers_source(): array {
  $out = [];
  foreach (harness_load() as $ct) {
    $out[] = [
      'name'      => $ct['name'],
      'id'        => $ct['id'],
      'image'     => $ct['image'],
      'state'     => $ct['state'],
      'update'    => (int)$ct['update'],
      'port'      => $ct['port'] ?: null,
      'autostart' => (bool)$ct['autostart'],
      'wait'      => (int)($ct['wait'] ?? 0),
      'webui'     => $ct['webui'] ?? '',
      /* The prototype stands in for real app logos with a letter on a tinted
       * tile; the fixtures carry the same two fields so the harness looks
       * like the screenshots without shipping third-party artwork. */
      'icon'      => '',
      'letter'    => $ct['letter'] ?? strtoupper(substr($ct['name'], 0, 1)),
      'tint'      => $ct['tint'] ?? 'slate',
      'template'  => '/boot/config/plugins/dockerMan/templates-user/my-'.$ct['name'].'.xml',
      'shell'     => 'sh',
      'labels'    => $ct['labels'] ?? [],
    ];
  }
  usort($out, fn($a, $b) => strnatcasecmp($a['name'], $b['name']));
  return $out;
}
