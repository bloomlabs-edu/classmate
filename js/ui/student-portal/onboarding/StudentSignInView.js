/**
 * ui/student-portal/onboarding/StudentSignInView.js
 *
 * The Student Portal's actual first screen now — "Continue with
 * Google," per the finalized authentication direction. Calls
 * services/studentIdentityService.js's signIn() only; has no idea
 * whether that's really Firebase Auth or (today) DemoIdentityProvider
 * underneath, which is exactly the point of the architecture.
 */

import { signIn } from '../../../services/studentIdentityService.js';
import { createIcon } from '../../components/Icon.js';

export function renderStudentSignInView(container, { onSignedIn }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'student-join-code';

  const icon = createIcon('graduation-cap', { className: 'student-join-code__icon', size: 32, strokeWidth: 1.5 });

  const title = document.createElement('h1');
  title.className = 'student-join-code__title';
  title.textContent = 'Welcome!';

  const subtitle = document.createElement('p');
  subtitle.className = 'student-join-code__subtitle';
  subtitle.textContent = 'Sign in to see your progress and achievements.';

  const signInButton = document.createElement('button');
  signInButton.type = 'button';
  signInButton.className = 'btn btn--primary btn--large';
  signInButton.textContent = 'Continue with Google';
  signInButton.addEventListener('click', async () => {
    signInButton.disabled = true;
    signInButton.textContent = 'Signing in\u2026';
    await signIn();
    onSignedIn();
  });

  wrapper.append(icon, title, subtitle, signInButton);
  container.appendChild(wrapper);
}
