/**
 * tests/ui/tvSignInView.test.js
 *
 * Real headless-Chromium tests for ui/views/TvSignInView.js's own
 * synchronized state machine (added 2026-10-08, first real two-device
 * QA round — see that file's own header comment): pending -> connected
 * -> approved/denied/expired, plus the initial "couldn't reach
 * ClassMate" error state. Same "real browser, not a fake DOM shim"
 * reasoning as tests/ui/approveDeviceSignInView.test.js's own header
 * comment (real `setInterval`/`Date.now()` polling timing). `window.fetch`
 * is stubbed in-page to simulate each server response in sequence,
 * matching that same file's established stubbing convention — this
 * never makes a real network call.
 *
 * Scope: this proves the TV's own CLIENT-SIDE rendering for each poll
 * outcome. The SERVER's own state machine (including the real
 * 'connected' transition) is covered exhaustively in
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
 * Renders the TV view with a stubbed fetch: `startDeviceSignIn` always
 * succeeds with a 5-minute session; `pollDeviceSignIn` returns
 * `pollStatuses` in sequence (repeating the last one once exhausted,
 * matching a real TV polling indefinitely until a terminal state).
 */
async function renderAndPoll({ pollStatuses, waitMs, startOk = true }) {
  return page.evaluate(
    async ({ pollStatuses, waitMs, startOk }) => {
      let pollCount = 0;
      window.fetch = async (url) => {
        const u = String(url);
        if (u.includes('startDeviceSignIn')) {
          if (!startOk) return new Response(JSON.stringify({ ok: false }), { status: 200 });
          return new Response(
            JSON.stringify({
              ok: true,
              pairingCode: '12345678',
              tvSessionToken: 't'.repeat(43),
              expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            }),
            { status: 200 }
          );
        }
        if (u.includes('pollDeviceSignIn')) {
          const status = pollStatuses[Math.min(pollCount, pollStatuses.length - 1)];
          pollCount += 1;
          if (status === 'approved') {
            return new Response(JSON.stringify({ ok: true, status: 'approved', customToken: 'fake-custom-token' }), { status: 200 });
          }
          return new Response(JSON.stringify({ ok: true, status }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: false }), { status: 200 });
      };

      const { renderTvSignInView } = await import('/js/ui/views/TvSignInView.js');
      const container = document.createElement('div');
      document.body.appendChild(container);

      renderTvSignInView(container, { onSignedIn: () => {}, onBack: () => {} });
      await new Promise((resolve) => setTimeout(resolve, waitMs));

      const description = {
        titleText: container.querySelector('.tv-signin-view__title')?.textContent || null,
        subtitleText: container.querySelector('.tv-signin-view__subtitle')?.textContent || null,
        hasQr: !!container.querySelector('.tv-signin-view__qr svg'),
        hasConnectedBody: !!container.querySelector('.tv-signin-view__connected'),
        bodyText: container.textContent,
        isBlank: container.innerHTML.trim() === '',
      };
      container.remove();
      return description;
    },
    { pollStatuses, waitMs, startOk }
  );
}

test('STATE SYNC: initial pending state shows the QR/code/countdown under "Sign in to ClassMate"', async () => {
  const result = await renderAndPoll({ pollStatuses: ['pending'], waitMs: 300 });
  assert.equal(result.isBlank, false);
  assert.equal(result.titleText, 'Sign in to ClassMate');
  assert.equal(result.hasQr, true);
});

test('STATE SYNC: once the phone connects, the TV switches to "Phone connected" / "Waiting for approval..." and the QR/code disappear', async () => {
  const result = await renderAndPoll({ pollStatuses: ['pending', 'connected'], waitMs: 2500 });
  assert.equal(result.isBlank, false);
  assert.equal(result.titleText, 'Phone connected');
  assert.match(result.subtitleText, /Waiting for approval/i);
  assert.equal(result.hasQr, false, 'the QR/code have no further purpose once a phone has connected');
  assert.equal(result.hasConnectedBody, true);
});

/**
 * NOTE on scope: a genuinely successful `signInWithCustomTokenForSharedDevice()`
 * redemption requires a REAL custom token minted by the Auth emulator's
 * own Admin SDK — already proven end-to-end (mint -> approve -> poll ->
 * redeem -> same uid) by deviceSignInEndpoints.emulator.test.js's own
 * "SUCCESSFUL END-TO-END PAIRING" test. This file has no server-side
 * Admin SDK access, so it uses a deliberately FAKE token here instead —
 * which lets it prove the OTHER half of this same code path just as
 * meaningfully: that an approved poll always at least ATTEMPTS
 * redemption (never silently ignores it), and that a failed redemption
 * (any reason — here, an invalid token) shows the real, recoverable
 * "Something went wrong" state rather than a blank or stuck screen.
 */
test('STATE SYNC: an approved poll attempts redemption immediately, and a failed redemption shows a recoverable error, never blank', async () => {
  const result = await renderAndPoll({ pollStatuses: ['connected', 'approved'], waitMs: 2500 });
  assert.equal(result.isBlank, false);
  assert.equal(result.titleText, 'Something went wrong');
  assert.match(result.bodyText, /start a new sign-in request/i);
});

test('STATE SYNC: denial shows "Sign-in cancelled" with a Try Again action, never blank', async () => {
  const result = await renderAndPoll({ pollStatuses: ['connected', 'denied'], waitMs: 2500 });
  assert.equal(result.isBlank, false);
  assert.equal(result.titleText, 'Sign-in cancelled');
  assert.match(result.bodyText, /Try Again/);
});

test('STATE SYNC: expiry shows a real, visible "Sign-in request expired" state with Try Again (no silent auto-refresh)', async () => {
  const result = await renderAndPoll({ pollStatuses: ['connected', 'expired'], waitMs: 2500 });
  assert.equal(result.isBlank, false);
  assert.equal(result.titleText, 'Sign-in request expired');
  assert.match(result.subtitleText, /Start a new request/i);
  assert.match(result.bodyText, /Try Again/);
});

test('ERROR STATE: if the TV cannot even start a pairing session, it shows a recoverable "Something went wrong" + Try Again, never blank', async () => {
  const result = await renderAndPoll({ pollStatuses: ['pending'], waitMs: 300, startOk: false });
  assert.equal(result.isBlank, false);
  assert.equal(result.titleText, 'Something went wrong');
  assert.match(result.bodyText, /Try Again|Retry/);
});
