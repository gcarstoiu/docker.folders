<?PHP
/* simple.folders harness - action-bar mockups.
 *
 * Three designs for the global action bar that replaces the tip line at the
 * bottom of the table, rendered with the plugin's real tokens and stylesheets
 * so they can be judged as they would actually look.
 *
 * Open http://localhost:8089/mockups  (add ?theme=white for the light themes)
 *
 * NOT part of the plugin package. Never shipped.
 */
$theme = preg_replace('/[^a-z]/', '', $_GET['theme'] ?? 'black');
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Action bar mockups</title>
<link rel="stylesheet" href="/plugins/simple.folders/styles/tokens.css">
<link rel="stylesheet" href="/plugins/simple.folders/styles/table.css">
<link rel="stylesheet" href="/plugins/simple.folders/styles/menus.css">
<style>
  body { margin:0; background:<?= $theme === 'white' || $theme === 'azure' ? '#F2F3F5' : '#101215' ?>;
         font-family: system-ui, sans-serif; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 24px 16px 60px; }
  .lbl { font: 600 13px/1.5 ui-monospace, monospace; letter-spacing:.08em; text-transform:uppercase;
         color:<?= $theme === 'white' || $theme === 'azure' ? '#5E646D' : '#8B929C' ?>; margin: 34px 0 4px; }
  .desc { font: 13px/1.6 system-ui; color:<?= $theme === 'white' || $theme === 'azure' ? '#363C44' : '#C9CED4' ?>;
          margin: 0 0 14px; max-width: 70ch; }
  .frame { border:1px dashed <?= $theme === 'white' || $theme === 'azure' ? '#C6CCD4' : '#343A42' ?>;
           border-radius:12px; }
</style>
</head>
<body>
<div class="wrap sf-root unapi" data-theme="<?= htmlspecialchars($theme) ?>">

<!-- ======================================================= A -->
<div class="lbl">A &mdash; Icon rail</div>
<p class="desc">Icon-only, 40&times;40 hit targets, grouped by what they do with thin dividers
between groups. Names live in the tooltip and the accessible label. Smallest footprint;
relies on the icons being legible on their own.</p>
<div class="frame">
  <div class="sf-actions sf-actions-a">
    <button class="sf-act sf-act-primary" title="Add container" aria-label="Add container"><?= ico('plus') ?></button>
    <span class="sf-act-sep"></span>
    <button class="sf-act" title="Start all" aria-label="Start all"><?= ico('play') ?></button>
    <button class="sf-act" title="Stop all" aria-label="Stop all"><?= ico('stop') ?></button>
    <button class="sf-act" title="Pause all" aria-label="Pause all"><?= ico('pause') ?></button>
    <button class="sf-act" title="Resume all" aria-label="Resume all"><?= ico('resume') ?></button>
    <span class="sf-act-sep"></span>
    <button class="sf-act" title="Check for updates" aria-label="Check for updates"><?= ico('check') ?></button>
    <button class="sf-act sf-act-badge" title="Update all" aria-label="Update all, 4 ready">
      <?= ico('download') ?><span class="sf-act-count">4</span>
    </button>
    <span class="sf-act-sep"></span>
    <button class="sf-act" title="Container size" aria-label="Container size"><?= ico('size') ?></button>
  </div>
</div>

<!-- ======================================================= B -->
<div class="lbl">B &mdash; Icon + short label</div>
<p class="desc">Each action is an icon with a one-word label &mdash; &ldquo;Start&rdquo;, not
&ldquo;Start All&rdquo;, since the bar is already global. Add container is the one filled button.
Readable without hovering, and still far lighter than the classic row.</p>
<div class="frame">
  <div class="sf-actions sf-actions-b">
    <button class="sf-chip sf-chip-primary"><?= ico('plus') ?><span>Add container</span></button>
    <span class="sf-act-sep"></span>
    <button class="sf-chip"><?= ico('play') ?><span>Start</span></button>
    <button class="sf-chip"><?= ico('stop') ?><span>Stop</span></button>
    <button class="sf-chip"><?= ico('pause') ?><span>Pause</span></button>
    <button class="sf-chip"><?= ico('resume') ?><span>Resume</span></button>
    <span class="sf-act-sep"></span>
    <button class="sf-chip"><?= ico('check') ?><span>Check</span></button>
    <button class="sf-chip sf-chip-warn"><?= ico('download') ?><span>Update</span><span class="sf-act-count">4</span></button>
    <span class="sf-act-sep"></span>
    <button class="sf-chip"><?= ico('size') ?><span>Size</span></button>
  </div>
</div>

