<?PHP
/* simple.folders harness - container source adapter.
 *
 * lib/Containers.php calls sf_containers_source() when SF_CONTAINER_SOURCE is
 * defined, instead of talking to DockerClient. This maps the harness fixture
 * state onto the exact shape sf_containers() returns on a real server, so the
 * plugin code under test is identical either way.
 *
 * NOT part of the plugin package. Never shipped.
 */
require_once __DIR__.'/state.php';

function sf_containers_source(): array {
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
      /* The real plugin gets CPU and memory from the dockerload nchan stream,
       * not from this payload. They are carried here only so a settled
       * screenshot (which turns the stream off) can show plausible figures. */
      'cpu'       => $ct['cpu'] ?? 0,
      'mem'       => $ct['mem'] ?? 0,
      'template'  => '/boot/config/plugins/dockerMan/templates-user/my-'.$ct['name'].'.xml',
      'shell'     => 'sh',
      'labels'    => $ct['labels'] ?? [],
    ];
  }
  usort($out, fn($a, $b) => strnatcasecmp($a['name'], $b['name']));
  return $out;
}
