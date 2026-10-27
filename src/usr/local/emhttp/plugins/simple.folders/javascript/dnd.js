/* simple.folders - dragging rows around the table.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 * What can be dragged, and what it means:
 *
 *   a container  onto a folder row        join that folder, last in its order
 *                between two member rows  join at that position
 *                into "Not in a folder"   leave its folder
 *   a folder     between two folder rows  reorder the folders
 *
 * Pointer Events, not the HTML5 drag-and-drop API: that API does not fire on
 * touch at all, and this plugin gets used from a phone. One code path covers
 * mouse, touch and pen.
 *
 * Dragging is an ADDITION, never the only route. Everything here is also
 * reachable from the container menu ("Move to folder"), the folder menu
 * ("Move folder up / down") and the editor's start-order list - which is
 * what keyboard and screen-reader users have, since a drag has no keyboard
 * equivalent worth pretending about.
 */
(function (root) {
  'use strict';

  var SF = root.SimpleFolders = root.SimpleFolders || {};
  var U = SF.util;
  var D = SF.dnd = {};

  /* Movement before a press becomes a drag. Below this a press is a tap, so
   * the grip can still be focused and clicked without the row jumping. */
  var THRESHOLD = 5;
  var EDGE = 64;           // autoscroll band at the top and bottom
  var EDGE_SPEED = 14;

  var drag = null;         // the drag in flight, or null

  D.active = function () { return drag !== null; };

  /* ---------------------------------------------------------------------
   * Starting
   * ------------------------------------------------------------------- */

  /* render.js calls this on each grip it creates. */
  D.attach = function (grip, kind, key) {
    grip.addEventListener('pointerdown', function (e) {
      /* Left button or a touch; never a right-click or a running job. */
      if (e.button !== 0 || SF.jobs.running()) return;
      begin(e, grip, kind, key);
    });
  };

  function begin(e, grip, kind, key) {
    var row = grip.closest('.sf-row');
    if (!row) return;

    var startX = e.clientX, startY = e.clientY;
    var started = false;

    /* Capture on the grip so the gesture keeps reporting even when the
     * pointer leaves the row - including over the ghost element. */
    try { grip.setPointerCapture(e.pointerId); } catch (err) { /* older engines */ }

    function onMove(ev) {
      if (!started) {
        if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < THRESHOLD) return;
        started = true;
        start(row, kind, key, ev);
      }
      move(ev);
      /* Stop the page scrolling under a touch drag. */
      ev.preventDefault();
    }

    function onUp(ev) {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onCancel);
      try { grip.releasePointerCapture(ev.pointerId); } catch (err) {}
      if (started) finish();
    }

    function onCancel() {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onCancel);
      if (started) cancel();
    }

    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onCancel);
  }

  function start(row, kind, key, ev) {
    var rect = row.getBoundingClientRect();

    drag = {
      kind: kind,                  // 'container' | 'folder'
      key: key,                    // container name, or folder id
      row: row,
      zones: [],
      target: null,
      ghost: null,
      indicator: null,
      scroller: null
    };

    /* A label that follows the pointer. Deliberately small: a full-width
     * clone of the row would cover the very rows being aimed at. */
    drag.ghost = U.el('div.sf-drag-ghost', { 'aria-hidden': 'true' }, [
      U.el('span.sf-drag-ghost-label', { text: label(kind, key) })
    ]);
    U.layer().appendChild(drag.ghost);

    drag.indicator = U.el('div.sf-drop-line', { 'aria-hidden': 'true' });
    U.layer().appendChild(drag.indicator);

    row.classList.add('is-dragging');
    document.body.classList.add('sf-dragging');

    drag.zones = buildZones(kind, key);
    void rect;
    move(ev);
  }

  function label(kind, key) {
    if (kind === 'folder') {
      var f = SF.store.folder(key);
      return f ? f.name : key;
    }
    return key;
  }

  /* ---------------------------------------------------------------------
   * Where a drop would land
   *
   * Computed once, from the DOM, when the drag starts: the rows do not move
   * during a drag (app.js holds off refreshing while one is in flight), so
   * the geometry stays valid and every pointermove is a cheap scan.
   * ------------------------------------------------------------------- */
  function buildZones(kind, key) {
    var zones = [];
    var mount = document.getElementById('sf-root');
    if (!mount) return zones;

    var rows = Array.prototype.slice.call(mount.querySelectorAll('.sf-row-folder, .sf-row-ct, .sf-section'));

    if (kind === 'folder') {
      /* Only the gaps between folders matter. A folder's own member rows
       * move with it, so they are not separate positions. */
      var folders = SF.store.state.folders;
      var order = folders.map(function (f) { return f.id; });
      var seen = 0;

      rows.forEach(function (node) {
        if (!node.classList.contains('sf-row-folder')) return;
        var r = node.getBoundingClientRect();
        zones.push({ y: r.top,    at: seen,     edge: r.top,    node: node, kind: 'folder-at' });
        zones.push({ y: r.bottom, at: seen + 1, edge: r.bottom, node: node, kind: 'folder-at' });
        seen++;
      });
      void order;
      return zones;
    }

    /* Dragging a container. */
    var currentFolder = null;
    var indexInFolder = 0;

    rows.forEach(function (node) {
      var r = node.getBoundingClientRect();

      if (node.classList.contains('sf-row-folder')) {
        currentFolder = node.dataset.folder;
        indexInFolder = 0;
        /* The body of a folder row means "join this folder", appended. */
        zones.push({
          y: r.top + r.height / 2, edge: null, node: node,
          kind: 'into-folder', folder: currentFolder
        });
        return;
      }

      if (node.classList.contains('sf-section')) {
        currentFolder = null;              // the "Not in a folder" heading
        zones.push({
          y: r.top + r.height / 2, edge: r.bottom, node: node, kind: 'loose'
        });
        return;
      }

      if (node.classList.contains('sf-row-ct')) {
        if (currentFolder) {
          /* Between members: insert at this position. */
          zones.push({
            y: r.top, edge: r.top, node: node,
            kind: 'at-index', folder: currentFolder, index: indexInFolder
          });
          zones.push({
            y: r.bottom, edge: r.bottom, node: node,
            kind: 'at-index', folder: currentFolder, index: indexInFolder + 1
          });
          indexInFolder++;
        } else {
          zones.push({ y: r.top + r.height / 2, edge: r.bottom, node: node, kind: 'loose' });
        }
      }
    });

    void key;
    return zones;
  }

  /* ---------------------------------------------------------------------
   * Tracking
   * ------------------------------------------------------------------- */
  function move(ev) {
    if (!drag) return;

    drag.ghost.style.transform = 'translate(' + (ev.clientX + 14) + 'px,' + (ev.clientY + 14) + 'px)';

    autoscroll(ev.clientY);

    /* Nearest zone by vertical distance. */
    var best = null, bestDist = Infinity;
    for (var i = 0; i < drag.zones.length; i++) {
      var d = Math.abs(drag.zones[i].y - ev.clientY);
      if (d < bestDist) { bestDist = d; best = drag.zones[i]; }
    }

    setTarget(best);
  }

  function setTarget(zone) {
    if (drag.target && drag.target.node) drag.target.node.classList.remove('is-drop-target');
    drag.target = zone;

    if (!zone) { drag.indicator.style.display = 'none'; return; }

    if (zone.kind === 'into-folder') {
      /* Highlight the whole folder row: the drop appends, it does not
       * insert at a particular place. */
      zone.node.classList.add('is-drop-target');
      drag.indicator.style.display = 'none';
      return;
    }

    var mount = document.getElementById('sf-root');
    var card = mount.querySelector('.sf-card');
    var box = (card || mount).getBoundingClientRect();

    drag.indicator.style.display = 'block';
    drag.indicator.style.transform =
      'translate(' + (box.left + root.scrollX) + 'px,' + (zone.edge + root.scrollY) + 'px)';
    drag.indicator.style.width = box.width + 'px';
  }

  function autoscroll(y) {
    var dy = 0;
    if (y < EDGE) dy = -EDGE_SPEED * (1 - y / EDGE);
    else if (y > root.innerHeight - EDGE) dy = EDGE_SPEED * (1 - (root.innerHeight - y) / EDGE);

    if (!dy) { stopScroll(); return; }
    if (drag.scroller) return;

    drag.scroller = root.setInterval(function () {
      root.scrollBy(0, dy);
      /* The zones were measured in viewport coordinates, so scrolling
       * invalidates them. Re-measure rather than drift. */
      drag.zones = buildZones(drag.kind, drag.key);
    }, 16);
  }

  function stopScroll() {
    if (!drag || !drag.scroller) return;
    root.clearInterval(drag.scroller);
    drag.scroller = null;
  }

  /* ---------------------------------------------------------------------
   * Committing
   * ------------------------------------------------------------------- */
  function finish() {
    var zone = drag ? drag.target : null;
    var kind = drag ? drag.kind : null;
    var key = drag ? drag.key : null;
    teardown();

    if (!zone) return;

    if (kind === 'folder') { commitFolderOrder(key, zone.at); return; }

    if (zone.kind === 'into-folder')  { commitIntoFolder(key, zone.folder, null); return; }
    if (zone.kind === 'at-index')     { commitIntoFolder(key, zone.folder, zone.index); return; }
    if (zone.kind === 'loose')        { commitLoose(key); return; }
  }

  function cancel() { teardown(); }

  function teardown() {
    if (!drag) return;
    stopScroll();
    if (drag.target && drag.target.node) drag.target.node.classList.remove('is-drop-target');
    if (drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    if (drag.indicator && drag.indicator.parentNode) drag.indicator.parentNode.removeChild(drag.indicator);
    drag.row.classList.remove('is-dragging');
    document.body.classList.remove('sf-dragging');
    drag = null;
  }

  function commitFolderOrder(id, at) {
    var ids = SF.store.state.folders.map(function (f) { return f.id; });
    var from = ids.indexOf(id);
    if (from === -1) return;

    ids.splice(from, 1);
    /* Removing the dragged folder shifts everything after it up by one. */
    ids.splice(at > from ? at - 1 : at, 0, id);

    SF.api.sortFolders(ids)
      .then(SF.refresh)
      .catch(function (err) { SF.jobs.toast(err.message, 'error'); });
  }

  function commitIntoFolder(name, folderId, index) {
    var folder = SF.store.folder(folderId);
    if (!folder) return;

    var owner = SF.store.folderOf(name);
    var sameFolder = owner && owner.id === folderId;

    /* Reordering inside the folder it is already in. */
    if (sameFolder && index !== null) {
      var members = folder.members.slice();
      var from = members.indexOf(name);
      if (from === -1) return;                      // here via a rule or label
      members.splice(from, 1);
      members.splice(index > from ? index - 1 : index, 0, name);

      SF.api.reorderMembers(folderId, members)
        .then(SF.refresh)
        .catch(function (err) { SF.jobs.toast(err.message, 'error'); });
      return;
    }
    if (sameFolder) return;                          // dropped on its own folder

    var done = index === null
      ? SF.api.assign(name, folderId)
      : SF.api.insert(name, folderId, index);

    done.then(function () {
      SF.jobs.toast(name + ' moved to “' + folder.name + '”');
      return SF.refresh();
    }).catch(function (err) { SF.jobs.toast(err.message, 'error'); });
  }

  function commitLoose(name) {
    var owner = SF.store.folderOf(name);
    if (!owner) return;                              // already loose

    SF.api.assign(name, null)
      .then(function () {
        SF.jobs.toast(name + ' removed from “' + owner.name + '”');
        return SF.refresh();
      })
      .catch(function (err) { SF.jobs.toast(err.message, 'error'); });
  }

  void U;
})(window);
