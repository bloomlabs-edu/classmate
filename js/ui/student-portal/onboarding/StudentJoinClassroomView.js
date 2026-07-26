/**
 * ui/student-portal/onboarding/StudentJoinClassroomView.js
 *
 * The new front door to the Student Portal: enter a classroom code,
 * see the real roster, done. No Google sign-in, no PIN, no invitation
 * link — replacing StudentOnboardingFlow.js's PIN-first sequence as
 * the default path, per this project's CHANGELOG (the multi-round
 * architecture discussion this implements). That older flow, and the
 * whole identity/consent/PIN layer beneath it, is left in place,
 * unused rather than deleted — it still backs the (now secondary)
 * authenticated parent-connection path, a decision this phase
 * deliberately didn't unwind.
 *
 * Reuses the .student-join-code CSS classes originally built for the
 * even earlier, since-superseded classroom-code flow — unused since
 * that flow was replaced by Google+PIN, and a good visual fit for
 * this one rather than needing new styles invented from scratch.
 */

import * as workspaceService from '../../../services/workspaceService.js';
import { createIcon } from '../../components/Icon.js';

export function renderStudentJoinClassroomView(container, { onClassroomResolved }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'student-join-code';

  const icon = createIcon('graduation-cap', { className: 'student-join-code__icon', size: 32, strokeWidth: 1.5 });

  const title = document.createElement('h1');
  title.className = 'student-join-code__title';
  title.textContent = 'Welcome!';

  const subtitle = document.createElement('p');
  subtitle.className = 'student-join-code__subtitle';
  subtitle.textContent = 'Enter your classroom code to get started.';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'student-join-code__input';
  input.placeholder = 'e.g. ABCD12';
  input.autocapitalize = 'characters';
  input.maxLength = 6;

  const errorMessage = document.createElement('p');
  errorMessage.className = 'student-join-code__error';
  errorMessage.hidden = true;

  const continueButton = document.createElement('button');
  continueButton.type = 'button';
  continueButton.className = 'btn btn--primary btn--large';
  continueButton.textContent = 'Continue';
  continueButton.addEventListener('click', async () => {
    const code = input.value.trim();
    if (!code) return;

    errorMessage.hidden = true;
    continueButton.disabled = true;
    continueButton.textContent = 'Checking\u2026';

    const classroom = await workspaceService.resolveStudentJoinCode(code);

    continueButton.disabled = false;
    continueButton.textContent = 'Continue';

    if (!classroom) {
      errorMessage.textContent = "That code doesn't match a classroom. Please check with your teacher.";
      errorMessage.hidden = false;
      return;
    }

    onClassroomResolved(classroom);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') continueButton.click();
  });

  wrapper.append(icon, title, subtitle, input, errorMessage, continueButton);
  container.appendChild(wrapper);
}
