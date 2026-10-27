/* simple.folders - building the table.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 * Layout follows DESIGN_SPEC.md 3-5. The table is a CSS grid rather than a
 * <table>: a folder row has to hold a wrapping icon strip whose height grows
 * with the number of members, which table layout fights.
 *
 * Every control is a real <button> or <input>. Nothing is a clickable <div>:
 * spec 14 requires full keyboard reach and sensible roles.
 */
(function (root) {
  'use strict';

  var SF = root.SimpleFolders = root.SimpleFolders || {};
  var U = SF.util;
  var R = SF.render = {};

  var COLUMNS = ['', 'Container', 'Status', 'Version', 'Port', 'CPU', 'Memory', 'Autostart', ''];

  /* ---------------------------------------------------------------------
   * Entry point
   * ------------------------------------------------------------------- */
  R.draw = function (mount) {
    var S = SF.store, state = S.state;

    U.clear(mount);
    mount.hidden = false;

    mount.appendChild(header());

    if (state.error) { mount.appendChild(notice(state.error, 'sf-notice-error')); return; }
    if (!state.loaded) { mount.appendChild(notice('Loading containers…')); return; }

    /* Classic view hands the page back to Unraid's own table untouched. */
    if (state.classic) {
      mount.appendChild(notice('Classic view is on — the standard Unraid table is shown above.'));
      return;
    }

    var folders = S.visibleFolders();
    var loose   = S.visibleLoose();

    if (state.filter && !folders.length && !loose.length) {
      mount.appendChild(notice('Nothing matches “' + state.filter + '”'));
      return;
    }

    var card = U.el('div.sf-card');
    card.appendChild(columnHeads());

    var body = U.el('div.sf-body');
    folders.forEach(function (entry) {
      body.appendChild(folderRow(entry.folder));
      if (S.isExpanded(entry.folder.id)) {
        entry.members.forEach(function (ct, i) {
          body.appendChild(containerRow(ct, { folder: entry.folder, index: i + 1 }));
        });
      }
    });

    if (loose.length) {
      body.appendChild(sectionLabel('Not in a folder', loose.length));
      loose.forEach(function (ct) { body.appendChild(containerRow(ct, {})); });
    }

    card.appendChild(body);
    mount.appendChild(card);
    mount.appendChild(actionBar());
  };

  /* Patch only the CPU and memory cells.
   *
   * The dockerload channel republishes roughly once a second. Redrawing the
   * whole table that often discards the card's horizontal scroll offset and
   * any focus in the filter box - on a phone, where the table must be
   * scrolled sideways to read it, that meant it snapped back to the left
   * every second. Nothing else in the row depends on these two numbers, so
   * they are written straight into the existing cells. */
  R.updateLive = function (mount) {
    var S = SF.store;
    if (!mount || S.state.classic || !S.state.loaded) return;

    mount.querySelectorAll('.sf-row-ct[data-container]').forEach(function (row) {
      var ct = S.container(row.dataset.container);
      if (!ct) return;
      setCell(row, '.sf-cell-cpu', U.cpu(S.cpu(ct)));
      setCell(row, '.sf-cell-mem', U.memory(S.mem(ct)));
    });

    mount.querySelectorAll('.sf-row-folder[data-folder]').forEach(function (row) {
      var folder = S.folder(row.dataset.folder);
      if (!folder) return;
      var sum = S.summary(folder);
      setCell(row, '.sf-cell-cpu', U.cpu(sum.cpu));
      setCell(row, '.sf-cell-mem', U.memory(sum.mem));
    });
  };

  function setCell(row, selector, value) {
    var cell = row.querySelector(selector);
    if (cell && cell.textContent !== value) cell.textContent = value;
  }

  /* ---------------------------------------------------------------------
   * Header
   * ------------------------------------------------------------------- */
  function header() {
    var S = SF.store, state = S.state, stats = state.stats;

    var summary = [
      U.plural(stats.containers, 'container'),
      stats.running + ' running',
      U.plural(stats.folders, 'folder'),
      stats.updates ? U.plural(stats.updates, 'update') + ' ready' : null
    ].filter(Boolean).join(' · ');

    var filter = U.el('input.sf-filter-input', {
      type: 'search',
      value: state.filter,
      placeholder: 'Filter containers or folders',
      'aria-label': 'Filter containers or folders',
      onInput: U.debounce(function (e) { S.setFilter(e.target.value.trim()); }, 140)
    });

    var open = S.anyExpanded();

    var actions = U.el('div.sf-head-actions', null, [
      U.el('div.sf-filter', null, [U.glyph('search', 'sf-filter-icon'), filter]),

      U.el('button.sf-btn', {
        type: 'button',
        disabled: state.classic || !state.folders.length,
        onClick: function () { S.setAllExpanded(!open); }
      }, open ? 'Fold all' : 'Unfold all'),

      U.el('button.sf-btn.sf-btn-primary', {
        type: 'button',
        disabled: state.classic,
        onClick: function () { SF.editor.open(null); }
      }, '+ New folder'),

      classicToggle()
    ]);

    /* No eyebrow and no "Containers" heading: Unraid already prints its own
     * "Docker Containers" heading directly above this, and repeating it put
     * three stacked titles on the page. The summary line carries straight on
     * from Unraid's heading. */
    return U.el('header.sf-head', null, [
      U.el('div.sf-head-text', null, [
        U.el('div.sf-summary', { text: summary })
      ]),
      actions
    ]);
  }

  /* The safety valve: hide our table and show Unraid's, with no reload. */
  function classicToggle() {
    var S = SF.store, on = S.state.classic;
    return U.el('label.sf-classic', { title: 'Show the standard Unraid container table instead' }, [
      U.el('input', {
        type: 'checkbox',
        checked: on,
        onChange: function (e) { S.setClassic(e.target.checked); }
      }),
      U.el('span', { text: 'Classic view' })
    ]);
  }

  function columnHeads() {
    var row = U.el('div.sf-row.sf-row-head', { role: 'row' });
    COLUMNS.forEach(function (label, i) {
      row.appendChild(U.el('div.sf-cell', {
        role: 'columnheader',
        'aria-hidden': label ? null : 'true',
        text: label
      }));
      void i;
    });
    return row;
  }

  function sectionLabel(text, count) {
    return U.el('div.sf-section', null, [
      U.el('span.sf-section-text', { text: text }),
      U.el('span.sf-section-count', { text: '· ' + count })
    ]);
  }

  function notice(text, cls) {
    return U.el('div.sf-notice' + (cls ? '.' + cls : ''), { text: text });
  }


  /* ---------------------------------------------------------------------
   * Global action bar
   *
   * The eight actions from Unraid's classic Docker view, which our table
   * otherwise hides along with the native button row.
   *
   * The four lifecycle actions are one joined segmented control under an
   * "All containers" label. That label is not decoration: the buttons say
   * "Stop", not "Stop All", and without it a bar sitting under a table of
   * folders reads as if it acts on a folder. Stop and Pause also confirm
   * first, because they hit every container on the server.
   * ------------------------------------------------------------------- */
  function actionBar() {
    var S = SF.store;
    var busy = SF.jobs.running();
    var cts = S.state.containers;

    var running = cts.filter(function (c) { return c.state === 'running'; }).length;
    var paused  = cts.filter(function (c) { return c.state === 'paused'; }).length;
    var stopped = cts.filter(function (c) { return c.state === 'stopped'; }).length;
    var updates = cts.filter(function (c) { return c.update === 1; }).length;

    var segs = U.el('div.sf-seggroup', { role: 'group', 'aria-label': 'All containers' }, [
      seg('play',   'Start',  'Start every stopped container', busy || !stopped,
          function () { SF.actions.globalLifecycle('start'); }),
      seg('stop',   'Stop',   'Stop every running container',  busy || !(running + paused),
          function () { SF.actions.globalLifecycle('stop'); }),
      seg('pause',  'Pause',  'Pause every running container', busy || !running,
          function () { SF.actions.globalLifecycle('pause'); }),
      seg('resume', 'Resume', 'Resume every paused container', busy || !paused,
          function () { SF.actions.globalLifecycle('resume'); })
    ]);

    var row = U.el('div.sf-actions', null, [
      chip('plus', 'Add container', 'brand', false, function () { SF.actions.addContainer(); }),
      segs,
      U.el('span.sf-act-grow'),
      chip('check', 'Check', null, busy, function () { SF.actions.checkUpdates(null); }),
      updates
        ? chip('download', 'Update ' + updates, 'warn', busy,
               function () { SF.actions.globalUpdate(); })
        : chip('download', 'Update', null, true, function () {}),
      U.el('button.sf-act', {
        type: 'button',
        'aria-label': 'More actions',
        'aria-haspopup': 'menu',
        onClick: function (e) { SF.menus.globalMore(e.currentTarget); }
      }, [U.glyph('more')])
    ]);

    return U.el('div.sf-actionbar', null, [
      U.el('div.sf-grouplbl', { text: 'All containers' }),
      row
    ]);
  }

  function chip(icon, label, tone, disabled, onClick) {
    return U.el('button.sf-chip' + (tone ? '.sf-chip-' + tone : ''), {
      type: 'button',
      disabled: disabled || false,
      onClick: onClick
    }, [U.glyph(icon), U.el('span', { text: label })]);
  }

  function seg(icon, label, title, disabled, onClick) {
    return U.el('button.sf-seg', {
      type: 'button',
      title: title,
      'aria-label': title,
      disabled: disabled || false,
      onClick: onClick
    }, [U.glyph(icon), U.el('span', { text: label })]);
  }

  /* ---------------------------------------------------------------------
   * Folder row (spec 4)
   * ------------------------------------------------------------------- */
  function folderRow(folder) {
    var S = SF.store;
    var sum = S.summary(folder);
    var open = S.isExpanded(folder.id);

    var row = U.el('div.sf-row.sf-row-folder', {
      role: 'row',
      'data-folder': folder.id,
      'data-color': folder.color
    });

    /* 1 - chevron */
    var chevron = U.el('button.sf-chevron', {
      type: 'button',
      'aria-expanded': String(open),
      'aria-label': (open ? 'Collapse' : 'Expand') + ' folder ' + folder.name,
      disabled: !!S.state.filter,
      onClick: function () { S.toggle(folder.id); }
    }, [U.el('span.sf-chevron-mark', { 'aria-hidden': 'true' })]);
    row.appendChild(U.el('div.sf-cell.sf-cell-tree', null, [chevron]));

    /* 2 - icon, name, count, and either the icon strip or the sub-line */
    var icon = U.el('button.sf-folder-icon', {
      type: 'button',
      'aria-label': 'Commands for folder ' + folder.name,
      'aria-haspopup': 'menu',
      onClick: function (e) { SF.menus.folder(e.currentTarget, folder, 'left'); }
    }, [folderIconContent(folder)]);

    /* Clicking the name folds the folder too - mouse convenience, not a second
     * tab stop (spec 4.3), so tabindex="-1". It must NOT be aria-hidden:
     * that would take the folder's name out of the accessibility tree and
     * leave a screen reader with an unnamed row. */
    var nameButton = U.el('button.sf-folder-name', {
      type: 'button',
      tabindex: '-1',
      onClick: function () { if (!S.state.filter) S.toggle(folder.id); }
    }, folder.name);

    /* The count sits beside the name only when the folder is folded; when it
     * is open the sub-line below already carries it, and showing both reads
     * as a mistake. */
    var line1 = U.el('div.sf-folder-line1', null, [
      nameButton,
      open ? null : U.el('span.sf-folder-count', { text: U.plural(sum.total, 'container') })
    ]);

    var line2 = (!open && folder.preview !== 'count')
      ? iconStrip(folder, sum.members)
      : U.el('div.sf-folder-sub', { text: subLine(folder, sum) });

    row.appendChild(U.el('div.sf-cell.sf-cell-name', null, [
      icon,
      U.el('div.sf-folder-text', null, [line1, line2])
    ]));

    /* 3 - status */
    row.appendChild(U.el('div.sf-cell', null, [
      U.el('div.sf-folder-status' + (sum.busy ? '.is-busy' : (sum.allRunning ? '.is-all' : '')), {
        text: sum.busy
          ? 'Working… ' + sum.running + ' of ' + sum.total + ' up'
          : sum.running + ' of ' + sum.total + ' running'
      }),
      segmentBar(sum.members)
    ]));

    /* 4 - version */
    row.appendChild(U.el('div.sf-cell', null, [
      sum.updates
        ? U.el('span.sf-badge.sf-badge-warn', { text: U.plural(sum.updates, 'update') })
        : U.el('span.sf-muted', { text: 'Up to date' })
    ]));

    /* 5-7 - port, cpu, memory */
    row.appendChild(U.el('div.sf-cell.sf-mono.sf-muted', { text: '—' }));
    row.appendChild(U.el('div.sf-cell.sf-mono.sf-cell-cpu', { text: U.cpu(sum.cpu) }));
    row.appendChild(U.el('div.sf-cell.sf-mono.sf-cell-mem', { text: U.memory(sum.mem) }));

    /* 8 - tri-state autostart */
    row.appendChild(U.el('div.sf-cell', null, [
      switchControl({
        state: sum.autostart,
        label: { on: 'All on', off: 'All off', mixed: 'Mixed' }[sum.autostart],
        ariaLabel: 'Autostart for every container in ' + folder.name,
        onToggle: function () { SF.actions.setFolderAutostart(folder, sum.autostart !== 'on'); }
      })
    ]));

    /* 9 - overflow menu */
    row.appendChild(U.el('div.sf-cell.sf-cell-menu', null, [
      kebab('Menu for folder ' + folder.name, function (e) {
        SF.menus.folder(e.currentTarget, folder, 'right');
      })
    ]));

    return row;
  }

  /* "5 containers - starts 5 s apart"; the delay half is dropped at 0. */
  function subLine(folder, sum) {
    var text = U.plural(sum.total, 'container');
    if (folder.delay > 0) text += ' · starts ' + folder.delay + ' s apart';
    return text;
  }

  /* The folded folder's icon strip: EVERY member, no cap and no "+N"
   * (spec 4.1). It sits on its own line under the name and wraps, so a narrow
   * Container column grows the row instead of colliding with the next one. */
  function iconStrip(folder, members) {
    var strip = U.el('div.sf-strip', { role: 'group', 'aria-label': 'Containers in ' + folder.name });

    members.forEach(function (ct) {
      var status = SF.store.status(ct);
      var button = U.el('button.sf-strip-btn', {
        type: 'button',
        'aria-label': 'Actions for ' + ct.name + ', ' + status.label,
        'aria-haspopup': 'menu',
        title: ct.name + ' · ' + status.label,
        onClick: function (e) { SF.menus.container(e.currentTarget, ct, 'left'); }
      }, [containerTile(ct, 'sf-strip-tile')]);

      /* "Icons only" hides the status dot but keeps the tooltip and label. */
      if (folder.preview !== 'icons') {
        button.appendChild(U.el('span.sf-strip-dot.sf-dot-' + status.kind, { 'aria-hidden': 'true' }));
      }
      strip.appendChild(button);
    });

    return strip;
  }

  /* One segment per member, coloured by status (spec 4.4). */
  function segmentBar(members) {
    var bar = U.el('div.sf-segments', { 'aria-hidden': 'true' });
    members.forEach(function (ct) {
      bar.appendChild(U.el('span.sf-segment.sf-seg-' + SF.store.status(ct).kind));
    });
    return bar;
  }

  /* ---------------------------------------------------------------------
   * Container row (spec 5)
   * ------------------------------------------------------------------- */
  function containerRow(ct, opts) {
    var S = SF.store;
    var status = S.status(ct);
    var inFolder = !!opts.folder;

    var row = U.el('div.sf-row.sf-row-ct' + (inFolder ? '.is-nested' : ''), {
      role: 'row',
      'data-container': ct.name
    });

    /* 1 - tree line when nested */
    row.appendChild(U.el('div.sf-cell.sf-cell-tree', null, [
      inFolder ? U.el('span.sf-tree', { 'aria-hidden': 'true' }) : null
    ]));

    /* 2 - start-order number, icon, name, image */
    var iconButton = U.el('button.sf-ct-icon', {
      type: 'button',
      'aria-label': 'Actions for ' + ct.name + ', ' + status.label,
      'aria-haspopup': 'menu',
      onClick: function (e) { SF.menus.container(e.currentTarget, ct, 'left'); }
    }, [containerTile(ct, 'sf-ct-tile')]);

    row.appendChild(U.el('div.sf-cell.sf-cell-name', null, [
      inFolder ? U.el('span.sf-order.sf-mono', { text: String(opts.index), 'aria-hidden': 'true' }) : null,
      iconButton,
      U.el('div.sf-ct-text', null, [
        U.el('div.sf-ct-name', { text: ct.name }),
        U.el('div.sf-ct-image', { text: ct.image })
      ])
    ]));

    /* 3 - status: the marker's SHAPE differs per state, so colour is never
     * the only signal (spec 5, spec 14). */
    row.appendChild(U.el('div.sf-cell', null, [
      U.el('div.sf-ct-status', null, [
        U.el('span.sf-dot.sf-dot-' + status.kind, { 'aria-hidden': 'true' }),
        U.el('span.sf-status-text.sf-status-' + status.kind, { text: status.label })
      ])
    ]));

    /* 4 - version */
    row.appendChild(U.el('div.sf-cell', null, [
      ct.update === 1 ? U.el('span.sf-badge.sf-badge-warn', { text: 'Update ready' })
      : ct.update === 2 ? U.el('span.sf-badge.sf-badge-warn', { text: 'Rebuild ready' })
      : U.el('span.sf-muted', { text: 'Up to date' })
    ]));

    /* 5-7 */
    row.appendChild(U.el('div.sf-cell.sf-mono', { text: ct.port ? ':' + ct.port : '—' }));
    row.appendChild(U.el('div.sf-cell.sf-mono.sf-cell-cpu', { text: U.cpu(S.cpu(ct)) }));
    row.appendChild(U.el('div.sf-cell.sf-mono.sf-cell-mem', { text: U.memory(S.mem(ct)) }));

    /* 8 */
    row.appendChild(U.el('div.sf-cell', null, [
      switchControl({
        state: ct.autostart ? 'on' : 'off',
        label: ct.autostart ? 'On' : 'Off',
        ariaLabel: 'Autostart ' + ct.name,
        onToggle: function () { SF.actions.setContainerAutostart(ct, !ct.autostart); }
      })
    ]));

    /* 9 */
    row.appendChild(U.el('div.sf-cell.sf-cell-menu', null, [
      kebab('Menu for ' + ct.name, function (e) { SF.menus.container(e.currentTarget, ct, 'right'); })
    ]));

    return row;
  }

  /* ---------------------------------------------------------------------
   * Shared pieces
   * ------------------------------------------------------------------- */

  /* A container's own icon, as Unraid resolved it. The harness (and any
   * container without one) falls back to a letter on a tinted tile, which is
   * what the prototype shows - the plugin never ships third-party logos. */
  function containerTile(ct, cls) {
    if (ct.icon) {
      return U.el('img', {
        class: cls + ' sf-tile-img',
        src: ct.icon,
        alt: '',
        loading: 'lazy',
        /* A broken icon URL must not leave an empty hole in the row. */
        onError: function (e) {
          var fallback = letterTile(ct, cls);
          if (e.target.parentNode) e.target.parentNode.replaceChild(fallback, e.target);
        }
      });
    }
    return letterTile(ct, cls);
  }

  function letterTile(ct, cls) {
    return U.el('span.' + cls.replace(/^\./, '') + '.sf-tile-letter', {
      'data-tint': ct.tint || 'slate',
      'aria-hidden': 'true',
      text: (ct.letter || ct.name.charAt(0)).toUpperCase()
    });
  }

  function folderIconContent(folder) {
    var icon = folder.icon || {};

    if (icon.type === 'web' && icon.localFile) {
      return U.el('img.sf-folder-img', {
        src: SF.config.base + '/include/Icons.php?file=' + encodeURIComponent(icon.localFile),
        alt: '', loading: 'lazy'
      });
    }

    if (icon.type === 'container') {
      var ct = SF.store.container(icon.name);
      if (ct) return containerTile(ct, 'sf-folder-img');
    }

    return U.glyph(icon.key || 'folder', 'sf-folder-glyph');
  }

  /* Two-state and tri-state switch. aria-pressed carries "mixed" for the
   * folder switch, which is exactly what that value is for. */
  function switchControl(opts) {
    var track = U.el('button.sf-switch', {
      type: 'button',
      'data-state': opts.state,
      'aria-pressed': opts.state === 'mixed' ? 'mixed' : String(opts.state === 'on'),
      'aria-label': opts.ariaLabel,
      onClick: opts.onToggle
    }, [U.el('span.sf-switch-knob', { 'aria-hidden': 'true' })]);

    return U.el('div.sf-switch-wrap', null, [
      track,
      U.el('span.sf-switch-label', { text: opts.label })
    ]);
  }

  function kebab(label, onClick) {
    return U.el('button.sf-kebab', {
      type: 'button',
      'aria-label': label,
      'aria-haspopup': 'menu',
      onClick: onClick
    }, [U.el('span', { 'aria-hidden': 'true', text: '⋮' })]);
  }
})(window);
