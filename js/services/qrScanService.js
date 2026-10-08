/**
 * services/qrScanService.js
 *
 * Camera access + QR decoding for the in-app scanner
 * (ui/components/QrScannerView.js) — added so ClassMate has its own
 * explicit "Scan QR code" flow (like WhatsApp's device-linking screen)
 * rather than relying on the phone's generic camera app as the primary
 * path (see docs/architecture/TV_PHONE_SIGNIN_DESIGN.md; this is purely
 * a second, friendlier ENTRY POINT into the exact same pairing session
 * — it never creates a second authentication mechanism. A successfully
 * scanned code is handed to the same loadRequestInfo()/approve/deny
 * flow services/deviceSignInApprovalService.js already drives for the
 * deep-link and manual-entry paths).
 *
 * Library: `jsQR` (cozmo/jsQR), MIT-licensed, UMD build from jsdelivr,
 * pinned to an exact version — same "classic CDN <script> tag, pinned,
 * never @latest" convention ui/components/PairingQrCode.js already
 * established for this app's QR-GENERATING dependency; this is the
 * QR-DECODING counterpart. No build step in this app (see that file's
 * own header comment), so a global UMD script is the only option.
 *
 * Deliberately split into three small, independently-testable pieces
 * (decode / camera-access / scan-loop) rather than one monolithic
 * "scan" function — ui/components/QrScannerView.js composes them, and
 * tests can exercise decodeQrFromImageData() against a REAL rendered QR
 * code (no camera needed) completely separately from exercising the
 * camera-permission UI states (which stub requestCameraStream()
 * directly, same "inject the impure boundary" convention
 * services/authService.js's getIdToken param already uses elsewhere in
 * this feature).
 */

const JSQR_LIBRARY_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';

let loadPromise = null;

function loadJsQrLibrary() {
  if (typeof window !== 'undefined' && window.jsQR) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = JSQR_LIBRARY_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loadPromise = null; // allow a later retry rather than permanently failing for the rest of this page's lifetime
      reject(new Error('Failed to load QR scanning library'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

/**
 * Decodes one already-captured frame. Returns the decoded text, or
 * `null` if no QR code was found in this frame — which is the
 * overwhelmingly common case while actively scanning (most frames show
 * no code, or a code mid-motion-blur), never treated as an error.
 */
export async function decodeQrFromImageData(imageData) {
  await loadJsQrLibrary();
  const result = window.jsQR(imageData.data, imageData.width, imageData.height);
  return result ? result.data : null;
}

/**
 * Requests the device camera, preferring the rear/environment-facing
 * one — matches every real "point your phone at this QR code" flow.
 * Classifies the rejection reason so the UI can show a specific,
 * graceful message (permission denied vs. no camera at all vs. the API
 * simply not existing on this browser) rather than one generic failure.
 *
 * `getUserMedia` is an injectable override purely for tests (same
 * pattern as this feature's other services accepting an injectable
 * dependency) — production callers never pass it, and get the real
 * `navigator.mediaDevices.getUserMedia` bound correctly.
 *
 * @returns {Promise<{ok: true, stream: MediaStream} | {ok: false, reason: 'unsupported'|'permission_denied'|'no_camera'|'error'}>}
 */
export async function requestCameraStream({ getUserMedia } = {}) {
  const request =
    getUserMedia ||
    (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia
      ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      : null);
  if (!request) return { ok: false, reason: 'unsupported' };

  try {
    const stream = await request({ video: { facingMode: 'environment' }, audio: false });
    return { ok: true, stream };
  } catch (error) {
    const name = error && error.name;
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      return { ok: false, reason: 'permission_denied' };
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
      return { ok: false, reason: 'no_camera' };
    }
    console.error('[qrScanService] requestCameraStream() failed:', error);
    return { ok: false, reason: 'error' };
  }
}

/** Stops every track on a camera stream — must be called on cancel, successful scan, AND view teardown, or the camera light stays on after the user has left this screen. */
export function stopStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}

/**
 * Drives the actual scan loop: draws each video frame to an offscreen
 * canvas and runs decodeQrFromImageData() against it via
 * `requestFrame` (real `requestAnimationFrame` by default; injectable
 * for tests), calling `onDecode(text)` the first time a frame decodes
 * to ANY non-empty string — recognizing whether that text is actually a
 * ClassMate pairing code is the CALLER's job (ui/components/
 * QrScannerView.js), not this generic decode loop's. Stops itself after
 * exactly one successful decode (the caller restarts it via a fresh
 * call if that decode turns out not to be what it was looking for) —
 * never calls `onDecode` more than once per call.
 *
 * Never throws into the caller: a single bad frame (video not ready
 * yet, a transient decode error) is skipped, not fatal — scanning
 * is inherently "keep trying until one frame works."
 *
 * @returns {() => void} stop — call to end the loop early (e.g. Cancel).
 */
export function startScanLoop({ videoEl, onDecode, requestFrame = (cb) => requestAnimationFrame(cb) }) {
  let stopped = false;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  async function tick() {
    if (stopped) return;

    if (videoEl.readyState >= 2 /* HAVE_CURRENT_DATA */ && videoEl.videoWidth > 0) {
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const text = await decodeQrFromImageData(imageData);
        if (text && !stopped) {
          stopped = true;
          onDecode(text);
          return;
        }
      } catch (error) {
        console.error('[qrScanService] frame decode failed:', error);
      }
    }

    if (!stopped) requestFrame(tick);
  }

  requestFrame(tick);

  return function stop() {
    stopped = true;
  };
}
