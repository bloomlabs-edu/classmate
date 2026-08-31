/**
 * ui/components/UserBar.js
 *
 * A small persistent bar (avatar + name + accent-color edit button +
 * a notification-settings bell + a link back to the teacher Overview
 * + Sign Out) shown above every screen once a teacher is signed in — added
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
 * The "\u2190 Overview" link takes a signed-in teacher back to their
 * own cross-classroom landing page (ui/views/PersonalHubView.js,
 * route #/teacher) \u2014 NOT the Bloom Labs / Student Portal picker at
 * the bare #/ route. It used to point there (labeled "Home"), which
 * meant clicking it from inside a classroom landed on a
 * portal-selection screen instead of the teacher's own Overview \u2014 a
 * real, reported navigation bug, not a design choice. That platform
 * picker still exists and is still reachable through its own intended
 * flow (opening the app fresh with no hash, or after a full
 * sign-out); this bar just never sends a signed-in teacher there
 * anymore. It does not sign anyone out or touch auth state; it's just
 * navigation.
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

export function renderUserBar(container, { user, onSignOut, currentAccentColorId, onSelectAccentColor, onSelectCustomAccentColor, onPreviewCustomAccentColor, onGoToOverview, notificationPermissionState, onEnableNotifications, onDisableNotifications, notificationUnreadCount, notifications, hasClassroomContext, onOpenNotification, onNotificationsViewed }) {
  container.innerHTML = '';
  if (!user) return;

  const bar = document.createElement('div');
  bar.className = 'user-bar';

  // Phase P — mobile only (see css/styles.css's own @media rule):
  // toggles .user-bar__secondary-menu open/closed. Inert and invisible
  // at desktop widths, where the secondary actions it controls stay
  // inline exactly as before — this never becomes a second navigation
  // system, only a CSS-driven collapse of the same existing actions.
  const menuToggle = document.createElement('button');
  menuToggle.type = 'button';
  menuToggle.className = 'user-bar__menu-toggle';
  menuToggle.setAttribute('aria-label', 'More actions');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.appendChild(createIcon('menu', { size: 20 }));
  bar.appendChild(menuToggle);

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

  // Phase P — the color editor, "Home" link, and Sign Out all move
  // into this sub-group. At desktop widths css/styles.css keeps it
  // laid out exactly as before (an inline row, no visual change); at
  // mobile widths it becomes menuToggle's own dropdown instead, per
  // the approved reference's cleaner mobile top bar. The notification
  // control is deliberately NOT part of this group — it stays directly
  // in rightGroup, always visible at every width, matching the
  // reference's own "hamburger + identity + notification" hierarchy.
  const secondaryMenu = document.createElement('div');
  secondaryMenu.className = 'user-bar__secondary-menu';

  menuToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = secondaryMenu.classList.toggle('user-bar__secondary-menu--open');
    menuToggle.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      setTimeout(() => document.addEventListener('click', handleOutsideMenuClick), 0);
    } else {
      document.removeEventListener('click', handleOutsideMenuClick);
    }
  });
  function handleOutsideMenuClick(event) {
    if (!secondaryMenu.contains(event.target) && event.target !== menuToggle) {
      secondaryMenu.classList.remove('user-bar__secondary-menu--open');
      menuToggle.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', handleOutsideMenuClick);
    }
  }
  // Appended now, filled in below — keeps this group's own children
  // (color editor, Home, Sign Out) in exactly the same relative DOM
  // order, before the notification control, that they already had
  // before this change; only the mobile CSS collapse is new.
  rightGroup.appendChild(secondaryMenu);

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
    secondaryMenu.appendChild(pickerWrapper);
  }

  if (notificationPermissionState && (onEnableNotifications || onDisableNotifications)) {
    rightGroup.appendChild(
      createNotificationControl({
        permissionState: notificationPermissionState,
        onEnable: onEnableNotifications,
        onDisable: onDisableNotifications,
        unreadCount: notificationUnreadCount,
        notifications,
        hasClassroomContext,
        onOpenNotification,
        onNotificationsViewed,
        currentUserUid: user.uid,
      })
    );
  }

  if (onGoToOverview) {
    const overviewLink = document.createElement('button');
    overviewLink.type = 'button';
    overviewLink.className = 'btn btn--text';
    overviewLink.appendChild(createIcon('arrow-left'));
    overviewLink.append('Overview');
    overviewLink.title = 'Back to Overview';
    overviewLink.addEventListener('click', onGoToOverview);
    secondaryMenu.appendChild(overviewLink);
  }

  const signOutButton = document.createElement('button');
  signOutButton.type = 'button';
  signOutButton.className = 'btn btn--text';
  signOutButton.textContent = 'Sign Out';
  signOutButton.addEventListener('click', onSignOut);
  secondaryMenu.appendChild(signOutButton);

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
 * `unreadCount`/`notifications`/`onOpenNotification`/`onNotificationsViewed`
 * back the actual in-app notification list (see
 * services/notificationService.js) -- added on top of this control's
 * own pre-existing push-permission settings below, per explicit
 * product direction to keep the two visually separate (a divider)
 * rather than merging them into one section: "manage whether this
 * device can receive a push" and "what actually happened recently"
 * are different concerns that happen to share one bell/popover, not
 * one feature.
 *
 * `hasClassroomContext` distinguishes "genuinely zero notifications"
 * from "not subscribed to any classroom right now" (see main.js's own
 * manageNotificationSubscription()) -- both otherwise look identical
 * (an empty `notifications` array), but only the first one should ever
 * say "No notifications yet."
 */
