/**
 * tests/services/weeklyReportService.test.js
 *
 * Real, executed unit tests against services/weeklyReportService.js —
 * a thin orchestration layer, so these tests focus on: correct week
 * boundaries/navigation, correct anchoring of recognition winners to
 * the SELECTED week (not the current week), and that Monday Reset
 * Scoreboard-style state (a fresh `currentScoringPeriodStartedAt`,
 * zeroed `score`) never affects what a historical week reports, since
 * everything is derived from `student.history`, which reset never
 * touches. No DOM, no Firebase.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNavigableWeekStarts, getWeekNavigationInfo, getWeeklyReport } from '../../js/services/weeklyReportService.js';
import { getMondayStartOfWeek } from '../../js/utils/dateHelpers.js';

const TODAY = '2026-09-10'; // Thursday
const THIS_WEEK_MONDAY = getMondayStartOfWeek(TODAY); // 2026-09-07

let idCounter = 0;
function pointEntry(dateKey, delta, hour = '09') {
  idCounter += 1;
  return { id: `e${idCounter}`, kind: 'points', label: delta > 0 ? 'Star' : 'Negative', delta, recordedAt: `${dateKey}T${hour}:00:00.000Z` };
}

function student(id, name, history) {
  return { id, name, score: 0, bucket: null, badges: [], notes: [], submissions: {}, learningRecord: {}, history };
}

/**
 * A 4-week fixture: earliest activity is the week of 2026-08-17.
 *   Week of 2026-08-17: Ava wins (5 stars), no one else scores.
 *   Week of 2026-08-24: Ben wins with a big climb from last place.
 *   Week of 2026-08-31 ("Last Week"): Ava wins again.
 *   Week of 2026-09-07 ("This Week"): Ben wins.
 * `currentScoringPeriodStartedAt`/live `score` are deliberately left at
 * their post-"Monday Reset" defaults (0 / a recent timestamp) to prove
 * the report never reads them.
 */
function buildFixtureClassroom() {
  const ava = student('ava', 'Ava', [
    pointEntry('2026-08-18', 5),
    pointEntry('2026-08-25', 1),
    pointEntry('2026-09-02', 6), // week of 08-31 ("Last Week")
    pointEntry('2026-09-08', 1), // this week, but loses to Ben below
  ]);
  const ben = student('ben', 'Ben', [
    // A small amount of PRIOR history (week of 08-17) so Ben has a real
    // baseline rank before the week of 08-24 begins — getBiggestClimber()
    // correctly excludes a student with literally zero history before
    // currentRange.start, treating them as a brand-new student rather
    // than someone who "climbed" from an assumed baseline of zero.
    pointEntry('2026-08-19', 1),
    pointEntry('2026-08-27', 9), // week of 08-24: Ben ends up on top (10) vs Ava's 1 that week
    pointEntry('2026-09-09', 8), // this week: Ben (8) beats Ava (1)
  ]);

  return {
    id: 'qa-classroom',
    currentScoringPeriodStartedAt: '2026-09-10T00:00:00.000Z', // a very recent "Monday Reset" moment
    notebookConfig: { subjects: [], notebookTypes: [] },
    teams: [{ id: 't1', name: 'Team Alpha', students: [ava, ben] }],
  };
}

test('getNavigableWeekStarts includes the current week first and stops at the earliest activity week', () => {
  const classroom = buildFixtureClassroom();
  const weeks = getNavigableWeekStarts(classroom, TODAY);
  assert.equal(weeks[0], THIS_WEEK_MONDAY);
  assert.equal(weeks[weeks.length - 1], '2026-08-17');
  assert.equal(weeks.length, 4);
  // Strictly descending, one week apart.
  for (let i = 1; i < weeks.length; i++) {
    assert.equal(weeks[i - 1] > weeks[i], true);
  }
});

