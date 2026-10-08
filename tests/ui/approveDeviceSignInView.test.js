/**
 * tests/ui/approveDeviceSignInView.test.js
 *
 * ui/views/ApproveDeviceSignInView.js's own expiry countdown (added
 * 2026-10-08 — see docs/architecture/TV_PHONE_SIGNIN_RACE_INVESTIGATION.md)
 * creates real DOM elements and drives real `setInterval`/
 * `Date.now()` timing, so — same reasoning as
 * tests/ui/studentNameElement.test.js's own header comment — this
 * suite drives a real headless Chromium page via Playwright rather than
 * a fake DOM shim. `window.fetch` is stubbed in-page so this never
 * makes a real network call; `getIdToken` is already an injectable
 * parameter the view itself accepts, so that needs no stubbing trick.
 *
 * Scope: this proves the CLIENT-SIDE countdown/disable/expired-display
 * behavior specifically — the SERVER's own authoritative expiry
 * enforcement is covered exhaustively in
 * tests/functions/deviceSignIn/deviceSignInRepository.emulator.test.js
 * and deviceSignInEndpoints.emulator.test.js; this file does not
 * re-litigate that.
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
let page;

test.before(async () => {
  ({ server, port } = await startStaticServer());
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/index.html`);
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

/**
 * Renders the confirm screen with a stubbed getDeviceSignInRequestInfo
 * response whose `expiresAt` is `expiresInMs` from "now", waits
 * `waitMs`, then returns a plain-object description of the rendered
 * DOM state. `window.fetch` is replaced for the lifetime of this one
 * `evaluate()` call only (each test gets a fresh page-level stub).
 */
async function renderAndWait({ expiresInMs, waitMs }) {
  return page.evaluate(
    async ({ expiresInMs, waitMs }) => {
      const requestedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + expiresInMs).toISOString();

      window.fetch = async (url) => {
        if (String(url).includes('getDeviceSignInRequestInfo')) {
          return new Response(JSON.stringify({ ok: true, deviceLabel: 'Test TV', requestedAt, expiresAt }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: false, error: 'unexpected_call_in_test' }), { status: 200 });
      };

      const { renderApproveDeviceSignInView } = await import('/js/ui/views/ApproveDeviceSignInView.js');
      const container = document.createElement('div');
      document.body.appendChild(container);

      renderApproveDeviceSignInView(container, {
        pairingCode: '12345678',
        getIdToken: async () => 'fake-id-token',
        onDone: () => {},
      });

      await new Promise((resolve) => setTimeout(resolve, waitMs));

      const approveButton = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Approve');
      const denyButton = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Deny');
      const countdownText = container.querySelector('.approve-device-signin-view__countdown')?.textContent || null;
      const bodyText = container.textContent;

      const description = {
        countdownText,
        approveDisabled: approveButton ? approveButton.disabled : null,
        denyDisabled: denyButton ? denyButton.disabled : null,
        bodyText,
      };
      container.remove();
      return description;
    },
    { expiresInMs, waitMs }
  );
}

test('D: a fresh, far-from-expiry session shows a live countdown with Approve enabled', async () => {
  const result = await renderAndWait({ expiresInMs: 5 * 60 * 1000, waitMs: 300 });
  assert.match(result.countdownText, /^Expires in \d:\d{2}$/);
  assert.equal(result.approveDisabled, false);
  assert.equal(result.denyDisabled, false);
});

test('D: countdown reaching zero disables Approve and Deny and shows a clean expired state', async () => {
  // expiresInMs chosen so the first 1s countdown tick (COUNTDOWN_TICK_MS)
  // lands after expiry — waiting past that tick is enough to observe
  // the transition without waiting out a real multi-minute TTL.
  const result = await renderAndWait({ expiresInMs: 300, waitMs: 1600 });
  assert.equal(result.approveDisabled, true, 'Approve must never remain tappable once the countdown has reached zero');
  assert.equal(result.denyDisabled, true);
  assert.match(result.countdownText, /expired/i);
  assert.match(result.bodyText, /Start a new request on the TV/i);
});

test('D: the expired state never mentions a false success', async () => {
  const result = await renderAndWait({ expiresInMs: 300, waitMs: 1600 });
  assert.ok(!/is now signed in/i.test(result.bodyText), 'an expired pairing must never show the success message');
});
