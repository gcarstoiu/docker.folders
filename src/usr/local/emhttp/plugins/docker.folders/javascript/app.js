/* docker.folders - bootstrap.
 * Copyright (C) 2026  george
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 * Wires the modules together, owns the refresh cycle, and manages the one
 * piece of the host page this plugin touches: hiding Unraid's own table.
 */
(function (root) {
  'use strict';

  var DF = root.DockerFolders = root.DockerFolders || {};
  var U = DF.util;

  var mount = null;
  var refreshTimer = null;
  var spriteLoaded = false;

  /* Unraid's table and its button row. Hidden, never removed, so Classic
   * view is a single style change away and uninstalling leaves no trace. */
  var NATIVE = '#docker_containers, .js-actions, .ToggleViewMode';

  function setNativeHidden(hidden) {
    document.querySelectorAll(NATIVE).forEach(function (node) {
      /* Remember what the page had, so Classic view restores it rather than
       * guessing at "" and overriding a theme that set something else. */
      if (node.dataset.dfDisplay === undefined) node.dataset.dfDisplay = node.style.display || '';
      node.style.display = hidden ? 'none' : node.dataset.dfDisplay;
    });
  }

  /* The glyph sprite is fetched once and inlined, so <use href="#df-g-..">
   * resolves without a same-document reference per icon. */
  function loadSprite() {
    if (spriteLoaded) return Promise.resolve();
    spriteLoaded = true;
    return fetch(DF.config.base + '/images/glyphs.svg', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (svg) {
        if (!svg) return;
        var holder = document.createElement('div');
        holder.style.display = 'none';
        holder.setAttribute('aria-hidden', 'true');
        holder.innerHTML = svg;
        document.body.appendChild(holder);
      })
      .catch(function () { /* icons fall back to empty tiles; the page works */ });
  }

  function refresh() {
    return DF.api.data()
      .then(function (payload) { DF.store.load(payload); })
      .catch(function (err) { DF.store.fail(err.message || 'Could not read the container list'); });
  }

  /* Poll while the tab is visible. Unraid's own page does the same; a hidden
   * tab must not keep the server busy. */
  function scheduleRefresh(ms) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      if (document.hidden) { scheduleRefresh(ms); return; }
      /* A running job drives its own updates; stay out of its way. */
      if (DF.jobs && DF.jobs.running()) { scheduleRefresh(ms); return; }
      refresh().then(function () { scheduleRefresh(ms); });
    }, ms);
  }

  function render() {
    setNativeHidden(!DF.store.state.classic);
    DF.render.draw(mount);
  }

  function start() {
    mount = document.getElementById('df-root');
    if (!mount) return;

    DF.store.on(render);

    /* Escape closes the topmost menu or dialog, innermost first (spec 14). */
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (DF.dialog.handleEscape()) { e.stopPropagation(); return; }
      if (DF.menus && DF.menus.close()) e.stopPropagation();
    }, true);

    loadSprite().then(refresh).then(function () { scheduleRefresh(5000); });

    /* Live CPU and memory. The channel republishes about once a second;
     * if nchan is unavailable those two columns simply stay empty. */
    DF.api.subscribe('dockerload', function (text) { DF.store.applyLive(text); });

    /* Unraid reloads its own table on its own schedule. When it does, our
     * view may be stale - pick up the change without waiting for the poll. */
    if (root.jQuery) {
      root.jQuery(document).on('docker.folders:loadlist', function () {
        if (!DF.jobs || !DF.jobs.running()) refresh();
      });
    }
  }

  DF.refresh = refresh;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  void U;
})(window);