test('a classroom with zero history still returns exactly the current week (never an empty list)', () => {
  const classroom = { id: 'empty', teams: [{ id: 't1', name: 'Team A', students: [student('s1', 'Solo', [])] }] };
  const weeks = getNavigableWeekStarts(classroom, TODAY);
  assert.deepEqual(weeks, [THIS_WEEK_MONDAY]);
});

test('getWeekNavigationInfo: current week has canGoNext=false, canGoPrevious=true when earlier history exists', () => {
  const classroom = buildFixtureClassroom();
  const info = getWeekNavigationInfo(classroom, null, TODAY);
  assert.equal(info.weekStart, THIS_WEEK_MONDAY);
  assert.equal(info.weekLabel, 'This Week');
  assert.equal(info.isCurrentWeek, true);
  assert.equal(info.canGoNext, false);
  assert.equal(info.canGoPrevious, true);
});

test('getWeekNavigationInfo: the earliest week has canGoPrevious=false', () => {
  const classroom = buildFixtureClassroom();
  const info = getWeekNavigationInfo(classroom, '2026-08-17', TODAY);
  assert.equal(info.canGoPrevious, false);
  assert.equal(info.canGoNext, true);
});

test('getWeeklyReport for the CURRENT week reports Ben (not Ava) as Star Performer, using live-scoreboard-independent history', () => {
  const classroom = buildFixtureClassroom();
  const report = getWeeklyReport(classroom, null, TODAY);
  assert.equal(report.isCurrentWeek, true);

  const starPerformer = report.recognitions.find((r) => r.category.id === 'star_performer');
  assert.ok(starPerformer, 'expected a Star Performer recognition this week');
  assert.deepEqual(
    starPerformer.winners.map((w) => w.studentId),
    ['ben']
  );
  assert.equal(starPerformer.winners[0].stars, 8);
});

test('getWeeklyReport for an OLDER week reports that week\'s own winner, not the current week\'s', () => {
  const classroom = buildFixtureClassroom();
  const report = getWeeklyReport(classroom, '2026-08-31', TODAY); // "Last Week"
  assert.equal(report.weekLabel, 'Last Week');
  assert.equal(report.isCurrentWeek, false);

  const starPerformer = report.recognitions.find((r) => r.category.id === 'star_performer');
  assert.deepEqual(
    starPerformer.winners.map((w) => w.studentId),
    ['ava']
  );
  assert.equal(starPerformer.winners[0].stars, 6);
});

test('getWeeklyReport: Biggest Climber for the week of 2026-08-24 correctly identifies Ben\'s climb', () => {
  const classroom = buildFixtureClassroom();
  const report = getWeeklyReport(classroom, '2026-08-24', TODAY);

  const climber = report.recognitions.find((r) => r.category.id === 'biggest_climber');
  assert.ok(climber, 'expected a Biggest Climber recognition for the week of 2026-08-24');
  assert.deepEqual(
    climber.winners.map((w) => w.studentId),
    ['ben']
  );
});

test('getWeeklyReport never reads classroom.currentScoringPeriodStartedAt or live student.score at all', () => {
  const classroom = buildFixtureClassroom();
  // Simulate the live scoreboard being reset AGAIN, arbitrarily, after
  // the fixture's own history was recorded — a historical week's report
  // must be completely unaffected by this, since it never reads either field.
  classroom.currentScoringPeriodStartedAt = '2099-01-01T00:00:00.000Z';
  classroom.teams[0].students.forEach((s) => { s.score = 999; });

  const report = getWeeklyReport(classroom, '2026-08-31', TODAY);
  const starPerformer = report.recognitions.find((r) => r.category.id === 'star_performer');
  assert.deepEqual(
    starPerformer.winners.map((w) => w.studentId),
    ['ava']
  );
  assert.equal(starPerformer.winners[0].stars, 6);
});

test('no future week ever appears in the navigable list, regardless of how much history exists', () => {
  const classroom = buildFixtureClassroom();
  const weeks = getNavigableWeekStarts(classroom, TODAY);
  assert.ok(weeks.every((weekStart) => weekStart <= THIS_WEEK_MONDAY));
});
