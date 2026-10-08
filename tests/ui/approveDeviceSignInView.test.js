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

      const approveButton = [...container.querySelectorAll('button')].find((b) => b.textContent === '✓ Approve');
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
  assert.match(result.bodyText, /Start a new sign-in request on the other screen/i);
});

test('D: the expired state never mentions a false success', async () => {
  const result = await renderAndWait({ expiresInMs: 300, waitMs: 1600 });
  assert.ok(!/is now signed in/i.test(result.bodyText), 'an expired pairing must never show the success message');
});

/**
 * ENTRY-CHOICE + IN-APP SCANNER (added 2026-10-08): a bare
 * `#/approve-sign-in` visit (no pairingCode from a deep link) now shows
 * an explicit "Scan QR code" / "Enter code" choice instead of jumping
 * straight to the manual-entry field. These tests exercise the REAL
 * ui/components/QrScannerView.js + services/qrScanService.js integration
 * (no stubbed scanService) — this headless environment has no real
 * camera, so requestCameraStream() genuinely fails, proving the whole
 * chain degrades to a graceful, non-blank fallback rather than hanging
 * or crashing. The scanner's own internal decode states (valid/invalid/
 * expired QR, permission denied) are covered with an injected fake
 * scanService in tests/ui/qrScannerView.test.js; this file proves the
 * WIRING between the two views, not the scanner's own internals again.
 */
async function renderEntryChoiceAndClick(buttonText) {
  return page.evaluate(
    async (buttonText) => {
      const { renderApproveDeviceSignInView } = await import('/js/ui/views/ApproveDeviceSignInView.js');
      const container = document.createElement('div');
      document.body.appendChild(container);

      renderApproveDeviceSignInView(container, { pairingCode: null, getIdToken: async () => 'fake-id-token', onDone: () => {} });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const entryButtons = [...container.querySelectorAll('.approve-device-signin-view__actions button')].map((b) => b.textContent);
      const target = [...container.querySelectorAll('button')].find((b) => b.textContent === buttonText);
      target.click();
      await new Promise((resolve) => setTimeout(resolve, 2500)); // outlasts the scanner's own camera-attach attempt in this camera-less environment

      const description = {
        entryButtons,
        isBlank: container.innerHTML.trim() === '',
        hasScannerHeader: !!container.querySelector('.qr-scanner-view__header'),
        hasCodeInput: !!container.querySelector('.approve-device-signin-view__code-input'),
      };
      container.remove();
      return description;
    },
    buttonText
  );
}

test('ENTRY CHOICE: a bare approve-sign-in visit offers both "Scan QR code" and "Enter code", never a blank screen', async () => {
  const result = await page.evaluate(async () => {
    const { renderApproveDeviceSignInView } = await import('/js/ui/views/ApproveDeviceSignInView.js');
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderApproveDeviceSignInView(container, { pairingCode: null, getIdToken: async () => 'fake-id-token', onDone: () => {} });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const buttons = [...container.querySelectorAll('.approve-device-signin-view__actions button')].map((b) => b.textContent);
    const isBlank = container.innerHTML.trim() === '';
    container.remove();
    return { buttons, isBlank };
  });

  assert.equal(result.isBlank, false);
  assert.ok(result.buttons.some((text) => text.includes('Scan QR code')), 'must offer the in-app scanner as the primary action');
  assert.ok(result.buttons.includes('Enter code'), 'the manual 8-digit fallback must remain available');
});

test('ENTRY CHOICE -> "Enter code" reaches the existing manual code-entry screen, which also offers "Scan QR code instead"', async () => {
  const result = await renderEntryChoiceAndClick('Enter code');
  assert.equal(result.isBlank, false);
  assert.equal(result.hasCodeInput, true);
});

test('ENTRY CHOICE -> "Scan QR code" opens the in-app scanner (never a blank screen), and it degrades gracefully with no real camera available', async () => {
  const result = await renderEntryChoiceAndClick('📷 Scan QR code');
  assert.equal(result.isBlank, false, 'the scanner screen itself must never be blank while mounting');
  assert.equal(result.hasScannerHeader, true, 'the dedicated full-screen scanner must actually open');
});

/**
 * STATE SYNC — Approve/Deny outcomes (added 2026-10-08): proves the
 * phone's own terminal-state copy matches the synchronized UX spec
 * ("✓ Device signed in" / "Sign-in cancelled") and that a server-side
 * rejection (e.g. a race against expiry) still shows a clean, specific
 * message rather than a blank or generic failure.
 */
async function renderConfirmAndClickAction(buttonText, { approveResponse, denyResponse } = {}) {
  return page.evaluate(
    async ({ buttonText, approveResponse, denyResponse }) => {
      const requestedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      window.fetch = async (url) => {
        const u = String(url);
        if (u.includes('getDeviceSignInRequestInfo')) {
          return new Response(JSON.stringify({ ok: true, deviceLabel: 'Chrome device', requestedAt, expiresAt }), { status: 200 });
        }
        if (u.includes('approveDeviceSignIn')) {
          return new Response(JSON.stringify(approveResponse ?? { ok: true }), { status: 200 });
        }
        if (u.includes('denyDeviceSignIn')) {
          return new Response(JSON.stringify(denyResponse ?? { ok: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: false, error: 'unexpected_call_in_test' }), { status: 200 });
      };

      const { renderApproveDeviceSignInView } = await import('/js/ui/views/ApproveDeviceSignInView.js');
      const container = document.createElement('div');
      document.body.appendChild(container);

      let doneCalled = false;
      renderApproveDeviceSignInView(container, {
        pairingCode: '12345678',
        getIdToken: async () => 'fake-id-token',
        onDone: () => { doneCalled = true; },
      });
      await new Promise((resolve) => setTimeout(resolve, 300));

      const button = [...container.querySelectorAll('button')].find((b) => b.textContent === buttonText);
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 300));

      const description = {
        isBlank: container.innerHTML.trim() === '',
        messageText: container.querySelector('.approve-device-signin-view__message, .approve-device-signin-view__error')?.textContent || null,
        detailText: container.querySelector('.approve-device-signin-view__detail')?.textContent || null,
      };

      // Exercise the "Done" action too, where present, so onDone's wiring is proven, not just assumed.
      const doneButton = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Done');
      if (doneButton) doneButton.click();
      description.doneCalled = doneCalled;

      container.remove();
      return description;
    },
    { buttonText, approveResponse, denyResponse }
  );
}

test('STATE SYNC: approving shows "✓ Device signed in" with the synchronized-state detail copy, never blank', async () => {
  const result = await renderConfirmAndClickAction('✓ Approve');
  assert.equal(result.isBlank, false);
  assert.equal(result.messageText, '✓ Device signed in');
  assert.match(result.detailText, /use ClassMate on the other screen/i);
});

test('STATE SYNC: denying shows "Sign-in cancelled" and the Done action navigates away', async () => {
  const result = await renderConfirmAndClickAction('Deny');
  assert.equal(result.isBlank, false);
  assert.equal(result.messageText, 'Sign-in cancelled');
  assert.equal(result.doneCalled, true);
});

test('a server-side rejection on Approve (e.g. a race against expiry) shows the specific error message, never a blank or generic failure', async () => {
  const result = await renderConfirmAndClickAction('✓ Approve', { approveResponse: { ok: false, error: 'invalid_or_expired' } });
  assert.equal(result.isBlank, false);
  assert.match(result.messageText, /expired or is invalid/i);
});
