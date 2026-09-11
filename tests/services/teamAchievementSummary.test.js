/**
 * tests/services/teamAchievementSummary.test.js
 *
 * services/achievementEngine.js's summarizeTeamAchievements() — the
 * generic, events-driven team achievement summary
 * ui/views/TeamProfileView.js's own Achievements section consumes.
 * Deliberately NOT the same thing as getTeamAchievementHistory() (that
 * function is Winning-Team-Member-specific by design); this one groups
 * by whatever badge types this team's own events actually name, so a
 * future badge type needs no change here to appear.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEventsForCycle, summarizeTeamAchievements } from '../../js/services/achievementEngine.js';
import { createAchievementEvent } from '../../js/models/AchievementEvent.js';

function team(id, name, total, students) {
  return { id, name, total, students };
}
function student(id, name, standing) {
  return { id, name, standing };
}
function archive(id, isoDate, teams) {
  return {
    id: `archive-${id}`,
    createdAt: isoDate,
    createdAtDateLabel: isoDate,
    teams: teams.map((t) => ({ id: t.id, name: t.name, total: t.total, isUngrouped: t.isUngrouped || false, students: t.students.map((s) => ({ id: s.id, name: s.name, score: s.standing })) })),
  };
}

test('a team with no achievement events of its own gets an empty summary list', () => {
  const events = buildEventsForCycle(archive(1, '2026-08-03T00:00:00.000Z', [team('A', 'Team A', 5, [student('s1', 'Ann', -3)])]), { source: 'live' });
  assert.deepEqual(summarizeTeamAchievements(events, 'A'), []);
});

test('counts DISTINCT CYCLES per badge type, not raw event count — one cycle with 3 recipients is still 1 cycle', () => {
  const events = buildEventsForCycle(
    archive(1, '2026-08-03T00:00:00.000Z', [team('P', 'Phoenix', 20, [student('s1', 'Ann', 5), student('s2', 'Ben', 2), student('s3', 'Cas', 0)])]),
    { source: 'live' }
  );
  const summaries = summarizeTeamAchievements(events, 'P');
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].definition.recognitionType, 'winning-team-member');
  assert.equal(summaries[0].cycleCount, 1);
});

test('multiple cycles accumulate the cycle count correctly and recentCycles lists them newest-first', () => {
  const cycle1 = buildEventsForCycle(archive(1, '2026-08-03T00:00:00.000Z', [team('P', 'Phoenix', 20, [student('s1', 'Ann', 5)])]), { source: 'backfill' });
  const cycle2 = buildEventsForCycle(archive(2, '2026-08-10T00:00:00.000Z', [team('P', 'Phoenix', 15, [student('s1', 'Ann', 3)])]), { source: 'backfill' });
  const cycle3 = buildEventsForCycle(archive(3, '2026-08-17T00:00:00.000Z', [team('P', 'Phoenix', 25, [student('s1', 'Ann', 8)])]), { source: 'backfill' });

  const summaries = summarizeTeamAchievements([...cycle1, ...cycle2, ...cycle3], 'P');
  assert.equal(summaries[0].cycleCount, 3);
  assert.deepEqual(summaries[0].recentCycles.map((c) => c.cycleLabel), ['2026-08-17T00:00:00.000Z', '2026-08-10T00:00:00.000Z', '2026-08-03T00:00:00.000Z']);
});

test('recentCycles caps at 5 even when more cycles exist', () => {
  const allEvents = [1, 2, 3, 4, 5, 6, 7].flatMap((n) =>
    buildEventsForCycle(archive(n, `2026-0${Math.min(n, 9)}-01T00:00:00.000Z`, [team('P', 'Phoenix', 10, [student('s1', 'Ann', 1)])]), { source: 'backfill' })
  );
  const summaries = summarizeTeamAchievements(allEvents, 'P');
  assert.equal(summaries[0].cycleCount, 7);
  assert.equal(summaries[0].recentCycles.length, 5);
});

test('a hypothetical future non-winning-team-member badge with real events for this team appears automatically, no code change needed', () => {
  const futureEvent = createAchievementEvent({
    studentId: 's9',
    badgeFamily: 'weekly-standing',
    recognitionType: 'team-topper',
    cycleId: 'archive-99',
    cycleLabel: '2026-09-01T00:00:00.000Z',
    teamId: 'P',
    teamName: 'Phoenix',
    standing: 12,
    awardedAt: new Date().toISOString(),
    source: 'live',
  });
  const summaries = summarizeTeamAchievements([futureEvent], 'P');
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].definition.recognitionType, 'team-topper');
  assert.equal(summaries[0].cycleCount, 1);
});

test('only events belonging to THIS team are counted — a different team\'s own events never leak in', () => {
  const events = [
    ...buildEventsForCycle(archive(1, '2026-08-03T00:00:00.000Z', [team('P', 'Phoenix', 20, [student('s1', 'Ann', 5)])]), { source: 'live' }),
    ...buildEventsForCycle(archive(2, '2026-08-10T00:00:00.000Z', [team('T', 'Tigers', 15, [student('s2', 'Ben', 3)])]), { source: 'live' }),
  ];
  const phoenixSummary = summarizeTeamAchievements(events, 'P');
  const tigersSummary = summarizeTeamAchievements(events, 'T');
  assert.equal(phoenixSummary[0].cycleCount, 1);
  assert.equal(tigersSummary[0].cycleCount, 1);
});
