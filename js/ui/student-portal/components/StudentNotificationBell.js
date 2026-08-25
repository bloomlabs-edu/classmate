/**
 * ui/student-portal/components/StudentNotificationBell.js
 *
 * The Student Portal's own 🔔 — Stage 1 of the notification
 * architecture audit (Section E). Deliberately a SEPARATE
 * implementation from ui/components/UserBar.js's own
 * createNotificationControl(), not an extraction of shared code, per
 * explicit product direction for this stage: get the student behavior
 * correct first, consider unifying the two afterward. The UX is
 * intentionally matched anyway (unread badge, a "Recent" list, an
 * unread dot per item, ~1.5s dwell-to-read, click-marks-read
 * immediately, an empty state) so 🔔 means the same thing to a student
 * as it already does to a teacher — see that file's own bell for the
 * shape being matched.
 *
 * Data comes entirely from services/studentPortalDataService.js (this
 * app's own single Student Portal data-access rule — see that file's
 * own header comment); this component never imports
 * services/studentEventService.js directly, matching every other
 * Student Portal view's existing convention.
 */

import { createIcon } from '../../components/Icon.js';
import { formatRelativeTimestamp } from '../../../utils/dateHelpers.js';

/**
 * `events` — the bell's own recent list, each already carrying
 * `isUnread` (see studentPortalDataService.js's own
 * getRecentEventsForBell()) — this component never computes read/unread
 * itself. `onOpenEvent(event)` marks it read immediately and navigates
 * if the event has a detail route (see config/studentEventNavigation.js).
 * `onEventsViewed(events)` fires once, after the popover has been open
 * with events showing for the dwell delay below — the bulk equivalent,
 * never a replacement for the individual click.
 */
export function renderStudentNotificationBell(container, { unreadCount, events = [], onOpenEvent, onEventsViewed }) {
  container.innerHTML = '';

  const count = Math.max(0, Number(unreadCount) || 0);

  const wrapper = document.createElement('div');
  wrapper.className = 'student-notification-bell';

  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'student-notification-bell__button';
  toggleButton.setAttribute('aria-label', count > 0 ? `Notifications, ${count} unread` : 'Notifications');
  toggleButton.setAttribute('aria-expanded', 'false');
  toggleButton.title = 'Notifications';
  toggleButton.appendChild(createIcon('bell', { className: 'student-notification-bell__icon', size: 20 }));
  wrapper.appendChild(toggleButton);

  if (count > 0) {
    const badge = document.createElement('span');
    badge.className = 'student-notification-bell__badge' + (count > 9 ? ' student-notification-bell__badge--wide' : '');
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.setAttribute('aria-hidden', 'true');
    wrapper.appendChild(badge);
  }

  const popover = document.createElement('div');
  popover.className = 'student-notification-bell__popover';
  popover.setAttribute('role', 'group');
  popover.setAttribute('aria-label', 'Notifications');

  const heading = document.createElement('p');
  heading.className = 'student-notification-bell__heading';
  heading.textContent = 'Recent';
  popover.appendChild(heading);

  if (events.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'student-notification-bell__empty';
    empty.textContent = 'No notifications yet.';
    popover.appendChild(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'student-notification-bell__list';
    events.forEach((event) => {
      const item = document.createElement('li');
      item.className = 'student-notification-bell__item' + (event.isUnread ? ' student-notification-bell__item--unread' : '');

      const itemButton = document.createElement('button');
      itemButton.type = 'button';
      itemButton.className = 'student-notification-bell__item-button';
      itemButton.addEventListener('click', () => {
        closePopover();
        onOpenEvent?.(event);
      });

      const title = document.createElement('span');
      title.className = 'student-notification-bell__item-title';
      title.textContent = event.title;
      itemButton.appendChild(title);

      const message = document.createElement('span');
      message.className = 'student-notification-bell__item-message';
      message.textContent = event.message;
      itemButton.appendChild(message);

      // Reuses the event's own existing createdAt — no new stored
      // field, no change to the data model (see
      // utils/dateHelpers.js's own formatRelativeTimestamp()).
      const timestamp = document.createElement('span');
      timestamp.className = 'student-notification-bell__item-timestamp';
      timestamp.textContent = formatRelativeTimestamp(event.createdAt);
      itemButton.appendChild(timestamp);

      item.appendChild(itemButton);
      list.appendChild(item);
    });
    popover.appendChild(list);
  }

  // Standard "opened and left open" read behavior, matching
  // UserBar.js's own scheduleAutoMarkRead()/cancelAutoMarkRead()
  // exactly in shape (a fresh, independent implementation, not shared
  // code — see this file's own header comment on why): once the
  // popover has been open for a short dwell time WITH events actually
  // showing, mark them all read; cancelled on every close path so a
  // quick open-then-close never fires this. Guarded on events.length
  // so an empty popover never marks anything read.
  let autoMarkReadTimeoutId = null;
  const AUTO_MARK_READ_DELAY_MS = 1500;

  function scheduleAutoMarkRead() {
    if (!onEventsViewed || events.length === 0) return;
    autoMarkReadTimeoutId = setTimeout(() => {
      autoMarkReadTimeoutId = null;
      onEventsViewed(events);
    }, AUTO_MARK_READ_DELAY_MS);
  }

  function cancelAutoMarkRead() {
    if (autoMarkReadTimeoutId === null) return;
    clearTimeout(autoMarkReadTimeoutId);
    autoMarkReadTimeoutId = null;
  }

  function closePopover() {
    popover.classList.remove('student-notification-bell__popover--open');
    toggleButton.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', handleOutsideClick);
    cancelAutoMarkRead();
  }

  function handleOutsideClick(event) {
    if (!wrapper.contains(event.target)) closePopover();
  }

  toggleButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = popover.classList.toggle('student-notification-bell__popover--open');
    toggleButton.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      setTimeout(() => document.addEventListener('click', handleOutsideClick), 0);
      scheduleAutoMarkRead();
    } else {
      document.removeEventListener('click', handleOutsideClick);
      cancelAutoMarkRead();
    }
  });

  wrapper.appendChild(popover);
  container.appendChild(wrapper);
}