<!-- ======================================================= C -->
<div class="lbl">C &mdash; Grouped command bar</div>
<p class="desc">A bar of its own, matching the table card. The four lifecycle actions are a
joined segmented control, so they read as one set of choices rather than four loose buttons.
Updates sit apart on the right with their count; the rarely-used Container size moves into an
overflow menu.</p>
<div class="frame">
  <div class="sf-actions sf-actions-c">
    <button class="sf-chip sf-chip-primary"><?= ico('plus') ?><span>Add container</span></button>

    <div class="sf-seggroup" role="group" aria-label="All containers">
      <button class="sf-seg" title="Start all"><?= ico('play') ?><span>Start</span></button>
      <button class="sf-seg" title="Stop all"><?= ico('stop') ?><span>Stop</span></button>
      <button class="sf-seg" title="Pause all"><?= ico('pause') ?><span>Pause</span></button>
      <button class="sf-seg" title="Resume all"><?= ico('resume') ?><span>Resume</span></button>
    </div>

    <span class="sf-act-grow"></span>

    <button class="sf-chip"><?= ico('check') ?><span>Check</span></button>
    <button class="sf-chip sf-chip-warn"><?= ico('download') ?><span>Update 4</span></button>
    <button class="sf-act" title="More" aria-label="More actions"><?= ico('more') ?></button>
  </div>
</div>

<div class="lbl">All three at phone width (420px)</div>
<div style="display:flex; gap:18px; flex-wrap:wrap">
  <?php foreach (['a','b','c'] as $v): ?>
  <div class="frame" style="width:420px; overflow:hidden">
    <div class="sf-actions sf-actions-<?= $v ?>">
      <button class="<?= $v === 'a' ? 'sf-act sf-act-primary' : 'sf-chip sf-chip-primary' ?>"><?= ico('plus') ?><?= $v === 'a' ? '' : '<span>Add container</span>' ?></button>
      <span class="sf-act-sep"></span>
      <?php if ($v === 'c'): ?>
        <div class="sf-seggroup">
          <button class="sf-seg"><?= ico('play') ?><span>Start</span></button>
          <button class="sf-seg"><?= ico('stop') ?><span>Stop</span></button>
          <button class="sf-seg"><?= ico('pause') ?><span>Pause</span></button>
          <button class="sf-seg"><?= ico('resume') ?><span>Resume</span></button>
        </div>
      <?php else: ?>
        <button class="<?= $v === 'a' ? 'sf-act' : 'sf-chip' ?>"><?= ico('play') ?><?= $v === 'a' ? '' : '<span>Start</span>' ?></button>
        <button class="<?= $v === 'a' ? 'sf-act' : 'sf-chip' ?>"><?= ico('stop') ?><?= $v === 'a' ? '' : '<span>Stop</span>' ?></button>
        <button class="<?= $v === 'a' ? 'sf-act' : 'sf-chip' ?>"><?= ico('pause') ?><?= $v === 'a' ? '' : '<span>Pause</span>' ?></button>
        <button class="<?= $v === 'a' ? 'sf-act' : 'sf-chip' ?>"><?= ico('resume') ?><?= $v === 'a' ? '' : '<span>Resume</span>' ?></button>
      <?php endif; ?>
      <span class="sf-act-sep"></span>
      <button class="<?= $v === 'a' ? 'sf-act' : 'sf-chip' ?>"><?= ico('check') ?><?= $v === 'a' ? '' : '<span>Check</span>' ?></button>
      <button class="<?= $v === 'a' ? 'sf-act sf-act-badge' : 'sf-chip sf-chip-warn' ?>"><?= ico('download') ?><?= $v === 'a' ? '<span class="sf-act-count">4</span>' : '<span>Update 4</span>' ?></button>
      <?php if ($v !== 'c'): ?>
        <span class="sf-act-sep"></span>
        <button class="<?= $v === 'a' ? 'sf-act' : 'sf-chip' ?>"><?= ico('size') ?><?= $v === 'a' ? '' : '<span>Size</span>' ?></button>
      <?php else: ?>
        <button class="sf-act"><?= ico('more') ?></button>
      <?php endif; ?>
    </div>
  </div>
  <?php endforeach; ?>
</div>

</div>

<style>
/* ---- shared ---- */
.sf-root .sf-actions {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 10px 12px;
}
.sf-root .sf-act-sep {
  width: 1px; height: 22px; margin: 0 6px;
  background: var(--sf-border-row);
}
.sf-root .sf-act-grow { flex: 1 1 auto; }
.sf-root .sf-act-count {
  min-width: 17px; height: 17px; padding: 0 5px;
  display: inline-grid; place-items: center;
  border-radius: var(--sf-r-pill);
  background: var(--sf-warn-bg); color: var(--sf-warn-fg);
  border: 1px solid var(--sf-warn-border);
  font: 600 10px/1 var(--sf-font-mono);
}

