<?PHP
/* docker.folders harness - a stand-in for Unraid's Docker page.
 *
 * Reproduces exactly what the plugin is entitled to assume is present when its
 * docker.folders.Docker.page is rendered inside the Docker tab:
 *
 *   - jQuery (Unraid ships 3.x) and the NchanSubscriber global
 *   - var csrf_token, and $.post patched to append it (webGUI does this in
 *     DefaultPageLayout/HeadInlineJS.php)
 *   - var docker = [], loadlist(), and the #docker_containers table
 *   - the .js-actions button row, body theme class, and _() translation stub
 *
 * The plugin's own page is included at the bottom, where Menu="Docker" puts it.
 *
 * NOT part of the plugin package. Never shipped.
 */
$theme = preg_replace('/[^a-z]/', '', $_GET['theme'] ?? 'black');

/* ?nostream=1 turns off the live CPU/memory subscription. The nchan channel
 * is a long poll that by design never ends, which means a headless browser
 * never sees the page go idle - so screenshots and DOM dumps need a way to
 * opt out. Only the two live columns are affected. */
$nostream = isset($_GET['nostream']);
$plugin = __DIR__.'/../../src/usr/local/emhttp/plugins/docker.folders';
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Docker — harness (<?=htmlspecialchars($theme)?>)</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>
<script src="/webGui/javascript/nchan.js"></script>
<!-- Unraid's element styling, which a plugin's UI has to survive. See the
     file header: without this the harness is friendlier than a real server
     and CSS collisions ship undetected. -->
