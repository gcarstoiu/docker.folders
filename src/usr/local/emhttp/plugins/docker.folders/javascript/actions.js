/* docker.folders - what each command actually does.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 * Target selection and ordering come from DESIGN_SPEC.md 7:
 *
 *   Start all    stopped members,         start order, delay between starts
 *   Stop all     running + paused,        reverse start order when reverseStop
 *   Restart all  RUNNING members only     stop phase, then start phase
 *   Pause all    running members,         start order
 *   Resume all   paused members,          start order
 *
 * "Restart all" deliberately leaves stopped containers stopped.
 */
(function (root) {
  'use strict';

  var DF = root.DockerFolders = root.DockerFolders || {};
  var U = DF.util;
  var A = DF.actions = {};

  var TITLES = {
    start: 'Starting', stop: 'Stopping', restart: 'Restarting',
    pause: 'Pausing', resume: 'Resuming'
  };

  var NOTES = {
    start:   { busy: 'Starting…',  note: 'starting', done: 'started' },
    stop:    { busy: 'Stopping…',  note: 'stopping', done: 'stopped' },
    restart: { busy: 'Restarting…',note: 'restarting', done: 'restarted' },
    pause:   { busy: 'Pausing…',   note: 'pausing',  done: 'paused' },
    resume:  { busy: 'Resuming…',  note: 'resuming', done: 'resumed' }
  };

  function targetsFor(members, action) {
    switch (action) {
      case 'start':   return members.filter(function (c) { return c.state === 'stopped'; });
      case 'stop':    return members.filter(function (c) { return c.state !== 'stopped'; });
      case 'restart': return members.filter(function (c) { return c.state === 'running'; });
      case 'pause':   return members.filter(function (c) { return c.state === 'running'; });
      case 'resume':  return members.filter(function (c) { return c.state === 'paused'; });
    }
    return [];
  }

  function step(ct, action) {
    var n = NOTES[action];
    return {
      name: ct.name,
      note: n.note,
      doneNote: n.done,
      busyLabel: n.busy,
      run: function () { return DF.api.container(action, ct.id); }
    };
  }

  /* ---------------------------------------------------------------------
   * Bulk folder operations
   * ------------------------------------------------------------------- */
  A.bulk = function (folder, action) {
    var members = DF.store.members(folder);
    var targets = targetsFor(members, action);

    if (!targets.length) {
      DF.jobs.toast('Nothing to do in “' + folder.name + '”');
      return;
    }

    var steps = [];

    if (action === 'restart') {
      /* Stop everything first, in stop order, then start it again in start
       * order with the configured delay - a true folder restart, not a
       * per-container restart that would ignore ordering entirely. */
      var stopOrder = folder.reverseStop ? targets.slice().reverse() : targets.slice();
      stopOrder.forEach(function (ct) {
        steps.push({ name: ct.name, note: 'stopping', doneNote: 'stopped',
                     busyLabel: 'Stopping…',
                     run: function () { return DF.api.container('stop', ct.id); } });
      });
      targets.forEach(function (ct, i) {
        if (i > 0 && folder.delay > 0) steps.push({ wait: folder.delay, name: ct.name });
        steps.push({ name: ct.name, note: 'starting', doneNote: 'restarted',
                     busyLabel: 'Starting…',
                     run: function () { return DF.api.container('start', ct.id); } });
      });
    } else {
      var order = (action === 'stop' && folder.reverseStop) ? targets.slice().reverse() : targets;
      order.forEach(function (ct, i) {
        /* The start delay applies between starts only (spec 7). */
        if (action === 'start' && i > 0 && folder.delay > 0) {
          steps.push({ wait: folder.delay, name: ct.name });
        }
        steps.push(step(ct, action));
      });
    }

    DF.jobs.run(TITLES[action] + ' ' + folder.name, targets.map(nameOf), steps);
  };

  /* A single container from its own menu. Still goes through the job engine
   * so the one-job-at-a-time rule and the progress panel apply uniformly. */
  A.one = function (ct, action) {
    DF.jobs.run(TITLES[action] + ' ' + ct.name, [ct.name], [step(ct, action)]);
  };

  /* ---------------------------------------------------------------------
   * Updates
   * ------------------------------------------------------------------- */
  /* Unraid's DockerUpdate.php refreshes EVERY container's update flag in one
   * pass; there is no per-folder variant. So this is a single step with a
   * single progress row - listing each member would imply per-container work
   * that never happens, leaving every row but the first stuck at "queued". */
  A.checkUpdates = function (folder) {
    var label = 'every container';
    DF.jobs.run('Checking for updates', [label], [{
      name: label,
      note: 'checking',
      doneNote: 'checked',
      busyLabel: 'Checking…',
      run: function () { return DF.api.checkUpdates(); }
    }]);
  };

  A.update = function (folder, force) {
    var members = DF.store.members(folder);
    var targets = force ? members : members.filter(function (c) { return c.update === 1; });

    if (!targets.length) {
      DF.jobs.toast('Nothing to do in “' + folder.name + '”');
      return;
    }
    DF.jobs.update('Updating ' + folder.name, targets);
  };

  A.updateContainers = function (containers, label) {
    DF.jobs.update('Updating ' + label, containers);
  };

  /* ---------------------------------------------------------------------
   * Global actions - the classic Docker view's button row
   *
   * These go through the same job engine as the folder commands, so the
   * one-job-at-a-time rule, the progress panel and the per-container error
   * reporting all behave identically. The alternative, Unraid's own
   * ContainerManager.php, acts on everything in one opaque request with no
   * progress and no way to report which container failed.
   *
   * Order comes from Unraid's autostart file, which is the real boot order
   * and which this plugin already writes folder order into. Containers not
   * listed there follow, name-sorted.
   * ------------------------------------------------------------------- */

  /* Stop and Pause hit every container on the server, and the buttons are
   * labelled with one word. Confirm before doing it. */
  var NEEDS_CONFIRM = {
    stop:  { title: 'Stop every container?',
             body: 'Every running and paused container on this server will be stopped, '
                 + 'in reverse start order. Nothing is removed, and autostart settings '
                 + 'are unchanged.',
             confirm: 'Stop all' },
    pause: { title: 'Pause every container?',
             body: 'Every running container on this server will be paused. '
                 + 'Paused containers keep their memory and can be resumed.',
             confirm: 'Pause all' }
  };

  A.globalLifecycle = function (action) {
    var targets = orderedTargets(action);

    if (!targets.length) {
      DF.jobs.toast('Nothing to ' + action);
      return;
    }

    var ask = NEEDS_CONFIRM[action];
    if (!ask) { runGlobal(action, targets); return; }

    DF.dialog.confirm({
      title: ask.title,
      body: ask.body,
      list: targets.map(function (ct) { return { text: ct.name, note: ct.state }; }),
      confirmText: ask.confirm + ' (' + targets.length + ')',
      tone: 'danger',
      onConfirm: function () { runGlobal(action, targets); }
    });
  };

  function runGlobal(action, targets) {
    var steps = targets.map(function (ct) { return step(ct, action); });
    DF.jobs.run(TITLES[action] + ' all containers', targets.map(nameOf), steps);
  }

  /* Targets for a global action, in boot order. Stop runs in reverse, the
   * same rule a folder uses. */
  function orderedTargets(action) {
    var all = DF.store.state.containers.slice();
    var order = DF.store.state.order || [];

    all.sort(function (a, b) {
      var ia = order.indexOf(a.name), ib = order.indexOf(b.name);
      if (ia === -1 && ib === -1) return strcmp(a.name, b.name);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    var targets = targetsFor(all, action);
    return action === 'stop' ? targets.reverse() : targets;
  }

  function strcmp(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

  /* Update every container that has one waiting. */
  A.globalUpdate = function () {
    var targets = DF.store.state.containers.filter(function (c) { return c.update === 1; });
    if (!targets.length) { DF.jobs.toast('Everything is up to date'); return; }
    DF.jobs.update('Updating all containers', targets);
  };

  /* Unraid owns these two screens; there is nothing to reimplement. */
  A.addContainer = function () {
    if (typeof root.addContainer === 'function') { root.addContainer(); return; }
    DF.jobs.toast('Unraid\'s Add Container page is unavailable', 'error');
  };

  A.containerSize = function () {
    if (typeof root.contSizes === 'function') { root.contSizes(); return; }
    DF.jobs.toast('Unraid\'s Container Size view is unavailable', 'error');
  };

  /* ---------------------------------------------------------------------
   * Confirmations (spec 8)
   * ------------------------------------------------------------------- */
  A.confirmForceUpdate = function (folder) {
    var members = DF.store.members(folder);

    DF.dialog.confirm({
      title: 'Force update ' + U.plural(members.length, 'container') + ' in “' + folder.name + '”?',
      body: 'Every image is pulled again and each container is recreated from its '
          + 'template. Containers that are running come back up in start order; '
          + 'containers that are stopped stay stopped.',
      list: members.map(function (ct) {
        return { text: ct.name, note: ct.update === 1 ? 'update ready' : 'already up to date',
                 tone: ct.update === 1 ? 'warn' : null };
      }),
      confirmText: 'Force update',
      tone: 'warn',
      onConfirm: function () { A.update(folder, true); }
    });
  };

  A.confirmDelete = function (folder) {
    var count = DF.store.members(folder).length;

    DF.dialog.confirm({
      title: 'Delete folder “' + folder.name + '”?',
      body: 'Only the folder is removed. Its ' + U.plural(count, 'container')
          + ' keep running and move to “Not in a folder”.',
      confirmText: 'Delete folder',
      tone: 'danger',
      onConfirm: function () {
        DF.api.deleteFolder(folder.id)
          .then(function () {
            DF.jobs.toast('Folder “' + folder.name + '” deleted');
            return DF.refresh();
          })
          .catch(function (err) { DF.jobs.toast(err.message, 'error'); });
      }
    });
  };

  /* ---------------------------------------------------------------------
   * Folder management
   * ------------------------------------------------------------------- */
  A.moveFolder = function (folder, direction) {
    DF.api.moveFolder(folder.id, direction)
      .then(DF.refresh)
      .catch(function (err) { DF.jobs.toast(err.message, 'error'); });
  };

  A.assign = function (ct, folder) {
    DF.api.assign(ct.name, folder ? folder.id : null)
      .then(function () {
        DF.jobs.toast(folder
          ? ct.name + ' moved to “' + folder.name + '”'
          : ct.name + ' removed from its folder');
        return DF.refresh();
      })
      .catch(function (err) { DF.jobs.toast(err.message, 'error'); });
  };

  A.openWebUIs = function (folder) {
    var urls = DF.store.members(folder)
      .filter(function (ct) { return ct.state === 'running' && ct.webui; })
      .map(function (ct) { return ct.webui; });

    if (!urls.length) {
      DF.jobs.toast('Nothing to do in “' + folder.name + '”');
      return;
    }

    urls.forEach(function (url) { root.open(url, '_blank', 'noopener'); });
    DF.jobs.toast(U.plural(urls.length, 'WebUI') + ' opened');
  };

  /* ---------------------------------------------------------------------
   * Autostart
   *
   * Writes through Unraid's own UpdateConfig.php, which maintains
   * /var/lib/docker/unraid-autostart. Folder start order and delay drive
   * that same file rather than shadowing it (spec 13.9).
   * ------------------------------------------------------------------- */
  A.setContainerAutostart = function (ct, on) {
    DF.api.setAutostart(ct.name, on, ct.wait || 0)
      .then(DF.refresh)
      .catch(function (err) { DF.jobs.toast(err.message, 'error'); });
  };

  A.setFolderAutostart = function (folder, on) {
    var members = DF.store.members(folder);
    if (!members.length) return;

    /* Sequential: each call rewrites the autostart file, so firing them in
     * parallel would have them overwrite each other. */
    var chain = Promise.resolve();
    members.forEach(function (ct, i) {
      chain = chain.then(function () {
        return DF.api.setAutostart(ct.name, on, i > 0 ? (folder.delay || 0) : 0);
      });
    });

    chain
      .then(function () { return DF.api.applyAutostart(folder.id); })
      .then(DF.refresh)
      .catch(function (err) { DF.jobs.toast(err.message, 'error'); });
  };

  function nameOf(ct) { return ct.name; }
})(window);
