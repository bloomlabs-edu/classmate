/**
 * ui/components/TimePicker.js
 *
 * A small, ClassMate-controlled replacement for native
 * `<input type="time">` wherever this app needs an interactive time
 * field a teacher opens and picks a value from. Native time inputs
 * render their own OS/browser-owned dropdown/spinner UI, which cannot
 * be reliably force-closed via JS nor guaranteed to close immediately
 * on selection across browsers — that's a real, separate bug from
 * "does clicking outside dismiss it," and the reason this component
 * exists at all (see ui/views/TimetableView.js's own exam-form and
 * Manage-Timetable-period-editing call sites for where it replaces
 * that native control).
 *
 * Renders as a text-like button showing the current "HH:mm" (or a
 * placeholder), which opens a small popover of Hour / Minute columns.
 * Clicking EITHER column's option commits that dimension immediately
 * (the other dimension defaults to "00" the first time anything is
 * picked from empty) and closes the popover right away — never
 * waiting for a second pick, and never relying on "eventually, an
 * outside click will dismiss it." `close()` always runs before the
 * caller's own `onChange` is invoked, specifically so the popover's
 * document-level listeners are torn down by reference before whatever
 * `onChange` does next (commonly triggering a full parent re-render,
 * this file's own established pattern — see e.g.
 * ui/views/TimetableView.js's renderBox() functions) — never left
 * dangling on a since-detached node regardless of what the caller does.
 *
 * Registered with utils/popupCoordinator.js, the same shared "one
 * dismissible popup open at a time, platform-wide" registry
 * ui/components/SearchableSelect.js and ui/components/OverflowMenu.js
 * already use.
 */

import { registerOpenPopup, clearOpenPopup } from '../../utils/popupCoordinator.js';

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

/**
 * `value`/`onChange` carry the same "HH:mm" 24-hour string every other
 * time field in this app already uses (models/ScheduledEvent.js's own
 * startTime/endTime, models/Timetable.js's own period times) — this
 * component never reformats it to 12-hour/AM-PM, matching how those
 * values already render everywhere else (e.g. the bulk/exam summary
 * lines' own `${startTime}–${endTime}`).
 */
export function createTimePicker({ value = '', onChange, ariaLabel = 'Time' } = {}) {
  let [hour, minute] = value ? value.split(':') : ['', ''];

  const wrapper = document.createElement('div');
  wrapper.className = 'time-picker';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'time-picker__button';
  button.setAttribute('aria-label', ariaLabel);
  wrapper.appendChild(button);

  const popover = document.createElement('div');
  popover.className = 'time-picker__popover';
  popover.hidden = true;
  wrapper.appendChild(popover);

  function currentValue() {
    return hour && minute ? `${hour}:${minute}` : '';
  }

  function updateButtonLabel() {
    button.textContent = currentValue() || 'Set time';
  }

  function close() {
    if (popover.hidden) return;
    popover.hidden = true;
    document.removeEventListener('click', onOutsideClick);
    document.removeEventListener('keydown', onKeyDown);
    clearOpenPopup(api);
  }

  function open() {
    registerOpenPopup(api);
    renderPopover();
    popover.hidden = false;
    document.addEventListener('click', onOutsideClick);
    document.addEventListener('keydown', onKeyDown);
  }

  function onOutsideClick(event) {
    if (!wrapper.contains(event.target)) close();
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') close();
  }

  function pick(nextHour, nextMinute) {
    close();
    hour = nextHour;
    minute = nextMinute;
    updateButtonLabel();
    onChange?.(currentValue());
  }

  function renderPopover() {
    popover.innerHTML = '';
    const columns = document.createElement('div');
    columns.className = 'time-picker__columns';

    const hourColumn = document.createElement('div');
    hourColumn.className = 'time-picker__column';
    hourColumn.setAttribute('aria-label', 'Hour');
    HOURS.forEach((h) => {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'time-picker__option' + (h === hour ? ' time-picker__option--active' : '');
      opt.textContent = h;
      opt.addEventListener('click', () => pick(h, minute || '00'));
      hourColumn.appendChild(opt);
    });

    const minuteColumn = document.createElement('div');
    minuteColumn.className = 'time-picker__column';
    minuteColumn.setAttribute('aria-label', 'Minute');
    MINUTES.forEach((m) => {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'time-picker__option' + (m === minute ? ' time-picker__option--active' : '');
      opt.textContent = m;
      opt.addEventListener('click', () => pick(hour || '00', m));
      minuteColumn.appendChild(opt);
    });

    columns.append(hourColumn, minuteColumn);
    popover.appendChild(columns);
  }

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (popover.hidden) open();
    else close();
  });

  updateButtonLabel();

  function getValue() {
    return currentValue();
  }

  /** Replaces the displayed value without notifying `onChange` — for a caller that needs to sync this picker to a value that changed elsewhere (e.g. a fresh draft loaded after save). Never called by this file itself; provided for API parity with ui/components/SearchableSelect.js's own setOptions(). */
  function setValue(newValue) {
    [hour, minute] = newValue ? newValue.split(':') : ['', ''];
    updateButtonLabel();
  }

  const api = { wrapper, getValue, setValue, close };
  return api;
}
