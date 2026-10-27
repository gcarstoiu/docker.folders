/* docker.folders - modal dialogs.
 * Copyright (C) 2026  george
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 * One modal shell, used by the confirmations (DESIGN_SPEC.md 8) and by the
 * folder editor (spec 9). Unlike the prototype it traps focus, which spec 14
 * calls for in the real build.
 */
(function (root) {
  'use strict';

  var DF = root.DockerFolders = root.DockerFolders || {};
  var U = DF.util;
  var D = DF.dialog = {};

  var stack = [];

  /* ---------------------------------------------------------------------
   * The shell
   *
   *   open({ title, body, footer, width, onClose })  ->  { close, node }
   * ------------------------------------------------------------------- */
  D.open = function (opts) {
    var previous = document.activeElement;

    var title = U.el('h3.df-dialog-title', { text: opts.title, id: 'df-dialog-title-' + stack.length });

    var dialog = U.el('div.df-dialog', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': title.id,
      style: { 'max-width': (opts.width || 'var(--df-confirm-max)') }
    }, [
      U.el('div.df-dialog-head', null, [
        title,
        U.el('button.df-dialog-x', {
          type: 'button', 'aria-label': 'Close',
          onClick: function () { entry.close(); }
        }, '×')
      ]),
      opts.body,
      opts.footer
    ]);

    var scrim = U.el('div.df-scrim', {
      onMousedown: function (e) { if (e.target === scrim) entry.close(); }
    }, [dialog]);

    var entry = {
      node: scrim,
      dialog: dialog,
      close: function () {
        var i = stack.indexOf(entry);
        if (i === -1) return;
        stack.splice(i, 1);

        document.removeEventListener('keydown', onKey, true);
        if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
        if (!stack.length) document.body.style.removeProperty('overflow');

        if (previous && document.contains(previous)) previous.focus();
        if (opts.onClose) opts.onClose();
      }
    };

    /* Tab must not escape to the page behind the scrim. */
    function onKey(e) {
      if (e.key !== 'Tab') return;
      if (stack[stack.length - 1] !== entry) return;

      var items = focusable(dialog);
      if (!items.length) return;

      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    U.layer().appendChild(scrim);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey, true);
    stack.push(entry);

    var initial = dialog.querySelector('[data-autofocus]') || focusable(dialog)[0];
    if (initial) initial.focus();

    return entry;
  };

  function focusable(node) {
    return Array.prototype.filter.call(
      node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (el) { return !el.disabled && el.offsetParent !== null; }
    );
  }

  /* Escape closes the topmost dialog; app.js routes the key here first so a
   * dialog opened from a menu closes before the menu does. */
  D.handleEscape = function () {
    if (!stack.length) return false;
    stack[stack.length - 1].close();
    return true;
  };

  D.isOpen = function () { return stack.length > 0; };

  /* ---------------------------------------------------------------------
   * Confirmation (spec 8)
   * ------------------------------------------------------------------- */
  D.confirm = function (opts) {
    var body = U.el('div.df-dialog-body', null, [
      U.el('p.df-dialog-text', { text: opts.body })
    ]);

    /* Force update lists each member and whether it has an update waiting,
     * so the scope of the action is visible before confirming. */
    if (opts.list && opts.list.length) {
      var list = U.el('ul.df-confirm-list');
      opts.list.forEach(function (item) {
        list.appendChild(U.el('li.df-confirm-row', null, [
          U.el('span.df-confirm-name', { text: item.text }),
          U.el('span.df-confirm-note' + (item.tone ? '.df-note-' + item.tone : ''), { text: item.note })
        ]));
      });
      body.appendChild(list);
    }

    var entry;
    var footer = U.el('div.df-dialog-foot', null, [
      U.el('span.df-foot-spacer'),
      U.el('button.df-btn', { type: 'button', onClick: function () { entry.close(); } }, 'Cancel'),
      U.el('button.df-btn.df-btn-' + (opts.tone || 'primary'), {
        type: 'button',
        'data-autofocus': '',
        onClick: function () { entry.close(); opts.onConfirm(); }
      }, opts.confirmText || 'Confirm')
    ]);

    entry = D.open({ title: opts.title, body: body, footer: footer });
    return entry;
  };
})(window);