<link rel="stylesheet" href="/webGui/styles/unraid-base-excerpt.css">
<style>
  /* A deliberately minimal stand-in for Unraid's stylesheets: enough structure
     to catch layout mistakes, not enough to mask them. */
  body { margin:0; font-family:system-ui,sans-serif; background:#1b1b1b; color:#e0e0e0; }
  body.white, body.azure { background:#f2f2f2; color:#1b1b1b; }
  .harness-bar { padding:8px 16px; background:#000; color:#9aa1ab; font:12px/1.6 ui-monospace,monospace;
                 display:flex; gap:16px; align-items:center; flex-wrap:wrap; }
  .harness-bar a { color:#6EA8FE; }
  .title { padding:16px; font-size:1.6rem; }
  .TableContainer { padding:0 16px; }
  table#docker_containers { width:100%; border-collapse:collapse; }
  #docker_containers th, #docker_containers td { padding:6px; border-bottom:1px solid #333; text-align:left; font-size:13px; }
  .js-actions { padding:16px; display:flex; gap:8px; flex-wrap:wrap; }
  .advanced { display:none; }
</style>
</head>
<body class="<?=htmlspecialchars($theme)?>">

<div class="harness-bar">
  <strong style="color:#fff">docker.folders harness</strong>
  <span>theme:</span>
  <?php foreach (['black','white','azure','gray'] as $t): ?>
    <a href="?theme=<?=$t?>"><?=$t?></a>
  <?php endforeach; ?>
  <span style="margin-left:auto">
    <a href="/_reset">reset container state</a>
  </span>
</div>

<div class="title">Docker Containers</div>

<div class="TableContainer">
  <table id="docker_containers" class="tablesorter shift">
    <thead>
      <tr>
        <th>Application</th><th>Version</th><th>Network</th><th>Container IP</th>
        <th>Container Port</th><th>LAN IP:Port</th><th>Volume Mappings</th>
        <th class="load advanced">CPU &amp; Memory load</th>
        <th class="nine">Autostart</th><th class="five">Uptime</th>
      </tr>
    </thead>
    <tbody id="docker_list"><tr><td colspan="10"></td></tr></tbody>
  </table>
</div>

<div class="js-actions">
  <input type="button" onclick="addContainer()" value="Add Container" style="display:none">
  <input type="button" onclick="startAll()" value="Start All" style="display:none">
  <input type="button" onclick="stopAll()" value="Stop All" style="display:none">
  <input type="button" onclick="checkAll()" value="Check for Updates" id="checkAll" style="display:none">
  <input type="button" onclick="updateAll()" value="Update All" id="updateAll" style="display:none">
</div>

<script>
/* PHP's built-in server cannot do websockets, so tell the plugin to use the
   long-poll transport NchanSubscriber also supports. Must be set before the
   plugin page's inline config runs. */
window.DockerFolders = { nchanTransport: <?= $nostream ? "'none'" : "'longpoll'" ?> };

/* ?folded=<id,id|all> presets the per-viewer fold state before app.js reads
   it, so a headless capture can show folded folders without clicking. */
<?php if (isset($_GET['folded'])): ?>
try {
  var want = <?= json_encode((string)$_GET['folded']) ?>;
  var map = {};
  (want === 'all' ? ['f-media','f-home','f-ai'] : want.split(',')).forEach(function (id) { map[id] = false; });
  localStorage.setItem('docker.folders:expanded', JSON.stringify(map));
} catch (e) {}
<?php endif; ?>

/* ---- globals the webGUI guarantees to every page ---------------------- */
var csrf_token = "0123456789ABCDEF";
var docker = [];
var timers = {};

/* webGUI patches every jQuery POST to carry the token. Reproduced because a
   plugin that forgets it passes locally and 403s on real hardware. */
$.ajaxSetup({ beforeSend: function (jqXHR, s) {
  if (s.type === 'POST' && typeof s.data === 'string' && s.data.indexOf('csrf_token=') === -1) {
    s.data += (s.data ? '&' : '') + 'csrf_token=' + csrf_token;
  }
}});

/* Unraid's translation helper. */
function _(s) { return s; }

/* The native list loader. The plugin hides this table rather than removing it,
   and must keep it working for "Classic view". */
function loadlist(init) {
  $.get('/plugins/dynamix.docker.manager/include/DockerContainers.php', function (d) {
    var data = d.split(/\0/);
    docker = [];
    $('#docker_list').html(data[0]);
    (new Function(data[1]))();
    $('input[type=button]').prop('disabled', false).show();
    $(document).trigger('docker.folders:loadlist');
  });
}

/* Native actions the plugin's container menu delegates to. */
function addContainer()  { alert('[harness] Add Container page'); }
function editContainer(n, t) { alert('[harness] edit ' + n); }
function openTerminal(k, n, s) { alert('[harness] ' + (s === '.log' ? 'logs' : 'console') + ' for ' + n); }
function rmContainer(n, i, id) { alert('[harness] remove ' + n); }
function startAll()  { $.post('/plugins/dynamix.docker.manager/include/ContainerManager.php', {action:'start'},  loadlist); }
function stopAll()   { $.post('/plugins/dynamix.docker.manager/include/ContainerManager.php', {action:'stop'},   loadlist); }
function checkAll()  { $.post('/plugins/dynamix.docker.manager/include/DockerUpdate.php', {}, loadlist); }
function updateAll() { alert('[harness] update all'); }

$(function () { loadlist(true); });
</script>

<?php
/* Render the plugin page the way emhttp does: strip the "Menu=/Icon=" header
   above the --- separator, then evaluate the rest as PHP+HTML. */
$page = $plugin.'/docker.folders.Docker.page';
if (file_exists($page)) {
  $raw  = file_get_contents($page);
  $body = strpos($raw, "\n---\n") !== false ? substr($raw, strpos($raw, "\n---\n") + 5) : $raw;
  /* Unraid's page parser also expands _(...)_ translation markers. */
  $body = preg_replace('/_\((.*?)\)_/', '$1', $body);
  eval('?>'.$body);
} else {
  echo '<p style="padding:16px;color:#FF9B9B">plugin page not found: '.htmlspecialchars($page).'</p>';
}
?>
</body>
</html>
