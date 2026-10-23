/**
 * tests/ui/startupErrorHandling.test.js
 *
 * Real headless-Chromium tests for index.html's own inline
 * `unhandledrejection` handler (same "real browser, not a fake DOM
 * shim" reasoning as tests/ui/tvSignInView.test.js's own header
 * comment — this is testing real browser event semantics, not
 * something a jsdom-style shim reproduces faithfully).
 *
 * Root cause this covers (2026-10-23 production incident): a DNS/
 * network failure on the reporting device made Firebase Auth token
 * refresh and Firestore both unreachable, and the Firestore JS SDK's
 * own internal watch-stream/persistence queue surfaced that as an
 * unhandled promise rejection with no application code anywhere in its
 * stack (a long-standing, version-spanning SDK behavior, not something
 * an app-level try/catch around any one call can intercept — see
 * js/main.js's own onAuthStateChange() comment above its guidance/
 * accent-color/Slack reads). Before this fix, index.html's
 * `unhandledrejection` listener treated ANY unhandled rejection,
 * forever, as fatal — unlike its sibling `error` listener just above
 * it, which only treats a failure as fatal while #app-boot-loading is
 * still the only thing in #app. A non-essential background read (or
 * an unrelated SDK-internal hiccup) firing AFTER a real view had
 * already rendered — which, in practice, is true almost immediately,
 * since even the "Loading your classrooms..." screen counts as a real
 * view — was able to blank out an already-working app with the same
 * "Something went wrong loading ClassMate" banner real startup
 * failures use.
 *
 * `js/main.js` itself is stubbed out to an empty module for every test
 * here (see stubMainJs() below) — these tests exercise only index.html's
 * own inline bootstrap script (the error/unhandledrejection listeners,
 * #app-boot-loading), not the real app's Firebase round-trip, so they
 * never race against the real main.js's own async auth-state resolution
 * (which, hitting the real classmate-302c2 Firebase project, has no
 * place in a deterministic test and would make these tests flaky).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const CONTENT_TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' };

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const filePath = path.join(REPO_ROOT, urlPath === '/' ? '/index.html' : urlPath);
    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

let server;
let port;
let browser;

test.before(async () => {
  ({ server, port } = await startStaticServer());
  browser = await chromium.launch();
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

/** Replaces js/main.js with an empty module for one page, so the real app never bootstraps -- see file header comment. */
async function stubMainJs(page) {
  await page.route('**/js/main.js', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' })
  );
}

test('STARTUP RESILIENCE: an unhandled rejection WHILE the app is still booting shows the fatal startup banner', async () => {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  await stubMainJs(page);
  await page.goto(`http://127.0.0.1:${port}/index.html`);

  // #app-boot-loading is still the only thing in #app at this point --
  // nothing has rendered a real view yet (see index.html's own comment:
  // "removed automatically the instant any real view renders").
  const stillBooting = await page.evaluate(() => {
    const boot = document.getElementById('app-boot-loading');
    const app = document.getElementById('app');
    return !!(boot && app && app.contains(boot));
  });
  assert.equal(stillBooting, true, 'precondition: test must start before any real view has rendered');

  await page.evaluate(() => {
    Promise.reject(new Error('simulated: Firestore client offline while loading preferences'));
  });
  await page.waitForSelector('#startup-error', { timeout: 2000 });

  const bannerText = await page.evaluate(() => document.getElementById('startup-error').textContent);
  assert.match(bannerText, /A background operation failed before the app could finish loading/);

  await page.close();
});

test('STARTUP RESILIENCE: an unhandled rejection AFTER a real view has rendered is logged, not fatal', async () => {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  await stubMainJs(page);
  await page.goto(`http://127.0.0.1:${port}/index.html`);

  // Simulate a real view having already rendered -- the same DOM
  // transition every view's render function performs (container.innerHTML
  // = ''), done directly here so this test doesn't depend on main.js's
  // own real Firebase round-trip actually completing within the test's
  // lifetime.
  await page.evaluate(() => {
    document.getElementById('app').innerHTML = '<div id="fake-real-view">Teacher Portal</div>';
  });

  await page.evaluate(() => {
    Promise.reject(new Error('simulated: FIRESTORE INTERNAL ASSERTION FAILED: Unexpected state'));
  });
  // Give the unhandledrejection event a tick to fire and be handled.
  await page.waitForTimeout(200);

  const bannerPresent = await page.evaluate(() => !!document.getElementById('startup-error'));
  assert.equal(bannerPresent, false, 'a post-boot background failure must not blank out an already-rendered app');

  const viewStillThere = await page.evaluate(() => !!document.getElementById('fake-real-view'));
  assert.equal(viewStillThere, true, 'the already-rendered view must be left untouched');

  assert.ok(
    consoleErrors.some((text) => /unhandled rejection after boot/.test(text)),
    'the failure must still be logged to the console, not silently swallowed'
  );

  await page.close();
});

test('STARTUP RESILIENCE: recovery — the UI can still update normally after a non-boot background failure was logged', async () => {
  const page = await browser.newPage();
  await stubMainJs(page);
  await page.goto(`http://127.0.0.1:${port}/index.html`);

  await page.evaluate(() => {
    document.getElementById('app').innerHTML = '<div id="fake-real-view">Teacher Portal</div>';
  });
  await page.evaluate(() => {
    Promise.reject(new Error('simulated: transient background failure'));
  });
  await page.waitForTimeout(200);

  // A later, successful background update (e.g. an accent-color
  // preference finally resolving after the network recovers) must still
  // be able to reach the UI -- the app must not be left in a broken
  // state by the earlier non-fatal rejection.
  await page.evaluate(() => {
    document.getElementById('fake-real-view').textContent = 'Teacher Portal (accent color applied)';
  });
  const finalText = await page.evaluate(() => document.getElementById('fake-real-view').textContent);
  assert.equal(finalText, 'Teacher Portal (accent color applied)');

  const bannerPresent = await page.evaluate(() => !!document.getElementById('startup-error'));
  assert.equal(bannerPresent, false);

  await page.close();
});
