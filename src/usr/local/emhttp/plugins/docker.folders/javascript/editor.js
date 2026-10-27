/* docker.folders - the New folder / Edit folder dialog.
 * Copyright (C) 2026  gcarstoiu
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 2, as published
 * by the Free Software Foundation.
 *
 * DESIGN_SPEC.md 9. Two columns that stack when narrow, with a live preview
 * of the folder row at the top of the body.
 *
 *   left   name, icon (built-in / from the web / from a container), colour
 *   right  members, start order, auto-add rule, behaviour
 */
(function (root) {
  'use strict';

  var DF = root.DockerFolders = root.DockerFolders || {};
  var U = DF.util;
  var E = DF.editor = {};

  var GLYPHS = [
    ['folder', 'Folder'], ['media', 'Media'], ['downloads', 'Downloads'], ['home', 'Home'],
    ['ai', 'AI / compute'], ['databases', 'Databases'], ['cloud', 'Cloud'], ['security', 'Security'],
    ['network', 'Network'], ['photos', 'Photos'], ['music', 'Music'], ['monitoring', 'Monitoring'],
    ['passwords', 'Passwords'], ['games', 'Games']
  ];

  var COLORS = ['slate', 'blue', 'teal', 'green', 'amber', 'orange', 'rose', 'violet'];

  E.open = function (existing, opts) {
    opts = opts || {};
    var S = DF.store;
    var creating = !existing;

    /* Working copy: nothing is written until Save. */
    var draft = existing ? {
      id: existing.id,
      name: existing.name,
      color: existing.color,
      icon: JSON.parse(JSON.stringify(existing.icon || { type: 'glyph', key: 'folder' })),
      members: existing.members.slice(),
      delay: existing.delay,
      reverseStop: existing.reverseStop,
      preview: existing.preview,
      rule: existing.rule,
      dashboard: existing.dashboard,
      autoIcon: false
    } : {
      id: null,
      name: '',
      color: 'slate',
      icon: { type: 'glyph', key: 'folder' },
      members: opts.preselect ? [opts.preselect] : [],
      delay: 0,
      reverseStop: true,
      preview: 'status',
      rule: '',
      dashboard: true,
      /* New folders follow the name until the user picks an icon (spec 9). */
      autoIcon: true
    };

    var entry;
    var refs = {};
    var iconTab = 'glyph';

    /* ------------------------------------------------------------------
     * Preview (top of the body)
     * ---------------------------------------------------------------- */
    var preview = U.el('div.df-ed-preview');

    function drawPreview() {
      U.clear(preview);

      var sub = U.plural(draft.members.length, 'container')
        + (draft.delay > 0 ? ' · starts ' + draft.delay + ' s apart' : '');

      var strip = U.el('div.df-strip');
      draft.members.forEach(function (name) {
        var ct = S.container(name);
        if (!ct) return;
        strip.appendChild(U.el('span.df-strip-btn', null, [tileFor(ct, 'df-strip-tile')]));
      });

      preview.appendChild(U.el('div.df-ed-preview-label', { text: 'PREVIEW' }));
      preview.appendChild(U.el('div.df-ed-preview-row', { 'data-color': draft.color }, [
        U.el('span.df-folder-icon', null, [iconNode()]),
        U.el('div.df-folder-text', null, [
          U.el('div.df-folder-line1', null, [
            U.el('span.df-folder-name', { text: draft.name || 'Untitled folder' })
          ]),
          U.el('div.df-folder-sub', { text: sub })
        ]),
        strip
      ]));
    }

    function iconNode() {
      if (draft.icon.type === 'web' && draft.icon.localFile) {
        return U.el('img.df-folder-img', {
          src: DF.config.base + '/include/Icons.php?file=' + encodeURIComponent(draft.icon.localFile), alt: ''
        });
      }
      if (draft.icon.type === 'container') {
        var ct = S.container(draft.icon.name);
        if (ct) return tileFor(ct, 'df-folder-img');
      }
      return U.glyph(draft.icon.key || 'folder', 'df-folder-glyph');
    }

    function tileFor(ct, cls) {
      if (ct.icon) return U.el('img', { class: cls + ' df-tile-img', src: ct.icon, alt: '' });
      return U.el('span.' + cls + '.df-tile-letter', {
        'data-tint': ct.tint || 'slate',
        text: (ct.letter || ct.name.charAt(0)).toUpperCase()
      });
    }

    /* ------------------------------------------------------------------
     * Left column
     * ---------------------------------------------------------------- */
    function nameField() {
      var counter = U.el('span.df-ed-counter', { text: draft.name.length + ' / 32' });
      var error = U.el('div.df-ed-error', { role: 'alert' });

      var input = U.el('input.df-input', {
        type: 'text', value: draft.name, maxlength: '32',
        id: 'df-ed-name', 'data-autofocus': '',
        'aria-describedby': 'df-ed-name-error',
        onInput: function (e) {
          draft.name = e.target.value;
          counter.textContent = draft.name.length + ' / 32';
          if (draft.autoIcon) refreshAutoIcon();
          validateName();
          drawPreview();
        }
      });

      error.id = 'df-ed-name-error';
      refs.name = input;
      refs.nameError = error;

      return field('Folder name', [
        input,
        U.el('div.df-ed-row-end', null, [error, counter])
      ], 'df-ed-name');
    }

    function validateName() {
      var name = draft.name.trim();
      var message = '';

      if (!name) message = 'Give the folder a name';
      else if (S.state.folders.some(function (f) {
        return f.id !== draft.id && f.name.toLowerCase() === name.toLowerCase();
      })) message = 'Another folder already uses this name';

      refs.nameError.textContent = message;
      refs.name.classList.toggle('is-invalid', !!message);
      refs.name.setAttribute('aria-invalid', message ? 'true' : 'false');
      if (refs.save) refs.save.disabled = !!message;
      return !message;
    }

    /* ---- icon tabs ---- */
    function iconSection() {
      var panel = U.el('div.df-ed-icon-panel');

      var tabs = U.el('div.df-tabs', { role: 'tablist' });
      [['glyph', 'Built-in'], ['web', 'From the web'], ['container', 'From a container']]
        .forEach(function (pair) {
          var button = U.el('button.df-tab', {
            type: 'button', role: 'tab',
            'aria-selected': String(iconTab === pair[0]),
            onClick: function () { iconTab = pair[0]; drawTabs(); drawIconPanel(); }
          }, pair[1]);
          button.dataset.tab = pair[0];
          tabs.appendChild(button);
        });

      refs.tabs = tabs;
      refs.iconPanel = panel;
      drawIconPanel();

      return field('Icon', [tabs, panel]);
    }

    function drawTabs() {
      Array.prototype.forEach.call(refs.tabs.children, function (b) {
        b.setAttribute('aria-selected', String(b.dataset.tab === iconTab));
      });
    }

    function drawIconPanel() {
      var panel = U.clear(refs.iconPanel);
      if (iconTab === 'glyph')     return drawGlyphs(panel);
      if (iconTab === 'web')       return drawWeb(panel);
      if (iconTab === 'container') return drawFromContainer(panel);
    }

    function drawGlyphs(panel) {
      var grid = U.el('div.df-glyph-grid');
      GLYPHS.forEach(function (pair) {
        var selected = draft.icon.type === 'glyph' && draft.icon.key === pair[0];
        grid.appendChild(U.el('button.df-glyph-btn', {
          type: 'button',
          title: pair[1],
          'aria-label': pair[1],
          'aria-pressed': String(selected),
          'data-color': draft.color,
          onClick: function () {
            draft.icon = { type: 'glyph', key: pair[0] };
            draft.autoIcon = false;
            drawIconPanel(); drawPreview();
          }
        }, [U.glyph(pair[0], 'df-glyph-sm')]));
      });
      panel.appendChild(grid);
    }

    function drawWeb(panel) {
      var auto = U.el('label.df-check', null, [
        U.el('input', {
          type: 'checkbox', checked: draft.autoIcon,
          onChange: function (e) {
            draft.autoIcon = e.target.checked;
            if (draft.autoIcon) refreshAutoIcon();
          }
        }),
        U.el('span', { text: 'Fetch automatically from the folder name' })
      ]);

      var search = U.el('input.df-input', {
        type: 'search', value: draft.name, placeholder: 'Search icon libraries',
        'aria-label': 'Search icon libraries',
        onInput: U.debounce(function (e) { runSearch(e.target.value); }, 300)
      });

      var results = U.el('div.df-icon-results');
      refs.iconResults = results;

      var urlInput = U.el('input.df-input', {
        type: 'url', placeholder: 'https://…/icon.png', 'aria-label': 'Image URL'
      });

      var urlError = U.el('div.df-ed-error', { role: 'alert' });

      var download = U.el('button.df-btn', {
        type: 'button',
        onClick: function () {
          urlError.textContent = '';
          download.disabled = true;
          DF.api.downloadIcon({ source: 'url', url: urlInput.value })
            .then(function (res) {
              draft.icon = { type: 'web', source: 'url', query: '', url: urlInput.value, localFile: res.file };
              draft.autoIcon = false;
              urlError.textContent = '';
              results.appendChild(U.el('div.df-ed-hint', {
                text: 'Downloaded ' + res.file + ' from ' + res.host + ' · stored locally so it shows offline'
              }));
              drawPreview();
            })
            .catch(function (err) { urlError.textContent = err.message; })
            .then(function () { download.disabled = false; });
        }
      }, 'Download');

      panel.appendChild(auto);
      panel.appendChild(search);
      panel.appendChild(results);
      panel.appendChild(U.el('div.df-ed-sub', { text: 'Or paste an image URL' }));
      panel.appendChild(U.el('div.df-ed-url-row', null, [urlInput, download]));
      panel.appendChild(urlError);
      panel.appendChild(U.el('div.df-ed-hint', {
        text: 'The icon is copied to the server, so it still shows when offline.'
      }));

      if (draft.name) runSearch(draft.name);
    }

    function runSearch(query) {
      if (!refs.iconResults) return;
      var results = U.clear(refs.iconResults);
      if (!query) return;

      results.appendChild(U.el('div.df-ed-hint', { text: 'Searching…' }));

      DF.api.searchIcons(query)
        .then(function (res) {
          if (!refs.iconResults) return;
          var box = U.clear(refs.iconResults);

          (res.results || []).forEach(function (item) {
            box.appendChild(U.el('button.df-icon-card', {
              type: 'button',
              'aria-label': item.label + ': ' + item.file,
              onClick: function () { pickWebIcon(item); }
            }, [
              U.el('span.df-icon-card-art', { 'data-source': item.source }, [
                item.preview
                  ? U.el('img', { src: item.preview, alt: '', loading: 'lazy' })
                  : U.el('span.df-icon-card-letter', { text: (query.charAt(0) || '?').toUpperCase() })
              ]),
              U.el('span.df-icon-card-name', { text: item.label }),
              U.el('span.df-icon-card-file', { text: item.file })
            ]));
          });

          if (!(res.results || []).length) {
            box.appendChild(U.el('div.df-ed-hint', { text: 'No icons matched “' + query + '”' }));
          }
        })
        .catch(function (err) {
          if (!refs.iconResults) return;
          U.clear(refs.iconResults).appendChild(
            U.el('div.df-ed-error', { text: err.message })
          );
        });
    }

    function pickWebIcon(item) {
      DF.api.downloadIcon({ source: item.source, url: item.url, query: item.query })
        .then(function (res) {
          draft.icon = { type: 'web', source: item.source, query: item.query, url: item.url, localFile: res.file };
          draft.autoIcon = false;
          drawPreview();
        })
        .catch(function (err) { DF.jobs.toast(err.message, 'error'); });
    }

    /* While "fetch automatically" is on, the icon follows the name. Only the
     * preview's query is updated as you type; the file is fetched on save. */
    function refreshAutoIcon() {
      draft.icon = { type: 'glyph', key: guessGlyph(draft.name) };
    }

    /* A cheap keyword match so the automatic icon is at least plausible
     * before any network call happens. */
    function guessGlyph(name) {
      var n = String(name).toLowerCase();
      var map = [
        ['media', ['media', 'plex', 'jellyfin', 'emby', 'video', 'movie', 'tv']],
        ['downloads', ['download', 'torrent', 'usenet', 'nzb', 'arr']],
        ['home', ['home', 'house', 'smart', 'assistant', 'iot']],
        ['ai', ['ai', 'ml', 'llm', 'ollama', 'compute', 'gpu']],
        ['databases', ['db', 'database', 'sql', 'postgres', 'maria', 'mongo', 'redis']],
        ['cloud', ['cloud', 'nextcloud', 'drive', 'sync', 'backup']],
        ['security', ['security', 'vpn', 'firewall', 'auth', 'guard']],
        ['network', ['network', 'proxy', 'dns', 'nginx', 'traefik', 'router']],
        ['photos', ['photo', 'immich', 'image', 'picture', 'gallery']],
        ['music', ['music', 'audio', 'navidrome', 'spotify', 'sound']],
        ['monitoring', ['monitor', 'grafana', 'metric', 'graph', 'stat', 'uptime']],
        ['passwords', ['password', 'vault', 'secret', 'bitwarden', 'keepass']],
        ['games', ['game', 'minecraft', 'steam', 'valheim', 'server']]
      ];
      for (var i = 0; i < map.length; i++) {
        for (var j = 0; j < map[i][1].length; j++) {
          if (n.indexOf(map[i][1][j]) !== -1) return map[i][0];
        }
      }
      return 'folder';
    }

    function drawFromContainer(panel) {
      if (!draft.members.length) {
        panel.appendChild(U.el('div.df-ed-hint', { text: 'Add containers to the folder first, then pick one here.' }));
        return;
      }
      var grid = U.el('div.df-ct-grid');
      draft.members.forEach(function (name) {
        var ct = S.container(name);
        if (!ct) return;
        var selected = draft.icon.type === 'container' && draft.icon.name === name;
        grid.appendChild(U.el('button.df-ct-card', {
          type: 'button',
          'aria-pressed': String(selected),
          'aria-label': 'Use ' + name + "'s icon",
          onClick: function () {
            draft.icon = { type: 'container', name: name };
            draft.autoIcon = false;
            drawIconPanel(); drawPreview();
          }
        }, [tileFor(ct, 'df-ct-tile'), U.el('span.df-ct-card-name', { text: name })]));
      });
      panel.appendChild(grid);
    }

    function colorSection() {
      var row = U.el('div.df-swatches');
      COLORS.forEach(function (color) {
        row.appendChild(U.el('button.df-swatch', {
          type: 'button',
          'data-color': color,
          'aria-label': color,
          'aria-pressed': String(draft.color === color),
          onClick: function () {
            draft.color = color;
            Array.prototype.forEach.call(row.children, function (b) {
              b.setAttribute('aria-pressed', String(b.dataset.color === draft.color));
            });
            /* The colour tints the glyph tiles, so redraw them too. */
            if (iconTab === 'glyph') drawIconPanel();
            drawPreview();
          }
        }));
      });
      return field('Colour', [row]);
    }

    /* ------------------------------------------------------------------
     * Right column
     * ---------------------------------------------------------------- */
    function membersSection() {
      var count = U.el('span.df-ed-counter', { text: draft.members.length + ' selected' });
      var list = U.el('div.df-ct-list', { role: 'group', 'aria-label': 'Containers in this folder' });
      refs.memberList = list;
      refs.memberCount = count;

      var search = U.el('input.df-input', {
        type: 'search', placeholder: 'Search containers', 'aria-label': 'Search containers',
        onInput: U.debounce(function (e) { drawMembers(e.target.value); }, 160)
      });

      drawMembers('');
      return field('Containers in this folder', [search, list], null, count);
    }

    /* Rebuilt only when the search text changes. A checkbox toggle updates
     * that one row in place: rebuilding here would replace the input the
     * user just clicked, losing focus and the scroll position. */
    function drawMembers(query) {
      var list = U.clear(refs.memberList);
      refs.memberRows = {};

      S.state.containers.forEach(function (ct) {
        if (query && !U.matches(ct.name, query)) return;

        var note = U.el('span.df-ct-opt-note');
        var box = U.el('input', {
          type: 'checkbox',
          checked: draft.members.indexOf(ct.name) !== -1,
          onChange: function (e) { toggleMember(ct.name, e.target.checked); }
        });

        var row = U.el('label.df-ct-opt', null, [
          box, tileFor(ct, 'df-ct-mini'),
          U.el('span.df-ct-opt-name', { text: ct.name }),
          note
        ]);

        refs.memberRows[ct.name] = { row: row, note: note, box: box };
        list.appendChild(row);
        paintMember(ct.name);
      });
    }

    /* The row's selected state and its "in <folder>" / "moves from <folder>"
     * note (spec 9). */
    function paintMember(name) {
      var ref = refs.memberRows && refs.memberRows[name];
      if (!ref) return;

      var checked = draft.members.indexOf(name) !== -1;
      var owner = S.folderOf(name);
      var elsewhere = owner && owner.id !== draft.id;

      ref.row.classList.toggle('is-on', checked);
      ref.note.classList.toggle('df-note-warn', !!(elsewhere && checked));
      ref.note.textContent = !elsewhere ? ''
        : (checked ? 'moves from ' + owner.name : 'in ' + owner.name);
    }

    function toggleMember(name, on) {
      var i = draft.members.indexOf(name);
      if (on && i === -1) draft.members.push(name);
      if (!on && i !== -1) draft.members.splice(i, 1);

      /* An icon borrowed from a container that just left makes no sense. */
      if (!on && draft.icon.type === 'container' && draft.icon.name === name) {
        draft.icon = { type: 'glyph', key: 'folder' };
      }

      paintMember(name);
      refs.memberCount.textContent = draft.members.length + ' selected';
      drawOrder();
      drawPreview();
      if (iconTab === 'container') drawIconPanel();
    }

    /* The member list IS the start order (spec 11). */
    function orderSection() {
      var list = U.el('ol.df-order-list');
      refs.orderList = list;
      drawOrder();

      var hint = U.el('span.df-ed-counter', {
        text: draft.reverseStop ? 'top starts first, stops last' : 'top starts first'
      });
      refs.orderHint = hint;

      return field('Start order', [list], null, hint);
    }

    function drawOrder() {
      var list = U.clear(refs.orderList);

      if (!draft.members.length) {
        list.appendChild(U.el('li.df-ed-hint', { text: 'No containers selected yet.' }));
        return;
      }

      draft.members.forEach(function (name, i) {
        var ct = S.container(name);
        list.appendChild(U.el('li.df-order-row', null, [
          U.el('span.df-order-num.df-mono', { text: String(i + 1) }),
          ct ? tileFor(ct, 'df-ct-mini') : null,
          U.el('span.df-order-name', { text: name }),
          U.el('button.df-order-btn', {
            type: 'button', 'aria-label': 'Start ' + name + ' earlier',
            disabled: i === 0,
            onClick: function () { moveMember(i, -1); }
          }, '↑'),
          U.el('button.df-order-btn', {
            type: 'button', 'aria-label': 'Start ' + name + ' later',
            disabled: i === draft.members.length - 1,
            onClick: function () { moveMember(i, 1); }
          }, '↓')
        ]));
      });
    }

    function moveMember(index, delta) {
      var to = index + delta;
      if (to < 0 || to >= draft.members.length) return;
      var item = draft.members.splice(index, 1)[0];
      draft.members.splice(to, 0, item);
      drawOrder();
      drawPreview();
    }

    function ruleSection() {
      var feedback = U.el('div.df-ed-chips');

      var input = U.el('input.df-input', {
        type: 'text', value: draft.rule,
        placeholder: 'e.g. ^(sonarr|radarr|lidarr)$',
        'aria-label': 'Auto-add containers whose name matches',
        onInput: U.debounce(function (e) { draft.rule = e.target.value; checkRule(feedback); }, 220)
      });

      checkRule(feedback);

      return field('Auto-add containers whose name matches', [
        input,
        feedback,
        U.el('div.df-ed-hint', { text: 'Optional. A regular expression, matched case-insensitively.' }),
        U.el('div.df-ed-hint', null, [
          'Containers carrying the Docker label ',
          U.el('code', { text: 'docker.folders=' + (draft.id || 'f-<name>') }),
          ' also join, including ones created later.'
        ])
      ]);
    }

    function checkRule(host) {
      var box = U.clear(host);
      if (!draft.rule) return;

      var regex;
      try { regex = new RegExp(draft.rule, 'i'); }
      catch (e) {
        box.appendChild(U.el('div.df-ed-error', { text: 'That is not a valid pattern' }));
        return;
      }

      var extra = S.state.containers
        .map(function (c) { return c.name; })
        .filter(function (n) { return regex.test(n) && draft.members.indexOf(n) === -1; });

      if (!extra.length) return;

      box.appendChild(U.el('span.df-ed-chips-label', { text: 'Will also add:' }));
      extra.forEach(function (n) { box.appendChild(U.el('span.df-matchchip', { text: n })); });
    }

    function behaviourSection() {
      var delay = U.el('input.df-input.df-input-num', {
        type: 'number', min: '0', max: '300', value: String(draft.delay),
        'aria-label': 'Wait between container starts, in seconds',
        onInput: function (e) {
          draft.delay = Math.max(0, Math.min(300, parseInt(e.target.value, 10) || 0));
          drawPreview();
        }
      });

      return field('Behaviour', [
        U.el('div.df-ed-line', null, [
          U.el('label', { for: 'df-ed-delay', text: 'Wait between container starts' }),
          U.el('div.df-ed-line-end', null, [delay, U.el('span.df-ed-unit', { text: 'seconds' })])
        ]),

        toggleLine('Stop in reverse order', draft.reverseStop, function (on) {
          draft.reverseStop = on;
          if (refs.orderHint) {
            refs.orderHint.textContent = on ? 'top starts first, stops last' : 'top starts first';
          }
        }),

        toggleLine('Show folder on the Dashboard', draft.dashboard, function (on) { draft.dashboard = on; }),

        U.el('div.df-ed-line', null, [
          U.el('span', { text: 'When folded, show' }),
          segmented([['status', 'Icons + status'], ['icons', 'Icons only'], ['count', 'Count only']],
            draft.preview, function (value) { draft.preview = value; drawPreview(); })
        ])
      ]);
    }

    function toggleLine(label, value, onChange) {
      var state = value;
      var track = U.el('button.df-switch', {
        type: 'button',
        'data-state': state ? 'on' : 'off',
        'aria-pressed': String(state),
        'aria-label': label,
        onClick: function () {
          state = !state;
          track.dataset.state = state ? 'on' : 'off';
          track.setAttribute('aria-pressed', String(state));
          onChange(state);
        }
      }, [U.el('span.df-switch-knob', { 'aria-hidden': 'true' })]);

      return U.el('div.df-ed-line', null, [U.el('span', { text: label }), track]);
    }

    function segmented(options, value, onChange) {
      var group = U.el('div.df-segmented', { role: 'group' });
      options.forEach(function (pair) {
        var button = U.el('button.df-seg-btn', {
          type: 'button',
          'aria-pressed': String(value === pair[0]),
          onClick: function () {
            value = pair[0];
            Array.prototype.forEach.call(group.children, function (b) {
              b.setAttribute('aria-pressed', String(b.dataset.value === value));
            });
            onChange(value);
          }
        }, pair[1]);
        button.dataset.value = pair[0];
        group.appendChild(button);
      });
      return group;
    }

    /* ------------------------------------------------------------------
     * Assembly
     * ---------------------------------------------------------------- */
    function field(label, children, id, aside) {
      return U.el('div.df-ed-field', null, [
        U.el('div.df-ed-label-row', null, [
          U.el('label.df-ed-label', { for: id || null, text: label }),
          aside || null
        ]),
        U.el('div.df-ed-control', null, children)
      ]);
    }

    var body = U.el('div.df-dialog-body.df-ed-body', null, [
      preview,
      U.el('div.df-ed-cols', null, [
        U.el('div.df-ed-col', null, [nameField(), iconSection(), colorSection()]),
        U.el('div.df-ed-col', null, [membersSection(), orderSection(), ruleSection(), behaviourSection()])
      ])
    ]);

    var save = U.el('button.df-btn.df-btn-primary', {
      type: 'button',
      onClick: function () {
        if (!validateName()) { refs.name.focus(); return; }
        save.disabled = true;

        DF.api.saveFolder({
          id: draft.id,
          name: draft.name.trim(),
          color: draft.color,
          icon: draft.icon,
          members: draft.members,
          delay: draft.delay,
          reverseStop: draft.reverseStop,
          preview: draft.preview,
          rule: draft.rule,
          dashboard: draft.dashboard
        })
          .then(function () {
            entry.close();
            DF.jobs.toast('Folder “' + draft.name.trim() + '” ' + (creating ? 'created' : 'saved'));
            return DF.refresh();
          })
          .catch(function (err) {
            save.disabled = false;
            refs.nameError.textContent = err.message;
          });
      }
    }, creating ? 'Create folder' : 'Save folder');

    refs.save = save;

    var footer = U.el('div.df-dialog-foot', null, [
      creating ? U.el('span.df-foot-spacer') : U.el('button.df-btn.df-btn-danger-outline', {
        type: 'button',
        onClick: function () { entry.close(); DF.actions.confirmDelete(existing); }
      }, 'Delete folder'),
      creating ? null : U.el('span.df-foot-spacer'),
      U.el('button.df-btn', { type: 'button', onClick: function () { entry.close(); } }, 'Cancel'),
      save
    ]);

    drawPreview();

    entry = DF.dialog.open({
      title: creating ? 'New folder' : 'Edit folder',
      body: body,
      footer: footer,
      width: 'var(--df-editor-max)'
    });

    validateName();
    return entry;
  };
})(window);
