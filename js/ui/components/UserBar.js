/**
 * ui/components/UserBar.js
 *
 * A small persistent bar (avatar + name + accent-color edit button +
 * a notification-settings bell + a link back to Bloom Labs + Sign
 * Out) shown above every screen once a teacher is signed in — added
 * once here, in main.js, rather than duplicated into every view's own
 * header.
 *
 * The notification bell mirrors the accent-color editor's own
 * button/popover shape immediately below it. It only ever explains
 * what enabling browser push notifications does and offers an
 * Enable/Disable action — the actual permission prompt, token
 * registration, and Firestore save/remove all live in
 * services/pushNotificationService.js, called via main.js's own
 * handleEnableNotifications()/handleDisableNotifications(), matching
 * this file's own "rendering only" role exactly.
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
import { createIcon } from './Icon.js';

export function renderUserBar(container, { user, onSignOut, currentAccentColorId, onSelectAccentColor, onSelectCustomAccentColor, onPreviewCustomAccentColor, onBackToLanding, notificationPermissionState, onEnableNotifications, onDisableNotifications, notificationUnreadCount }) {
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

    const pencilIcon = createIcon('palette', { className: 'user-bar__color-edit-icon', size: 16 });
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

  if (notificationPermissionState && (onEnableNotifications || onDisableNotifications)) {
    rightGroup.appendChild(
      createNotificationControl(notificationPermissionState, onEnableNotifications, onDisableNotifications, notificationUnreadCount)
    );
  }

  if (onBackToLanding) {
    const landingLink = document.createElement('button');
    landingLink.type = 'button';
    landingLink.className = 'btn btn--text';
    landingLink.appendChild(createIcon('arrow-left'));
    landingLink.append('Home');
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

/**
 * Bell icon + popover, mirroring the accent-color editor's own
 * button/popover/outside-click-to-close shape immediately above --
 * deliberately not a new interaction pattern. Explains what enabling
 * notifications actually does before offering the action, per explicit
 * product direction; never shows anything beyond a small "granted"
 * dot on the bell itself until a teacher opens this popover.
 *
 * `unreadCount` is optional and purely presentational here -- there is
 * no unread-notification store/count anywhere in this app yet (see
 * services/pushNotificationService.js's own header comment: this is
 * still Phase 1, registration only), so no caller currently passes a
 * real value and this renders no badge at all today. Accepting it
 * now just means a later phase can wire up a real count without
 * touching this component again.
 */
function createNotificationControl(permissionState, onEnable, onDisable, unreadCount) {
  const count = Math.max(0, Number(unreadCount) || 0);

  const wrapper = document.createElement('div');
  wrapper.className = 'user-bar__notification-control';

  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'user-bar__notification-button';
  toggleButton.setAttribute('aria-label', count > 0 ? `Notification settings, ${count} unread` : 'Notification settings');
  toggleButton.setAttribute('aria-expanded', 'false');
  toggleButton.title = 'Notification settings';
  toggleButton.appendChild(createIcon('bell', { className: 'user-bar__notification-icon', size: 20 }));
  // The "granted" dot and the unread badge below both occupy the same
  // top-right corner of the bell -- only ever show one at a time, and
  // the badge (an actual count needing attention) wins.
  if (permissionState === 'granted' && count === 0) {
    const dot = document.createElement('span');
    dot.className = 'user-bar__notification-dot';
    dot.setAttribute('aria-hidden', 'true');
    toggleButton.appendChild(dot);
  }

  const popover = document.createElement('div');
  popover.className = 'user-bar__notification-popover';
  popover.setAttribute('role', 'group');
  popover.setAttribute('aria-label', 'Notification settings');

  const explanation = document.createElement('p');
  explanation.className = 'user-bar__notification-explanation';
  explanation.textContent =
    'Get a browser notification when something in ClassMate needs your attention — even when this tab isn’t open. Nothing is sent automatically today; this only turns on the ability to receive one later.';
  popover.appendChild(explanation);

  const status = document.createElement('p');
  status.className = 'user-bar__notification-status';
  if (permissionState === 'unsupported') {
    status.textContent = 'Notifications aren’t supported in this browser.';
  } else if (permissionState === 'granted') {
    status.textContent = 'Notifications are enabled on this device.';
  } else if (permissionState === 'denied') {
    status.textContent = 'Notifications are blocked for this site — allow them from your browser’s site settings, then reopen this.';
  } else {
    status.textContent = 'Notifications are not enabled on this device yet.';
  }
  popover.appendChild(status);

  if (permissionState === 'granted' && onDisable) {
    const disableButton = document.createElement('button');
    disableButton.type = 'button';
    disableButton.className = 'btn btn--text';
    disableButton.textContent = 'Turn off notifications';
    disableButton.addEventListener('click', () => {
      closePopover();
      onDisable();
    });
    popover.appendChild(disableButton);
  } else if (permissionState !== 'denied' && permissionState !== 'unsupported' && onEnable) {
    const enableButton = document.createElement('button');
    enableButton.type = 'button';
    enableButton.className = 'btn btn--secondary';
    enableButton.textContent = 'Enable notifications';
    enableButton.addEventListener('click', () => {
      closePopover();
      onEnable();
    });
    popover.appendChild(enableButton);
  }

  function closePopover() {
    popover.classList.remove('user-bar__notification-popover--open');
    toggleButton.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', handleOutsideClick);
  }

  function handleOutsideClick(event) {
    if (!wrapper.contains(event.target)) closePopover();
  }

  toggleButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = popover.classList.toggle('user-bar__notification-popover--open');
    toggleButton.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      setTimeout(() => document.addEventListener('click', handleOutsideClick), 0);
    } else {
      document.removeEventListener('click', handleOutsideClick);
    }
  });

  // Positioned on `wrapper`, not `toggleButton` -- overlaps the
  // button's own top-right corner (see .user-bar__notification-badge)
  // without needing the button itself to know about it.
  if (count > 0) {
    const badge = document.createElement('span');
    badge.className = 'user-bar__notification-badge' + (count > 9 ? ' user-bar__notification-badge--wide' : '');
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.setAttribute('aria-hidden', 'true');
    wrapper.appendChild(badge);
  }

  wrapper.append(toggleButton, popover);
  return wrapper;
}
