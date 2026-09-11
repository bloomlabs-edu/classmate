/**
 * tests/services/recognitionWall.test.js
 *
 * services/achievementEngine.js's groupEventsForRecognitionWall() —
 * the Recognition Wall's own grouping logic (ui/components/RecognitionWall.js
 * only lays out whatever this function returns; no eligibility or
 * grouping decisions live in that DOM-building file, so this is where
 * those decisions are actually verified).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEventsForCycle, groupEventsForRecognitionWall } from '../../js/services/achievementEngine.js';
import { createAchievementEvent } from '../../js/models/AchievementEvent.js';

function team(id, name, total, students) {
  return { id, name, total, students };
}
function student(id, name, standing) {
  return { id, name, standing };
}
function archive(id, teams) {
  return {
    id: `archive-${id}`,
    createdAt: `2026-0${id}-01T00:00:00.000Z`,
    createdAtDateLabel: `Cycle ${id}`,
    teams: teams.map((t) => ({ id: t.id, name: t.name, total: t.total, isUngrouped: t.isUngrouped || false, students: t.students.map((s) => ({ id: s.id, name: s.name, score: s.standing })) })),
  };
}

test('winning team recipients appear, grouped under their own team', () => {
  const events = buildEventsForCycle(
    archive(1, [team('C', 'Charlie', 37, [student('s1', 'R. Varalaxmi', 15), student('s2', 'Dhyasri', 7)])]),
    { source: 'live' }
  );
  const groups = groupEventsForRecognitionWall(events);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].definition.recognitionType, 'winning-team-member');
  assert.equal(groups[0].teamGroups.length, 1);
  assert.equal(groups[0].teamGroups[0].teamName, 'Charlie');
  assert.deepEqual(groups[0].teamGroups[0].recipients.map((r) => r.studentId).sort(), ['s1', 's2']);
});

test('a negative-standing student on the winning team never appears (no event was ever created for them)', () => {
  const events = buildEventsForCycle(
    archive(1, [team('C', 'Charlie', 37, [student('s1', 'Ann', 15), student('s2', 'Neg', -2)])]),
    { source: 'live' }
  );
  const groups = groupEventsForRecognitionWall(events);
  const allRecipientIds = groups.flatMap((g) => g.recipients.map((r) => r.studentId));
  assert.ok(!allRecipientIds.includes('s2'));
  assert.deepEqual(allRecipientIds, ['s1']);
});

test('a zero-standing student on the winning team appears', () => {
  const events = buildEventsForCycle(archive(1, [team('C', 'Charlie', 10, [student('s1', 'Zero', 0)])]), { source: 'live' });
  const groups = groupEventsForRecognitionWall(events);
  assert.deepEqual(groups[0].recipients.map((r) => r.studentId), ['s1']);
});

test('tied winning teams both appear as separate team columns, no tiebreaker', () => {
  const events = buildEventsForCycle(
    archive(1, [
      team('A', 'Team A', 20, [student('s1', 'Ann', 4)]),
      team('B', 'Team B', 20, [student('s2', 'Ben', 1)]),
      team('C', 'Team C', 12, [student('s3', 'Cas', 9)]),
    ]),
    { source: 'live' }
  );
  const groups = groupEventsForRecognitionWall(events);
  assert.equal(groups[0].teamGroups.length, 2);
  assert.deepEqual(groups[0].teamGroups.map((t) => t.teamName).sort(), ['Team A', 'Team B']);
});

test('historical team context is correct: a student who changed teams keeps the right team name for each cycle\'s own events', () => {
  const cycle1Events = buildEventsForCycle(archive(1, [team('P', 'Phoenix', 20, [student('s1', 'Ann', 5)])]), { source: 'backfill' });
  const cycle2Events = buildEventsForCycle(archive(2, [team('T', 'Tigers', 20, [student('s1', 'Ann', 3)])]), { source: 'backfill' });

  const groups1 = groupEventsForRecognitionWall(cycle1Events);
  const groups2 = groupEventsForRecognitionWall(cycle2Events);
  assert.equal(groups1[0].teamGroups[0].teamName, 'Phoenix');
  assert.equal(groups2[0].teamGroups[0].teamName, 'Tigers');
});

test('no recipients for a cycle (e.g. every team scored negative) produces an empty group list, not a fabricated placeholder', () => {
  const events = buildEventsForCycle(archive(1, [team('A', 'Team A', 5, [student('s1', 'Ann', -3)])]), { source: 'live' });
  const groups = groupEventsForRecognitionWall(events);
  assert.deepEqual(groups, []);
});

test('a future badge type with no team concept renders as a flat recipient list (teamGroups: null), no hard-coded winning-team-member assumption', () => {
  const futureEvent = createAchievementEvent({
    studentId: 's9',
    badgeFamily: 'weekly-standing',
    recognitionType: 'helper', // already a real definition in config/badgeDefinitions.js, no award rule yet
    cycleId: 'archive-1',
    teamId: null,
    teamName: null,
    standing: 0,
    awardedAt: new Date().toISOString(),
    source: 'live',
  });
  const groups = groupEventsForRecognitionWall([futureEvent]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].definition.recognitionType, 'helper');
  assert.equal(groups[0].teamGroups, null);
  assert.deepEqual(groups[0].recipients.map((r) => r.studentId), ['s9']);
});
