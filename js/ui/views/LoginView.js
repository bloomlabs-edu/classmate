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

  // Two-tone wordmark, not the CM monogram (assets/icons/classmate-icon.svg
  // is the app ICON, documented as such — favicon/PWA use only; the
  // branding foundation doc itself lists "Final ClassMate logo"/"Logo
  // colour treatment" as still-open decisions, so there is no separate
  // wordmark asset to pull in here). Reuses the exact same fixed hex
  // pair the monogram's own "C"/"M" letters already use
  // (classmate-icon.svg: #1565C0 / #ff9b65) — not this app's
  // customizable per-teacher accent color (--color-primary-deep), since
  // a brandmark should read the same regardless of a signed-in
  // teacher's own theme choice, and this screen renders before any
  // teacher/accent color is even known.
  const title = document.createElement('h1');
  title.className = 'login-view__title';
  const classPart = document.createElement('span');
  classPart.className = 'login-view__title-class';
  classPart.textContent = 'Class';
  const matePart = document.createElement('span');
  matePart.className = 'login-view__title-mate';
  matePart.textContent = 'Mate';
  title.append(classPart, matePart);

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
