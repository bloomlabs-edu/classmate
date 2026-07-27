/**
 * ui/student-portal/onboarding/StudentDevicePinPromptView.js
 *
 * Gates the two actions that change which students an already-claimed
 * device trusts — adding a 2nd/3rd profile, or removing one (see
 * services/studentDeviceService.js's trusted-device model). Never
 * shown for a fresh device's first profile, and never shown to switch
 * between profiles already approved on this device — both of those
 * stay PIN-free by design.
 *
 * Verifies against workspaceService.verifyDeviceResetPin(), a
 * read-only check against the classroom's own `deviceResetPin` field
 * (see models/Classroom.js's doc comment on that field).
 *
 * Basic throttling after repeated wrong attempts — a short numeric
 * PIN is guessable fast on a phone's number pad by a curious student
 * with nothing better to do between classes, and this is the one spot
 * in the whole flow worth hardening against that specifically. Not a
 * defense against a determined attacker, just friction proportionate
 * to what this PIN actually protects.
 */

import { verifyDeviceResetPin } from '../../../services/workspaceService.js';
import { createIcon } from '../../components/Icon.js';

const LOCKOUT_AFTER_ATTEMPTS = 3;
const LOCKOUT_SECONDS = 20;

export function renderStudentDevicePinPromptView(container, { classroomId, title = 'Enter Device PIN', message, onVerified, onCancel }) {
  container.innerHTML = '';

  let attempts = 0;
  let lockedUntil = 0;

  const wrapper = document.createElement('div');
  wrapper.className = 'student-pin-prompt';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append('Cancel');
  backButton.addEventListener('click', onCancel);
  wrapper.appendChild(backButton);

  const titleEl = document.createElement('h1');
  titleEl.className = 'student-pin-prompt__title';
  titleEl.textContent = title;
  wrapper.appendChild(titleEl);

  if (message) {
    const messageEl = document.createElement('p');
    messageEl.className = 'student-pin-prompt__message';
    messageEl.textContent = message;
    wrapper.appendChild(messageEl);
  }

  const input = document.createElement('input');
  input.type = 'tel';
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  input.maxLength = 8;
  input.className = 'student-pin-prompt__input';
  input.placeholder = 'PIN';
  wrapper.appendChild(input);

  const errorEl = document.createElement('p');
  errorEl.className = 'student-pin-prompt__error';
  wrapper.appendChild(errorEl);

  const submitButton = document.createElement('button');
  submitButton.type = 'button';
  submitButton.className = 'btn btn--primary';
  submitButton.textContent = 'Submit';
  wrapper.appendChild(submitButton);

  async function handleSubmit() {
    const now = Date.now();
    if (now < lockedUntil) {
      const secondsLeft = Math.ceil((lockedUntil - now) / 1000);
      errorEl.textContent = `Too many attempts. Try again in ${secondsLeft}s.`;
      return;
    }

    const enteredPin = input.value.trim();
    if (!enteredPin) return;

    submitButton.disabled = true;
    errorEl.textContent = '';

    try {
      const isValid = await verifyDeviceResetPin(classroomId, enteredPin);
      if (isValid) {
        onVerified();
        return;
      }
      attempts += 1;
      if (attempts >= LOCKOUT_AFTER_ATTEMPTS) {
        lockedUntil = Date.now() + LOCKOUT_SECONDS * 1000;
        errorEl.textContent = `Incorrect PIN. Try again in ${LOCKOUT_SECONDS}s.`;
        attempts = 0;
      } else {
        errorEl.textContent = 'Incorrect PIN. Ask your teacher for it.';
      }
      input.value = '';
    } catch (error) {
      console.error('[StudentDevicePinPromptView] PIN verification failed:', error);
      errorEl.textContent = "Couldn't check the PIN right now. Check your connection and try again.";
    } finally {
      submitButton.disabled = false;
    }
  }

  submitButton.addEventListener('click', handleSubmit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handleSubmit();
  });

  container.appendChild(wrapper);
  input.focus();
}
