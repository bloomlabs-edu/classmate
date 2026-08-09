/**
 * ui/student-portal/onboarding/StudentEnrollmentCodeView.js
 *
 * Minimal code-entry step, inserted into the existing onboarding flow
 * right after a student picks their own name off the roster (see
 * StudentDeviceFlow.js's own onSelect callback) — studentId is
 * already known at this point, never typed by the student.
 *
 * Deliberately plain: one text input, one button, no QR, no separate
 * screen chrome beyond what's needed. Real errors from
 * enrollmentService.js are shown directly, not swallowed into a
 * generic message.
 */

import * as enrollmentService from '../../../services/enrollmentService.js';

const ERROR_MESSAGES = {
  NOT_FOUND: 'That code wasn\u2019t found. Double check it and try again.',
  ALREADY_USED: 'That code has already been used.',
  EXPIRED: 'That code has expired \u2014 ask your teacher for a new one.',
  WRONG_STUDENT: 'That code isn\u2019t for this student.',
  NOT_APPROVED_ON_THIS_DEVICE: 'Something went wrong setting up this profile. Try again from the start.',
};

export function renderStudentEnrollmentCodeView(container, { classroomId, studentId, studentName, onEnrolled }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'student-enrollment-code';

  const heading = document.createElement('h2');
  heading.textContent = `One more step, ${studentName}`;
  wrapper.appendChild(heading);

  const message = document.createElement('p');
  message.textContent = 'Ask your teacher for your enrollment code, then enter it below.';
  wrapper.appendChild(message);

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Enrollment code';
  input.autocapitalize = 'characters';
  wrapper.appendChild(input);

  const errorText = document.createElement('p');
  errorText.style.color = 'var(--color-danger, #c0392b)';
  wrapper.appendChild(errorText);

  const submitButton = document.createElement('button');
  submitButton.type = 'button';
  submitButton.className = 'btn btn--primary';
  submitButton.textContent = 'Continue';
  submitButton.addEventListener('click', async () => {
    const code = input.value.trim().toUpperCase();
    if (!code) return;

    errorText.textContent = '';
    submitButton.disabled = true;
    submitButton.textContent = 'Checking\u2026';

    const result = await enrollmentService.redeemEnrollmentToken(code, { classroomId, studentId });

    if (result.success) {
      onEnrolled();
      return;
    }

    submitButton.disabled = false;
    submitButton.textContent = 'Continue';
    errorText.textContent = ERROR_MESSAGES[result.reason] || `Something went wrong: ${result.reason}`;
  });
  wrapper.appendChild(submitButton);

  container.appendChild(wrapper);
}
