/* simple.folders - UI tests against the local harness.
 *
 * Walks DESIGN_SPEC.md 15's acceptance checklist with real clicks and real
 * keystrokes, and writes a screenshot per state into harness/test/shots.
 *
 *   ./harness/test/run.sh            everything
 *   ./harness/test/run.sh filter     only tests whose name contains "filter"
 *
 * Connects to a Chrome already listening on CDP (see run.sh), so no browser
 * is downloaded.
 *
 * NOT part of the plugin package. Never shipped.
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE  = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');
const BASE  = process.env.HARNESS_URL || 'http://localhost:8089';
const CDP   = process.env.CDP_URL || 'http://localhost:9222';
const ONLY  = process.argv[2] || '';

mkdirSync(SHOTS, { recursive: true });

const results = [];
let browser, page;

/* ------------------------------------------------------------------ */
const t = (name, fn) => ({ name, fn });

function ok(cond, detail) {
  if (!cond) throw new Error(detail || 'assertion failed');
}

async function shot(name) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/* Reset server state and reload with a clean per-viewer preference set. */
async function fresh(query = '') {
  await page.goto(`${BASE}/_reset`, { waitUntil: 'domcontentloaded' });
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto(`${BASE}/?nostream=1${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sf-card', { timeout: 10000 });
}

const count = (sel) => page.$$eval(sel, (n) => n.length);
const text  = (sel) => page.$eval(sel, (n) => n.textContent.trim()).catch(() => null);

/* ------------------------------------------------------------------
 * Tests
 * ---------------------------------------------------------------- */
const TESTS = [

  t('renders the table with the expected totals', async () => {
    await fresh();
    ok(await count('.sf-row-folder') === 3, 'expected 3 folder rows');
    ok(await count('.sf-row-ct') === 16, 'expected 16 container rows');
    const summary = await text('.sf-summary');
    ok(summary === '16 containers · 13 running · 3 folders · 4 updates ready',
       `summary was: ${summary}`);
    await shot('01-overview');
  }),

  t('folded folders show every member icon, uncapped', async () => {
    await fresh('&folded=all');
    ok(await count('.sf-row-ct') === 6, 'only the loose containers should be listed');
    /* Media has 5 members: all five icons, no "+N" overflow. */
    const strips = await page.$$eval('.sf-row-folder .sf-strip',
      (nodes) => nodes.map((n) => n.children.length));
    /* Folder order is the fixture order: Media(5), Smart home(3), AI(2). */
    ok(JSON.stringify(strips) === '[5,3,2]', `strip sizes were ${JSON.stringify(strips)}`);
    const plus = await page.$$eval('.sf-strip', (n) => n.map((s) => s.textContent).join(''));
    ok(!/\+\d/.test(plus), 'found a "+N" overflow marker');
    await shot('02-folded');
  }),

  t('the icon strip wraps instead of overlapping at the narrowest width', async () => {
    await page.setViewport({ width: 1100, height: 900 });
    await fresh('&folded=all');

    const media = await page.$('.sf-row-folder[data-folder="f-media"]');
    const box = await media.boundingBox();
    const strip = await (await media.$('.sf-strip')).boundingBox();
    const status = await (await media.$('.sf-folder-status')).boundingBox();

    ok(strip.x + strip.width <= status.x + 1,
       `the strip (ends ${strip.x + strip.width}) overlaps the status column (starts ${status.x})`);
    ok(box.height >= 64, 'the folder row should grow to fit the strip');
    await shot('03-narrow-1100');
    await page.setViewport({ width: 1440, height: 1000 });
  }),

  t('clicking a folded icon opens that container\'s menu', async () => {
    await fresh('&folded=all');
    await page.click('.sf-row-folder[data-folder="f-media"] .sf-strip-btn');
    await page.waitForSelector('.sf-menu', { timeout: 3000 });
    const head = await text('.sf-menu-head');
    ok(head === 'plex', `menu header was "${head}", expected the container name`);
    await shot('04-container-menu-from-strip');
  }),

  t('clicking the folder icon opens the folder menu', async () => {
    await fresh();
    await page.click('.sf-row-folder[data-folder="f-media"] .sf-folder-icon');
    await page.waitForSelector('.sf-menu', { timeout: 3000 });
    ok(await text('.sf-menu-head') === 'Media', 'menu header should be the folder name');

    const items = await page.$$eval('.sf-menu-item .sf-menu-label', (n) => n.map((x) => x.textContent));
    for (const want of ['Start all', 'Stop all', 'Restart all', 'Check for updates',
                        'Force update all', 'Edit folder…', 'Delete folder']) {
      ok(items.includes(want), `folder menu is missing "${want}"`);
    }
    await shot('05-folder-menu');
  }),

  t('Escape closes the menu and returns focus to its trigger', async () => {
    await fresh();
    await page.click('.sf-row-folder[data-folder="f-media"] .sf-folder-icon');
    await page.waitForSelector('.sf-menu');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.sf-menu'), { timeout: 3000 });
    const focused = await page.evaluate(() => document.activeElement.className);
    ok(focused.includes('sf-folder-icon'), `focus went to "${focused}"`);
  }),

  t('unfolding shows member rows with start-order numbers', async () => {
    await fresh('&folded=all');
    await page.click('.sf-row-folder[data-folder="f-media"] .sf-chevron');
    await page.waitForFunction(() => document.querySelectorAll('.sf-row-ct').length === 11,
                               { timeout: 3000 });
    const orders = await page.$$eval('.sf-row-ct.is-nested .sf-order', (n) => n.map((x) => x.textContent));
    ok(JSON.stringify(orders) === '["1","2","3","4","5"]', `order numbers were ${JSON.stringify(orders)}`);
    await shot('06-unfolded');
  }),

  t('the filter matches folders and containers (spec 10)', async () => {
    await fresh('&folded=all');
    await page.type('.sf-filter-input', 'sonarr');
    await page.waitForFunction(
      () => document.querySelectorAll('.sf-row-folder').length === 1, { timeout: 3000 });

    /* The folder name does not match, so only the matching member shows -
     * and while filtering every visible folder is unfolded. */
    ok(await count('.sf-row-ct') === 1, 'expected exactly the matching container');
    ok(await text('.sf-row-ct .sf-ct-name') === 'sonarr', 'wrong container shown');

    await page.$eval('.sf-filter-input', (n) => { n.value = ''; });
    await page.type('.sf-filter-input', 'zzzz');
    await page.waitForSelector('.sf-notice', { timeout: 3000 });
    ok((await text('.sf-notice')).includes('Nothing matches'), 'missing the empty-result notice');
    await shot('07-filter');
  }),

  t('Classic view restores Unraid\'s own table', async () => {
    await fresh();
    ok(await page.$eval('#docker_containers', (n) => getComputedStyle(n).display) === 'none',
       'the native table should start hidden');

    await page.click('.sf-classic input');
    await page.waitForFunction(
      () => getComputedStyle(document.querySelector('#docker_containers')).display !== 'none',
      { timeout: 3000 });

    ok(await count('.sf-card') === 0, 'our table should be gone in classic view');
    ok(await count('#docker_list tr') === 16, 'the native table should still be populated');
    await shot('08-classic');
  }),

  t('deleting a folder asks first and never touches containers', async () => {
    await fresh();
    const before = await count('.sf-row-ct');

    await page.click('.sf-row-folder[data-folder="f-ai"] .sf-folder-icon');
    await page.waitForSelector('.sf-menu');
    await clickMenuItem('Delete folder');

    await page.waitForSelector('.sf-dialog', { timeout: 3000 });
    const body = await text('.sf-dialog-text');
    ok(body.includes('keep running'), `confirmation body was: ${body}`);
    await shot('09-delete-confirm');

    await clickButton('.sf-dialog-foot', 'Delete folder');
    await page.waitForFunction(
      () => document.querySelectorAll('.sf-row-folder').length === 2, { timeout: 5000 });

    ok(await count('.sf-row-ct') === before, 'container count changed - containers were touched');
    const loose = await page.$$eval('.sf-section-text', (n) => n.map((x) => x.textContent));
    ok(loose.includes('Not in a folder'), 'the orphaned containers should move to "Not in a folder"');
  }),

  t('force update warns and lists each member', async () => {
    await fresh();
    await page.click('.sf-row-folder[data-folder="f-media"] .sf-folder-icon');
    await page.waitForSelector('.sf-menu');
    await clickMenuItem('Force update all');

    await page.waitForSelector('.sf-dialog', { timeout: 3000 });
    const title = await text('.sf-dialog-title');
    ok(title.includes('Force update 5 containers'), `title was: ${title}`);

    const notes = await page.$$eval('.sf-confirm-note', (n) => n.map((x) => x.textContent));
    ok(notes.filter((x) => x === 'update ready').length === 2, 'expected 2 members with updates');
    ok(notes.filter((x) => x === 'already up to date').length === 3, 'expected 3 up-to-date members');
    await shot('10-force-update-confirm');
    await page.keyboard.press('Escape');
  }),

  t('the folder editor opens with a live preview and validates the name', async () => {
    await fresh();
    await clickButton('.sf-head-actions', '+ New folder');
    await page.waitForSelector('.sf-dialog', { timeout: 3000 });

    ok(await text('.sf-dialog-title') === 'New folder', 'wrong dialog title');
    ok(await text('.sf-ed-preview-row .sf-folder-name') === 'Untitled folder',
       'preview should show a placeholder name');

    /* Empty name is refused. */
    ok(await page.$eval('.sf-dialog-foot .sf-btn-primary', (n) => n.disabled),
       'Create should be disabled with an empty name');

    /* A duplicate is reported, not silently accepted. */
    await page.type('#sf-ed-name', 'Media');
    await page.waitForFunction(
      () => document.querySelector('#sf-ed-name-error').textContent.includes('already uses'),
      { timeout: 3000 });

    await page.$eval('#sf-ed-name', (n) => { n.value = ''; });
    await page.type('#sf-ed-name', 'Cloud');
    await page.waitForFunction(
      () => document.querySelector('#sf-ed-name-error').textContent === '', { timeout: 3000 });

    /* Picking members updates the preview and the start order. */
    await tickMembers(['nextcloud', 'mariadb', 'redis']);
    await page.waitForFunction(
      () => document.querySelectorAll('.sf-order-row').length === 3, { timeout: 3000 });
    await shot('11-editor');
  }),

  t('a container moves between folders, and only one folder holds it', async () => {
    await fresh();
    await clickButton('.sf-head-actions', '+ New folder');
    await page.waitForSelector('.sf-dialog');
    await page.type('#sf-ed-name', 'Cloud');

    /* sonarr is in Media; ticking it here must show that it will move. */
    await tickMembers(['sonarr']);
    await page.waitForFunction(() => {
      const row = [...document.querySelectorAll('.sf-ct-opt')]
        .find((r) => r.querySelector('.sf-ct-opt-name').textContent === 'sonarr');
      return row && /moves from Media/.test(row.textContent);
    }, { timeout: 3000 });

    await clickButton('.sf-dialog-foot', 'Create folder');
    await page.waitForFunction(
      () => document.querySelectorAll('.sf-row-folder').length === 4, { timeout: 5000 });

    const owners = await page.evaluate(async () => {
      const r = await fetch('/plugins/simple.folders/include/Data.php');
      const d = await r.json();
      return d.folders.filter((f) => f.resolved.includes('sonarr')).map((f) => f.name);
    });
    ok(JSON.stringify(owners) === '["Cloud"]', `sonarr is in ${JSON.stringify(owners)}`);
    await shot('12-after-create');
  }),

  t('bulk stop runs sequentially in reverse order with a progress panel', async () => {
    await fresh();
    await page.click('.sf-row-folder[data-folder="f-ai"] .sf-folder-icon');
    await page.waitForSelector('.sf-menu');
    await clickMenuItem('Stop all');

    await page.waitForSelector('.sf-panel', { timeout: 3000 });
    ok((await text('.sf-panel-title')) === 'Stopping AI', 'wrong panel title');

    /* reverseStop is on for this folder, so open-webui stops before ollama. */
    const order = await page.$$eval('.sf-panel-name', (n) => n.map((x) => x.textContent));
    ok(JSON.stringify(order) === '["ollama","open-webui"]',
       `panel listed ${JSON.stringify(order)}`);
    await shot('13-progress');

    await page.waitForFunction(
      () => document.querySelector('.sf-panel-foot') !== null, { timeout: 30000 });
    const summary = await text('.sf-panel-foot span');
    ok(summary.includes('stopped'), `summary was: ${summary}`);

    const states = await page.evaluate(async () => {
      const r = await fetch('/plugins/simple.folders/include/Data.php');
      const d = await r.json();
      return d.containers.filter((c) => ['ollama', 'open-webui'].includes(c.name)).map((c) => c.state);
    });
    ok(states.every((s) => s === 'stopped'), `states after stop: ${states}`);
  }),

  t('a second job is refused while one is running', async () => {
    await fresh();
    await page.click('.sf-row-folder[data-folder="f-media"] .sf-folder-icon');
    await page.waitForSelector('.sf-menu');
    await clickMenuItem('Stop all');
    await page.waitForSelector('.sf-panel', { timeout: 3000 });

    /* Every docker action is disabled while a job runs (spec 6).
     * Click through evaluate: the table re-renders as containers report busy,
     * so a handle resolved a moment ago may already be detached. */
    await page.evaluate(() =>
      document.querySelector('.sf-row-folder[data-folder="f-home"] .sf-folder-icon').click());
    await page.waitForSelector('.sf-menu', { timeout: 3000 });
    const disabled = await page.$eval('.sf-menu-item', (n) => n.disabled);
    ok(disabled, 'folder menu actions should be disabled while a job runs');
    await page.keyboard.press('Escape');
  }),

  /* The harness loads Unraid's own element styling (see
   * harness/mock/webGui/styles/unraid-base-excerpt.css). Its "button" rule
   * repaints every control - uppercase, letter-spacing, min-width 86px, an
   * orange border - and on a real server it did exactly that. The cure is
   * Unraid's .unapi opt-out; this test fails if that ever comes off. */
  t('Unraid\'s element styling does not leak into the plugin', async () => {
    await fresh('&folded=all');

    const host = await page.$eval('#sf-root', (n) => n.className);
    ok(/\bunapi\b/.test(host), `#sf-root must carry "unapi", had "${host}"`);

    const probe = (sel) => page.$eval(sel, (n) => {
      const s = getComputedStyle(n);
      return {
        transform: s.textTransform,
        minWidth: s.minWidth,
        spacing: s.letterSpacing,
        borderTop: s.borderTopWidth,
        marginRight: s.marginRight
      };
    });

    for (const sel of ['.sf-kebab', '.sf-chevron', '.sf-switch', '.sf-strip-btn']) {
      const got = await probe(sel);
      ok(got.transform === 'none', `${sel} is ${got.transform}, Unraid's uppercase leaked in`);
      ok(got.minWidth !== '86px', `${sel} picked up Unraid's min-width:86px`);
      ok(got.spacing === 'normal', `${sel} picked up Unraid's letter-spacing`);
      ok(got.borderTop === '0px', `${sel} picked up Unraid's button border (${got.borderTop})`);
    }

    /* Our own buttons must keep the styling we gave them. */
    const primary = await page.$eval('.sf-btn-primary', (n) => {
      const s = getComputedStyle(n);
      return { bg: s.backgroundColor, border: s.borderTopWidth, transform: s.textTransform };
    });
    ok(primary.border === '1px', `the primary button lost its border (${primary.border})`);
    ok(primary.transform === 'none', 'the primary button got uppercased');
    ok(primary.bg !== 'rgba(0, 0, 0, 0)', 'the primary button lost its background');

    /* And the menu, which lives outside #sf-root in the overlay layer. */
    await page.click('.sf-row-folder[data-folder="f-media"] .sf-folder-icon');
    await page.waitForSelector('.sf-menu');
    const item = await page.$eval('.sf-menu-item', (n) => {
      const s = getComputedStyle(n);
      return { transform: s.textTransform, minWidth: s.minWidth, border: s.borderTopWidth };
    });
    ok(item.transform === 'none', 'menu items got uppercased by Unraid');
    ok(item.minWidth !== '86px', 'menu items picked up Unraid min-width');
    ok(item.border === '0px', `menu items picked up Unraid's border (${item.border})`);
    await page.keyboard.press('Escape');
    await shot('14-no-style-leak');
  }),

  t('the page shows a single heading, not three', async () => {
    await fresh();
    /* Unraid prints "Docker Containers" above; the plugin must not add its
     * own "Simple Folders" section bar or repeat "Containers". */
    ok(await count('.sf-eyebrow') === 0, 'the UNRAID-DOCKER eyebrow should be gone');
    ok(await count('.sf-title') === 0, 'the duplicate "Containers" heading should be gone');
    ok(await count('.sf-summary') === 1, 'the summary line should remain');
    const summary = await text('.sf-summary');
    ok(/containers/.test(summary), `summary was: ${summary}`);
  }),

  /* The live CPU/memory stream republishes about once a second. It used to
   * trigger a full redraw, which reset the card's horizontal scroll - on a
   * phone the table snapped back to the left every second. */
  t('a live stats update does not reset the horizontal scroll', async () => {
    await page.setViewport({ width: 420, height: 820, isMobile: true });
    /* Note: no nostream here - the live channel has to be running. */
    await page.goto(`${BASE}/_reset`, { waitUntil: 'domcontentloaded' });
    await page.goto(`${BASE}/?folded=all`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sf-card');

    await page.$eval('.sf-card', (n) => { n.scrollLeft = 400; });
    const before = await page.$eval('.sf-card', (n) => n.scrollLeft);
    ok(before > 0, 'could not scroll the card sideways to begin with');

    /* Count table rebuilds. Scroll position alone is not enough of a test:
     * app.js also restores scrollLeft around a redraw, so the symptom is
     * masked even when the table IS being thrown away every second. What
     * must be true is that a live tick does not rebuild the table at all. */
    await page.evaluate(() => {
      window.__rebuilds = 0;
      const root = document.getElementById('sf-root');
      new MutationObserver((records) => {
        for (const r of records) {
          for (const node of r.removedNodes) {
            if (node.nodeType === 1 && node.classList.contains('sf-card')) window.__rebuilds++;
          }
        }
      }).observe(root, { childList: true });
    });

    /* Long enough for several dockerload ticks and one data poll. */
    await new Promise((r) => setTimeout(r, 6500));

    const rebuilds = await page.evaluate(() => window.__rebuilds);
    /* ~6 live ticks happen in that window. Only the 5s data poll may redraw,
     * so anything above a couple means live updates are redrawing again. */
    ok(rebuilds <= 2, `the table was rebuilt ${rebuilds} times in 6.5s`);

    const after = await page.$eval('.sf-card', (n) => n.scrollLeft);
    ok(after === before, `scroll moved from ${before} to ${after}`);

    /* And the live figures must actually still be arriving. */
    const cpu = await page.$$eval('.sf-cell-cpu', (n) => n.map((x) => x.textContent));
    ok(cpu.some((v) => v !== '\u2014'), 'no live CPU values arrived at all');

    await page.setViewport({ width: 1440, height: 1000, isMobile: false });
  }),

  t('typing in the filter survives a background refresh', async () => {
    await fresh();
    await page.focus('.sf-filter-input');
    await page.type('.sf-filter-input', 'son');
    await new Promise((r) => setTimeout(r, 5600));   // past one poll
    const focused = await page.evaluate(() =>
      document.activeElement && document.activeElement.className);
    ok(/sf-filter-input/.test(focused || ''), `focus moved to "${focused}"`);
    ok(await page.$eval('.sf-filter-input', (n) => n.value) === 'son', 'the typed text was lost');
  }),

  t('the table reaches both screen edges on a phone', async () => {
    await page.setViewport({ width: 420, height: 820, isMobile: true });
    await fresh('&folded=all');

    const box = await page.$eval('.sf-card', (n) => {
      const r = n.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width };
    });
    ok(Math.abs(box.left) <= 1, `card starts ${box.left}px from the left edge`);
    ok(Math.abs(box.right - 420) <= 1, `card ends at ${box.right}px, viewport is 420px`);

    /* The table itself stays wide and scrollable - that is the design. */
    const scrollable = await page.$eval('.sf-card', (n) => n.scrollWidth > n.clientWidth);
    ok(scrollable, 'the card should scroll horizontally on a phone');

    /* ...and the page itself must not scroll sideways. */
    const bodyOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(bodyOverflow <= 1, `the page itself scrolls sideways by ${bodyOverflow}px`);

    await shot('15-mobile');
    await page.setViewport({ width: 1440, height: 1000, isMobile: false });
  }),

  t('the action bar carries every classic Docker action', async () => {
    await fresh();
    ok(await count('.sf-tip') === 0, 'the old tip line should be gone');
    ok(await count('.sf-actionbar') === 1, 'the action bar should be present');

    ok((await text('.sf-grouplbl')) === 'All containers',
       'the lifecycle group must state its scope');

    const labels = await page.$$eval('.sf-actionbar button',
      (n) => n.map((b) => (b.textContent || b.getAttribute('aria-label') || '').trim()));

    for (const want of ['Add container', 'Start', 'Stop', 'Pause', 'Resume', 'Check']) {
      ok(labels.some((l) => l === want), `action bar is missing "${want}" (had ${JSON.stringify(labels)})`);
    }
    ok(labels.some((l) => /^Update/.test(l)), 'action bar is missing Update');

    /* Container size is the one classic action kept in the overflow. */
    await page.click('.sf-actionbar .sf-act');
    await page.waitForSelector('.sf-menu', { timeout: 3000 });
    const items = await page.$$eval('.sf-menu-item .sf-menu-label', (n) => n.map((x) => x.textContent));
    ok(items.some((i) => /Container size/.test(i)), `overflow was ${JSON.stringify(items)}`);
    await page.keyboard.press('Escape');

    await shot('16-action-bar');
  }),

  t('Add container uses Unraid\'s brand orange', async () => {
    await fresh();
    const style = await page.$eval('.sf-chip-brand', (n) => {
      const s = getComputedStyle(n);
      return { bg: s.backgroundColor, color: s.color };
    });
    /* #ff8c2f - --orange-500 in the webGUI palette. */
    ok(style.bg === 'rgb(255, 140, 47)', `background was ${style.bg}`);
    /* Near-black, not white: white on this orange is 2.32:1. */
    ok(style.color !== 'rgb(255, 255, 255)', 'the label must not be white on orange');
  }),

  t('Stop all and Pause all confirm before acting', async () => {
    await fresh();
    const before = await page.evaluate(async () => {
      const d = await (await fetch('/plugins/simple.folders/include/Data.php')).json();
      return d.stats.running;
    });

    await clickButton('.sf-seggroup', 'Stop');
    await page.waitForSelector('.sf-dialog', { timeout: 3000 });
    const title = await text('.sf-dialog-title');
    ok(/every container/i.test(title), `confirmation title was: ${title}`);

    /* Cancelling must change nothing. */
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.sf-dialog'), { timeout: 3000 });
    const after = await page.evaluate(async () => {
      const d = await (await fetch('/plugins/simple.folders/include/Data.php')).json();
      return d.stats.running;
    });
    ok(after === before, `cancelling stopped containers anyway (${before} -> ${after})`);
    await shot('17-stop-all-confirm');
  }),

  t('a global stop runs in reverse boot order', async () => {
    await fresh();
    await clickButton('.sf-seggroup', 'Stop');
    await page.waitForSelector('.sf-dialog');
    await page.evaluate(() => {
      [...document.querySelectorAll('.sf-dialog-foot button')]
        .find((b) => /^Stop all/.test(b.textContent.trim())).click();
    });

    await page.waitForSelector('.sf-panel', { timeout: 3000 });
    const listed = await page.$$eval('.sf-panel-name', (n) => n.map((x) => x.textContent));
    ok(listed.length > 1, 'expected several containers in the job');

    await page.waitForFunction(() => document.querySelector('.sf-panel-foot') !== null,
                               { timeout: 60000 });
    const running = await page.evaluate(async () => {
      const d = await (await fetch('/plugins/simple.folders/include/Data.php')).json();
      return d.stats.running;
    });
    ok(running === 0, `${running} containers still running after Stop all`);
  }),

  /* The first version guessed "<name>.svg" on both CDNs and rendered an
   * <img> without checking it existed: a name neither library carries gave
   * a row of broken images, and a name they did carry still only offered
   * three. The search now queries each catalogue's published index. */
  t('icon search returns real matches, never broken images', async () => {
    await fresh();
    await clickButton('.sf-head-actions', '+ New folder');
    await page.waitForSelector('.sf-dialog');

    await page.$$eval('.sf-tab', (tabs) =>
      tabs.find((t) => t.textContent.trim() === 'From the web').click());
    await page.waitForSelector('.sf-icon-results', { timeout: 3000 });

    /* A term both libraries carry: many results, exact match first. */
    const search = '.sf-ed-icon-panel input[type="search"]';
    await page.$eval(search, (n) => { n.value = ''; });
    await page.type(search, 'plex');
    await page.waitForFunction(
      () => document.querySelectorAll('.sf-icon-card').length > 4, { timeout: 6000 });

    const cards = await page.$$eval('.sf-icon-card .sf-icon-card-file', (n) => n.map((x) => x.textContent));
    ok(cards.length > 4, `only ${cards.length} results for "plex"`);
    ok(cards[0] === 'plex.svg', `first result was ${cards[0]}, expected the exact match`);

    /* Every preview must actually load - no broken images. */
    const broken = await page.$$eval('.sf-icon-card img',
      (imgs) => imgs.filter((i) => i.complete && i.naturalWidth === 0).length);
    ok(broken === 0, `${broken} preview images failed to load`);

    /* A term neither library carries: say so, and offer the monogram. */
    await page.$eval(search, (n) => { n.value = ''; });
    await page.type(search, 'cobra');
    await page.waitForFunction(
      () => /No icon named/.test(document.querySelector('.sf-icon-results').textContent),
      { timeout: 6000 });

    const after = await page.$$eval('.sf-icon-card .sf-icon-card-name', (n) => n.map((x) => x.textContent));
    ok(JSON.stringify(after) === '["Generated"]',
       `expected only the monogram, got ${JSON.stringify(after)}`);
    const stillBroken = await page.$$eval('.sf-icon-card img',
      (imgs) => imgs.filter((i) => i.complete && i.naturalWidth === 0).length);
    ok(stillBroken === 0, 'a broken image was rendered for a term with no matches');

    await shot('18-icon-search');
    await page.keyboard.press('Escape');
  }),

  /* 100vh is the viewport without the browser's retractable chrome, so on a
   * browser with the URL bar at the bottom the dialog's footer buttons end
   * up behind it. */
  t('dialog buttons stay on screen when the viewport is short', async () => {
    await page.setViewport({ width: 420, height: 600, isMobile: true });
    await fresh();
    await clickButton('.sf-head-actions', '+ New folder');
    await page.waitForSelector('.sf-dialog');

    const fit = await page.evaluate(() => {
      const foot = document.querySelector('.sf-dialog-foot');
      const r = foot.getBoundingClientRect();
      return { bottom: r.bottom, viewport: window.innerHeight, visible: r.height > 0 };
    });
    ok(fit.visible, 'the dialog footer has no height');
    ok(fit.bottom <= fit.viewport + 1,
       `footer runs ${Math.round(fit.bottom - fit.viewport)}px past the bottom of the viewport`);

    /* Confirm the rule is actually dvh, not just vh that happens to match. */
    const usesDvh = await page.evaluate(() => {
      const css = [...document.styleSheets]
        .filter((s) => (s.href || '').includes('simple.folders'))
        .flatMap((s) => { try { return [...s.cssRules]; } catch (e) { return []; } })
        .map((r) => r.cssText).join('');
      return /dvh/.test(css);
    });
    ok(usesDvh, 'no dvh units found - the fix is not in the stylesheets');

    await shot('19-short-viewport');
    await page.keyboard.press('Escape');
    await page.setViewport({ width: 1440, height: 1000, isMobile: false });
  }),

  /* The plugin was called docker.folders before the rename. Container
   * templates carrying the old label must keep working, or renaming the
   * plugin silently empties people's folders. */
  t('the pre-rename docker.folders label still assigns a container', async () => {
    await page.goto(`${BASE}/_reset`, { waitUntil: 'domcontentloaded' });

    for (const [key, value] of [['docker.folders', 'f-ai'], ['simple.folders', '']]) {
      await page.goto(
        `${BASE}/_label?container=immich&key=${encodeURIComponent(key)}&value=${encodeURIComponent(value)}`,
        { waitUntil: 'domcontentloaded' });
    }

    const owner = await page.evaluate(async () => {
      const d = await (await fetch('/plugins/simple.folders/include/Data.php')).json();
      const f = d.folders.find((x) => x.resolved.includes('immich'));
      return f ? f.name : null;
    });
    ok(owner === 'AI', `immich landed in ${owner}, expected AI via the legacy label`);

    /* And the current label works the same way. */
    await page.goto(`${BASE}/_reset`, { waitUntil: 'domcontentloaded' });
    await page.goto(`${BASE}/_label?container=immich&key=simple.folders&value=f-media`,
                    { waitUntil: 'domcontentloaded' });
    const owner2 = await page.evaluate(async () => {
      const d = await (await fetch('/plugins/simple.folders/include/Data.php')).json();
      const f = d.folders.find((x) => x.resolved.includes('immich'));
      return f ? f.name : null;
    });
    ok(owner2 === 'Media', `immich landed in ${owner2}, expected Media`);
  }),

  t('dragging a container onto a folder row moves it there', async () => {
    await fresh('&folded=all');

    const before = await foldersNow();
    ok(before.find((f) => f.id === 'f-ai').members.length === 2, 'AI should start with 2');

    /* immich is loose; drop it on the AI folder row. */
    await dragGrip('.sf-row-ct[data-container="immich"]', '.sf-row-folder[data-folder="f-ai"]');
    await page.waitForFunction(() => !document.querySelector('.sf-drag-ghost'), { timeout: 3000 });

    await page.waitForFunction(async () => {
      const d = await (await fetch('/plugins/simple.folders/include/Data.php')).json();
      return d.folders.find((f) => f.id === 'f-ai').resolved.includes('immich');
    }, { timeout: 5000 });

    const after = await foldersNow();
    ok(after.find((f) => f.id === 'f-ai').members.includes('immich'), 'immich did not join AI');
    await shot('20-drag-into-folder');
  }),

  t('dragging a member out drops it back to "Not in a folder"', async () => {
    await fresh();   // expanded, so member rows are on screen

    await dragGrip('.sf-row-ct[data-container="ollama"]', '.sf-section');
    await page.waitForFunction(() => !document.querySelector('.sf-drag-ghost'), { timeout: 3000 });

    await page.waitForFunction(async () => {
      const d = await (await fetch('/plugins/simple.folders/include/Data.php')).json();
      return d.loose.includes('ollama');
    }, { timeout: 5000 });

    const after = await foldersNow();
    ok(!after.find((f) => f.id === 'f-ai').members.includes('ollama'), 'ollama is still in AI');
  }),

  t('dragging a member within its folder changes the start order', async () => {
    await fresh();

    const before = await foldersNow();
    const media = before.find((f) => f.id === 'f-media').members;
    ok(media[0] === 'plex', `expected plex first, got ${media[0]}`);

    /* Drag plex down past radarr, the last member. */
    await dragGrip('.sf-row-ct[data-container="plex"]',
                   '.sf-row-ct[data-container="radarr"]', 'bottom');
    await page.waitForFunction(() => !document.querySelector('.sf-drag-ghost'), { timeout: 3000 });

    await page.waitForFunction(async () => {
      const d = await (await fetch('/plugins/simple.folders/include/Data.php')).json();
      return d.folders.find((f) => f.id === 'f-media').resolved[0] !== 'plex';
    }, { timeout: 5000 });

    const after = (await foldersNow()).find((f) => f.id === 'f-media').members;
    ok(after.length === 5, `lost a member: ${JSON.stringify(after)}`);
    ok(after[after.length - 1] === 'plex', `plex should now be last, order is ${JSON.stringify(after)}`);
  }),

  t('dragging a folder reorders the folders', async () => {
    await fresh('&folded=all');

    const before = (await foldersNow()).map((f) => f.id);
    ok(before[0] === 'f-media', `expected Media first, got ${before[0]}`);

    /* Drag Media below AI, the last folder. */
    await dragGrip('.sf-row-folder[data-folder="f-media"]',
                   '.sf-row-folder[data-folder="f-ai"]', 'bottom');
    await page.waitForFunction(() => !document.querySelector('.sf-drag-ghost'), { timeout: 3000 });

    await page.waitForFunction(async () => {
      const d = await (await fetch('/plugins/simple.folders/include/Data.php')).json();
      return d.folders[0].id !== 'f-media';
    }, { timeout: 5000 });

    const after = (await foldersNow()).map((f) => f.id);
    ok(after.length === 3, `lost a folder: ${JSON.stringify(after)}`);
    ok(after[after.length - 1] === 'f-media', `Media should be last, order is ${JSON.stringify(after)}`);
  }),

  t('the stock Docker table is hidden before it can be seen', async () => {
    await page.goto(`${BASE}/_reset`, { waitUntil: 'domcontentloaded' });
    await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });

    /* Check at the earliest moment scripts can observe: the stock table must
     * already be hidden, before our first render - which is a fetch away. */
    await page.goto(`${BASE}/?nostream=1`, { waitUntil: 'domcontentloaded' });
    const early = await page.evaluate(() => ({
      taken: document.documentElement.classList.contains('sf-takeover'),
      display: getComputedStyle(document.querySelector('#docker_containers')).display,
      rendered: !!document.querySelector('.sf-card')
    }));
    ok(early.taken, 'html.sf-takeover was not set during parsing');
    ok(early.display === 'none', `the stock table was ${early.display} before our render`);

    await page.waitForSelector('.sf-card');

    /* And with Classic view on, it must NOT be hidden at any point.
     *
     * The flag has to be written from an init script, not with a plain
     * evaluate(): fresh() registers a localStorage.clear() via
     * evaluateOnNewDocument, those handlers persist for the rest of the
     * session and run on every navigation, so anything written beforehand
     * is wiped before the page's inline script can read it. Init scripts
     * run in registration order, so this one lands after the clears. */
    await page.evaluateOnNewDocument(() => {
      try { localStorage.setItem('simple.folders:classic', 'true'); } catch (e) {}
    });
    await page.goto(`${BASE}/?nostream=1`, { waitUntil: 'domcontentloaded' });
    const classic = await page.evaluate(() =>
      document.documentElement.classList.contains('sf-takeover'));
    ok(!classic, 'Classic view still hid the stock table on load');

    /* Leave the session clean for the tests that follow. */
    await page.evaluateOnNewDocument(() => {
      try { localStorage.removeItem('simple.folders:classic'); } catch (e) {}
    });
  }),

  t('every control is reachable by keyboard', async () => {
    await fresh('&folded=all');
    const reached = await page.evaluate(() => {
      const sel = 'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), [tabindex="0"]';
      return [...document.querySelector('#sf-root').querySelectorAll(sel)].length;
    });
    ok(reached > 20, `only ${reached} focusable controls found`);

    /* The chevron carries the expanded state, not a div with a click handler. */
    const aria = await page.$eval('.sf-chevron', (n) => n.getAttribute('aria-expanded'));
    ok(aria === 'false', `chevron aria-expanded was "${aria}"`);

    /* The folder switch uses aria-pressed="mixed" when members differ. */
    const mixed = await page.$eval('.sf-row-folder[data-folder="f-media"] .sf-switch',
      (n) => n.getAttribute('aria-pressed'));
    ok(mixed === 'mixed', `folder switch aria-pressed was "${mixed}"`);
  })
];

