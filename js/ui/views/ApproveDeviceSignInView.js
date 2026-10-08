/**
 * ui/views/ApproveDeviceSignInView.js
 *
 * The teacher's-own-phone side of "Sign in with Phone" (see
 * docs/architecture/TV_PHONE_SIGNIN_DESIGN.md). Reached either via the
 * TV's QR deep link (`#/approve-sign-in/{code}`, e.g. scanned with the
 * phone's own generic camera app), the IN-APP scanner this view now
 * offers directly (ui/components/QrScannerView.js), or a bare
 * `#/approve-sign-in` visit followed by manual code entry. Only ever
 * rendered once a teacher is already signed in — js/main.js's existing
 * `!currentUser` auth gate handles "not signed in yet" before this view
 * is ever reached, per design decision #3 (the teacher authenticates
 * with Google on her phone using the existing, unchanged flow).
 *
 * This is the one mandatory explicit-consent screen the whole feature
 * hinges on: it must never auto-approve, and must always show enough
 * context (device label + request time) for the teacher to make a real
 * decision before Approve is even reachable.
 *
 * EXPIRY AWARENESS (added 2026-10-08, see
 * docs/architecture/TV_PHONE_SIGNIN_RACE_INVESTIGATION.md): this screen
 * now shows a live countdown driven by the session's own authoritative
 * `expiresAt` (returned by getDeviceSignInRequestInfo — the same value
 * the server itself enforces), and disables Approve once it reaches
 * zero rather than ever leaving a tap available that's guaranteed to
 * fail. This is UX only — the real Approve/Deny network call already
 * re-validates expiry against the server's own clock every time
 * regardless of what this countdown shows (including if the tab was
 * backgrounded and the on-screen timer fell behind); client time is
 * never trusted for the actual authorization decision.
 *
 * IN-APP SCANNER + SYNCHRONIZED STATES (added 2026-10-08, first real
 * two-device QA round): the bare `#/approve-sign-in` entry point no
 * longer jumps straight to the manual code-entry field — it now offers
 * an explicit choice ("Scan QR code" / "Enter code"), matching a
 * WhatsApp-style device-linking entry screen rather than relying on the
 * phone's generic camera app as the primary workflow. A successful scan
 * feeds the exact same `loadRequestInfo()` call the deep-link and
 * manual-entry paths already used — this is one resolution path with
 * three entry points, never a second authentication mechanism (see
 * TV_PHONE_SIGNIN_DESIGN.md's security model, untouched by this round).
 * Every render* function below mounts into the SAME `wrapper` element
 * (never replaces it) specifically so the scanner — itself mounted
 * INSIDE that wrapper, not the top-level container — can hand control
 * back to any of these screens afterward without ever leaving `wrapper`
 * detached from the document (see QrScannerView.js's own header
 * comment on why it checks `isConnected` rather than a parent-container
 * check for exactly this reason).
 */
import { getDeviceSignInRequestInfo, approveDeviceSignIn, denyDeviceSignIn } from '../../services/deviceSignInApprovalService.js';
import { renderQrScannerView } from '../components/QrScannerView.js';

const PAIRING_CODE_LENGTH = 8;
const COUNTDOWN_TICK_MS = 1000;

function formatRequestedAt(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return 'just now';
  }
}

