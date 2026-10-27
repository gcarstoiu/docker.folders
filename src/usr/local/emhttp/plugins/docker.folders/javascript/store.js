/* docker.folders - client-side state and the values derived from it.
 * Copyright (C) 2026  george
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 * One object holds everything the table draws from. Anything that changes it
 * calls emit(), and app.js re-renders. Derived values (folder status summary,
 * CPU/memory sums, update counts) are computed here so render.js only
 * arranges DOM and the rules live in one place.
 */
(function (root) {
  'use strict';

  var DF = root.DockerFolders = root.DockerFolders || {};
  var U = DF.util;

  var listeners = [];

  var state = {
    folders: [],
    containers: [],
    loose: [],
    stats: { containers: 0, running: 0, folders: 0, updates: 0 },

    byName: {},          // name -> container
    live: {},            // name -> {cpu, mem}   from the dockerload channel
    busy: {},            // name -> label        while a job is acting on it

    filter: '',
    classic: U.pref.get('classic', false),
    expanded: U.pref.get('expanded', {}),    // folder id -> bool

    loaded: false,
    error: null
  };

  var S = DF.store = {
    state: state,

    on: function (fn) { listeners.push(fn); },
    emit: function () { listeners.forEach(function (fn) { fn(state); }); },

    /* ------------------------------------------------------------------
     * Ingest
     * ---------------------------------------------------------------- */
    load: function (payload) {
      state.folders    = payload.folders || [];
      state.containers = payload.containers || [];
      state.loose      = payload.loose || [];
      state.stats      = payload.stats || state.stats;
      state.loaded     = true;
      state.error      = null;

      state.byName = {};
      state.containers.forEach(function (ct) { state.byName[ct.name] = ct; });

      /* A folder created in another tab should open, not arrive collapsed
       * with no way to tell it is new. Default to expanded. */
      state.folders.forEach(function (f) {
        if (!(f.id in state.expanded)) state.expanded[f.id] = true;
      });

      S.emit();
    },

    fail: function (message) {
      state.error = message;
      state.loaded = true;
      S.emit();
    },

    /* CPU and memory arrive over nchan as "<id>;<cpu>%;<used> / <limit>". */
    applyLive: function (text) {
      var seen = {};
      String(text).split('\n').forEach(function (line) {
        var parts = line.split(';');
        if (parts.length < 3) return;

        var ct = S.byId(parts[0].trim());
        if (!ct) return;

        seen[ct.name] = true;
        state.live[ct.name] = {
          cpu: parseFloat(parts[1]) || 0,
          mem: parseMem(parts[2].split('/')[0])
        };
      });

      /* Anything docker stats no longer reports is not running. */
      Object.keys(state.live).forEach(function (name) {
        if (!seen[name]) delete state.live[name];
      });

      S.emit();
    },

    /* ------------------------------------------------------------------
     * Lookups
     * ---------------------------------------------------------------- */
    byId: function (id) {
      for (var i = 0; i < state.containers.length; i++) {
        /* docker stats reports the short id; ours may be longer. */
        if (state.containers[i].id.indexOf(id) === 0 || id.indexOf(state.containers[i].id) === 0) {
          return state.containers[i];
        }
      }
      return null;
    },

    container: function (name) { return state.byName[name] || null; },

    folder: function (id) {
      for (var i = 0; i < state.folders.length; i++) if (state.folders[i].id === id) return state.folders[i];
      return null;
    },

    folderOf: function (name) {
      for (var i = 0; i < state.folders.length; i++) {
        if (state.folders[i].resolved.indexOf(name) !== -1) return state.folders[i];
      }
      return null;
    },

    members: function (folder) {
      return (folder.resolved || []).map(S.container).filter(Boolean);
    },

    /* ------------------------------------------------------------------
     * Derived
     * ---------------------------------------------------------------- */

    /* A container's effective status, with any in-flight job taking
     * precedence - a row must not claim "Running" while it is being stopped. */
    status: function (ct) {
      if (state.busy[ct.name]) return { kind: 'busy', label: state.busy[ct.name] };
      if (ct.state === 'running') return { kind: 'running', label: 'Running' };
      if (ct.state === 'paused')  return { kind: 'paused',  label: 'Paused' };
      return { kind: 'stopped', label: 'Stopped' };
    },

    cpu: function (ct) {
      var live = state.live[ct.name];
      return ct.state === 'running' && live ? live.cpu : null;
    },

    mem: function (ct) {
      var live = state.live[ct.name];
      return ct.state === 'running' && live ? live.mem : null;
    },

    /* Everything the folder row needs in one pass (spec 4.4). */
    summary: function (folder) {
      var members = S.members(folder);
      var running = 0, paused = 0, stopped = 0, updates = 0, busy = 0;
      var cpu = 0, mem = 0, haveCpu = false, haveMem = false;

      members.forEach(function (ct) {
        var status = S.status(ct);
        if (status.kind === 'busy') busy++;

        if (ct.state === 'running') running++;
        else if (ct.state === 'paused') paused++;
        else stopped++;

        if (ct.update === 1) updates++;

        var c = S.cpu(ct), m = S.mem(ct);
        if (c !== null) { cpu += c; haveCpu = true; }
        if (m !== null) { mem += m; haveMem = true; }
      });

      return {
        members: members,
        total: members.length,
        running: running,
        paused: paused,
        stopped: stopped,
        updates: updates,
        busy: busy,
        allRunning: members.length > 0 && running === members.length,
        cpu: haveCpu ? cpu : null,
        mem: haveMem ? mem : null,
        autostart: autostartState(members)
      };
    },

    /* ------------------------------------------------------------------
     * UI preferences
     * ---------------------------------------------------------------- */
    isExpanded: function (id) {
      /* While filtering, every folder still shown is expanded (spec 10). */
      if (state.filter) return true;
      return state.expanded[id] !== false;
    },

    toggle: function (id) {
      state.expanded[id] = !S.isExpanded(id);
      U.pref.set('expanded', state.expanded);
      S.emit();
    },

    setAllExpanded: function (open) {
      state.folders.forEach(function (f) { state.expanded[f.id] = open; });
      U.pref.set('expanded', state.expanded);
      S.emit();
    },

    anyExpanded: function () {
      return state.folders.some(function (f) { return S.isExpanded(f.id); });
    },

    setFilter: function (value) { state.filter = value; S.emit(); },

    setClassic: function (on) {
      state.classic = on;
      U.pref.set('classic', on);
      S.emit();
    },

    setBusy: function (name, label) {
      if (label) state.busy[name] = label; else delete state.busy[name];
      S.emit();
    },

    clearBusy: function () { state.busy = {}; S.emit(); },

    /* ------------------------------------------------------------------
     * Filtering (spec 10)
     *
     * A folder whose own name matches shows all its members; otherwise it
     * shows only matching members. Folders with no match are hidden.
     * ---------------------------------------------------------------- */
    visibleFolders: function () {
      var q = state.filter;
      if (!q) {
        return state.folders.map(function (f) { return { folder: f, members: S.members(f) }; });
      }

      var out = [];
      state.folders.forEach(function (f) {
        var members = S.members(f);
        if (U.matches(f.name, q)) { out.push({ folder: f, members: members }); return; }

        var hits = members.filter(function (ct) { return U.matches(ct.name, q); });
        if (hits.length) out.push({ folder: f, members: hits });
      });
      return out;
    },

    visibleLoose: function () {
      return state.loose
        .map(S.container)
        .filter(Boolean)
        .filter(function (ct) { return U.matches(ct.name, state.filter); });
    }
  };

  /* All on / all off / mixed, for the folder's tri-state switch (spec 4.3). */
  function autostartState(members) {
    if (!members.length) return 'off';
    var on = members.filter(function (ct) { return ct.autostart; }).length;
    if (on === 0) return 'off';
    if (on === members.length) return 'on';
    return 'mixed';
  }

  /* docker stats prints "640MiB", "1.53GiB", "512kB"... */
  function parseMem(text) {
    var m = String(text).trim().match(/^([\d.]+)\s*([KMGT]?i?B)$/i);
    if (!m) return 0;
    var value = parseFloat(m[1]);
    var unit = m[2].toUpperCase();
    var scale = { B: 1, KB: 1e3, KIB: 1024, MB: 1e6, MIB: 1048576,
                  GB: 1e9, GIB: 1073741824, TB: 1e12, TIB: 1099511627776 };
    return value * (scale[unit] || 1);
  }
})(window);
