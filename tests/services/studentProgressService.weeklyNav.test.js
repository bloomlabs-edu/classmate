/**
 * tests/services/studentProgressService.weeklyNav.test.js
 *
 * Real, executed unit tests covering only what changed in
 * services/studentProgressService.js for the Class Mode Student
 * Profile's week-by-week chart navigation: getWeeklyNetPoints()'s new
 * optional weekAnchorDateKey parameter (backward-compatible — must
 * still default to the current week when omitted) and the new
 * getEarliestActivityWeekStart(). No DOM, no Firebase; a minimal
 * classroom/student fixture built directly against models/Student.js
 * and models/Team.js's own documented shape.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getWeeklyNetPoints, getEarliestActivityWeekStart } from '../../js/services/studentProgressService.js';
import { getTodayDateKey, getMondayStartOfWeek } from '../../js/utils/dateHelpers.js';

let idCounter = 0;
function pointEntry(dateKey, delta) {
  idCounter += 1;
  return { id: `e${idCounter}`, kind: 'points', label: delta > 0 ? 'Star' : 'Negative', delta, recordedAt: `${dateKey}T09:00:00.000Z` };
}

function classroomWithStudent(history) {
  const student = { id: 's1', name: 'Test Student', score: 0, bucket: null, badges: [], notes: [], submissions: {}, learningRecord: {}, history };
  return { teams: [{ id: 't1', name: 'Team A', students: [student] }] };
}

test('getWeeklyNetPoints defaults to the current week exactly as before (no anchor argument)', () => {
  const today = getTodayDateKey();
  const monday = getMondayStartOfWeek(today);
  const classroom = classroomWithStudent([pointEntry(monday, 4)]);
  const days = getWeeklyNetPoints(classroom, 's1');
  assert.equal(days.length, 5);
  assert.deepEqual(days[0], { dayLabel: 'Mon', value: 4 });
  assert.equal(days[1].value, 0);
});

test('getWeeklyNetPoints, given an anchor date in an older week, returns that week\'s own data', () => {
  const classroom = classroomWithStudent([
    pointEntry('2026-08-24', 3), // Monday of an older week
    pointEntry('2026-08-26', -2), // Wednesday
    pointEntry('2026-09-07', 10), // an unrelated later week — must NOT leak into the older week's result
  ]);
  const days = getWeeklyNetPoints(classroom, 's1', '2026-08-25'); // any date inside that older week
  assert.deepEqual(
    days.map((d) => d.value),
    [3, 0, -2, 0, 0]
  );
});

test('getEarliestActivityWeekStart returns null when the student has no points history', () => {
  const classroom = classroomWithStudent([]);
  assert.equal(getEarliestActivityWeekStart(classroom, 's1'), null);
});

test('getEarliestActivityWeekStart returns the Monday of the earliest week with any points entry', () => {
  const classroom = classroomWithStudent([
    pointEntry('2026-08-26', 2), // Wednesday, week of 2026-08-24
    pointEntry('2026-09-08', 1), // a later week
  ]);
  assert.equal(getEarliestActivityWeekStart(classroom, 's1'), '2026-08-24');
});

test('getEarliestActivityWeekStart ignores non-points history entries (e.g. badges)', () => {
  const classroom = classroomWithStudent([
    { id: 'b1', kind: 'badge', label: 'Helper', delta: 0, recordedAt: '2026-07-01T09:00:00.000Z' },
    pointEntry('2026-08-24', 5),
  ]);
  assert.equal(getEarliestActivityWeekStart(classroom, 's1'), '2026-08-24');
});

test('getEarliestActivityWeekStart returns null for an unknown studentId', () => {
  const classroom = classroomWithStudent([pointEntry('2026-08-24', 5)]);
  assert.equal(getEarliestActivityWeekStart(classroom, 'does-not-exist'), null);
});
