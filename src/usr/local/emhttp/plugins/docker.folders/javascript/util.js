/* docker.folders - small helpers shared by every module.
 * Copyright (C) 2026  george
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 * No build step and no framework: this is a plugin dropped into someone
 * else's page, so it stays dependency-free apart from the jQuery the webGUI
 * already loads (which only api.js touches, for its CSRF plumbing).
 */
(function (root) {
  'use strict';

  var DF = root.DockerFolders = root.DockerFolders || {};
  var U = DF.util = {};

  /* ---------------------------------------------------------------------
   * DOM
   *
   * el('div.row', {attrs}, [children]) - the tag string carries classes so
   * call sites stay readable. Text children are inserted as text nodes, so
   * every user-supplied string is escaped by construction rather than by
   * remembering to call an escape helper. DESIGN_SPEC.md's rule "escape every
   * user-provided string" is satisfied structurally.
   * ------------------------------------------------------------------- */
  U.el = function (spec, attrs, children) {
    var parts = String(spec).split('.');
    var node = document.createElement(parts[0] || 'div');
    for (var i = 1; i < parts.length; i++) node.classList.add(parts[i]);

    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'text') { node.textContent = value; return; }
        if (key === 'html') { node.innerHTML = value; return; }      // trusted markup only
        if (key === 'style' && typeof value === 'object') {
          Object.keys(value).forEach(function (p) { node.style.setProperty(p, value[p]); });
          return;
        }
        if (key.slice(0, 2) === 'on' && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
          return;
        }
        if (value === true) { node.setAttribute(key, ''); return; }
        node.setAttribute(key, value);
      });
    }

    U.append(node, children);
    return node;
  };

  U.append = function (node, children) {
    if (children === null || children === undefined) return node;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  };

  U.clear = function (node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  };

  /* An <svg><use> referencing the sprite in images/glyphs.svg. */
  U.glyph = function (key, className) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    if (className) svg.setAttribute('class', className);
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#df-g-' + key);
    svg.appendChild(use);
    return svg;
  };

  /* Menus, toasts and dialogs cannot live inside #df-root: render.js empties
   * that element on every draw, and the table card clips its own overflow.
   * They go in a sibling that carries the same classes, so the design tokens
   * (which are scoped to .df-root) still resolve, and that is never cleared. */
  var layer = null;
  U.layer = function () {
    if (layer && document.body.contains(layer)) return layer;
    var mount = document.getElementById('df-root');
    layer = U.el('div.df-root.df-layer', {
      'data-theme': (mount && mount.dataset.theme) || 'black'
    });
    document.body.appendChild(layer);
    return layer;
  };

  /* ---------------------------------------------------------------------
   * Formatting
   * ------------------------------------------------------------------- */

  /* "Memory shows MB under 1000, else GB with one decimal" - spec 4.4. */
  U.memory = function (bytes) {
    if (!bytes) return '—';
    var mb = bytes / 1048576;
    if (mb < 1000) return Math.round(mb) + ' MB';
    return (mb / 1024).toFixed(1) + ' GB';
  };

  U.cpu = function (percent) {
    if (percent === null || percent === undefined || percent === 0) return '—';
    return percent.toFixed(1) + '%';
  };

  U.plural = function (n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  };

  /* ---------------------------------------------------------------------
   * Misc
   * ------------------------------------------------------------------- */

  U.debounce = function (fn, ms) {
    var timer = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, ms || 120);
    };
  };

  U.sleep = function (ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  };

  /* Per-viewer UI preferences (fold state, classic view). Spec 11 keeps these
   * out of the shared folder definition so two browsers do not fight.
   * Every access is guarded: localStorage throws in private windows and can
   * be disabled outright. */
  var PREFIX = 'docker.folders:';
  U.pref = {
    get: function (key, fallback) {
      try {
        var raw = root.localStorage.getItem(PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { root.localStorage.setItem(PREFIX + key, JSON.stringify(value)); }
      catch (e) { /* nothing persists this session; the UI still works */ }
    }
  };

  /* Case-insensitive substring match, used by the header filter (spec 10). */
  U.matches = function (haystack, needle) {
    if (!needle) return true;
    return String(haystack).toLowerCase().indexOf(String(needle).toLowerCase()) !== -1;
  };
})(window);
