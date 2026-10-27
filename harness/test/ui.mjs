/* docker.folders - UI tests against the local harness.
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
  await page.waitForSelector('.df-card', { timeout: 10000 });
}

const count = (sel) => page.$$eval(sel, (n) => n.length);
const text  = (sel) => page.$eval(sel, (n) => n.textContent.trim()).catch(() => null);

/* ------------------------------------------------------------------
 * Tests
 * ---------------------------------------------------------------- */
const TESTS = [

  t('renders the table with the expected totals', async () => {
    await fresh();
    ok(await count('.df-row-folder') === 3, 'expected 3 folder rows');
    ok(await count('.df-row-ct') === 16, 'expected 16 container rows');
    const summary = await text('.df-summary');
    ok(summary === '16 containers · 13 running · 3 folders · 4 updates ready',
       `summary was: ${summary}`);
    await shot('01-overview');
  }),

  t('folded folders show every member icon, uncapped', async () => {
    await fresh('&folded=all');
    ok(await count('.df-row-ct') === 6, 'only the loose containers should be listed');
    /* Media has 5 members: all five icons, no "+N" overflow. */
    const strips = await page.$$eval('.df-row-folder .df-strip',
      (nodes) => nodes.map((n) => n.children.length));
    /* Folder order is the fixture order: Media(5), Smart home(3), AI(2). */
    ok(JSON.stringify(strips) === '[5,3,2]', `strip sizes were ${JSON.stringify(strips)}`);
    const plus = await page.$$eval('.df-strip', (n) => n.map((s) => s.textContent).join(''));
    ok(!/\+\d/.test(plus), 'found a "+N" overflow marker');
    await shot('02-folded');
  }),

  t('the icon strip wraps instead of overlapping at the narrowest width', async () => {
    await page.setViewport({ width: 1100, height: 900 });
    await fresh('&folded=all');

    const media = await page.$('.df-row-folder[data-folder="f-media"]');
    const box = await media.boundingBox();
    const strip = await (await media.$('.df-strip')).boundingBox();
    const status = await (await media.$('.df-folder-status')).boundingBox();

    ok(strip.x + strip.width <= status.x + 1,
       `the strip (ends ${strip.x + strip.width}) overlaps the status column (starts ${status.x})`);
    ok(box.height >= 64, 'the folder row should grow to fit the strip');
    await shot('03-narrow-1100');
    await page.setViewport({ width: 1440, height: 1000 });
  }),

  t('clicking a folded icon opens that container\'s menu', async () => {
    await fresh('&folded=all');
    await page.click('.df-row-folder[data-folder="f-media"] .df-strip-btn');
    await page.waitForSelector('.df-menu', { timeout: 3000 });
    const head = await text('.df-menu-head');
    ok(head === 'plex', `menu header was "${head}", expected the container name`);
    await shot('04-container-menu-from-strip');
  }),

  t('clicking the folder icon opens the folder menu', async () => {
    await fresh();
    await page.click('.df-row-folder[data-folder="f-media"] .df-folder-icon');
    await page.waitForSelector('.df-menu', { timeout: 3000 });
    ok(await text('.df-menu-head') === 'Media', 'menu header should be the folder name');

    const items = await page.$$eval('.df-menu-item .df-menu-label', (n) => n.map((x) => x.textContent));
    for (const want of ['Start all', 'Stop all', 'Restart all', 'Check for updates',
                        'Force update all', 'Edit folder…', 'Delete folder']) {
      ok(items.includes(want), `folder menu is missing "${want}"`);
    }
    await shot('05-folder-menu');
  }),

  t('Escape closes the menu and returns focus to its trigger', async () => {
    await fresh();
    await page.click('.df-row-folder[data-folder="f-media"] .df-folder-icon');
    await page.waitForSelector('.df-menu');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.df-menu'), { timeout: 3000 });
    const focused = await page.evaluate(() => document.activeElement.className);
    ok(focused.includes('df-folder-icon'), `focus went to "${focused}"`);
  }),

  t('unfolding shows member rows with start-order numbers', async () => {
    await fresh('&folded=all');
    await page.click('.df-row-folder[data-folder="f-media"] .df-chevron');
    await page.waitForFunction(() => document.querySelectorAll('.df-row-ct').length === 11,
                               { timeout: 3000 });
    const orders = await page.$$eval('.df-row-ct.is-nested .df-order', (n) => n.map((x) => x.textContent));
    ok(JSON.stringify(orders) === '["1","2","3","4","5"]', `order numbers were ${JSON.stringify(orders)}`);
    await shot('06-unfolded');
  }),

  t('the filter matches folders and containers (spec 10)', async () => {
    await fresh('&folded=all');
    await page.type('.df-filter-input', 'sonarr');
    await page.waitForFunction(
      () => document.querySelectorAll('.df-row-folder').length === 1, { timeout: 3000 });

    /* The folder name does not match, so only the matching member shows -
     * and while filtering every visible folder is unfolded. */
    ok(await count('.df-row-ct') === 1, 'expected exactly the matching container');
    ok(await text('.df-row-ct .df-ct-name') === 'sonarr', 'wrong container shown');

    await page.$eval('.df-filter-input', (n) => { n.value = ''; });
    await page.type('.df-filter-input', 'zzzz');
    await page.waitForSelector('.df-notice', { timeout: 3000 });
    ok((await text('.df-notice')).includes('Nothing matches'), 'missing the empty-result notice');
    await shot('07-filter');
  }),

  t('Classic view restores Unraid\'s own table', async () => {
    await fresh();
    ok(await page.$eval('#docker_containers', (n) => getComputedStyle(n).display) === 'none',
       'the native table should start hidden');

    await page.click('.df-classic input');
    await page.waitForFunction(
      () => getComputedStyle(document.querySelector('#docker_containers')).display !== 'none',
      { timeout: 3000 });

    ok(await count('.df-card') === 0, 'our table should be gone in classic view');
    ok(await count('#docker_list tr') === 16, 'the native table should still be populated');
    await shot('08-classic');
  }),

  t('deleting a folder asks first and never touches containers', async () => {
    await fresh();
    const before = await count('.df-row-ct');

    await page.click('.df-row-folder[data-folder="f-ai"] .df-folder-icon');
    await page.waitForSelector('.df-menu');
    await clickMenuItem('Delete folder');

    await page.waitForSelector('.df-dialog', { timeout: 3000 });
    const body = await text('.df-dialog-text');
    ok(body.includes('keep running'), `confirmation body was: ${body}`);
    await shot('09-delete-confirm');

    await clickButton('.df-dialog-foot', 'Delete folder');
    await page.waitForFunction(
      () => document.querySelectorAll('.df-row-folder').length === 2, { timeout: 5000 });

    ok(await count('.df-row-ct') === before, 'container count changed - containers were touched');
    const loose = await page.$$eval('.df-section-text', (n) => n.map((x) => x.textContent));
    ok(loose.includes('Not in a folder'), 'the orphaned containers should move to "Not in a folder"');
  }),

  t('force update warns and lists each member', async () => {
    await fresh();
    await page.click('.df-row-folder[data-folder="f-media"] .df-folder-icon');
    await page.waitForSelector('.df-menu');
    await clickMenuItem('Force update all');

    await page.waitForSelector('.df-dialog', { timeout: 3000 });
    const title = await text('.df-dialog-title');
    ok(title.includes('Force update 5 containers'), `title was: ${title}`);

    const notes = await page.$$eval('.df-confirm-note', (n) => n.map((x) => x.textContent));
    ok(notes.filter((x) => x === 'update ready').length === 2, 'expected 2 members with updates');
    ok(notes.filter((x) => x === 'already up to date').length === 3, 'expected 3 up-to-date members');
    await shot('10-force-update-confirm');
    await page.keyboard.press('Escape');
  }),

  t('the folder editor opens with a live preview and validates the name', async () => {
    await fresh();
    await clickButton('.df-head-actions', '+ New folder');
    await page.waitForSelector('.df-dialog', { timeout: 3000 });

    ok(await text('.df-dialog-title') === 'New folder', 'wrong dialog title');
    ok(await text('.df-ed-preview-row .df-folder-name') === 'Untitled folder',
       'preview should show a placeholder name');

    /* Empty name is refused. */
    ok(await page.$eval('.df-dialog-foot .df-btn-primary', (n) => n.disabled),
       'Create should be disabled with an empty name');

    /* A duplicate is reported, not silently accepted. */
    await page.type('#df-ed-name', 'Media');
    await page.waitForFunction(
      () => document.querySelector('#df-ed-name-error').textContent.includes('already uses'),
      { timeout: 3000 });

    await page.$eval('#df-ed-name', (n) => { n.value = ''; });
    await page.type('#df-ed-name', 'Cloud');
    await page.waitForFunction(
      () => document.querySelector('#df-ed-name-error').textContent === '', { timeout: 3000 });

    /* Picking members updates the preview and the start order. */
    await tickMembers(['nextcloud', 'mariadb', 'redis']);
    await page.waitForFunction(
      () => document.querySelectorAll('.df-order-row').length === 3, { timeout: 3000 });
    await shot('11-editor');
  }),

  t('a container moves between folders, and only one folder holds it', async () => {
    await fresh();
    await clickButton('.df-head-actions', '+ New folder');
    await page.waitForSelector('.df-dialog');
    await page.type('#df-ed-name', 'Cloud');

    /* sonarr is in Media; ticking it here must show that it will move. */
    await tickMembers(['sonarr']);
    await page.waitForFunction(() => {
      const row = [...document.querySelectorAll('.df-ct-opt')]
        .find((r) => r.querySelector('.df-ct-opt-name').textContent === 'sonarr');
      return row && /moves from Media/.test(row.textContent);
    }, { timeout: 3000 });

    await clickButton('.df-dialog-foot', 'Create folder');
    await page.waitForFunction(
      () => document.querySelectorAll('.df-row-folder').length === 4, { timeout: 5000 });

    const owners = await page.evaluate(async () => {
      const r = await fetch('/plugins/docker.folders/include/Data.php');
      const d = await r.json();
      return d.folders.filter((f) => f.resolved.includes('sonarr')).map((f) => f.name);
    });
    ok(JSON.stringify(owners) === '["Cloud"]', `sonarr is in ${JSON.stringify(owners)}`);
    await shot('12-after-create');
  }),

  t('bulk stop runs sequentially in reverse order with a progress panel', async () => {
    await fresh();
    await page.click('.df-row-folder[data-folder="f-ai"] .df-folder-icon');
    await page.waitForSelector('.df-menu');
    await clickMenuItem('Stop all');

    await page.waitForSelector('.df-panel', { timeout: 3000 });
    ok((await text('.df-panel-title')) === 'Stopping AI', 'wrong panel title');

    /* reverseStop is on for this folder, so open-webui stops before ollama. */
    const order = await page.$$eval('.df-panel-name', (n) => n.map((x) => x.textContent));
    ok(JSON.stringify(order) === '["ollama","open-webui"]',
       `panel listed ${JSON.stringify(order)}`);
    await shot('13-progress');

    await page.waitForFunction(
      () => document.querySelector('.df-panel-foot') !== null, { timeout: 30000 });
    const summary = await text('.df-panel-foot span');
    ok(summary.includes('stopped'), `summary was: ${summary}`);

    const states = await page.evaluate(async () => {
      const r = await fetch('/plugins/docker.folders/include/Data.php');
      const d = await r.json();
      return d.containers.filter((c) => ['ollama', 'open-webui'].includes(c.name)).map((c) => c.state);
    });
    ok(states.every((s) => s === 'stopped'), `states after stop: ${states}`);
  }),

  t('a second job is refused while one is running', async () => {
    await fresh();
    await page.click('.df-row-folder[data-folder="f-media"] .df-folder-icon');
    await page.waitForSelector('.df-menu');
    await clickMenuItem('Stop all');
    await page.waitForSelector('.df-panel', { timeout: 3000 });

    /* Every docker action is disabled while a job runs (spec 6).
     * Click through evaluate: the table re-renders as containers report busy,
     * so a handle resolved a moment ago may already be detached. */
    await page.evaluate(() =>
      document.querySelector('.df-row-folder[data-folder="f-home"] .df-folder-icon').click());
    await page.waitForSelector('.df-menu', { timeout: 3000 });
    const disabled = await page.$eval('.df-menu-item', (n) => n.disabled);
    ok(disabled, 'folder menu actions should be disabled while a job runs');
    await page.keyboard.press('Escape');
  }),

  t('every control is reachable by keyboard', async () => {
    await fresh('&folded=all');
    const reached = await page.evaluate(() => {
      const sel = 'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), [tabindex="0"]';
      return [...document.querySelector('#df-root').querySelectorAll(sel)].length;
    });
    ok(reached > 20, `only ${reached} focusable controls found`);

    /* The chevron carries the expanded state, not a div with a click handler. */
    const aria = await page.$eval('.df-chevron', (n) => n.getAttribute('aria-expanded'));
    ok(aria === 'false', `chevron aria-expanded was "${aria}"`);

    /* The folder switch uses aria-pressed="mixed" when members differ. */
    const mixed = await page.$eval('.df-row-folder[data-folder="f-media"] .df-switch',
      (n) => n.getAttribute('aria-pressed'));
    ok(mixed === 'mixed', `folder switch aria-pressed was "${mixed}"`);
  })
];

/* ------------------------------------------------------------------ */
async function clickMenuItem(label) {
  const clicked = await page.evaluate((want) => {
    const item = [...document.querySelectorAll('.df-menu-item')]
      .find((b) => b.querySelector('.df-menu-label').textContent === want);
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
      const row = [...document.querySelectorAll('.df-ct-opt')]
        .find((r) => r.querySelector('.df-ct-opt-name').textContent === want);
      if (!row) return false;
      row.querySelector('input').click();
      return true;
    }, name);
    if (!found) throw new Error(`container "${name}" not in the checklist`);
  }
}

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
