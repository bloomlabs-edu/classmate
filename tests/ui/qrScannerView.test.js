/**
 * tests/ui/qrScannerView.test.js
 *
 * Real headless-Chromium tests for ui/components/QrScannerView.js's own
 * state orchestration (permission denied / no camera / invalid QR /
 * successful scan / cancel) — same "real browser, not a fake DOM shim"
 * reasoning as tests/ui/approveDeviceSignInView.test.js's own header
 * comment. No real camera exists in this environment, so every test
 * here injects a FAKE `scanService` (requestCameraStream/startScanLoop/
 * stopStream) — the same "inject the impure boundary" convention this
 * feature already uses for `getIdToken` — letting these tests exercise
 * the view's own rendering/cleanup logic deterministically. The REAL
 * jsQR decode path is proven separately (against real rendered QR
 * pixel data) in tests/ui/qrScanService.test.js; this file does not
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

test('QR scanner: a successful camera grant shows the live scanning UI (video + guide + instructions + cancel), never blank', async () => {
  const result = await page.evaluate(async () => {
    const { renderQrScannerView } = await import('/js/ui/components/QrScannerView.js');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const fakeStream = Object.assign(new MediaStream(), { getTracks: () => [] });
    let startScanLoopCalls = 0;
    const scanService = {
      requestCameraStream: async () => ({ ok: true, stream: fakeStream }),
      startScanLoop: () => {
        startScanLoopCalls += 1;
        return () => {};
      },
      stopStream: () => {},
    };

    renderQrScannerView(container, { scanService });
    await new Promise((resolve) => setTimeout(resolve, 1200)); // outlasts QrScannerView's own ~1s video.play() race (see that file's own header comment)

    const description = {
      hasVideo: !!container.querySelector('.qr-scanner-view__video'),
      hasGuide: !!container.querySelector('.qr-scanner-view__guide'),
      hasCancel: !![...container.querySelectorAll('button')].find((b) => b.textContent === 'Cancel'),
      instructionsText: container.querySelector('.qr-scanner-view__instructions')?.textContent || null,
      startScanLoopCalls,
      bodyEmpty: container.innerHTML.trim() === '',
    };
    container.remove();
    return description;
  });

  assert.equal(result.bodyEmpty, false, 'the scanner must never render a blank container');
  assert.equal(result.hasVideo, true);
  assert.equal(result.hasGuide, true);
  assert.equal(result.hasCancel, true);
  assert.match(result.instructionsText, /Point your camera/i);
  assert.equal(result.startScanLoopCalls, 1);
});

test('QR scanner: camera permission denied shows a graceful fallback (never blank) with a working "Enter code instead" action', async () => {
  const result = await page.evaluate(async () => {
    const { renderQrScannerView } = await import('/js/ui/components/QrScannerView.js');
    const container = document.createElement('div');
    document.body.appendChild(container);

    let useCodeInsteadCalled = false;
    const scanService = {
      requestCameraStream: async () => ({ ok: false, reason: 'permission_denied' }),
      startScanLoop: () => () => {},
      stopStream: () => {},
    };

    renderQrScannerView(container, { scanService, onUseCodeInstead: () => { useCodeInsteadCalled = true; } });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const useCodeButton = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Enter code instead');
    useCodeButton.click();

    const description = {
      bodyEmpty: container.innerHTML.trim() === '',
      messageText: container.querySelector('.qr-scanner-view__message')?.textContent || null,
      titleText: container.querySelector('.qr-scanner-view__title')?.textContent || null,
      useCodeInsteadCalled,
    };
    container.remove();
    return description;
  });

  assert.equal(result.bodyEmpty, false);
  assert.equal(result.titleText, 'Camera access needed');
  assert.match(result.messageText, /denied/i);
  assert.equal(result.useCodeInsteadCalled, true);
});

test('QR scanner: no usable camera shows a distinct graceful fallback, never blank', async () => {
  const result = await page.evaluate(async () => {
    const { renderQrScannerView } = await import('/js/ui/components/QrScannerView.js');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const scanService = {
      requestCameraStream: async () => ({ ok: false, reason: 'no_camera' }),
      startScanLoop: () => () => {},
      stopStream: () => {},
    };

    renderQrScannerView(container, { scanService });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const description = {
      titleText: container.querySelector('.qr-scanner-view__title')?.textContent || null,
      bodyEmpty: container.innerHTML.trim() === '',
    };
    container.remove();
    return description;
  });

  assert.equal(result.bodyEmpty, false);
  assert.equal(result.titleText, 'Camera unavailable');
});

test('QR scanner: a successful decode of a valid ClassMate pairing QR calls onScanned with the extracted code, and stops the camera', async () => {
  const result = await page.evaluate(async () => {
    const { renderQrScannerView } = await import('/js/ui/components/QrScannerView.js');
    const container = document.createElement('div');
    document.body.appendChild(container);

    let tracksStopped = 0;
    const fakeStream = Object.assign(new MediaStream(), { getTracks: () => [{ stop: () => { tracksStopped += 1; } }] });
    let scannedCode = null;

    const scanService = {
      requestCameraStream: async () => ({ ok: true, stream: fakeStream }),
      startScanLoop: ({ onDecode }) => {
        // Simulate the camera immediately seeing the TV's own QR code.
        setTimeout(() => onDecode('https://classmate-302c2.web.app/#/approve-sign-in/12345678'), 0);
        return () => {};
      },
      stopStream: (stream) => { stream.getTracks().forEach((t) => t.stop()); },
    };

    renderQrScannerView(container, { scanService, onScanned: (code) => { scannedCode = code; } });
    await new Promise((resolve) => setTimeout(resolve, 1200)); // outlasts QrScannerView's own ~1s video.play() race

    const description = { scannedCode, tracksStopped };
    container.remove();
    return description;
  });

  assert.equal(result.scannedCode, '12345678');
  assert.equal(result.tracksStopped, 1, 'the camera stream must be stopped the moment a valid code is scanned');
});

test('QR scanner: decoding an unrelated (non-ClassMate) QR code shows an inline notice, keeps scanning, and never calls onScanned', async () => {
  const result = await page.evaluate(async () => {
    const { renderQrScannerView } = await import('/js/ui/components/QrScannerView.js');
    const container = document.createElement('div');
    document.body.appendChild(container);

    let scannedCode = null;
    let startScanLoopCalls = 0;
    const fakeStream = Object.assign(new MediaStream(), { getTracks: () => [] });

    const scanService = {
      requestCameraStream: async () => ({ ok: true, stream: fakeStream }),
      startScanLoop: ({ onDecode }) => {
        startScanLoopCalls += 1;
        if (startScanLoopCalls === 1) {
          setTimeout(() => onDecode('https://example.com/not-classmate-at-all'), 0);
        }
        return () => {};
      },
      stopStream: () => {},
    };

    renderQrScannerView(container, { scanService, onScanned: (code) => { scannedCode = code; } });
    await new Promise((resolve) => setTimeout(resolve, 1200)); // outlasts QrScannerView's own ~1s video.play() race

    const description = {
      scannedCode,
      startScanLoopCalls, // must be 2: the initial call, plus one restart after the non-matching decode
      noticeText: container.querySelector('.qr-scanner-view__notice')?.textContent || null,
      stillShowingVideo: !!container.querySelector('.qr-scanner-view__video'),
    };
    container.remove();
    return description;
  });

  assert.equal(result.scannedCode, null, 'an unrelated QR code must never be treated as a valid pairing code');
  assert.equal(result.startScanLoopCalls, 2, 'scanning must resume automatically after a non-matching decode');
  assert.match(result.noticeText, /doesn't look like a ClassMate sign-in code/i);
  assert.equal(result.stillShowingVideo, true, 'the live camera view must remain visible while scanning continues');
});

test('QR scanner: Cancel stops the camera and calls onCancel, never leaving the screen blank first', async () => {
  const result = await page.evaluate(async () => {
    const { renderQrScannerView } = await import('/js/ui/components/QrScannerView.js');
    const container = document.createElement('div');
    document.body.appendChild(container);

    let tracksStopped = 0;
    let cancelCalled = false;
    const fakeStream = Object.assign(new MediaStream(), { getTracks: () => [{ stop: () => { tracksStopped += 1; } }] });

    const scanService = {
      requestCameraStream: async () => ({ ok: true, stream: fakeStream }),
      startScanLoop: () => () => {},
      stopStream: (stream) => { stream.getTracks().forEach((t) => t.stop()); },
    };

    renderQrScannerView(container, { scanService, onCancel: () => { cancelCalled = true; } });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const cancelButton = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Cancel');
    cancelButton.click();

    const description = { cancelCalled, tracksStopped };
    container.remove();
    return description;
  });

  assert.equal(result.cancelCalled, true);
  assert.equal(result.tracksStopped, 1);
});

test('QR scanner: destroy() (e.g. the app navigating away mid-scan) stops the camera even without a user clicking Cancel', async () => {
  const result = await page.evaluate(async () => {
    const { renderQrScannerView } = await import('/js/ui/components/QrScannerView.js');
    const container = document.createElement('div');
    document.body.appendChild(container);

    let tracksStopped = 0;
    const fakeStream = Object.assign(new MediaStream(), { getTracks: () => [{ stop: () => { tracksStopped += 1; } }] });

    const scanService = {
      requestCameraStream: async () => ({ ok: true, stream: fakeStream }),
      startScanLoop: () => () => {},
      stopStream: (stream) => { stream.getTracks().forEach((t) => t.stop()); },
    };

    const handle = renderQrScannerView(container, { scanService });
    await new Promise((resolve) => setTimeout(resolve, 50));
    handle.destroy();

    const description = { tracksStopped };
    container.remove();
    return description;
  });

  assert.equal(result.tracksStopped, 1);
});
