/* docker.folders - the job engine, progress panel and toasts.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 * DESIGN_SPEC.md 7: every bulk operation runs SEQUENTIALLY, one container at
 * a time, and only ONE job runs at a time across the whole page. A second
 * request is refused with a toast rather than queued - two jobs interleaving
 * start order would make the ordering guarantee meaningless.
 */
(function (root) {
  'use strict';

  var DF = root.DockerFolders = root.DockerFolders || {};
  var U = DF.util;
  var J = DF.jobs = {};

  var current = null;          // the running job, or null
  var panel = null;            // { node, fill, step, rows }
  var dismissTimer = null;

  var TOAST_MS = 4200;
  var PANEL_MS = 6500;

  J.running = function () { return current !== null; };

  /* ---------------------------------------------------------------------
   * Toasts (spec 7.2)
   * ------------------------------------------------------------------- */
  J.toast = function (message, tone) {
    var host = U.layer().querySelector('.df-toasts');
    if (!host) {
      host = U.el('div.df-toasts', { 'aria-live': 'polite' });
      U.layer().appendChild(host);
    }

    var node = U.el('div.df-toast' + (tone ? '.df-toast-' + tone : ''), { text: message });
    host.appendChild(node);
    setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, TOAST_MS);
  };

  /* ---------------------------------------------------------------------
   * Running a job
   *
   * A job is a title plus a list of steps. Each step is either a container
   * action or a wait; waits count as steps in the progress total, which is
   * what makes the "starts 5 s apart" delay visible rather than looking like
   * a hang (spec 7.1).
   *
   * step = { name, note, run() }  |  { wait: seconds }
   * ------------------------------------------------------------------- */
  J.run = function (title, targets, steps) {
    if (current) {
      J.toast('Another job is still running');
      return Promise.resolve(false);
    }
    if (!steps.length) return Promise.resolve(false);

    current = { title: title, cancelled: false };
    openPanel(title, targets);

    var index = 0;
    var failures = 0;

    function next() {
      if (index >= steps.length) return Promise.resolve();

      var step = steps[index++];
      setProgress(index, steps.length);

      if (step.wait) {
        markRow(step.name, 'active', 'wait ' + step.wait + ' s');
        return U.sleep(step.wait * 1000).then(next);
      }

      markRow(step.name, 'active', step.note || 'working');
      DF.store.setBusy(step.name, step.busyLabel || 'Working…');

      return step.run()
        .then(function () {
          markRow(step.name, 'done', step.doneNote || 'done');
        })
        .catch(function (err) {
          failures++;
          markRow(step.name, 'failed', 'failed');
          J.toast(step.name + ': ' + (err.message || 'failed'), 'error');
        })
        .then(function () {
          DF.store.setBusy(step.name, null);
          return next();
        });
    }

    return next().then(function () {
      current = null;
      DF.store.clearBusy();
      return DF.refresh().then(function () {
        finishPanel(summaryText(title, targets.length, failures), failures);
        return failures === 0;
      });
    });
  };

  function summaryText(title, count, failures) {
    if (failures) return failures + ' of ' + count + ' failed';
    return U.plural(count, 'container') + ' ' + pastTense(title);
  }

  function pastTense(title) {
    var verb = title.split(' ')[0].toLowerCase();
    return ({
      starting: 'started', stopping: 'stopped', restarting: 'restarted',
      pausing: 'paused', resuming: 'resumed', updating: 'updated',
      checking: 'checked'
    })[verb] || 'done';
  }

  /* ---------------------------------------------------------------------
   * Progress panel (spec 7.1)
   * ------------------------------------------------------------------- */
  function openPanel(title, targets) {
    closePanel();
    clearTimeout(dismissTimer);

    var fill = U.el('div.df-progress-fill');
    var step = U.el('span.df-panel-step', { text: 'Step 0 of —' });
    var list = U.el('ul.df-panel-list');
    var rows = {};

    targets.forEach(function (name) {
      var mark = U.el('span.df-mark.df-mark-queued', { 'aria-hidden': 'true' });
      var note = U.el('span.df-panel-note', { text: 'queued' });
      var row = U.el('li.df-panel-row', null, [
        mark, U.el('span.df-panel-name', { text: name }), note
      ]);
      rows[name] = { row: row, mark: mark, note: note };
      list.appendChild(row);
    });

    var node = U.el('div.df-panel', { role: 'status', 'aria-live': 'polite' }, [
      U.el('div.df-panel-head', null, [U.el('span.df-panel-title', { text: title }), step]),
      U.el('div.df-progress', null, [fill]),
      list
    ]);

    U.layer().appendChild(node);
    panel = { node: node, fill: fill, step: step, rows: rows };
  }

  function setProgress(done, total) {
    if (!panel) return;
    panel.step.textContent = 'Step ' + done + ' of ' + total;
    panel.fill.style.width = Math.round((done / total) * 100) + '%';
  }

  function markRow(name, state, note) {
    if (!panel || !panel.rows[name]) return;
    var row = panel.rows[name];
    row.mark.className = 'df-mark df-mark-' + state;
    row.note.textContent = note;
    row.row.classList.toggle('is-active', state === 'active');
    row.row.classList.toggle('is-failed', state === 'failed');
  }

  function finishPanel(summary, failures) {
    if (!panel) return;
    setProgress(1, 1);

    var foot = U.el('div.df-panel-foot', null, [
      U.el('span', null, [
        U.el('span.df-mark.' + (failures ? 'df-mark-failed' : 'df-mark-done'), { 'aria-hidden': 'true' }),
        ' ' + summary
      ]),
      U.el('button.df-panel-close', { type: 'button', onClick: closePanel }, 'Close')
    ]);
    panel.node.appendChild(foot);

    /* A job that failed stays up until it is read; a clean one gets out of
     * the way on its own (spec 7.1). */
    if (!failures) dismissTimer = setTimeout(closePanel, PANEL_MS);
  }

  function closePanel() {
    clearTimeout(dismissTimer);
    if (panel && panel.node.parentNode) panel.node.parentNode.removeChild(panel.node);
    panel = null;
  }

  J.closePanel = closePanel;

  /* ---------------------------------------------------------------------
   * The update job (spec 7)
   *
   * "Update" and "force update" are the same operation on different target
   * sets: Unraid's scripts/update_container always pulls and recreates, and
   * restores the container's previous running state. Our Update.php runs it
   * in the background and reports phases; we poll rather than parse the
   * nchan log, whose text is translated on non-English servers.
   * ------------------------------------------------------------------- */
  J.update = function (title, containers) {
    if (current) { J.toast('Another job is still running'); return Promise.resolve(false); }
    if (!containers.length) return Promise.resolve(false);

    var names = containers.map(function (ct) { return ct.name; });
    current = { title: title };
    openPanel(title, names);
    names.forEach(function (n) { DF.store.setBusy(n, 'Updating…'); });

    return DF.api.startUpdate(names)
      .then(function (res) { return poll(res.job, names); })
      .catch(function (err) {
        J.toast(err.message || 'Update failed to start', 'error');
      })
      .then(function () {
        current = null;
        DF.store.clearBusy();
        return DF.refresh();
      });
  };

  function poll(job, names) {
    return new Promise(function (resolve) {
      var seen = {};

      function tick() {
        DF.api.updateState(job).then(function (state) {
          (state.containers || []).forEach(function (entry) {
            var mark = entry.status === 'done' ? 'done'
                     : entry.status === 'failed' ? 'failed'
                     : entry.status === 'active' ? 'active' : 'queued';
            markRow(entry.name, mark, entry.note || entry.status);
            if (mark === 'done' || mark === 'failed') seen[entry.name] = true;
          });

          setProgress(Object.keys(seen).length, names.length);

          if (state.finished) {
            var failures = (state.containers || []).filter(function (e) { return e.status === 'failed'; }).length;
            finishPanel(summaryText('Updating', names.length, failures), failures);
            resolve();
            return;
          }
          setTimeout(tick, 1000);
        }).catch(function (err) {
          J.toast(err.message || 'Lost track of the update', 'error');
          finishPanel('Update status unavailable', 1);
          resolve();
        });
      }

      tick();
    });
  }
})(window);