function createNotificationControl({ permissionState, onEnable, onDisable, unreadCount, notifications = [], hasClassroomContext, onOpenNotification, onNotificationsViewed, currentUserUid }) {
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
  // the badge (an actual count needing attention) wins. Additionally
  // suppressed entirely once the real notification list is wired in
  // (onOpenNotification present) -- otherwise this dot, which means
  // only "push is enabled on this device" and has nothing to do with
  // unread notifications, reads as a false "you have something new"
  // signal sitting in the exact corner the real unread badge now
  // owns. Once this control's own real unread count exists, it should
  // be the only thing that can ever occupy this corner.
  if (permissionState === 'granted' && count === 0 && !onOpenNotification) {
    const dot = document.createElement('span');
    dot.className = 'user-bar__notification-dot';
    dot.setAttribute('aria-hidden', 'true');
    toggleButton.appendChild(dot);
  }

  const popover = document.createElement('div');
  popover.className = 'user-bar__notification-popover';
  popover.setAttribute('role', 'group');
  popover.setAttribute('aria-label', 'Notifications');

  // The actual in-app notification list — kept above, and visually
  // separated by a divider from, the push-permission settings below
  // (unchanged from before this feature). Only rendered at all once a
  // caller actually passes onOpenNotification (main.js only does this
  // once a classroom is open, since notifications are classroom-scoped
  // — see that file's own manageNotificationSubscription()), so this
  // control still degrades to exactly its old, settings-only shape
  // anywhere a classroom isn't in scope (e.g. Curriculum Management).
  if (onOpenNotification) {
    const listHeading = document.createElement('p');
    listHeading.className = 'user-bar__notification-list-heading';
    listHeading.textContent = 'Recent';
    popover.appendChild(listHeading);

    if (notifications.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'user-bar__notification-empty';
      // Notifications are classroom-scoped (see main.js's own
      // manageNotificationSubscription()) -- an empty list here only
      // ever means "nothing for the currently open classroom," never
      // "you have zero notifications anywhere." hasClassroomContext
      // is what actually distinguishes those two states; without it,
      // Home/Curriculum Management (no classroom subscribed at all)
      // would wrongly claim there's nothing to see.
      empty.textContent = hasClassroomContext ? 'No notifications yet.' : 'Open a classroom to see notifications.';
      popover.appendChild(empty);
    } else {
      const list = document.createElement('ul');
      list.className = 'user-bar__notification-list';
      notifications.forEach((notification) => {
        const isUnread = !(notification.readBy || []).includes(currentUserUid);

        const item = document.createElement('li');
        item.className = 'user-bar__notification-item' + (isUnread ? ' user-bar__notification-item--unread' : '');

        const itemButton = document.createElement('button');
        itemButton.type = 'button';
        itemButton.className = 'user-bar__notification-item-button';
        itemButton.addEventListener('click', () => {
          closePopover();
          onOpenNotification(notification);
        });

        const title = document.createElement('span');
        title.className = 'user-bar__notification-item-title';
        title.textContent = notification.title;
        itemButton.appendChild(title);

        const message = document.createElement('span');
        message.className = 'user-bar__notification-item-message';
        message.textContent = notification.message;
        itemButton.appendChild(message);

        item.appendChild(itemButton);
        list.appendChild(item);
      });
      popover.appendChild(list);
    }

    const divider = document.createElement('hr');
    divider.className = 'user-bar__notification-divider';
    popover.appendChild(divider);
  }

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

  // Standard "opened and left open" read behavior, per explicit
  // product direction: once the popover has been open for a short
  // dwell time WITH actual notifications showing, mark them read
  // automatically, the same way most apps' own notification panels do
  // -- clicking one individually (see onOpenNotification above) stays
  // available as an immediate alternative, never replaced by this.
  // Guarded on notifications.length > 0 so opening an empty popover
  // (nothing to view, or hasClassroomContext false -- see this
  // function's own header comment) never marks anything read.
  // Cancelled on every close path below so a quick open-then-close
  // never fires this against content the teacher didn't actually
  // dwell on.
  let autoMarkReadTimeoutId = null;
  const AUTO_MARK_READ_DELAY_MS = 1500;

  function scheduleAutoMarkRead() {
    if (!onNotificationsViewed || notifications.length === 0) return;
    autoMarkReadTimeoutId = setTimeout(() => {
      autoMarkReadTimeoutId = null;
      onNotificationsViewed(notifications);
    }, AUTO_MARK_READ_DELAY_MS);
  }

  function cancelAutoMarkRead() {
    if (autoMarkReadTimeoutId === null) return;
    clearTimeout(autoMarkReadTimeoutId);
    autoMarkReadTimeoutId = null;
  }

  function closePopover() {
    popover.classList.remove('user-bar__notification-popover--open');
    toggleButton.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', handleOutsideClick);
    cancelAutoMarkRead();
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
      scheduleAutoMarkRead();
    } else {
      document.removeEventListener('click', handleOutsideClick);
      cancelAutoMarkRead();
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
