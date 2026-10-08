/**
 * ui/components/QrScannerView.js
 *
 * ClassMate's own explicit in-app QR scanner — added so the phone-side
 * approval flow (ui/views/ApproveDeviceSignInView.js) has a dedicated,
 * full-screen "Scan QR code" experience (like WhatsApp's device-linking
 * screen) instead of relying on the phone's generic camera app as the
 * PRIMARY workflow. The deep-link path a generic camera app resolves
 * (`#/approve-sign-in/{code}`) still works unchanged as a fallback — see
 * router.js and ApproveDeviceSignInView.js — this is purely an
 * additional, friendlier entry point into the exact same pairing
 * session; it never creates a second authentication mechanism (see
 * TV_PHONE_SIGNIN_DESIGN.md's security model, which this feature does
 * not touch).
 *
 * All actual camera/decoding work is isolated behind
 * services/qrScanService.js (`scanService` here, injectable for tests —
 * same convention as this feature's other injectable boundaries, e.g.
 * ApproveDeviceSignInView's own `getIdToken` param) — this file is
 * rendering + state orchestration only.
 *
 * States this view can show (never a blank screen in any of them):
 *   - requesting/scanning: live camera preview + scan frame guide
 *   - permission denied: explicit message + "Enter code instead"
 *   - no usable camera / getUserMedia unsupported: same fallback
 *   - a decoded QR that isn't a ClassMate pairing code: transient
 *     inline notice, scanning continues (not fatal)
 * An expired-but-otherwise-valid-looking pairing code is deliberately
 * NOT handled here — extractPairingCode() only checks shape, never
 * validity. The scanned code is handed to the exact same
 * loadRequestInfo() call the deep-link/manual-entry paths already use
 * (see ApproveDeviceSignInView.js), which already shows the existing
 * "expired or invalid" message — one resolution path, not a second one
 * duplicated here.
 */
import * as realQrScanService from '../../services/qrScanService.js';

const DEFAULT_SCAN_SERVICE = {
  requestCameraStream: realQrScanService.requestCameraStream,
  startScanLoop: realQrScanService.startScanLoop,
  stopStream: realQrScanService.stopStream,
};

/**
 * Extracts an 8-digit ClassMate pairing code from decoded QR text —
 * accepts either the bare 8-digit code or a full deep link
 * (".../#/approve-sign-in/12345678"), the exact shape
 * deviceSignInTvService.js's own buildApprovalDeepLink() produces.
 * Exported for direct unit testing without a camera.
 */
export function extractPairingCode(decodedText) {
  const match = /(\d{8})(?:\D|$)/.exec(typeof decodedText === 'string' ? decodedText : '');
  return match ? match[1] : null;
}