/* ------------------------------------------------------------------ */
async function clickMenuItem(label) {
  const clicked = await page.evaluate((want) => {
    const item = [...document.querySelectorAll('.sf-menu-item')]
      .find((b) => b.querySelector('.sf-menu-label').textContent === want);
    if (!item || item.disabled) return false;
    item.click();
    return true;
  }, label);
  if (!clicked) throw new Error(`menu item "${label}" not found or disabled`);
}

/* Tick one checklist row at a time, re-querying between clicks. */
async function tickMembers(names) {
  for (const name of names) {
    const found = await page.evaluate((want) => {
      const row = [...document.querySelectorAll('.sf-ct-opt')]
        .find((r) => r.querySelector('.sf-ct-opt-name').textContent === want);
      if (!row) return false;
      row.querySelector('input').click();
      return true;
    }, name);
    if (!found) throw new Error(`container "${name}" not in the checklist`);
  }
}

/* Drive a real pointer drag from one element's grip to a point on another
 * row. CDP's mouse API dispatches genuine pointer events, so this exercises
 * the same path a person does - not a synthetic shortcut. */
async function dragGrip(fromSelector, toSelector, where = 'middle') {
  const grip = await page.$(`${fromSelector} .sf-grip`);
  if (!grip) throw new Error(`no grip on ${fromSelector}`);
  const g = await grip.boundingBox();

  const target = await page.$(toSelector);
  if (!target) throw new Error(`no drop target ${toSelector}`);
  const t = await target.boundingBox();
  const y = where === 'top' ? t.y + 2 : where === 'bottom' ? t.y + t.height - 2 : t.y + t.height / 2;

  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  /* Several steps: one jump would skip the movement threshold. */
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 + 10, { steps: 4 });
  await page.mouse.move(t.x + 120, y, { steps: 12 });
  await page.mouse.up();
}

