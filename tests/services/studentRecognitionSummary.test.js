/**
 * tests/services/studentRecognitionSummary.test.js
 *
 * services/achievementEngine.js's summarizeStudentBadges() — the exact
 * data ui/views/StudentProfileView.js's compact recognition row (and
 * its own Achievements tab) both consume. No DOM assertions here (this
 * project has no DOM-testing library — see
 * tests/ui/programmeSessionHelpers.test.js's own header comment); this
 * verifies the underlying data contract the profile header's
 * populateRecognitionRow() renders directly from, one badge summary
 * per chip, with no logic of its own beyond "does a summary exist."
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeStudentBadges } from '../../js/services/achievementEngine.js';
import { createAchievementEvent } from '../../js/models/AchievementEvent.js';
import { BADGE_THEMES } from '../../js/config/badgeDefinitions.js';

function event(overrides) {
  return createAchievementEvent({
    studentId: 's1',
    badgeFamily: 'weekly-standing',
    recognitionType: 'winning-team-member',
    cycleId: 'c1',
    teamId: 'T',
    teamName: 'Team A',
    standing: 5,
    awardedAt: '2026-01-01T00:00:00.000Z',
    source: 'live',
    ...overrides,
  });
}

test('a student with no Achievement Events has no recognition summaries (the profile header renders nothing, not an empty state)', () => {
  assert.deepEqual(summarizeStudentBadges([]), []);
});

test('a student with one earned badge gets exactly one summary, at the correct level', () => {
  const summaries = summarizeStudentBadges([event({ cycleId: 'c1' })]);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].level, 1);
  assert.equal(summaries[0].definition.title, 'Winning Team Member');
});

test('a student with multiple DIFFERENT badges gets one summary per badge type, all present', () => {
  const events = [
    event({ cycleId: 'c1', recognitionType: 'winning-team-member' }),
    event({ cycleId: 'c1', recognitionType: 'helper', teamId: null, teamName: null }),
  ];
  const summaries = summarizeStudentBadges(events);
  assert.equal(summaries.length, 2);
  assert.deepEqual(summaries.map((s) => s.definition.recognitionType).sort(), ['helper', 'winning-team-member']);
});

test('level is read from the count of Achievement Events, never recalculated independently', () => {
  const events = ['c1', 'c2', 'c3', 'c4'].map((cycleId) => event({ cycleId }));
  const summaries = summarizeStudentBadges(events);
  assert.equal(summaries[0].level, 4);
  assert.equal(summaries[0].history.length, 4);
});

test('recognition colour (theme) is tied to badge type, independent of level, and does not change as level climbs', () => {
  const lowLevel = summarizeStudentBadges([event({ cycleId: 'c1' })]);
  const highLevel = summarizeStudentBadges(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10'].map((cycleId) => event({ cycleId })));
  assert.equal(lowLevel[0].definition.theme, 'amber');
  assert.equal(highLevel[0].definition.theme, 'amber');
  assert.equal(BADGE_THEMES[lowLevel[0].definition.theme].primary, BADGE_THEMES[highLevel[0].definition.theme].primary);
});
