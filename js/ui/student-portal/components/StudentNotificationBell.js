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
 * Whether the popover is currently open — module-level, not local to
 * one call of renderStudentNotificationBell(), because this component
 * has no DOM of its own that survives between calls: main.js's own
 * onLiveUpdateCallback (see studentPortalDataService.js's
 * startClassroomSubscription()) re-renders the ENTIRE Student Portal
 * shell — tearing down and rebuilding this bell from scratch — on
 * every read-state snapshot, including the very one markEventsRead()
 * itself produces. Without this surviving somewhere outside the DOM
 * this function keeps recreating, a just-opened popover would look
 * like it "closed itself" the moment its own dwell-to-read write round-
 * trips back through that subscription — which is exactly the bug this
 * fixes. Read at the top of a fresh render to decide whether to render
 * already-open; written only by this file's own toggle/close paths
 * below, never by the read-state write path itself.
 */
let isPopoverOpenState = false;

/**
 * The outside-click listener currently registered on `document`, if
 * any — tracked at module level for the same reason isPopoverOpenState
 * is: a fresh render creates a brand-new handleOutsideClick closure
 * every time, so without this, silently reopening on a rebuild (see
 * isPopoverOpenState's own comment) would add a NEW listener each time
 * without ever removing the previous instance's own (that instance is
 * simply discarded, never calling its own closePopover(), since
 * marking events read never closes the panel any more). Cleared
 * exactly on the same two paths that ever add one.
 */
let activeOutsideClickListener = null;

function replaceOutsideClickListener(handler) {
  if (activeOutsideClickListener) {
    document.removeEventListener('click', activeOutsideClickListener);
  }
  activeOutsideClickListener = handler;
  if (handler) document.addEventListener('click', handler);
}

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
      // Deliberately does NOT close the popover first — marking this
      // one event read must not visibly close the whole panel any more
      // than the dwell-based bulk read below does (see this file's own
      // isPopoverOpenState comment for why a read-marking write
      // reopens, rather than closes, on the re-render it triggers). If
      // onOpenEvent actually navigates (an event with a detail route —
      // see config/studentEventNavigation.js), that navigation is its
      // own, separate reason the panel stops being visible; this click
      // handler doesn't need to force it.
      itemButton.addEventListener('click', () => {
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

  // The only two closes this component ever performs on its own —
  // the user re-toggling the bell, or clicking outside the panel (see
  // toggleButton's own click handler and handleOutsideClick below).
  // Marking events read (individually or via the dwell timer) never
  // calls this — see isPopoverOpenState's own comment above.
  function closePopover() {
    isPopoverOpenState = false;
    popover.classList.remove('student-notification-bell__popover--open');
    toggleButton.setAttribute('aria-expanded', 'false');
    replaceOutsideClickListener(null);
    cancelAutoMarkRead();
  }

  function handleOutsideClick(event) {
    if (!wrapper.contains(event.target)) closePopover();
  }

  toggleButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = popover.classList.toggle('student-notification-bell__popover--open');
    isPopoverOpenState = isOpen;
    toggleButton.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      setTimeout(() => replaceOutsideClickListener(handleOutsideClick), 0);
      scheduleAutoMarkRead();
    } else {
      replaceOutsideClickListener(null);
      cancelAutoMarkRead();
    }
  });

  wrapper.appendChild(popover);
  container.appendChild(wrapper);

  // Re-render while the popover was already open (this render's own
  // container was just torn down and rebuilt from under an open panel
  // — see isPopoverOpenState's own comment above) — reflect that
  // immediately, WITHOUT going through the click handler above: no
  // fresh click actually happened, so no new auto-mark-read timer
  // should start (events already showing here have already been
  // through that once). The listener attachment itself is STILL
  // deferred to the next tick, same as toggleButton's own open path
  // below — this render can be triggered synchronously from inside a
  // live click's own bubble phase (an item's own onOpenEvent call,
  // via markEventRead()'s read-state round trip, rebuilds this bell
  // WHILE that same click event is still bubbling toward `document`);
  // attaching immediately would let that still-bubbling click, whose
  // target is now a detached element from the previous instance,
  // immediately look like an "outside" click against the new wrapper
  // and close the panel right back. Goes through
  // replaceOutsideClickListener() too, so the previous, now-orphaned
  // instance's own listener is swapped out rather than left stacked
  // alongside this one.
  if (isPopoverOpenState) {
    popover.classList.add('student-notification-bell__popover--open');
    toggleButton.setAttribute('aria-expanded', 'true');
    setTimeout(() => replaceOutsideClickListener(handleOutsideClick), 0);
  }
}