/* ---- A: icon rail ---- */
.sf-root .sf-act {
  position: relative;
  width: 40px; height: 40px;
  display: grid; place-items: center;
  border-radius: var(--sf-r-control);
  color: var(--sf-text-secondary);
}
.sf-root .sf-act:hover { background: var(--sf-bg-hover-ghost); color: var(--sf-text); }
.sf-root .sf-act svg { width: 19px; height: 19px; }
.sf-root .sf-act-primary {
  background: var(--sf-accent); color: var(--sf-on-accent);
}
.sf-root .sf-act-primary:hover { background: var(--sf-accent-hover); color: var(--sf-on-accent); }
.sf-root .sf-act-badge .sf-act-count { position: absolute; top: 2px; right: 1px; }

/* ---- B: icon + label chip ---- */
.sf-root .sf-chip {
  display: inline-flex; align-items: center; gap: 7px;
  height: 36px; padding: 0 12px;
  border: 1px solid var(--sf-border-control);
  border-radius: var(--sf-r-control);
  color: var(--sf-text);
  font-size: var(--sf-fs-small); font-weight: 500;
  white-space: nowrap;
}
.sf-root .sf-chip:hover { background: var(--sf-bg-hover-ghost); }
.sf-root .sf-chip svg { width: 16px; height: 16px; color: var(--sf-text-muted); }
.sf-root .sf-chip-primary {
  background: var(--sf-accent); border-color: var(--sf-accent);
  color: var(--sf-on-accent); font-weight: 600;
}
.sf-root .sf-chip-primary svg { color: var(--sf-on-accent); }
.sf-root .sf-chip-warn { border-color: var(--sf-warn-border); color: var(--sf-warn-fg); }
.sf-root .sf-chip-warn svg { color: var(--sf-warn-fg); }

/* ---- C: segmented group ---- */
.sf-root .sf-actions-c {
  border: 1px solid var(--sf-border-card);
  border-radius: var(--sf-r-card);
  background: var(--sf-bg-card);
  padding: 10px 12px;
  gap: 10px;
}
.sf-root .sf-seggroup { display: inline-flex; }
.sf-root .sf-seg {
  display: inline-flex; align-items: center; gap: 6px;
  height: 36px; padding: 0 12px;
  border: 1px solid var(--sf-border-control);
  border-left-width: 0;
  color: var(--sf-text);
  font-size: var(--sf-fs-small); font-weight: 500;
  white-space: nowrap;
}
.sf-root .sf-seg:first-child {
  border-left-width: 1px;
  border-radius: var(--sf-r-control) 0 0 var(--sf-r-control);
}
.sf-root .sf-seg:last-child { border-radius: 0 var(--sf-r-control) var(--sf-r-control) 0; }
.sf-root .sf-seg:hover { background: var(--sf-bg-hover-ghost); }
.sf-root .sf-seg svg { width: 16px; height: 16px; color: var(--sf-text-muted); }
</style>
</body>
</html>

<?PHP
/* 24-unit stroke icons, same style as the folder glyph sprite. */
function ico(string $name): string {
  $paths = [
    'plus'     => '<path d="M12 5v14M5 12h14"/>',
    'play'     => '<path d="M8 5.6l10 6.4-10 6.4z"/>',
    'stop'     => '<rect x="6" y="6" width="12" height="12" rx="2.2"/>',
    'pause'    => '<path d="M9.5 5.5v13M14.5 5.5v13"/>',
    'resume'   => '<path d="M7 5.6l9 6.4-9 6.4z"/><path d="M19 5.5v13"/>',
    'check'    => '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5V10h-5.5"/>',
    'download' => '<path d="M12 4v10"/><path d="M8 10.5l4 4 4-4"/><path d="M5 17.5v1.2a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8v-1.2"/>',
    'size'     => '<ellipse cx="12" cy="6.3" rx="6.8" ry="2.6"/><path d="M5.2 6.3v11.4c0 1.44 3.04 2.6 6.8 2.6s6.8-1.16 6.8-2.6V6.3"/><path d="M5.2 12c0 1.44 3.04 2.6 6.8 2.6s6.8-1.16 6.8-2.6"/>',
    'more'     => '<circle cx="12" cy="5.5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="18.5" r="1.4"/>',
  ];
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"'
       . ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
       . ($paths[$name] ?? '') . '</svg>';
}
