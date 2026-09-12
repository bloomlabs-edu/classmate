/**
 * tests/ui/timePickerState.test.js
 *
 * Unit tests for ui/components/TimePickerState.js — the pure
 * Hour -> Minute -> commit state machine backing
 * ui/components/TimePicker.js. TimePicker.js itself builds real DOM
 * (document.createElement, document-level click/keydown listeners),
 * which this repo's Node test runner cannot exercise without a DOM
 * library it doesn't depend on (see tests/ui/programmeSessionView.test.js
 * for the same pattern) — the actual stage-transition decisions were
 * pulled out into this DOM-free module specifically so they're
 * directly testable. Outside-click/Escape dismissal and the rendered
 * popover DOM are covered by browser verification instead.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTimePickerState,
  resetToHourStage,
  pickHour,
  pickMinute,
  getCommittedValue,
} from '../../js/ui/components/TimePickerState.js';

test('createTimePickerState: a fresh/empty value starts in the hour stage with nothing committed', () => {
  const state = createTimePickerState('');
  assert.equal(state.stage, 'hour');
  assert.equal(state.hour, '');
  assert.equal(state.minute, '');
  assert.equal(state.pendingHour, '');
  assert.equal(getCommittedValue(state), '');
});

test('createTimePickerState: opening to edit an existing "HH:mm" value still starts in the hour stage', () => {
  const state = createTimePickerState('10:30');
  assert.equal(state.stage, 'hour', 'must start at hour stage even when a value already exists');
  assert.equal(state.hour, '10');
  assert.equal(state.minute, '30');
  assert.equal(getCommittedValue(state), '10:30');
});

test('pickHour: does not commit and moves to the minute stage', () => {
  const initial = createTimePickerState('');
  const afterHour = pickHour(initial, '10');
  assert.equal(afterHour.stage, 'minute', 'selecting an hour must transition to minute selection');
  assert.equal(afterHour.pendingHour, '10');
  // Nothing has been committed yet — an hour pick alone must not produce a complete value.
  assert.equal(getCommittedValue(afterHour), '', 'selecting an hour alone must not commit a value');
  // The previously-committed hour/minute (none, here) are untouched.
  assert.equal(afterHour.hour, '');
  assert.equal(afterHour.minute, '');
});

test('pickHour: picking a new hour while editing an existing value does not touch the old committed value until a minute is picked', () => {
  const initial = createTimePickerState('09:15');
  const afterHour = pickHour(initial, '14');
  assert.equal(afterHour.stage, 'minute');
  assert.equal(afterHour.pendingHour, '14');
  assert.equal(getCommittedValue(afterHour), '09:15', 'old committed value survives until minute is picked');
});

test('pickMinute: commits the pending hour + picked minute as the complete value', () => {
  const initial = createTimePickerState('');
  const afterHour = pickHour(initial, '10');
  const afterMinute = pickMinute(afterHour, '30');
  assert.equal(getCommittedValue(afterMinute), '10:30');
  assert.equal(afterMinute.stage, 'hour', 'commits and resets back to the hour stage for the next open()');
  assert.equal(afterMinute.pendingHour, '', 'pending hour is cleared once committed');
});

test('full flow: hour then minute produces the exact "HH:mm" committed value', () => {
  let state = createTimePickerState('');
  state = pickHour(state, '07');
  state = pickMinute(state, '05');
  assert.equal(getCommittedValue(state), '07:05');
});

test('resetToHourStage: discards an in-progress hour pick without touching the last committed value (dismissal mid-selection)', () => {
  const initial = createTimePickerState('11:45');
  const afterHour = pickHour(initial, '02');
  assert.equal(getCommittedValue(afterHour), '11:45');
  const dismissed = resetToHourStage(afterHour);
  assert.equal(dismissed.stage, 'hour');
  assert.equal(dismissed.pendingHour, '', 'in-progress hour pick is discarded');
  assert.equal(getCommittedValue(dismissed), '11:45', 'previously committed value is unaffected by a discarded in-progress pick');
});

test('getCommittedValue: incomplete state (only one of hour/minute set) is never reported as a complete value', () => {
  assert.equal(getCommittedValue({ hour: '10', minute: '', stage: 'hour', pendingHour: '' }), '');
  assert.equal(getCommittedValue({ hour: '', minute: '30', stage: 'hour', pendingHour: '' }), '');
});
