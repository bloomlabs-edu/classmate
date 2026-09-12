/**
 * ui/components/TimePickerState.js
 *
 * Pure, DOM-free state machine backing ui/components/TimePicker.js's
 * Hour -> Minute -> commit flow. Extracted specifically so the actual
 * stage-transition decisions are unit-testable in this repo's Node
 * test runner, which has no DOM library available (see this project's
 * own tests/ui/programmeSessionView.test.js for the same pattern:
 * pure decision functions pulled out of a DOM-building view file so
 * they can be tested directly).
 *
 * A picker's state is always one of:
 *   { hour, minute, stage: 'hour', pendingHour: '' }
 *   { hour, minute, stage: 'minute', pendingHour }
 * `hour`/`minute` are the last COMMITTED value (what the closed button
 * shows, or '' if nothing has ever been committed). `pendingHour` is
 * only meaningful while `stage === 'minute'` and holds the in-progress
 * hour pick that has not yet been committed — a picker dismissed from
 * the minute stage without picking a minute discards it.
 */

/** Builds the initial/opened state for a given committed "HH:mm" (or '') value. Opening always starts at the 'hour' stage, per this component's explicit spec — never derived from whether a value already exists. */
export function createTimePickerState(value = '') {
  const [hour, minute] = value ? value.split(':') : ['', ''];
  return { hour: hour || '', minute: minute || '', stage: 'hour', pendingHour: '' };
}

/** Resets an existing state back to the Hour stage without touching the committed hour/minute — used both when opening the popover and when it's dismissed mid-selection (discarding any pending hour pick). */
export function resetToHourStage(state) {
  return { ...state, stage: 'hour', pendingHour: '' };
}

/** Stage 1: picking an hour records it as pending and advances to the Minute stage. Does not touch the committed hour/minute yet. */
export function pickHour(state, hour) {
  return { ...state, pendingHour: hour, stage: 'minute' };
}

/** Stage 2: picking a minute commits the pending hour + this minute as the new value and returns to the Hour stage (ready for the next time the picker is opened). */
export function pickMinute(state, minute) {
  return { hour: state.pendingHour, minute, stage: 'hour', pendingHour: '' };
}

/** The committed "HH:mm" string, or '' if incomplete/never set. Never reflects an in-progress (uncommitted) hour pick. */
export function getCommittedValue(state) {
  return state.hour && state.minute ? `${state.hour}:${state.minute}` : '';
}
