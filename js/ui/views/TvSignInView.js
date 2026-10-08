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
 *
 * SYNCHRONIZED STATE MACHINE (added 2026-10-08, first real two-device QA
 * round): the TV now distinguishes "nobody has scanned yet" (`pending`)
 * from "a phone has loaded the approval screen but hasn't decided yet"
 * (`connected`) — see deviceSignInTvService.js's pollPairingSession()
 * and the server's own deviceSignInRepository.js for where this comes
 * from. `connected` is non-terminal and pending-equivalent: the SAME
 * poll loop keeps running across the pending->connected transition,
 * only the on-screen copy changes (QR/code/instructions are replaced
 * with "Phone connected — waiting for approval", since they have no
 * further purpose once a phone has already loaded this exact session).
 *
 * Also changed: an expired session used to be silently, automatically
 * replaced with a fresh one (decision #7's original "never leave a dead
 * code on screen"). Per this round's explicit UX spec, expiry is now a
 * real, visible state with its own "Try Again" action — a teacher who
 * was mid-flow on her phone otherwise has no visible explanation for why
 * the code on the TV suddenly changed underneath her.
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

  /**
   * `title`/`subtitle` are now per-state (previously hardcoded to the
   * initial "Sign in to ClassMate" copy for every single screen this
   * view ever showed, including denial/expiry/error — see this file's
   * own header comment). Defaults preserve exactly that original copy,
   * so the only states that ever need to override them are the ones
   * with their own distinct heading per the UX spec.
   */
  function renderShell(bodyContent, { title = 'Sign in to ClassMate', subtitle = 'Use your phone to sign in — no password needed on this screen.', showBack = true } = {}) {
    wrapper.innerHTML = '';

    const titleEl = document.createElement('h1');
    titleEl.className = 'tv-signin-view__title';
    titleEl.textContent = title;

    wrapper.appendChild(titleEl);

    if (subtitle) {
      const subtitleEl = document.createElement('p');
      subtitleEl.className = 'tv-signin-view__subtitle';
      subtitleEl.textContent = subtitle;
      wrapper.appendChild(subtitleEl);
    }

    wrapper.appendChild(bodyContent);

    if (onBack && showBack) {
      const backButton = document.createElement('button');
      backButton.type = 'button';
      backButton.className = 'btn btn--text tv-signin-view__back';
      backButton.textContent = 'Use a Google account on this device instead';
      backButton.addEventListener('click', onBack);
      wrapper.appendChild(backButton);
    }
  }

  function renderWaitingBody({ pairingCode, expiresAt }) {
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

    function updateCountdown() {
      const remainingMs = new Date(expiresAt).getTime() - Date.now();
      if (remainingMs <= 0) {
        countdown.textContent = 'Expired';
        return;
      }
      const totalSeconds = Math.ceil(remainingMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      countdown.textContent = `Expires in ${minutes}:${String(seconds).padStart(2, '0')}`;
    }
    updateCountdown();
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      if (!stillMounted()) return stopTimers();
      updateCountdown();
    }, COUNTDOWN_TICK_MS);

    return body;
  }

  function renderConnectedBody() {
    const body = document.createElement('div');
    body.className = 'tv-signin-view__connected';

    const spinner = document.createElement('div');
    spinner.className = 'tv-signin-view__spinner';
    spinner.setAttribute('aria-hidden', 'true');

    const note = document.createElement('p');
    note.className = 'tv-signin-view__instructions';
    note.textContent = 'Check your phone to finish signing in.';

    body.append(spinner, note);
    return body;
  }

  /**
   * One active pairing session: starts in the `waiting` phase (QR/code/
   * countdown), moves forward to `connected` the first time a poll
   * reports it (never backward — see this file's own header comment on
   * why `connected` is pending-equivalent but still a forward-only UI
   * transition), and keeps the SAME poll/countdown timers running across
   * that transition. Only a terminal poll outcome (approved/denied/
   * expired) ever stops them.
   */
  function renderPending({ pairingCode, tvSessionToken, expiresAt }) {
    let phase = 'waiting';
    renderShell(renderWaitingBody({ pairingCode, expiresAt }));

    pollTimer = setInterval(async () => {
      if (!stillMounted()) return stopTimers();

      const result = await pollPairingSession(pairingCode, tvSessionToken);
      if (!stillMounted()) return stopTimers();

      if (result.status === 'rate_limited' || result.status === 'network_error') {
        return; // transient — not a terminal state for the TV, keep the current phase on screen
      }
      if (result.status === 'pending') {
        return; // still phase 'waiting' — nothing changes
      }
      if (result.status === 'connected') {
        if (phase !== 'connected') {
          phase = 'connected';
          // The waiting phase's own countdown display has no further
          // purpose once a phone has connected (QR/code are gone from
          // screen) -- stop it rather than leaving it silently ticking
          // against a now-detached DOM node. The poll loop itself (this
          // very setInterval) is what actually detects a real expiry
          // from here on, same as it always has.
          if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
          }
          renderShell(renderConnectedBody(), { title: 'Phone connected', subtitle: 'Waiting for approval on your phone…' });
        }
        return;
      }
      if (result.status === 'denied') {
        stopTimers();
        return renderDenied();
      }
      if (result.status === 'expired') {
        stopTimers();
        return renderExpired();
      }
      if (result.status === 'approved') {
        stopTimers();
        return renderApproved(result.customToken);
      }
    }, POLL_INTERVAL_MS);
  }

  function renderRetryBody(retryLabel = 'Try Again') {
    const body = document.createElement('div');
    body.className = 'tv-signin-view__retry-body';

    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.className = 'btn btn--primary';
    retryButton.textContent = retryLabel;
    retryButton.addEventListener('click', beginPairing);

    body.appendChild(retryButton);
    return body;
  }

  function renderDenied() {
    renderShell(renderRetryBody(), { title: 'Sign-in cancelled', subtitle: '' });
  }

  function renderExpired() {
    renderShell(renderRetryBody(), { title: 'Sign-in request expired', subtitle: 'Start a new request to continue.' });
  }

  function renderStartError() {
    renderShell(renderRetryBody('Retry'), {
      title: 'Something went wrong',
      subtitle: "Couldn't reach ClassMate. Check this device's internet connection and try again.",
    });
  }

  async function renderApproved(customToken) {
    const body = document.createElement('div');
    body.className = 'tv-signin-view__approved';
    renderShell(body, { title: '✓ Signed in', subtitle: 'Opening ClassMate…' });

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
      const line = document.createElement('p');
      line.className = 'tv-signin-view__success-line';
      line.textContent = `Signed in as ${profile.displayName}`;
      body.innerHTML = '';
      body.appendChild(line);
      setTimeout(() => {
        setTransitioningAfterApproval(false);
        if (stillMounted()) onSignedIn(profile);
      }, 1200);
    } catch (error) {
      console.error('[TvSignInView] signInWithCustomTokenForSharedDevice() failed:', error);
      setTransitioningAfterApproval(false);
      if (!stillMounted()) return;
      renderShell(renderRetryBody(), {
        title: 'Something went wrong',
        subtitle: 'Please start a new sign-in request.',
      });
    }
  }

  async function beginPairing() {
    stopTimers();
    const body = document.createElement('div');
    body.className = 'tv-signin-view__starting';
    const spinner = document.createElement('div');
    spinner.className = 'tv-signin-view__spinner';
    spinner.setAttribute('aria-hidden', 'true');
    body.appendChild(spinner);
    renderShell(body, { subtitle: 'Preparing your sign-in code…' });

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
