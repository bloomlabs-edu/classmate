/**
 * ui/views/TvSignInView.js
 *
 * The shared TV/display side of "Sign in with Phone" (see
 * docs/architecture/TV_PHONE_SIGNIN_DESIGN.md). Rendering + polling
 * orchestration only — every actual network call lives in
 * services/deviceSignInTvService.js, and the eventual redemption call
 * lives in services/authService.js's signInWithCustomTokenForSharedDevice();
 * this file wires the two together and drives the on-screen states.
 *
 * Self-cancels its own poll loop once `wrapper` is no longer attached
 * under `container` (i.e. the app navigated to a different route and
 * some other view's render() replaced this screen's DOM) — there is no
 * existing app-wide "view teardown" hook in js/main.js to plug into, so
 * this is a deliberately self-contained safeguard rather than a new one.
 */
import {
  startPairingSession,
  pollPairingSession,
  buildApprovalDeepLink,
  setTransitioningAfterApproval,
} from '../../services/deviceSignInTvService.js';
import { renderPairingQrCode } from '../components/PairingQrCode.js';

const POLL_INTERVAL_MS = 2000;
const COUNTDOWN_TICK_MS = 1000;

export function renderTvSignInView(container, { onSignedIn, onBack }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'tv-signin-view';
  container.appendChild(wrapper);

  let pollTimer = null;
  let countdownTimer = null;

  function stillMounted() {
    return container.contains(wrapper);
  }

  function stopTimers() {
    if (pollTimer) clearInterval(pollTimer);
    if (countdownTimer) clearInterval(countdownTimer);
    pollTimer = null;
    countdownTimer = null;
  }

  function renderShell(bodyContent) {
    wrapper.innerHTML = '';

    const title = document.createElement('h1');
    title.className = 'tv-signin-view__title';
    title.textContent = 'Sign in to ClassMate';

    const subtitle = document.createElement('p');
    subtitle.className = 'tv-signin-view__subtitle';
    subtitle.textContent = 'Use your phone to sign in — no password needed on this screen.';

    wrapper.append(title, subtitle, bodyContent);

    if (onBack) {
      const backButton = document.createElement('button');
      backButton.type = 'button';
      backButton.className = 'btn btn--text tv-signin-view__back';
      backButton.textContent = 'Use a Google account on this device instead';
      backButton.addEventListener('click', onBack);
      wrapper.appendChild(backButton);
    }
  }

  function renderPending({ pairingCode, tvSessionToken, expiresAt }) {
    const body = document.createElement('div');
    body.className = 'tv-signin-view__pending';

    const qrContainer = document.createElement('div');
    qrContainer.className = 'tv-signin-view__qr';
    renderPairingQrCode(qrContainer, buildApprovalDeepLink(pairingCode));

    const codeLabel = document.createElement('p');
    codeLabel.className = 'tv-signin-view__code-label';
    codeLabel.textContent = 'Or enter this code on your phone:';

    const code = document.createElement('p');
    code.className = 'tv-signin-view__code';
    code.textContent = pairingCode.replace(/(\d{4})(\d{4})/, '$1 $2');

    const countdown = document.createElement('p');
    countdown.className = 'tv-signin-view__countdown';

    const instructions = document.createElement('p');
    instructions.className = 'tv-signin-view__instructions';
    instructions.textContent = 'On your phone: open ClassMate, sign in with Google if needed, then scan this code or enter it to approve this device.';

    body.append(qrContainer, codeLabel, code, countdown, instructions);
    renderShell(body);

    function updateCountdown() {
      const remainingMs = new Date(expiresAt).getTime() - Date.now();
      if (remainingMs <= 0) {
        countdown.textContent = 'Expired — getting a new code…';
        return;
      }
      const totalSeconds = Math.ceil(remainingMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      countdown.textContent = `Expires in ${minutes}:${String(seconds).padStart(2, '0')}`;
    }
    updateCountdown();
    countdownTimer = setInterval(() => {
      if (!stillMounted()) return stopTimers();
      updateCountdown();
    }, COUNTDOWN_TICK_MS);

    pollTimer = setInterval(async () => {
      if (!stillMounted()) return stopTimers();

      const result = await pollPairingSession(pairingCode, tvSessionToken);
      if (!stillMounted()) return stopTimers();

      if (result.status === 'pending' || result.status === 'rate_limited' || result.status === 'network_error') {
        return; // keep waiting — a transient rate-limit/network hiccup is not a terminal state for the TV
      }
      if (result.status === 'denied') {
        stopTimers();
        return renderDenied();
      }
      if (result.status === 'expired') {
        stopTimers();
        return beginPairing(); // decision #7: automatically invalidate and refresh after expiry, never leave a dead code on screen
      }
      if (result.status === 'approved') {
        stopTimers();
        return renderApproved(result.customToken);
      }
    }, POLL_INTERVAL_MS);
  }

  function renderDenied() {
    const body = document.createElement('div');
    body.className = 'tv-signin-view__denied';

    const message = document.createElement('p');
    message.textContent = 'Sign-in request was denied on your phone.';

    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.className = 'btn btn--primary';
    retryButton.textContent = 'Try again';
    retryButton.addEventListener('click', beginPairing);

    body.append(message, retryButton);
    renderShell(body);
  }

  function renderStartError() {
    const body = document.createElement('div');
    body.className = 'tv-signin-view__error';

    const message = document.createElement('p');
    message.textContent = "Couldn't reach ClassMate. Check this device's internet connection and try again.";

    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.className = 'btn btn--primary';
    retryButton.textContent = 'Retry';
    retryButton.addEventListener('click', beginPairing);

    body.append(message, retryButton);
    renderShell(body);
  }

  async function renderApproved(customToken) {
    const body = document.createElement('div');
    body.className = 'tv-signin-view__approved';
    body.textContent = 'Signing in…';
    renderShell(body);

    // MUST be set before signInWithCustomTokenForSharedDevice() below —
    // that call is what triggers the Firebase auth-state change js/main.js's
    // own top-level listener also reacts to; see
    // deviceSignInTvService.js's own header comment on this flag for the
    // exact race this prevents (main.js must not redirect away from under
    // this confirmation screen before the teacher ever sees it).
    setTransitioningAfterApproval(true);

    const authService = await import('../../services/authService.js');
    try {
      const profile = await authService.signInWithCustomTokenForSharedDevice(customToken);
      if (!stillMounted()) {
        setTransitioningAfterApproval(false);
        return;
      }
      body.innerHTML = '';
      const line1 = document.createElement('p');
      line1.className = 'tv-signin-view__success-line';
      line1.textContent = `✓ Signed in as ${profile.displayName}`;
      const line2 = document.createElement('p');
      line2.className = 'tv-signin-view__success-line';
      line2.textContent = 'Opening your classroom…';
      body.append(line1, line2);
      setTimeout(() => {
        setTransitioningAfterApproval(false);
        if (stillMounted()) onSignedIn(profile);
      }, 1200);
    } catch (error) {
      console.error('[TvSignInView] signInWithCustomTokenForSharedDevice() failed:', error);
      setTransitioningAfterApproval(false);
      if (!stillMounted()) return;
      body.textContent = 'Something went wrong finishing sign-in. Please try again.';
      setTimeout(() => {
        if (stillMounted()) beginPairing();
      }, 2000);
    }
  }

  async function beginPairing() {
    stopTimers();
    const body = document.createElement('div');
    body.className = 'tv-signin-view__starting';
    body.textContent = 'Preparing your sign-in code…';
    renderShell(body);

    const result = await startPairingSession();
    if (!stillMounted()) return;

    if (!result.ok) {
      return renderStartError();
    }
    renderPending(result);
  }

  beginPairing();

  // Returned so a caller with an explicit teardown point (none exists
  // in js/main.js today — see this file's own header comment) can stop
  // timers immediately rather than relying on the stillMounted() self-
  // check noticing on its own next tick.
  return { destroy: stopTimers };
}
