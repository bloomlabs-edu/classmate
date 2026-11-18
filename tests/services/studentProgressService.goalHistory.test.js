/**
 * tests/services/studentProgressService.goalHistory.test.js
 *
 * Real, executed unit tests for the Student Growth Dashboard's own
 * getGoalHistoryForStudent() — this student's own goals across every
 * Goal Cycle (active or closed), each with its RAW completed-date
 * array (never an invented completion rate/score). No DOM, no
 * Firebase; fixtures built directly against models/Classroom.js and
 * the real goalService/goalCompletionService functions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import * as goalService from '../../js/services/goalService.js';
import * as goalCompletionService from '../../js/services/goalCompletionService.js';
import { getGoalHistoryForStudent } from '../../js/services/studentProgressService.js';

function buildClassroom() {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test School', gradeSection: 'G1' });
  classroom.teams = [{ id: 't1', name: 'Team 1', students: [{ id: 's1', name: 'Asha' }] }];
  return classroom;
}

test('zero goal cycles on the classroom returns []', () => {
  const classroom = buildClassroom();
  assert.deepEqual(getGoalHistoryForStudent(classroom, 's1'), []);
});

test('A CYCLE WITH ZERO GOALS SUBMITTED BY THIS STUDENT is omitted entirely, never shown as an empty cycle', () => {
  const classroom = buildClassroom();
  const cycle = goalService.createNewGoalCycle(classroom, { title: 'August Goals', startDate: '2026-08-01', endDate: '2026-08-31' });
  goalService.addCategory(cycle, 'Reading');
  // No submitGoal() call at all for s1.
  assert.deepEqual(getGoalHistoryForStudent(classroom, 's1'), []);
});

test('SPANS ACTIVE AND CLOSED CYCLES, newest first, including the goal text/status/category and RAW completed-dates array', () => {
  const classroom = buildClassroom();
  const augustCycle = goalService.createNewGoalCycle(classroom, { title: 'August Goals', startDate: '2026-08-01', endDate: '2026-08-31' });
  const readingCategory = goalService.addCategory(augustCycle, 'Reading');
  const augustGoal = goalService.submitGoal(augustCycle, readingCategory.id, 's1', 'Read 10 pages a day');
  goalCompletionService.setCompletion(augustCycle, augustGoal.id, '2026-08-01', true);
  goalCompletionService.setCompletion(augustCycle, augustGoal.id, '2026-08-03', true);

  // Creating a new cycle auto-closes the August one (goalService's own rule).
  const septemberCycle = goalService.createNewGoalCycle(classroom, { title: 'September Goals', startDate: '2026-09-01', endDate: '2026-09-30' });
  const writingCategory = goalService.addCategory(septemberCycle, 'Writing');
  const septemberGoal = goalService.submitGoal(septemberCycle, writingCategory.id, 's1', 'Write one paragraph a day');
  goalCompletionService.setCompletion(septemberCycle, septemberGoal.id, '2026-09-05', true);

  const history = getGoalHistoryForStudent(classroom, 's1');

  assert.equal(history.length, 2);
  assert.equal(history[0].cycleId, septemberCycle.id, 'newest cycle first');
  assert.equal(history[0].cycleStatus, 'active');
  assert.equal(history[1].cycleId, augustCycle.id);
  assert.equal(history[1].cycleStatus, 'closed', 'auto-closed when the September cycle was created');

  const [augustEntry] = history[1].goals;
  assert.equal(augustEntry.text, 'Read 10 pages a day');
  assert.equal(augustEntry.categoryName, 'Reading');
  assert.deepEqual(augustEntry.completedDates, ['2026-08-01', '2026-08-03'], 'raw dates, not an invented percentage/rate');

  const [septemberEntry] = history[0].goals;
  assert.deepEqual(septemberEntry.completedDates, ['2026-09-05']);
});

test('A GOAL WITH ZERO COMPLETIONS EVER returns an empty completedDates array, never null or a thrown error', () => {
  const classroom = buildClassroom();
  const cycle = goalService.createNewGoalCycle(classroom, { title: 'August Goals', startDate: '2026-08-01', endDate: '2026-08-31' });
  const category = goalService.addCategory(cycle, 'Reading');
  goalService.submitGoal(cycle, category.id, 's1', 'Read every day');

  const [entry] = getGoalHistoryForStudent(classroom, 's1')[0].goals;
  assert.deepEqual(entry.completedDates, []);
});

test('A CATEGORY REMOVED MID-CYCLE (cascading per goalService.removeCategory) no longer appears, and does not crash the calculation', () => {
  const classroom = buildClassroom();
  const cycle = goalService.createNewGoalCycle(classroom, { title: 'August Goals', startDate: '2026-08-01', endDate: '2026-08-31' });
  const category = goalService.addCategory(cycle, 'Reading');
  const goal = goalService.submitGoal(cycle, category.id, 's1', 'Read every day');
  goalCompletionService.setCompletion(cycle, goal.id, '2026-08-01', true);

  goalService.removeCategory(cycle, category.id);

  assert.deepEqual(getGoalHistoryForStudent(classroom, 's1'), [], 'the cycle now has zero goals for this student and is omitted');
});

test('ONLY THIS STUDENT\'S OWN GOALS are returned, never another student\'s', () => {
  const classroom = buildClassroom();
  classroom.teams[0].students.push({ id: 's2', name: 'Baiju' });
  const cycle = goalService.createNewGoalCycle(classroom, { title: 'August Goals', startDate: '2026-08-01', endDate: '2026-08-31' });
  const category = goalService.addCategory(cycle, 'Reading');
  goalService.submitGoal(cycle, category.id, 's2', 'Baiju\'s own goal');

  assert.deepEqual(getGoalHistoryForStudent(classroom, 's1'), []);
});