export function renderQrScannerView(container, { onScanned, onCancel, onUseCodeInstead, scanService = DEFAULT_SCAN_SERVICE } = {}) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'qr-scanner-view';
  container.appendChild(wrapper);

  let stopLoop = null;
  let activeStream = null;
  let destroyed = false;
  // Separate from `destroyed`: true once cleanup() has run for ANY
  // reason (Cancel, a successful scan handoff, or destroy() alike) --
  // guards specifically against a slow-to-settle camera attach (see
  // start()'s own video.play() race) resolving AFTER one of those and
  // re-arming scanning / re-acquiring the camera out from under
  // whatever already replaced this screen. Deliberately NOT folded into
  // `stillMounted()` itself: that check also gates whether it's safe to
  // call a render* function (e.g. the attach-failure catch block below
  // still needs to show renderGenericCameraError() even though cleanup()
  // -- and therefore this flag -- has already run by that point).
  let cancelled = false;

  function stillMounted() {
    // `wrapper.isConnected` (not `container.contains(wrapper)`): this
    // view is routinely mounted into another view's own sub-container
    // (ApproveDeviceSignInView.js opens it inside its own `wrapper`, not
    // the app's top-level #app container directly) — `isConnected`
    // correctly answers "is this element still part of the LIVE
    // document" regardless of how many ancestor containers up the chain
    // got cleared, which a single-level `container.contains(...)` check
    // cannot.
    return !destroyed && wrapper.isConnected;
  }

  function cleanup() {
    cancelled = true;
    if (stopLoop) stopLoop();
    stopLoop = null;
    if (activeStream) scanService.stopStream(activeStream);
    activeStream = null;
  }

  function renderShell(bodyContent, { title = 'Scan QR code' } = {}) {
    wrapper.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'qr-scanner-view__header';

    const titleEl = document.createElement('h1');
    titleEl.className = 'qr-scanner-view__title';
    titleEl.textContent = title;

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn--text qr-scanner-view__cancel';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => {
      cleanup();
      if (onCancel) onCancel();
    });

    header.append(titleEl, cancelButton);
    wrapper.append(header, bodyContent);
  }

  function renderFallbackBody(message) {
    const body = document.createElement('div');
    body.className = 'qr-scanner-view__message-body';

    const messageEl = document.createElement('p');
    messageEl.className = 'qr-scanner-view__message';
    messageEl.textContent = message;

    const useCodeButton = document.createElement('button');
    useCodeButton.type = 'button';
    useCodeButton.className = 'btn btn--primary';
    useCodeButton.textContent = 'Enter code instead';
    useCodeButton.addEventListener('click', () => {
      cleanup();
      if (onUseCodeInstead) onUseCodeInstead();
    });

    body.append(messageEl, useCodeButton);
    return body;
  }

  function renderPermissionDenied() {
    renderShell(
      renderFallbackBody("Camera access was denied. You can allow it in your browser's settings, or enter the code instead."),
      { title: 'Camera access needed' }
    );
  }

  function renderNoCamera() {
    renderShell(renderFallbackBody("This device doesn't have a usable camera. Enter the code instead."), { title: 'Camera unavailable' });
  }

  function renderGenericCameraError() {
    renderShell(renderFallbackBody("Couldn't start the camera. Enter the code instead."), { title: 'Something went wrong' });
  }

  function renderScanningBody() {
    const body = document.createElement('div');
    body.className = 'qr-scanner-view__body';

    const frame = document.createElement('div');
    frame.className = 'qr-scanner-view__frame';

    const video = document.createElement('video');
    video.className = 'qr-scanner-view__video';
    video.setAttribute('playsinline', ''); // required on iOS Safari to avoid an auto-fullscreen takeover that would hide this entire screen
    video.setAttribute('autoplay', '');
    video.muted = true;
    frame.appendChild(video);

    const guide = document.createElement('div');
    guide.className = 'qr-scanner-view__guide';
    frame.appendChild(guide);

    const instructions = document.createElement('p');
    instructions.className = 'qr-scanner-view__instructions';
    instructions.textContent = 'Point your camera at the QR code shown on the TV or shared device.';

    const notice = document.createElement('p');
    notice.className = 'qr-scanner-view__notice';
    notice.setAttribute('aria-live', 'polite');

    const useCodeButton = document.createElement('button');
    useCodeButton.type = 'button';
    useCodeButton.className = 'btn btn--secondary qr-scanner-view__use-code';
    useCodeButton.textContent = 'Enter code instead';
    useCodeButton.addEventListener('click', () => {
      cleanup();
      if (onUseCodeInstead) onUseCodeInstead();
    });

    body.append(frame, instructions, notice, useCodeButton);
    renderShell(body);

    return { video, notice };
  }

  function handleDecode(video, notice, decodedText) {
    if (!stillMounted()) return;

    const code = extractPairingCode(decodedText);
    if (!code) {
      // Not a ClassMate pairing code (e.g. some other QR code entirely)
      // — not fatal, keep scanning. The loop already stopped itself
      // after this one decode (see qrScanService.startScanLoop's own
      // header comment), so it must be explicitly restarted here.
      notice.textContent = "That doesn't look like a ClassMate sign-in code — try again.";
      stopLoop = scanService.startScanLoop({ videoEl: video, onDecode: (text) => handleDecode(video, notice, text) });
      return;
    }

    cleanup();
    if (onScanned) onScanned(code);
  }

  async function start() {
    const { video, notice } = renderScanningBody();

    const cameraResult = await scanService.requestCameraStream();
    if (!stillMounted() || cancelled) {
      if (cameraResult.ok) scanService.stopStream(cameraResult.stream); // scanner was cancelled/replaced while the permission prompt was still in flight
      return;
    }

    if (!cameraResult.ok) {
      if (cameraResult.reason === 'permission_denied') return renderPermissionDenied();
      if (cameraResult.reason === 'no_camera' || cameraResult.reason === 'unsupported') return renderNoCamera();
      return renderGenericCameraError();
    }

    activeStream = cameraResult.stream;
    try {
      // Assigning an unexpected object to `srcObject` can throw
      // synchronously (e.g. a value that isn't a real MediaStream) —
      // guarded explicitly rather than left to silently abort this
      // async function, which would otherwise leave the camera frame
      // visible but permanently unresponsive with no error shown at
      // all (exactly the class of failure this whole feature exists to
      // eliminate — see this app's own blank-screen investigation).
      video.srcObject = activeStream;
      // Autoplay can reject on some browsers until a real user gesture
      // has occurred — tolerated here (the scan loop below only reads
      // frames once the video actually has data, via readyState, so a
      // rejected .play() call here is not itself fatal to scanning
      // working). Raced against a short timeout as well, not just
      // `.catch()`-ed: a stream with no immediately-playable track can
      // leave this promise neither resolving NOR rejecting at all on
      // some browsers/devices, which would otherwise hang this entire
      // function forever with no visible feedback -- exactly the class
      // of silent stall this whole feature exists to eliminate.
      await Promise.race([video.play().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 1000))]);
    } catch (error) {
      console.error('[QrScannerView] attaching the camera stream failed:', error);
      cleanup();
      if (stillMounted()) renderGenericCameraError();
      return;
    }

    if (cancelled || !stillMounted()) return; // cancelled/handed off while the camera stream was still attaching

    stopLoop = scanService.startScanLoop({ videoEl: video, onDecode: (text) => handleDecode(video, notice, text) });
  }

  start();

  return {
    destroy() {
      destroyed = true;
      cleanup();
    },
  };
}
