/**
 * tests/ui/lessonPlanBuilderDifferentiationBucketsResponsive.test.js
 *
 * WORK-0028: the Lesson Plan Builder's three differentiation buckets
 * (css/styles.css's own `.lesson-plan-builder__differentiation-buckets`)
 * used to stay a cramped 3-column grid all the way down to the 640px
 * mobile breakpoint, including at the 768px tablet width. Added an
 * intermediate `@media (max-width: 960px)` step (matching this file's
 * own established 3-column responsive convention — see
 * `.operational-work-grid`'s identical 3 -> 2 -> 1 shape) that drops to
 * 2 columns at tablet widths, while the existing 1-column behavior
 * below 640px is unchanged.
 *
 * Verifies the REAL rendered column count directly from the real
 * stylesheet at every width named in the WORK-0028 test matrix (1280,
 * 960, 768, 640, 375), rather than asserting the CSS source text —
 * confirms the breakpoint actually resolves the way it's meant to in a
 * real browser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') {
      const html = `<!doctype html><html><head><link rel="stylesheet" href="/css/styles.css"></head>
<body>
  <div class="lesson-plan-builder__differentiation-buckets" id="buckets">
    <div class="lesson-plan-builder__differentiation-bucket">Support</div>
    <div class="lesson-plan-builder__differentiation-bucket">Core</div>
    <div class="lesson-plan-builder__differentiation-bucket">Stretch</div>
  </div>
</body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }
    const filePath = path.join(REPO_ROOT, urlPath);
    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': path.extname(filePath) === '.css' ? 'text/css' : 'text/plain' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

let server;
let port;
let browser;
let page;

test.before(async () => {
  ({ server, port } = await startStaticServer());
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

async function columnCountAt(width) {
  await page.setViewportSize({ width, height: 800 });
  return page.evaluate(() => {
    const grid = document.getElementById('buckets');
    const columns = getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/);
    return columns.length;
  });
}

for (const [width, expectedColumns, description] of [
  [1280, 3, 'wide desktop'],
  [960, 2, 'the breakpoint boundary itself -- max-width:960px is inclusive, so the 2-column rule is already active exactly at 960px'],
  [768, 2, 'tablet -- the WORK-0028 target width, previously still cramped at 3'],
  [640, 1, 'the existing mobile breakpoint boundary -- max-width:640px includes 640px'],
  [375, 1, 'narrow mobile'],
]) {
  test(`at ${width}px (${description}): renders ${expectedColumns} column(s)`, async () => {
    const count = await columnCountAt(width);
    assert.equal(count, expectedColumns, `expected ${expectedColumns} column(s) at ${width}px, got ${count}`);
  });
}

test('961px (just above the tablet breakpoint): still renders 3 columns -- the breakpoint has not fired yet', async () => {
  const count = await columnCountAt(961);
  assert.equal(count, 3);
});

test('641px (just above the mobile breakpoint): renders 2 columns, not yet collapsed to 1', async () => {
  const count = await columnCountAt(641);
  assert.equal(count, 2);
});

test('the existing one-column narrow-screen behavior below 640px is unchanged by this fix', async () => {
  const count = await columnCountAt(400);
  assert.equal(count, 1);
});
