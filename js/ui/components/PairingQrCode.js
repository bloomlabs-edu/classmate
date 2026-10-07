/**
 * ui/components/PairingQrCode.js
 *
 * Renders a QR code for the TV pairing screen
 * (ui/views/TvSignInView.js) — see
 * docs/architecture/TV_PHONE_SIGNIN_DESIGN.md §4, which flags this as
 * the one new third-party runtime dependency this feature introduces
 * ("no existing dependency covers this"). This app has no build step
 * (index.html loads ES modules directly — see
 * docs/CLASSMATE_ARCHITECTURE_CURRENT_STATE.md §1), so a classic CDN
 * `<script>` tag is the only option, the same pattern this app already
 * uses for the Firebase SDK itself (`https://www.gstatic.com/
 * firebasejs/...`), just via a global rather than an ESM import (the
 * library below ships a UMD build only).
 *
 * Library: `qrcode-generator` (kazuhikoarase), MIT-licensed, loaded
 * from jsdelivr, pinned to an exact version — never `@latest`, so this
 * screen's behavior can't change out from under a deployed app. No API
 * key, no tracking, pure client-side generation (the pairing code never
 * leaves the browser to produce the QR image).
 */

const QR_LIBRARY_URL = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';

let loadPromise = null;

function loadQrLibrary() {
  if (typeof window !== 'undefined' && window.qrcode) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = QR_LIBRARY_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loadPromise = null; // allow a later retry rather than permanently failing for the rest of this page's lifetime
      reject(new Error('Failed to load QR code library'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

/**
 * Renders a QR code encoding `text` into `container` (replacing any
 * existing content). Resolves once rendered; on any failure (network
 * error loading the library), clears `container` and resolves anyway —
 * the plain 8-digit code + manual-entry path (decision #2's own "QR
 * code AND an 8-digit code") means a QR render failure is a degraded
 * experience, never a blocked one.
 */
export async function renderPairingQrCode(container, text) {
  container.innerHTML = '';
  try {
    await loadQrLibrary();
    const qr = window.qrcode(0, 'M'); // type 0 = auto-detect smallest size; 'M' = medium error correction, standard for a screen-to-camera scan
    qr.addData(text);
    qr.make();
    container.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2 });
  } catch (error) {
    console.error('[PairingQrCode] renderPairingQrCode() failed:', error);
  }
}