function formatCountdown(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function renderApproveDeviceSignInView(container, { pairingCode, getIdToken, onDone }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'approve-device-signin-view';
  container.appendChild(wrapper);

  let countdownTimer = null;
  let visibilityListener = null;
  let activeScanner = null;

  function stillMounted() {
    return wrapper.isConnected;
  }

  function stopCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
    if (visibilityListener) document.removeEventListener('visibilitychange', visibilityListener);
    visibilityListener = null;
  }

  function closeScannerIfOpen() {
    if (activeScanner) activeScanner.destroy();
    activeScanner = null;
  }

  function makeButton(label, { variant = 'secondary', onClick } = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn btn--${variant}`;
    button.textContent = label;
    if (onClick) button.addEventListener('click', onClick);
    return button;
  }

  /**
   * The new default landing screen for a bare `#/approve-sign-in` visit
   * (no code already in hand from a deep link) — an explicit choice
   * between the in-app scanner and manual entry, rather than jumping
   * straight into the numeric-code field as before.
   */
  function renderEntryChoice() {
    stopCountdown();
    closeScannerIfOpen();
    wrapper.innerHTML = '';

    const title = document.createElement('h1');
    title.textContent = 'Sign in to ClassMate';

    const subtitle = document.createElement('p');
    subtitle.className = 'approve-device-signin-view__subtitle';
    subtitle.textContent = 'Use this phone to approve a sign-in on another device.';

    const actions = document.createElement('div');
    actions.className = 'approve-device-signin-view__actions';

    const scanButton = makeButton('📷 Scan QR code', { variant: 'primary', onClick: openScanner });
    const enterCodeButton = makeButton('Enter code', { variant: 'secondary', onClick: () => renderCodeEntry() });

    actions.append(scanButton, enterCodeButton);
    wrapper.append(title, subtitle, actions);
  }

  function openScanner() {
    stopCountdown();
    wrapper.innerHTML = '';
    activeScanner = renderQrScannerView(wrapper, {
      onScanned: (code) => {
        activeScanner = null;
        loadRequestInfo(code);
      },
      onCancel: () => {
        activeScanner = null;
        renderEntryChoice();
      },
      onUseCodeInstead: () => {
        activeScanner = null;
        renderCodeEntry();
      },
    });
  }

  function renderCodeEntry(prefillCode, errorMessage) {
    stopCountdown();
    closeScannerIfOpen();
    wrapper.innerHTML = '';

    const title = document.createElement('h1');
    title.textContent = 'Approve a device';

    const subtitle = document.createElement('p');
    subtitle.textContent = `Enter the ${PAIRING_CODE_LENGTH}-digit code shown on the TV or shared device.`;

    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.maxLength = PAIRING_CODE_LENGTH;
    input.className = 'approve-device-signin-view__code-input';
    input.placeholder = '00000000';
    input.value = prefillCode || '';

    const actions = document.createElement('div');
    actions.className = 'approve-device-signin-view__actions';

    const continueButton = makeButton('Continue', {
      variant: 'primary',
      onClick: () => {
        const code = input.value.replace(/\D/g, '');
        if (code.length !== PAIRING_CODE_LENGTH) {
          renderCodeEntry(code, `Enter the full ${PAIRING_CODE_LENGTH}-digit code.`);
          return;
        }
        loadRequestInfo(code);
      },
    });
    const scanInsteadButton = makeButton('📷 Scan QR code instead', { variant: 'text', onClick: openScanner });

    actions.append(continueButton, scanInsteadButton);
    wrapper.append(title, subtitle, input, actions);

    if (errorMessage) {
      const error = document.createElement('p');
      error.className = 'approve-device-signin-view__error';
      error.textContent = errorMessage;
      wrapper.appendChild(error);
    }
  }

  function renderMessage(title, { detail, isError = false, doneLabel = 'Done' } = {}) {
    stopCountdown();
    closeScannerIfOpen();
    wrapper.innerHTML = '';

    const titleEl = document.createElement('p');
    titleEl.className = isError ? 'approve-device-signin-view__error' : 'approve-device-signin-view__message';
    titleEl.textContent = title;
    wrapper.appendChild(titleEl);

    if (detail) {
      const detailEl = document.createElement('p');
      detailEl.className = 'approve-device-signin-view__detail';
      detailEl.textContent = detail;
      wrapper.appendChild(detailEl);
    }

    if (onDone) {
      const actions = document.createElement('div');
      actions.className = 'approve-device-signin-view__actions';
      actions.appendChild(makeButton(doneLabel, { variant: 'secondary', onClick: onDone }));
      wrapper.appendChild(actions);
    }
  }

  const REASON_TO_MESSAGE = Object.freeze({
    unauthenticated: 'Please sign in again to approve a device.',
    rate_limited: 'Too many attempts — please wait a minute and try again.',
    invalid_or_expired: 'This code has expired or is invalid — ask for a new one on the TV.',
    already_resolved: 'This sign-in has already been completed.',
    invalid_request: `Enter the full ${PAIRING_CODE_LENGTH}-digit code.`,
    error: "Couldn't reach ClassMate — check your connection and try again.",
  });

  async function loadRequestInfo(code) {
    stopCountdown();
    closeScannerIfOpen();
    wrapper.innerHTML = '';
    const checking = document.createElement('p');
    checking.className = 'approve-device-signin-view__message';
    checking.textContent = 'Checking code…';
    wrapper.appendChild(checking);

    const idToken = await getIdToken();
    if (!stillMounted()) return;
    const info = await getDeviceSignInRequestInfo(idToken, code);
    if (!stillMounted()) return;

    if (!info.ok) {
      renderCodeEntry(code, REASON_TO_MESSAGE[info.reason] || REASON_TO_MESSAGE.error);
      return;
    }

    renderConfirm(code, info);
  }

  function renderConfirm(code, info) {
    stopCountdown();
    wrapper.innerHTML = '';

    const title = document.createElement('h1');
    title.textContent = 'Sign in to this device?';

    const deviceLine = document.createElement('p');
    deviceLine.className = 'approve-device-signin-view__device';
    deviceLine.textContent = info.deviceLabel;

    const timeLine = document.createElement('p');
    timeLine.className = 'approve-device-signin-view__time';
    timeLine.textContent = `Requested at ${formatRequestedAt(info.requestedAt)}`;

    const countdownLine = document.createElement('p');
    countdownLine.className = 'approve-device-signin-view__countdown';

    const warning = document.createElement('p');
    warning.className = 'approve-device-signin-view__warning';
    warning.textContent = "Only approve this if you're actually standing at this device right now.";

    const buttonRow = document.createElement('div');
    buttonRow.className = 'approve-device-signin-view__buttons';

    const approveButton = makeButton('✓ Approve', {
      variant: 'primary',
      onClick: async () => {
        approveButton.disabled = true;
        denyButton.disabled = true;
        const idToken = await getIdToken();
        // The server independently re-validates expiresAt against its own
        // clock right here, regardless of what the countdown above showed
        // — this network call IS the "re-check server state before
        // approval" the design calls for; client time is never trusted
        // for the actual decision. A session that expired while this
        // screen sat open (including a backgrounded/throttled tab whose
        // own countdown display fell behind) is rejected here exactly the
        // same as one the countdown already caught, and reported with the
        // identical clean expired message below — never a false success.
        const result = await approveDeviceSignIn(idToken, code);
        if (!stillMounted()) return;
        if (!result.ok) {
          renderMessage(REASON_TO_MESSAGE[result.reason] || REASON_TO_MESSAGE.error, { isError: true });
          return;
        }
        renderMessage('✓ Device signed in', { detail: 'You can now use ClassMate on the other screen.' });
      },
    });

    const denyButton = makeButton('Deny', {
      variant: 'secondary',
      onClick: async () => {
        approveButton.disabled = true;
        denyButton.disabled = true;
        const idToken = await getIdToken();
        const result = await denyDeviceSignIn(idToken, code);
        if (!stillMounted()) return;
        if (!result.ok) {
          renderMessage(REASON_TO_MESSAGE[result.reason] || REASON_TO_MESSAGE.error, { isError: true });
          return;
        }
        renderMessage('Sign-in cancelled');
      },
    });

    buttonRow.append(approveButton, denyButton);
    wrapper.append(title, deviceLine, timeLine, countdownLine, warning, buttonRow);

    /**
     * UX-ONLY countdown, driven entirely by the session's own
     * authoritative `expiresAt` (never a client-side timer started from
     * scratch) — see this file's own header comment. Disables Approve
     * the moment the displayed time reaches zero, swapping in the same
     * clean "expired, start a new request on the TV" state the server
     * itself would eventually report anyway, so the teacher is never
     * left looking at a live-seeming button that's already guaranteed
     * to fail.
     */
    function showExpiredState() {
      stopCountdown();
      approveButton.disabled = true;
      denyButton.disabled = true;
      countdownLine.textContent = 'This request has expired.';
      countdownLine.classList.add('approve-device-signin-view__countdown--expired');
      const expiredNote = document.createElement('p');
      expiredNote.className = 'approve-device-signin-view__error';
      expiredNote.textContent = 'Start a new sign-in request on the other screen.';
      wrapper.appendChild(expiredNote);

      if (onDone) {
        const actions = document.createElement('div');
        actions.className = 'approve-device-signin-view__actions';
        actions.appendChild(makeButton('Done', { variant: 'secondary', onClick: onDone }));
        wrapper.appendChild(actions);
      }
    }

    function tickCountdown() {
      if (!stillMounted()) {
        stopCountdown();
        return;
      }
      const remainingMs = new Date(info.expiresAt).getTime() - Date.now();
      if (remainingMs <= 0) {
        showExpiredState();
        return;
      }
      countdownLine.textContent = `Expires in ${formatCountdown(remainingMs)}`;
    }

    tickCountdown();
    if (!approveButton.disabled) {
      countdownTimer = setInterval(tickCountdown, COUNTDOWN_TICK_MS);
      // A backgrounded/throttled tab can make setInterval fire late —
      // re-check the instant the tab becomes visible again rather than
      // waiting for the next lagging tick, so the displayed state never
      // stays stale longer than necessary (the actual Approve action
      // would still be safe either way, since the server re-validates
      // regardless — this is purely so the UI itself stays honest).
      // Removed again by stopCountdown() (called on every re-render and
      // whenever tickCountdown itself detects expiry), so this view
      // never accumulates more than one live listener.
      visibilityListener = tickCountdown;
      document.addEventListener('visibilitychange', visibilityListener);
    }
  }

  if (pairingCode && /^\d{8}$/.test(pairingCode)) {
    loadRequestInfo(pairingCode);
  } else {
    renderEntryChoice();
  }
}
