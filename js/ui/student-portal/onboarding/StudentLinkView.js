/**
 * ui/student-portal/onboarding/StudentLinkView.js
 *
 * Shown after Google sign-in when the signed-in account isn't linked
 * to any student yet. Two paths, both handled by this one screen:
 *
 *  - An invitation-link token in the URL (?token=...) — resolved and
 *    redeemed automatically, no PIN needed. This is the "even smoother
 *    onboarding" path: a parent who tapped a shared link never sees a
 *    PIN field at all.
 *  - No token (or token invalid/expired) — falls back to manual PIN
 *    entry, exactly as the base flow specifies. The PIN stays
 *    available as a fallback whenever sharing a link isn't practical.
 *
 * Either way, this screen only ever calls
 * services/studentIdentityService.js — never the repository or
 * provider directly.
 */

import { linkWithPin, linkWithInvitationToken } from '../../../services/studentIdentityService.js';
import { createIcon } from '../../components/Icon.js';

export function renderStudentLinkView(container, { invitationToken, onLinked }) {
  container.innerHTML = '';

  if (invitationToken) {
    renderRedeemingToken(container, { invitationToken, onLinked });
    return;
  }

  renderPinEntry(container, { onLinked });
}

async function renderRedeemingToken(container, { invitationToken, onLinked }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'student-join-code';

  const message = document.createElement('p');
  message.className = 'student-join-code__subtitle';
  message.textContent = 'Linking your account\u2026';
  wrapper.appendChild(message);
  container.appendChild(wrapper);

  const studentRef = await linkWithInvitationToken(invitationToken);
  if (studentRef) {
    onLinked(studentRef);
    return;
  }

  // Token invalid, expired, or already used — fall back to the PIN,
  // exactly as the base flow specifies, rather than a dead end.
  renderPinEntry(container, { onLinked, fallbackNotice: 'That invitation link has expired or was already used. Enter your Student PIN instead.' });
}

function renderPinEntry(container, { onLinked, fallbackNotice }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'student-join-code';

  const icon = createIcon('key', { className: 'student-join-code__icon', size: 32, strokeWidth: 1.5 });

  const title = document.createElement('h1');
  title.className = 'student-join-code__title';
  title.textContent = 'One more step';

  const subtitle = document.createElement('p');
  subtitle.className = 'student-join-code__subtitle';
  subtitle.textContent =
    fallbackNotice || 'Enter the Student PIN your teacher shared with you. You\u2019ll only need to do this once.';

  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.className = 'student-join-code__input';
  input.placeholder = 'e.g. 123456';
  input.setAttribute('aria-label', 'Student PIN');

  const errorMessage = document.createElement('p');
  errorMessage.className = 'student-join-code__error';
  errorMessage.hidden = true;

  const continueButton = document.createElement('button');
  continueButton.type = 'button';
  continueButton.className = 'btn btn--primary btn--large';
  continueButton.textContent = 'Continue';

  continueButton.addEventListener('click', async () => {
    const pin = input.value.trim();
    if (pin.length < 4) {
      errorMessage.textContent = 'Enter the Student PIN your teacher shared with you.';
      errorMessage.hidden = false;
      input.focus();
      return;
    }
    continueButton.disabled = true;
    const studentRef = await linkWithPin(pin);
    if (!studentRef) {
      errorMessage.textContent = 'That PIN doesn\u2019t match a student. Check with your teacher and try again.';
      errorMessage.hidden = false;
      continueButton.disabled = false;
      return;
    }
    onLinked(studentRef);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') continueButton.click();
  });

  wrapper.append(icon, title, subtitle, input, errorMessage, continueButton);
  container.appendChild(wrapper);
  input.focus();
}
