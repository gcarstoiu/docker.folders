/* simple.folders - every call that leaves the browser.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 * CSRF
 * ----
 * Unraid installs webGui/include/local_prepend.php as php.ini's
 * auto_prepend_file. EVERY POST without a valid token is rejected with 403
 * before any endpoint runs - core's and ours alike. jQuery's $.post is patched
 * globally by the webGUI to append csrf_token, but fetch() is not, so every
 * POST here sends the X-CSRF-Token header explicitly (local_prepend.php
 * accepts either form).
 */
(function (root) {
  'use strict';

  var SF = root.SimpleFolders = root.SimpleFolders || {};
  var API = SF.api = {};

  var PLUGIN = '/plugins/simple.folders/include';
  var CORE   = '/plugins/dynamix.docker.manager/include';

  function token() {
    /* Defined by the webGUI on every page; the harness defines it too. */
    return typeof root.csrf_token === 'string' ? root.csrf_token : '';
  }

  function post(url, params) {
    var body = new URLSearchParams();
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      if (value === null || value === undefined) return;
      body.append(key, typeof value === 'boolean' ? String(value) : value);
    });

    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-CSRF-Token': token()
      },
      body: body.toString()
    }).then(readJson);
  }

  function get(url) {
    return fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(readJson);
  }

  function readJson(response) {
    return response.text().then(function (text) {
      var data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }

      if (!response.ok) {
        /* 403 here almost always means the CSRF token went stale, which
         * happens after the server restarts. Say so plainly - "forbidden"
         * sends people hunting for a permissions problem that is not there. */
        if (response.status === 403) {
          throw new Error('Session expired — reload the page and try again');
        }
        /* Our endpoints report the failing file and line in `where`; include
         * it so a server-side fault is diagnosable from the page itself. */
        var message = (data && (data.error || data.success))
          || ('Request failed (' + response.status + ')');
        if (data && data.where) message += ' [' + data.where + ']';
        throw new Error(message);
      }
      if (data && data.ok === false) throw new Error(data.error || 'Request failed');
      return data;
    });
  }

  /* ---------------------------------------------------------------------
   * Our own endpoints
   * ------------------------------------------------------------------- */

  API.data = function () { return get(PLUGIN + '/Data.php'); };

  API.saveFolder   = function (folder) { return post(PLUGIN + '/Folders.php', { action: 'save',   folder: JSON.stringify(folder) }); };
  API.deleteFolder = function (id)     { return post(PLUGIN + '/Folders.php', { action: 'delete', id: id }); };
  API.moveFolder   = function (id, d)  { return post(PLUGIN + '/Folders.php', { action: 'move',   id: id, direction: d }); };
  API.assign       = function (ct, id) { return post(PLUGIN + '/Folders.php', { action: 'assign', container: ct, folder: id || '' }); };

  /* Dragging needs to express an arbitrary order, which move-up/move-down
   * cannot, so these post the whole list or an explicit position. */
  API.reorderMembers = function (id, names) {
    return post(PLUGIN + '/Folders.php', { action: 'reorder', id: id, members: names.join(',') });
  };
  API.sortFolders = function (ids) {
    return post(PLUGIN + '/Folders.php', { action: 'sort', ids: ids.join(',') });
  };
  API.insert = function (ct, id, index) {
    return post(PLUGIN + '/Folders.php', { action: 'insert', container: ct, folder: id, index: index });
  };

  /* The container display order, written into Unraid's own userprefs.cfg so
   * the stock table agrees. Start order is separate and lives with the
   * folders - see include/Order.php for why these are not one call. */
  API.setDisplayOrder = function (names) {
    return post(PLUGIN + '/Order.php', { action: 'set', names: names.join(',') });
  };

  API.applyAutostart = function (id)   { return post(PLUGIN + '/Autostart.php', { action: 'apply', id: id }); };

  API.searchIcons    = function (q)    { return post(PLUGIN + '/Icons.php', { action: 'search',   query: q }); };
  API.downloadIcon   = function (p)    { return post(PLUGIN + '/Icons.php', Object.assign({ action: 'download' }, p)); };

  API.startUpdate = function (names)   { return post(PLUGIN + '/Update.php', { action: 'start',  containers: names.join(',') }); };
  API.updateState = function (job)     { return get(PLUGIN + '/Update.php?job=' + encodeURIComponent(job)); };

  /* ---------------------------------------------------------------------
   * Unraid's endpoints
   *
   * Verified byte-identical across 7.2.1 - 7.4.0-rc.2.1. Events.php reports
   * failure as {success:"<message>"}, NOT {error:...}, so anything other than
   * exactly true is an error.
   * ------------------------------------------------------------------- */

  var ACTIONS = { start: 'start', stop: 'stop', restart: 'restart', pause: 'pause', resume: 'resume' };

  API.container = function (action, id) {
    if (!ACTIONS[action]) return Promise.reject(new Error('Unknown action: ' + action));
    return post(CORE + '/Events.php', { action: ACTIONS[action], container: id })
      .then(function (data) {
        if (!data || data.success !== true) {
          throw new Error((data && (data.success || data.error)) || 'Docker refused the request');
        }
        return true;
      });
  };

  /* Refresh every container's update-available flag. Returns nothing; the
   * caller reloads afterwards. Can take a while - it downloads templates and
   * queries each registry. */
  API.checkUpdates = function () { return post(CORE + '/DockerUpdate.php', {}); };

  /* Autostart flag and per-container start delay, stored by Unraid in
   * /var/lib/docker/unraid-autostart. */
  API.setAutostart = function (name, on, wait) {
    return post(CORE + '/UpdateConfig.php', {
      action: 'autostart', container: name, auto: on ? 'true' : 'false', wait: wait || 0
    });
  };

  /* ---------------------------------------------------------------------
   * nchan
   *
   * NchanSubscriber is bundled in the webGUI's dynamix.js and is already
   * global. The harness cannot serve websockets, so the transport is
   * configurable; everywhere else it is a websocket, as core uses.
   * ------------------------------------------------------------------- */
  API.subscribe = function (channel, onMessage) {
    if (typeof root.NchanSubscriber !== 'function') return null;

    var transport = (SF.config && SF.config.nchan) || 'websocket';
    var sub;
    try {
      sub = new root.NchanSubscriber('/sub/' + channel, {
        subscriber: transport,
        reconnectTimeout: 5000
      });
    } catch (e) {
      return null;
    }

    sub.on('message', function (data) { try { onMessage(data); } catch (e) { /* keep the stream alive */ } });
    /* A dropped stream degrades the page (stale CPU figures); it must never
     * take the page down with it. */
    sub.on('error', function () { /* NchanSubscriber reconnects on its own */ });

    try { sub.start(); } catch (e) { return null; }
    return sub;
  };
})(window);
