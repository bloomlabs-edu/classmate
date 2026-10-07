/**
 * ui/views/ApproveDeviceSignInView.js
 *
 * The teacher's-own-phone side of "Sign in with Phone" (see
 * docs/architecture/TV_PHONE_SIGNIN_DESIGN.md). Reached either via the
 * TV's QR deep link (`#/approve-sign-in/{code}`) or a bare
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
 */
import { getDeviceSignInRequestInfo, approveDeviceSignIn, denyDeviceSignIn } from '../../services/deviceSignInApprovalService.js';

const PAIRING_CODE_LENGTH = 8;

function formatRequestedAt(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return 'just now';
  }
}

export function renderApproveDeviceSignInView(container, { pairingCode, getIdToken, onDone }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'approve-device-signin-view';
  container.appendChild(wrapper);

  function renderCodeEntry(prefillCode, errorMessage) {
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

    const continueButton = document.createElement('button');
    continueButton.type = 'button';
    continueButton.className = 'btn btn--primary';
    continueButton.textContent = 'Continue';
    continueButton.addEventListener('click', () => {
      const code = input.value.replace(/\D/g, '');
      if (code.length !== PAIRING_CODE_LENGTH) {
        renderCodeEntry(code, `Enter the full ${PAIRING_CODE_LENGTH}-digit code.`);
        return;
      }
      loadRequestInfo(code);
    });

    wrapper.append(title, subtitle, input, continueButton);

    if (errorMessage) {
      const error = document.createElement('p');
      error.className = 'approve-device-signin-view__error';
      error.textContent = errorMessage;
      wrapper.appendChild(error);
    }
  }

  function renderMessage(text, { isError = false } = {}) {
    wrapper.innerHTML = '';
    const message = document.createElement('p');
    message.className = isError ? 'approve-device-signin-view__error' : 'approve-device-signin-view__message';
    message.textContent = text;
    wrapper.appendChild(message);

    if (onDone) {
      const doneButton = document.createElement('button');
      doneButton.type = 'button';
      doneButton.className = 'btn btn--secondary';
      doneButton.textContent = 'Done';
      doneButton.addEventListener('click', onDone);
      wrapper.appendChild(doneButton);
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
    renderMessage('Checking code…');
    const idToken = await getIdToken();
    const info = await getDeviceSignInRequestInfo(idToken, code);

    if (!info.ok) {
      renderCodeEntry(code, REASON_TO_MESSAGE[info.reason] || REASON_TO_MESSAGE.error);
      return;
    }

    renderConfirm(code, info);
  }

  function renderConfirm(code, info) {
    wrapper.innerHTML = '';

    const title = document.createElement('h1');
    title.textContent = 'Sign in to this device?';

    const deviceLine = document.createElement('p');
    deviceLine.className = 'approve-device-signin-view__device';
    deviceLine.textContent = info.deviceLabel;

    const timeLine = document.createElement('p');
    timeLine.className = 'approve-device-signin-view__time';
    timeLine.textContent = `Requested at ${formatRequestedAt(info.requestedAt)}`;

    const warning = document.createElement('p');
    warning.className = 'approve-device-signin-view__warning';
    warning.textContent = "Only approve this if you're actually standing at this device right now.";

    const buttonRow = document.createElement('div');
    buttonRow.className = 'approve-device-signin-view__buttons';

    const approveButton = document.createElement('button');
    approveButton.type = 'button';
    approveButton.className = 'btn btn--primary';
    approveButton.textContent = 'Approve';
    approveButton.addEventListener('click', async () => {
      approveButton.disabled = true;
      denyButton.disabled = true;
      const idToken = await getIdToken();
      const result = await approveDeviceSignIn(idToken, code);
      if (!result.ok) {
        renderMessage(REASON_TO_MESSAGE[result.reason] || REASON_TO_MESSAGE.error, { isError: true });
        return;
      }
      renderMessage(`✅ ${info.deviceLabel} is now signed in. It will stay signed in until someone signs out there.`);
    });

    const denyButton = document.createElement('button');
    denyButton.type = 'button';
    denyButton.className = 'btn btn--secondary';
    denyButton.textContent = 'Deny';
    denyButton.addEventListener('click', async () => {
      approveButton.disabled = true;
      denyButton.disabled = true;
      const idToken = await getIdToken();
      const result = await denyDeviceSignIn(idToken, code);
      if (!result.ok) {
        renderMessage(REASON_TO_MESSAGE[result.reason] || REASON_TO_MESSAGE.error, { isError: true });
        return;
      }
      renderMessage('Sign-in request denied.');
    });

    buttonRow.append(approveButton, denyButton);
    wrapper.append(title, deviceLine, timeLine, warning, buttonRow);
  }

  if (pairingCode && /^\d{8}$/.test(pairingCode)) {
    loadRequestInfo(pairingCode);
  } else {
    renderCodeEntry(pairingCode);
  }
}
