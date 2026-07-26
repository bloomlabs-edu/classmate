/**
 * ui/components/UserBar.js
 *
 * A small persistent bar (avatar + name + accent-color edit button +
 * a link back to Bloom Labs + Sign Out) shown above every screen once
 * a teacher is signed in — added once here, in main.js, rather than
 * duplicated into every view's own header.
 *
 * The "\u2190 Bloom Labs" link exists purely so a signed-in teacher can
 * get back to the platform landing page (and from there, the Student
 * placeholder) without editing the URL by hand — there was previously
 * no in-app way to do this once inside the teacher app. It does not
 * sign anyone out or touch auth state; it's just navigation.
 *
 * The color edit control is icon-only (a pencil, no "Edit" label) and
 * sits grouped with Sign Out on the right side of the bar, per explicit
 * direction. Its popover now contains a real 2D gradient picker (see
 * SpectrumColorPicker.js) instead of the browser's native OS color
 * dialog — "spectrum color picker" specifically meant an inline visual
 * square with a marker dot, not whatever `<input type="color">` opens.
 *
 * Rendering only; the actual sign-out call lives in
 * services/authService.js, and the actual apply/persist calls live in
 * services/accentColorService.js and
 * services/accentColorPreferenceService.js, both via main.js.
 */

import { ACCENT_COLOR_OPTIONS } from '../../config/accentColorConfig.js';
import { createSpectrumColorPicker } from './SpectrumColorPicker.js';

export function renderUserBar(container, { user, onSignOut, currentAccentColorId, onSelectAccentColor, onSelectCustomAccentColor, onPreviewCustomAccentColor, onBackToLanding }) {
  container.innerHTML = '';
  if (!user) return;

  const bar = document.createElement('div');
  bar.className = 'user-bar';

  const identity = document.createElement('div');
  identity.className = 'user-bar__identity';

  if (user.photoURL) {
    const avatar = document.createElement('img');
    avatar.className = 'user-bar__avatar';
    avatar.src = user.photoURL;
    avatar.alt = '';
    avatar.referrerPolicy = 'no-referrer';
    identity.appendChild(avatar);
  } else {
    const fallback = document.createElement('span');
    fallback.className = 'user-bar__avatar user-bar__avatar--fallback';
    fallback.textContent = (user.displayName || 'T').charAt(0).toUpperCase();
    identity.appendChild(fallback);
  }

  const name = document.createElement('span');
  name.className = 'user-bar__name';
  name.textContent = user.displayName;
  identity.appendChild(name);

  bar.appendChild(identity);

  // Grouped together so `.user-bar`'s space-between layout puts both
  // on the right side, adjacent to each other, rather than the color
  // editor floating in the middle of the bar.
  const rightGroup = document.createElement('div');
  rightGroup.className = 'user-bar__right-group';

  if (currentAccentColorId && onSelectAccentColor) {
    const isCustomActive = currentAccentColorId.startsWith('#');
    const currentHex = isCustomActive
      ? currentAccentColorId
      : ACCENT_COLOR_OPTIONS.find((option) => option.id === currentAccentColorId)?.hex || '#5ea6da';

    const pickerWrapper = document.createElement('div');
    pickerWrapper.className = 'user-bar__color-editor';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'user-bar__color-edit-button';
    editButton.setAttribute('aria-label', 'Edit accent color');
    editButton.setAttribute('aria-expanded', 'false');
    editButton.title = 'Edit accent color';

    const currentSwatch = document.createElement('span');
    currentSwatch.className = 'user-bar__color-edit-swatch';
    currentSwatch.style.backgroundColor = currentHex;
    editButton.appendChild(currentSwatch);

    const pencilIcon = document.createElement('span');
    pencilIcon.className = 'user-bar__color-edit-icon';
    pencilIcon.setAttribute('aria-hidden', 'true');
    pencilIcon.textContent = '\u270f\ufe0f';
    editButton.appendChild(pencilIcon);

    const popover = document.createElement('div');
    popover.className = 'user-bar__color-popover';
    popover.setAttribute('role', 'group');
    popover.setAttribute('aria-label', 'Accent color options');

    const presetRow = document.createElement('div');
    presetRow.className = 'user-bar__color-presets';
    ACCENT_COLOR_OPTIONS.forEach((option) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className =
        'user-bar__color-swatch' + (option.id === currentAccentColorId ? ' user-bar__color-swatch--active' : '');
      swatch.style.backgroundColor = option.hex;
      swatch.title = option.label;
      swatch.setAttribute('aria-label', option.label + (option.id === currentAccentColorId ? ' (current)' : ''));
      swatch.addEventListener('click', () => {
        onSelectAccentColor(option.id);
        closePopover();
      });
      presetRow.appendChild(swatch);
    });
    popover.appendChild(presetRow);

    if (onSelectCustomAccentColor) {
      const spectrum = createSpectrumColorPicker({
        initialHex: currentHex,
        onChange: (hex) => onPreviewCustomAccentColor?.(hex),
        onChangeComplete: (hex) => onSelectCustomAccentColor(hex),
      });
      popover.appendChild(spectrum);
    }

    function closePopover() {
      popover.classList.remove('user-bar__color-popover--open');
      editButton.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', handleOutsideClick);
    }

    function handleOutsideClick(event) {
      if (!pickerWrapper.contains(event.target)) closePopover();
    }

    editButton.addEventListener('click', (event) => {
      event.stopPropagation();
      const isOpen = popover.classList.toggle('user-bar__color-popover--open');
      editButton.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) {
        // Registered a tick later so this same click doesn't immediately close what it just opened.
        setTimeout(() => document.addEventListener('click', handleOutsideClick), 0);
      } else {
        document.removeEventListener('click', handleOutsideClick);
      }
    });

    pickerWrapper.append(editButton, popover);
    rightGroup.appendChild(pickerWrapper);
  }

  if (onBackToLanding) {
    const landingLink = document.createElement('button');
    landingLink.type = 'button';
    landingLink.className = 'btn btn--text';
    landingLink.textContent = '\u2190 Home';
    landingLink.title = 'Back to Home';
    landingLink.addEventListener('click', onBackToLanding);
    rightGroup.appendChild(landingLink);
  }

  const signOutButton = document.createElement('button');
  signOutButton.type = 'button';
  signOutButton.className = 'btn btn--text';
  signOutButton.textContent = 'Sign Out';
  signOutButton.addEventListener('click', onSignOut);
  rightGroup.appendChild(signOutButton);

  bar.appendChild(rightGroup);
  container.appendChild(bar);
}
