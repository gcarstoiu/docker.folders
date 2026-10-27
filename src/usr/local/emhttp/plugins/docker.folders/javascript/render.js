/* docker.folders - building the table.
 * Copyright (C) 2026  george
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

  var DF = root.DockerFolders = root.DockerFolders || {};
  var U = DF.util;
  var R = DF.render = {};

  var COLUMNS = ['', 'Container', 'Status', 'Version', 'Port', 'CPU', 'Memory', 'Autostart', ''];

  /* ---------------------------------------------------------------------
   * Entry point
   * ------------------------------------------------------------------- */
  R.draw = function (mount) {
    var S = DF.store, state = S.state;

    U.clear(mount);
    mount.hidden = false;

    mount.appendChild(header());

    if (state.error) { mount.appendChild(notice(state.error, 'df-notice-error')); return; }
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

    var card = U.el('div.df-card');
    card.appendChild(columnHeads());

    var body = U.el('div.df-body');
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
    mount.appendChild(tip());
  };

  /* ---------------------------------------------------------------------
   * Header
   * ------------------------------------------------------------------- */
  function header() {
    var S = DF.store, state = S.state, stats = state.stats;

    var summary = [
      U.plural(stats.containers, 'container'),
      stats.running + ' running',
      U.plural(stats.folders, 'folder'),
      stats.updates ? U.plural(stats.updates, 'update') + ' ready' : null
    ].filter(Boolean).join(' · ');

    var filter = U.el('input.df-filter-input', {
      type: 'search',
      value: state.filter,
      placeholder: 'Filter containers or folders',
      'aria-label': 'Filter containers or folders',
      onInput: U.debounce(function (e) { S.setFilter(e.target.value.trim()); }, 140)
    });

    var open = S.anyExpanded();

    var actions = U.el('div.df-head-actions', null, [
      U.el('div.df-filter', null, [U.glyph('search', 'df-filter-icon'), filter]),

      U.el('button.df-btn', {
        type: 'button',
        disabled: state.classic || !state.folders.length,
        onClick: function () { S.setAllExpanded(!open); }
      }, open ? 'Fold all' : 'Unfold all'),

      U.el('button.df-btn.df-btn-primary', {
        type: 'button',
        disabled: state.classic,
        onClick: function () { DF.editor.open(null); }
      }, '+ New folder'),

      classicToggle()
    ]);

    return U.el('header.df-head', null, [
      U.el('div.df-head-text', null, [
        U.el('div.df-eyebrow', { text: 'UNRAID · DOCKER' }),
        U.el('h2.df-title', { text: 'Containers' }),
        U.el('div.df-summary', { text: summary })
      ]),
      actions
    ]);
  }

  /* The safety valve: hide our table and show Unraid's, with no reload. */
  function classicToggle() {
    var S = DF.store, on = S.state.classic;
    return U.el('label.df-classic', { title: 'Show the standard Unraid container table instead' }, [
      U.el('input', {
        type: 'checkbox',
        checked: on,
        onChange: function (e) { S.setClassic(e.target.checked); }
      }),
      U.el('span', { text: 'Classic view' })
    ]);
  }

  function columnHeads() {
    var row = U.el('div.df-row.df-row-head', { role: 'row' });
    COLUMNS.forEach(function (label, i) {
      row.appendChild(U.el('div.df-cell', {
        role: 'columnheader',
        'aria-hidden': label ? null : 'true',
        text: label
      }));
      void i;
    });
    return row;
  }

  function sectionLabel(text, count) {
    return U.el('div.df-section', null, [
      U.el('span.df-section-text', { text: text }),
      U.el('span.df-section-count', { text: '· ' + count })
    ]);
  }

  function notice(text, cls) {
    return U.el('div.df-notice' + (cls ? '.' + cls : ''), { text: text });
  }

  function tip() {
    return U.el('div.df-tip', {
      text: "Tip: a folder's icon opens its commands · each container icon opens that container's menu · the folder name unfolds it"
    });
  }

  /* ---------------------------------------------------------------------
   * Folder row (spec 4)
   * ------------------------------------------------------------------- */
  function folderRow(folder) {
    var S = DF.store;
    var sum = S.summary(folder);
    var open = S.isExpanded(folder.id);

    var row = U.el('div.df-row.df-row-folder', {
      role: 'row',
      'data-folder': folder.id,
      'data-color': folder.color
    });

    /* 1 - chevron */
    var chevron = U.el('button.df-chevron', {
      type: 'button',
      'aria-expanded': String(open),
      'aria-label': (open ? 'Collapse' : 'Expand') + ' folder ' + folder.name,
      disabled: !!S.state.filter,
      onClick: function () { S.toggle(folder.id); }
    }, [U.el('span.df-chevron-mark', { 'aria-hidden': 'true' })]);
    row.appendChild(U.el('div.df-cell.df-cell-tree', null, [chevron]));

    /* 2 - icon, name, count, and either the icon strip or the sub-line */
    var icon = U.el('button.df-folder-icon', {
      type: 'button',
      'aria-label': 'Commands for folder ' + folder.name,
      'aria-haspopup': 'menu',
      onClick: function (e) { DF.menus.folder(e.currentTarget, folder, 'left'); }
    }, [folderIconContent(folder)]);

    /* Clicking the name folds the folder too - mouse convenience, not a second
     * tab stop (spec 4.3), so tabindex="-1". It must NOT be aria-hidden:
     * that would take the folder's name out of the accessibility tree and
     * leave a screen reader with an unnamed row. */
    var nameButton = U.el('button.df-folder-name', {
      type: 'button',
      tabindex: '-1',
      onClick: function () { if (!S.state.filter) S.toggle(folder.id); }
    }, folder.name);

    /* The count sits beside the name only when the folder is folded; when it
     * is open the sub-line below already carries it, and showing both reads
     * as a mistake. */
    var line1 = U.el('div.df-folder-line1', null, [
      nameButton,
      open ? null : U.el('span.df-folder-count', { text: U.plural(sum.total, 'container') })
    ]);

    var line2 = (!open && folder.preview !== 'count')
      ? iconStrip(folder, sum.members)
      : U.el('div.df-folder-sub', { text: subLine(folder, sum) });

    row.appendChild(U.el('div.df-cell.df-cell-name', null, [
      icon,
      U.el('div.df-folder-text', null, [line1, line2])
    ]));

    /* 3 - status */
    row.appendChild(U.el('div.df-cell', null, [
      U.el('div.df-folder-status' + (sum.busy ? '.is-busy' : (sum.allRunning ? '.is-all' : '')), {
        text: sum.busy
          ? 'Working… ' + sum.running + ' of ' + sum.total + ' up'
          : sum.running + ' of ' + sum.total + ' running'
      }),
      segmentBar(sum.members)
    ]));

    /* 4 - version */
    row.appendChild(U.el('div.df-cell', null, [
      sum.updates
        ? U.el('span.df-badge.df-badge-warn', { text: U.plural(sum.updates, 'update') })
        : U.el('span.df-muted', { text: 'Up to date' })
    ]));

    /* 5-7 - port, cpu, memory */
    row.appendChild(U.el('div.df-cell.df-mono.df-muted', { text: '—' }));
    row.appendChild(U.el('div.df-cell.df-mono', { text: U.cpu(sum.cpu) }));
    row.appendChild(U.el('div.df-cell.df-mono', { text: U.memory(sum.mem) }));

    /* 8 - tri-state autostart */
    row.appendChild(U.el('div.df-cell', null, [
      switchControl({
        state: sum.autostart,
        label: { on: 'All on', off: 'All off', mixed: 'Mixed' }[sum.autostart],
        ariaLabel: 'Autostart for every container in ' + folder.name,
        onToggle: function () { DF.actions.setFolderAutostart(folder, sum.autostart !== 'on'); }
      })
    ]));

    /* 9 - overflow menu */
    row.appendChild(U.el('div.df-cell.df-cell-menu', null, [
      kebab('Menu for folder ' + folder.name, function (e) {
        DF.menus.folder(e.currentTarget, folder, 'right');
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
    var strip = U.el('div.df-strip', { role: 'group', 'aria-label': 'Containers in ' + folder.name });

    members.forEach(function (ct) {
      var status = DF.store.status(ct);
      var button = U.el('button.df-strip-btn', {
        type: 'button',
        'aria-label': 'Actions for ' + ct.name + ', ' + status.label,
        'aria-haspopup': 'menu',
        title: ct.name + ' · ' + status.label,
        onClick: function (e) { DF.menus.container(e.currentTarget, ct, 'left'); }
      }, [containerTile(ct, 'df-strip-tile')]);

      /* "Icons only" hides the status dot but keeps the tooltip and label. */
      if (folder.preview !== 'icons') {
        button.appendChild(U.el('span.df-strip-dot.df-dot-' + status.kind, { 'aria-hidden': 'true' }));
      }
      strip.appendChild(button);
    });

    return strip;
  }

  /* One segment per member, coloured by status (spec 4.4). */
  function segmentBar(members) {
    var bar = U.el('div.df-segments', { 'aria-hidden': 'true' });
    members.forEach(function (ct) {
      bar.appendChild(U.el('span.df-segment.df-seg-' + DF.store.status(ct).kind));
    });
    return bar;
  }

  /* ---------------------------------------------------------------------
   * Container row (spec 5)
   * ------------------------------------------------------------------- */
  function containerRow(ct, opts) {
    var S = DF.store;
    var status = S.status(ct);
    var inFolder = !!opts.folder;

    var row = U.el('div.df-row.df-row-ct' + (inFolder ? '.is-nested' : ''), {
      role: 'row',
      'data-container': ct.name
    });

    /* 1 - tree line when nested */
    row.appendChild(U.el('div.df-cell.df-cell-tree', null, [
      inFolder ? U.el('span.df-tree', { 'aria-hidden': 'true' }) : null
    ]));

    /* 2 - start-order number, icon, name, image */
    var iconButton = U.el('button.df-ct-icon', {
      type: 'button',
      'aria-label': 'Actions for ' + ct.name + ', ' + status.label,
      'aria-haspopup': 'menu',
      onClick: function (e) { DF.menus.container(e.currentTarget, ct, 'left'); }
    }, [containerTile(ct, 'df-ct-tile')]);

    row.appendChild(U.el('div.df-cell.df-cell-name', null, [
      inFolder ? U.el('span.df-order.df-mono', { text: String(opts.index), 'aria-hidden': 'true' }) : null,
      iconButton,
      U.el('div.df-ct-text', null, [
        U.el('div.df-ct-name', { text: ct.name }),
        U.el('div.df-ct-image', { text: ct.image })
      ])
    ]));

    /* 3 - status: the marker's SHAPE differs per state, so colour is never
     * the only signal (spec 5, spec 14). */
    row.appendChild(U.el('div.df-cell', null, [
      U.el('div.df-ct-status', null, [
        U.el('span.df-dot.df-dot-' + status.kind, { 'aria-hidden': 'true' }),
        U.el('span.df-status-text.df-status-' + status.kind, { text: status.label })
      ])
    ]));

    /* 4 - version */
    row.appendChild(U.el('div.df-cell', null, [
      ct.update === 1 ? U.el('span.df-badge.df-badge-warn', { text: 'Update ready' })
      : ct.update === 2 ? U.el('span.df-badge.df-badge-warn', { text: 'Rebuild ready' })
      : U.el('span.df-muted', { text: 'Up to date' })
    ]));

    /* 5-7 */
    row.appendChild(U.el('div.df-cell.df-mono', { text: ct.port ? ':' + ct.port : '—' }));
    row.appendChild(U.el('div.df-cell.df-mono', { text: U.cpu(S.cpu(ct)) }));
    row.appendChild(U.el('div.df-cell.df-mono', { text: U.memory(S.mem(ct)) }));

    /* 8 */
    row.appendChild(U.el('div.df-cell', null, [
      switchControl({
        state: ct.autostart ? 'on' : 'off',
        label: ct.autostart ? 'On' : 'Off',
        ariaLabel: 'Autostart ' + ct.name,
        onToggle: function () { DF.actions.setContainerAutostart(ct, !ct.autostart); }
      })
    ]));

    /* 9 */
    row.appendChild(U.el('div.df-cell.df-cell-menu', null, [
      kebab('Menu for ' + ct.name, function (e) { DF.menus.container(e.currentTarget, ct, 'right'); })
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
        class: cls + ' df-tile-img',
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
    return U.el('span.' + cls.replace(/^\./, '') + '.df-tile-letter', {
      'data-tint': ct.tint || 'slate',
      'aria-hidden': 'true',
      text: (ct.letter || ct.name.charAt(0)).toUpperCase()
    });
  }

  function folderIconContent(folder) {
    var icon = folder.icon || {};

    if (icon.type === 'web' && icon.localFile) {
      return U.el('img.df-folder-img', {
        src: DF.config.base + '/include/Icons.php?file=' + encodeURIComponent(icon.localFile),
        alt: '', loading: 'lazy'
      });
    }

    if (icon.type === 'container') {
      var ct = DF.store.container(icon.name);
      if (ct) return containerTile(ct, 'df-folder-img');
    }

    return U.glyph(icon.key || 'folder', 'df-folder-glyph');
  }

  /* Two-state and tri-state switch. aria-pressed carries "mixed" for the
   * folder switch, which is exactly what that value is for. */
  function switchControl(opts) {
    var track = U.el('button.df-switch', {
      type: 'button',
      'data-state': opts.state,
      'aria-pressed': opts.state === 'mixed' ? 'mixed' : String(opts.state === 'on'),
      'aria-label': opts.ariaLabel,
      onClick: opts.onToggle
    }, [U.el('span.df-switch-knob', { 'aria-hidden': 'true' })]);

    return U.el('div.df-switch-wrap', null, [
      track,
      U.el('span.df-switch-label', { text: opts.label })
    ]);
  }

  function kebab(label, onClick) {
    return U.el('button.df-kebab', {
      type: 'button',
      'aria-label': label,
      'aria-haspopup': 'menu',
      onClick: onClick
    }, [U.el('span', { 'aria-hidden': 'true', text: '⋮' })]);
  }
})(window);
