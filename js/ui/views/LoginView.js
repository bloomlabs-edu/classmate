/**
 * ui/views/LoginView.js
 *
 * Shown whenever no teacher is signed in — Google Sign-In only, per the
 * brief. Rendering only: the actual Firebase call lives in
 * services/authService.js and is triggered by main.js, never from
 * inside this (or any) view directly.
 */

export function renderLoginView(container, { onSignIn }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'login-view';

  const title = document.createElement('h1');
  title.className = 'login-view__title';
  title.textContent = 'ClassMate';

  const subtitle = document.createElement('p');
  subtitle.className = 'login-view__subtitle';
  subtitle.textContent = 'Sign in with your Google account to continue.';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--primary btn--large login-view__google-button';
  button.addEventListener('click', onSignIn);

  const icon = document.createElement('span');
  icon.className = 'login-view__google-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = 'G';

  const label = document.createElement('span');
  label.textContent = 'Sign in with Google';

  button.append(icon, label);
  wrapper.append(title, subtitle, button);
  container.appendChild(wrapper);
}
