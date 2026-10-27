/* docker.folders - popover menus.
 * Copyright (C) 2026  george
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 * One popover implementation serves both menus (DESIGN_SPEC.md 6): 260px
 * wide, max-height 76vh with scroll, opens below the trigger or above when
 * there is no room, closes on outside click, on Escape with focus returning
 * to the trigger, and after choosing an item.
 *
 * While any job is running every Docker action is disabled (spec 6).
 */
(function (root) {
  'use strict';

  var DF = root.DockerFolders = root.DockerFolders || {};
  var U = DF.util;
  var M = DF.menus = {};

  var open = null;   // { node, trigger }

  /* ---------------------------------------------------------------------
   * The popover
   * ------------------------------------------------------------------- */
  function show(trigger, align, title, items) {
    M.close();

    var list = U.el('div.df-menu', { role: 'menu', 'aria-label': title });
    list.appendChild(U.el('div.df-menu-head', { text: title }));

    items.forEach(function (item) {
      if (!item) return;
      if (item.divider) { list.appendChild(U.el('div.df-menu-divider', { role: 'separator' })); return; }

      /* A group label such as "Move to folder" - not focusable, not an item. */
      if (item.heading) {
        list.appendChild(U.el('div.df-menu-sub', { role: 'presentation', text: item.text }));
        return;
      }

      var cls = '.df-menu-item' + (item.tone ? '.df-menu-' + item.tone : '');
      var button = U.el('button' + cls, {
        type: 'button',
        role: 'menuitem',
        disabled: item.disabled || false,
        onClick: function () { M.close(); item.action(); }
      }, [
        U.el('span.df-menu-label', { text: item.text }),
        item.hint ? U.el('span.df-menu-hint', { text: item.hint }) : null
      ]);
      list.appendChild(button);
    });

    U.layer().appendChild(list);
    position(list, trigger, align);

    open = { node: list, trigger: trigger };

    /* Deferred so the click that opened the menu does not immediately close
     * it on the way back up. */
    setTimeout(function () { document.addEventListener('mousedown', onOutside, true); }, 0);

    var first = list.querySelector('.df-menu-item:not([disabled])');
    if (first) first.focus();

    list.addEventListener('keydown', onMenuKey);
    return list;
  }

  function position(node, trigger, align) {
    var rect = trigger.getBoundingClientRect();
    var height = node.offsetHeight;
    var width = node.offsetWidth;
    var gap = 6;

    var below = rect.bottom + gap;
    var fitsBelow = below + height <= root.innerHeight - 8;
    var top = fitsBelow ? below : Math.max(8, rect.top - gap - height);

    var left = align === 'right' ? rect.right - width : rect.left;
    left = Math.min(Math.max(8, left), root.innerWidth - width - 8);

    node.style.top = (top + root.scrollY) + 'px';
    node.style.left = (left + root.scrollX) + 'px';
  }

  function onOutside(e) {
    if (open && !open.node.contains(e.target)) M.close();
  }

  /* Arrow keys move between items; Tab leaves and closes, which is what a
   * menu should do rather than trapping focus. */
  function onMenuKey(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();

    var items = Array.prototype.slice.call(this.querySelectorAll('.df-menu-item:not([disabled])'));
    if (!items.length) return;

    var i = items.indexOf(document.activeElement);
    var next = e.key === 'ArrowDown'
      ? (i + 1) % items.length
      : (i <= 0 ? items.length - 1 : i - 1);
    items[next].focus();
  }

  M.close = function () {
    if (!open) return false;
    document.removeEventListener('mousedown', onOutside, true);

    var trigger = open.trigger;
    if (open.node.parentNode) open.node.parentNode.removeChild(open.node);
    open = null;

    /* Focus goes back where it came from (spec 6). */
    if (trigger && document.contains(trigger)) trigger.focus();
    return true;
  };

  M.isOpen = function () { return !!open; };

  /* ---------------------------------------------------------------------
   * Folder menu (spec 6.1)
   * ------------------------------------------------------------------- */
  M.folder = function (trigger, folder, align) {
    var S = DF.store;
    var sum = S.summary(folder);
    var busy = DF.jobs.running();
    var folders = S.state.folders;
    var index = folders.indexOf(S.folder(folder.id));

    var stoppedCount = sum.stopped;
    var upCount      = sum.running + sum.paused;
    var empty        = sum.total === 0;

    var items = [
      { text: 'Start all',
        hint: stoppedCount ? stoppedCount + ' stopped' : 'all up',
        disabled: busy || !stoppedCount,
        action: function () { DF.actions.bulk(folder, 'start'); } },

      { text: 'Stop all',
        hint: folder.reverseStop ? 'reverse order' : null,
        disabled: busy || !upCount,
        action: function () { DF.actions.bulk(folder, 'stop'); } },

      { text: 'Restart all',
        hint: sum.running ? sum.running + ' running' : null,
        disabled: busy || !sum.running,
        action: function () { DF.actions.bulk(folder, 'restart'); } },

      /* Pause and Resume share a slot: whichever applies to the folder's
       * current state (spec 6.1). */
      sum.paused
        ? { text: 'Resume all', hint: sum.paused + ' paused', disabled: busy,
            action: function () { DF.actions.bulk(folder, 'resume'); } }
        : { text: 'Pause all', hint: null, disabled: busy || !sum.running,
            action: function () { DF.actions.bulk(folder, 'pause'); } },

      { divider: true },

      { text: 'Check for updates',
        disabled: busy || empty,
        action: function () { DF.actions.checkUpdates(folder); } },

      sum.updates
        ? { text: 'Update ' + U.plural(sum.updates, 'container'), hint: 'ready', disabled: busy,
            action: function () { DF.actions.update(folder, false); } }
        : null,

      { text: 'Force update all',
        hint: String(sum.total),
        tone: 'warn',
        disabled: busy || empty,
        action: function () { DF.actions.confirmForceUpdate(folder); } },

      { divider: true },

      { text: 'Open WebUIs',
        hint: sum.running ? String(sum.running) : null,
        disabled: !sum.running,
        action: function () { DF.actions.openWebUIs(folder); } },

      { text: 'Edit folder…',
        action: function () { DF.editor.open(folder); } },

      { text: 'Move folder up',   disabled: index <= 0,
        action: function () { DF.actions.moveFolder(folder, 'up'); } },
      { text: 'Move folder down', disabled: index < 0 || index >= folders.length - 1,
        action: function () { DF.actions.moveFolder(folder, 'down'); } },

      { divider: true },

      { text: 'Delete folder', tone: 'danger', disabled: busy,
        action: function () { DF.actions.confirmDelete(folder); } }
    ];

    return show(trigger, align, folder.name, items);
  };

  /* ---------------------------------------------------------------------
   * Container menu (spec 6.2)
   *
   * Reachable from the row's kebab AND from a folded folder's icon strip.
   * ------------------------------------------------------------------- */
  M.container = function (trigger, ct, align) {
    var S = DF.store;
    var busy = DF.jobs.running();
    var folder = S.folderOf(ct.name);
    var running = ct.state === 'running';
    var paused  = ct.state === 'paused';

    var items = [];

    if (paused) {
      items.push({ text: 'Resume', disabled: busy, action: function () { DF.actions.one(ct, 'resume'); } });
    } else if (running) {
      items.push({ text: 'Stop',    disabled: busy, action: function () { DF.actions.one(ct, 'stop'); } });
      items.push({ text: 'Pause',   disabled: busy, action: function () { DF.actions.one(ct, 'pause'); } });
      items.push({ text: 'Restart', disabled: busy, action: function () { DF.actions.one(ct, 'restart'); } });
    } else {
      items.push({ text: 'Start',   disabled: busy, action: function () { DF.actions.one(ct, 'start'); } });
    }

    items.push({
      text: ct.update === 1 ? 'Update' : 'Force update',
      hint: ct.update === 1 ? 'ready' : null,
      tone: ct.update === 1 ? null : 'warn',
      disabled: busy,
      action: function () { DF.actions.updateContainers([ct], ct.name); }
    });

    /* The native actions our table displaces. Delegating to core's own
     * functions keeps one implementation of each. */
    items.push({ divider: true });
    if (ct.webui && running) {
      items.push({ text: 'WebUI', action: function () { root.open(ct.webui, '_blank', 'noopener'); } });
    }
    if (running && typeof root.openTerminal === 'function') {
      items.push({ text: 'Console', action: function () { root.openTerminal('docker', ct.name, ct.shell || 'sh'); } });
    }
    if (typeof root.openTerminal === 'function') {
      items.push({ text: 'Logs', action: function () { root.openTerminal('docker', ct.name, '.log'); } });
    }
    if (ct.template && typeof root.editContainer === 'function') {
      items.push({ text: 'Edit', action: function () { root.editContainer(ct.name, ct.template); } });
    }
    if (typeof root.rmContainer === 'function') {
      items.push({ text: 'Remove', tone: 'danger', disabled: busy,
        action: function () { root.rmContainer(ct.name, ct.image, ct.id); } });
    }

    /* Move / add to folder */
    items.push({ divider: true });
    items.push({ heading: true, text: folder ? 'Move to folder' : 'Add to folder' });

    S.state.folders.forEach(function (f) {
      if (folder && f.id === folder.id) return;
      items.push({
        text: f.name,
        hint: String((f.resolved || []).length),
        disabled: busy,
        action: function () { DF.actions.assign(ct, f); }
      });
    });

    items.push({ text: 'New folder…', disabled: busy,
      action: function () { DF.editor.open(null, { preselect: ct.name }); } });

    if (folder) {
      items.push({ text: 'Remove from ' + folder.name, disabled: busy,
        action: function () { DF.actions.assign(ct, null); } });
    }

    return show(trigger, align, ct.name, items);
  };
})(window);
