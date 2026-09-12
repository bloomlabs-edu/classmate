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
 * placeholder), which opens a small popover that steps through an
 * explicit two-stage flow: Hour selection first, then Minute
 * selection. Opening the picker always starts at the Hour stage (even
 * when editing an existing "HH:mm" value) so the interaction is
 * consistent every time. Picking an hour records it and advances to
 * the Minute stage WITHOUT closing the popover; only picking a minute
 * commits the complete value and closes the popover — never closing
 * on the hour pick alone. `close()` always runs before the caller's
 * own `onChange` is invoked, specifically so the popover's
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
import { createTimePickerState, resetToHourStage, pickHour as pickHourState, pickMinute as pickMinuteState, getCommittedValue } from './TimePickerState.js';

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
  /** Backed by ./TimePickerState.js's pure Hour->Minute state machine — see that file for the actual transition logic (kept there so it's testable without a DOM). */
  let state = createTimePickerState(value);

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
    return getCommittedValue(state);
  }

  /** Closed/committed-state contract unchanged: shows the committed "HH:mm" or the 'Set time' placeholder. While an hour has been picked but the popover is still open awaiting a minute, shows an in-progress "HH:--" label so the teacher sees their hour choice reflected. */
  function updateButtonLabel() {
    if (!popover.hidden && state.stage === 'minute') {
      button.textContent = `${state.pendingHour}:--`;
      return;
    }
    button.textContent = currentValue() || 'Set time';
  }

  function close() {
    if (popover.hidden) return;
    popover.hidden = true;
    state = resetToHourStage(state);
    document.removeEventListener('click', onOutsideClick);
    document.removeEventListener('keydown', onKeyDown);
    clearOpenPopup(api);
    updateButtonLabel();
  }

  function open() {
    state = resetToHourStage(state);
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

  /** Stage 1: picking an hour records it as pending and advances to minute selection. Does NOT close the popover and does NOT commit — a dismissal from here discards the pick. */
  function onPickHour(h) {
    state = pickHourState(state, h);
    updateButtonLabel();
    renderPopover();
  }

  /** Stage 2: picking a minute commits the complete value using the pending hour, then closes, then notifies onChange — in that order, per this file's own close-before-onChange contract. */
  function onPickMinute(m) {
    state = pickMinuteState(state, m);
    close();
    onChange?.(currentValue());
  }

  function renderPopover() {
    popover.innerHTML = '';

    if (state.stage === 'hour') {
      const columns = document.createElement('div');
      columns.className = 'time-picker__columns';
      const hourColumn = document.createElement('div');
      hourColumn.className = 'time-picker__column';
      hourColumn.setAttribute('aria-label', 'Hour');
      HOURS.forEach((h) => {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'time-picker__option' + (h === state.hour ? ' time-picker__option--active' : '');
        opt.textContent = h;
        // Stopped here, not just on the outer toggle button: picking an
        // hour no longer closes the popover (see onPickHour()), so
        // without this the click would keep bubbling to `document`'s
        // still-registered onOutsideClick() — which, by the time it
        // runs, sees a DETACHED event.target (renderPopover() already
        // replaced this button's whole column via popover.innerHTML =
        // '' for the minute stage), reads that as "outside," and closes
        // the popover it was never actually meant to close.
        opt.addEventListener('click', (event) => {
          event.stopPropagation();
          onPickHour(h);
        });
        hourColumn.appendChild(opt);
      });
      columns.appendChild(hourColumn);
      popover.appendChild(columns);
      return;
    }

    // state.stage === 'minute'
    const header = document.createElement('div');
    header.className = 'time-picker__stage-header';
    header.textContent = `${state.pendingHour} : —`;
    popover.appendChild(header);

    const columns = document.createElement('div');
    columns.className = 'time-picker__columns';
    const minuteColumn = document.createElement('div');
    minuteColumn.className = 'time-picker__column';
    minuteColumn.setAttribute('aria-label', 'Minute');
    MINUTES.forEach((m) => {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'time-picker__option' + (m === state.minute ? ' time-picker__option--active' : '');
      opt.textContent = m;
      // Same stopPropagation reasoning as the hour column above —
      // harmless here too (onPickMinute() closes deliberately anyway),
      // but keeps both option columns' click handling symmetric rather
      // than relying on which stage happens to call close() itself.
      opt.addEventListener('click', (event) => {
        event.stopPropagation();
        onPickMinute(m);
      });
      minuteColumn.appendChild(opt);
    });
    columns.appendChild(minuteColumn);
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
    state = createTimePickerState(newValue);
    updateButtonLabel();
  }

  const api = { wrapper, getValue, setValue, close };
  return api;
}
