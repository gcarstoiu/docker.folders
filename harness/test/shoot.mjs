/* docker.folders - product screenshots for the Community Apps listing.
 *
 *   node harness/test/shoot.mjs
 *
 * Hides the harness' own chrome so the capture shows only the plugin, then
 * writes docs/screenshot-*.png. Needs the harness and a CDP Chrome running
 * (see run.sh).
 *
 * NOT part of the plugin package. Never shipped.
 */
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT  = join(dirname(fileURLToPath(import.meta.url)), '../../docs');
const BASE = process.env.HARNESS_URL || 'http://localhost:8089';
const CDP  = process.env.CDP_URL || 'http://localhost:9222';

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: { width: 1360, height: 900 } });
const page = await browser.newPage();

async function capture(name, query, height) {
  await page.goto(`${BASE}/_reset`, { waitUntil: 'domcontentloaded' });
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });
  await page.setViewport({ width: 1360, height });
  await page.goto(`${BASE}/?nostream=1${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.df-card');

  /* Strip the harness' own header so the shot is the plugin alone. */
  await page.evaluate(() => {
    document.querySelector('.harness-bar')?.remove();
    document.querySelector('.title')?.remove();
    document.body.style.background = '#101215';
  });

  /* Give the live columns plausible values: the real page fills these from
     the dockerload stream, which is off for a settled capture. */
  await page.evaluate(() => {
    const DF = window.DockerFolders;
    DF.store.state.containers.forEach((ct) => {
      if (ct.state !== 'running') return;
      DF.store.state.live[ct.name] = { cpu: ct.cpu ?? 0, mem: ct.mem ?? 0 };
    });
    DF.store.emit();
  });

  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

await capture('screenshot-folded', '&folded=all', 620);
await capture('screenshot-expanded', '', 1180);

await page.close();
await browser.disconnect();