const foldersNow = () => page.evaluate(async () => {
  const d = await (await fetch('/plugins/simple.folders/include/Data.php')).json();
  return d.folders.map((f) => ({ id: f.id, name: f.name, members: f.resolved }));
});

async function clickButton(scope, label) {
  const clicked = await page.evaluate((s, want) => {
    const btn = [...document.querySelectorAll(`${s} button`)]
      .find((b) => b.textContent.trim() === want);
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  }, scope, label);
  if (!clicked) throw new Error(`button "${label}" not found or disabled in ${scope}`);
}

/* ------------------------------------------------------------------ */
browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: { width: 1440, height: 1000 } });
page = await browser.newPage();

page.on('pageerror', (err) => results.push({ name: 'PAGE ERROR', error: err.message }));
page.on('console', (msg) => {
  if (msg.type() === 'error') results.push({ name: 'CONSOLE ERROR', error: msg.text() });
});

for (const test of TESTS) {
  if (ONLY && !test.name.includes(ONLY)) continue;
  try {
    await test.fn();
    results.push({ name: test.name, pass: true });
    console.log(`  ok   ${test.name}`);
  } catch (err) {
    results.push({ name: test.name, pass: false, error: err.message });
    console.log(`  FAIL ${test.name}\n       ${err.message}`);
    try { await shot(`fail-${test.name.slice(0, 40).replace(/\W+/g, '-')}`); } catch (e) {}
  }
}

await page.close();
await browser.disconnect();

const failed = results.filter((r) => r.pass === false || r.error);
writeFileSync(join(SHOTS, 'results.json'), JSON.stringify(results, null, 2));

console.log(`\n${results.filter((r) => r.pass).length} passed, ${failed.length} failed`);
if (failed.length) {
  for (const f of failed) console.log(`  - ${f.name}: ${f.error}`);
  process.exit(1);
}
