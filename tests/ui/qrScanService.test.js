/**
 * tests/ui/qrScanService.test.js
 *
 * Real headless-Chromium tests for services/qrScanService.js's
 * decode path — same "drive a real browser, not a fake DOM shim"
 * reasoning as tests/ui/approveDeviceSignInView.test.js's own header
 * comment (real canvas/ImageData APIs, real jsQR CDN load).
 *
 * Deliberately proves the REAL jsQR integration decodes REAL pixel
 * data correctly — a QR code is rendered with this app's own existing
 * QR-GENERATING dependency (ui/components/PairingQrCode.js's
 * `qrcode-generator`), rasterized onto a canvas, and fed straight into
 * decodeQrFromImageData(). This is the one part of the scanner that
 * cannot be meaningfully tested by stubbing — the actual pixel decode —
 * so it is exercised for real here rather than mocked. Camera
 * acquisition and the scan-loop/UI orchestration (permission denied,
 * successful scan, invalid QR, cancel) are covered separately in
 * tests/ui/qrScannerView.test.js via an injected fake scanService,
 * since no real camera exists in this environment.
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

/** Renders `text` as a real QR code (this app's own qrcode-generator dependency), rasterizes it to a canvas, and returns real ImageData-equivalent plain data for decodeQrFromImageData(). */
async function renderQrToImageData(page, text) {
  return page.evaluate(async (text) => {
    const { renderPairingQrCode } = await import('/js/ui/components/PairingQrCode.js');
    const container = document.createElement('div');
    document.body.appendChild(container);
    await renderPairingQrCode(container, text);

    const svg = container.querySelector('svg');
    const svgText = new XMLSerializer().serializeToString(svg);
    const img = new Image();
    const loaded = new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    img.src = 'data:image/svg+xml;base64,' + btoa(svgText);
    await loaded;

    const size = 300; // upscaled well beyond the QR's own native cell size for a clean, reliably-decodable raster
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    const imageData = ctx.getImageData(0, 0, size, size);

    container.remove();
    return { data: Array.from(imageData.data), width: imageData.width, height: imageData.height };
  }, text);
}

test('decodeQrFromImageData: decodes a REAL rendered ClassMate pairing deep link correctly', async () => {
  const deepLink = 'https://classmate-302c2.web.app/#/approve-sign-in/12345678';
  const raw = await renderQrToImageData(page, deepLink);

  const decoded = await page.evaluate(
    async ({ data, width, height }) => {
      const { decodeQrFromImageData } = await import('/js/services/qrScanService.js');
      return decodeQrFromImageData({ data: new Uint8ClampedArray(data), width, height });
    },
    raw
  );

  assert.equal(decoded, deepLink);
});

test('decodeQrFromImageData: returns null for a plain blank image (no QR code present)', async () => {
  const decoded = await page.evaluate(async () => {
    const { decodeQrFromImageData } = await import('/js/services/qrScanService.js');
    const size = 100;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    const imageData = ctx.getImageData(0, 0, size, size);
    return decodeQrFromImageData(imageData);
  });

  assert.equal(decoded, null);
});

test('extractPairingCode (QrScannerView.js): extracts the 8-digit code from a full ClassMate deep link', async () => {
  const code = await page.evaluate(async () => {
    const { extractPairingCode } = await import('/js/ui/components/QrScannerView.js');
    return extractPairingCode('https://classmate-302c2.web.app/#/approve-sign-in/87654321');
  });
  assert.equal(code, '87654321');
});

test('extractPairingCode: extracts a bare 8-digit code with no URL wrapper', async () => {
  const code = await page.evaluate(async () => {
    const { extractPairingCode } = await import('/js/ui/components/QrScannerView.js');
    return extractPairingCode('12345678');
  });
  assert.equal(code, '12345678');
});

test('extractPairingCode: returns null for an unrelated (non-ClassMate) QR code', async () => {
  const code = await page.evaluate(async () => {
    const { extractPairingCode } = await import('/js/ui/components/QrScannerView.js');
    return extractPairingCode('https://example.com/some-other-page');
  });
  assert.equal(code, null);
});

test('extractPairingCode: returns null for empty/garbage input, never throws', async () => {
  const codes = await page.evaluate(async () => {
    const { extractPairingCode } = await import('/js/ui/components/QrScannerView.js');
    return [extractPairingCode(''), extractPairingCode(null), extractPairingCode(undefined), extractPairingCode('1234567')]; // last one is only 7 digits
  });
  assert.deepEqual(codes, [null, null, null, null]);
});
