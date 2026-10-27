<?PHP
/* docker.folders harness - mock of Unraid's DockerContainers.php.
 *
 * The real endpoint returns three NUL-separated parts:
 *   [0] the <tbody> rows as HTML
 *   [1] a JS snippet of docker.push({name,id,state,pause,update}) calls
 *   [2] "1" while containers are still starting, else ""
 *
 * Part [0] is the piece that changed heavily between 7.2.1 and 7.4, which is
 * why the plugin never parses it. It is reproduced here only so "Classic view"
 * has a native table to fall back to.
 *
 * NOT part of the plugin package. Never shipped.
 */
require_once dirname(__DIR__, 3).'/state.php';

$rows = [];
$js   = [];

foreach (harness_load() as $ct) {
  $running = $ct['state'] === 'running' || $ct['state'] === 'paused' ? 1 : 0;
  $paused  = $ct['state'] === 'paused' ? 1 : 0;
  $update  = (int)$ct['update'];

  $shape  = $running ? ($paused ? 'pause' : 'play') : 'square';
  $color  = $running ? ($paused ? 'orange-text' : 'green-text') : 'red-text';
  $status = $paused ? 'paused' : ($running ? 'started' : 'stopped');

  $mem = $ct['mem'] >= 1073741824
    ? round($ct['mem'] / 1073741824, 1).' GB'
    : round($ct['mem'] / 1048576).' MB';

  $name = htmlspecialchars($ct['name']);
  $id   = htmlspecialchars($ct['id']);

  $rows[] = "<tr class='sortable'>"
    ."<td class='ct-name' style='width:220px;padding:8px'>"
    ."<span class='outer'><span id='{$id}' class='hand'>[icon]</span>"
    ."<span class='inner'><span class='appname'>{$name}</span><br>"
    ."<i id='load-{$id}' class='fa fa-{$shape} {$color}'></i>"
    ."<span class='state'>{$status}</span></span></span></td>"
    ."<td class='updatecolumn'>".($update ? 'update ready' : 'up-to-date')."</td>"
    ."<td>bridge</td><td>172.17.0.2</td><td>{$ct['port']}</td>"
    ."<td>10.0.0.10:{$ct['port']}</td><td>/mnt/user/appdata/{$name}</td>"
    ."<td class='load advanced'>{$ct['cpu']}% / {$mem}</td>"
    ."<td class='nine'><input type='checkbox' class='autostart' container='{$name}'"
    .(!empty($ct['autostart']) ? ' checked' : '')."></td>"
    ."<td class='five'>up 3 days</td></tr>";

  $js[] = "docker.push({name:'{$name}',id:'{$id}',state:{$running},pause:{$paused},update:{$update}});";
}

echo implode('', $rows)."\0".implode('', $js)."\0";
