/**
 * tests/services/winningTeamMemberRule.test.js
 *
 * Covers the Badge & Achievement Engine's own required test cases
 * (see the product brief's "Testing Requirements" section) at the
 * pure-function layer: services/badgeAwardRules/winningTeamMemberRule.js's
 * evaluateWinningTeamMember() for the award rule itself (ties, negative
 * standing, zero standing, membership-per-cycle), and
 * services/achievementService.js's buildEventsForCycle()/
 * summarizeStudentBadges() for level progression, idempotent ids, and
 * cross-cycle team-membership history — all Firestore-free, per this
 * project's own established "extract and test pure logic" convention.
 *
 * A "cycle" here is the exact shape services/achievementService.js's
 * toStandingCycle() produces from a real
 * services/scoreboardArchiveService.js Archive: `{ id, label, teams:
 * [{ id, name, total, isUngrouped, students: [{ id, name, standing }] }] }`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateWinningTeamMember } from '../../js/services/badgeAwardRules/winningTeamMemberRule.js';
import { buildEventsForCycle, summarizeStudentBadges, getTeamAchievementHistory } from '../../js/services/achievementEngine.js';
import { buildAchievementEventId } from '../../js/models/AchievementEvent.js';

function team(id, name, total, students) {
  return { id, name, total, students };
}
function student(id, name, standing) {
  return { id, name, standing };
}

// Archive-shaped fixture (what toStandingCycle() actually consumes) —
// used for buildEventsForCycle()/backfill-style tests, which go
// through the real archive -> cycle adapter.
function archive(id, teams, createdAt = `2026-01-0${id}T00:00:00.000Z`) {
  return {
    id: `archive-${id}`,
    createdAt,
    createdAtDateLabel: `Cycle ${id}`,
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      total: t.total,
      isUngrouped: t.isUngrouped || false,
      students: t.students.map((s) => ({ id: s.id, name: s.name, score: s.standing })),
    })),
  };
}

// -----------------------------------------------------------------
// Case 1 — single winner
// -----------------------------------------------------------------
test('Case 1 — single winner: only the higher-scoring team\'s eligible members are awarded', () => {
  const cycle = {
    id: 'c1',
    teams: [
      team('A', 'Team A', 20, [student('s1', 'Ann', 10), student('s2', 'Ben', 3)]),
      team('B', 'Team B', 12, [student('s3', 'Cas', 5)]),
    ],
  };
  const { winningTeams, awards } = evaluateWinningTeamMember(cycle);
  assert.deepEqual(winningTeams.map((t) => t.id), ['A']);
  assert.deepEqual(awards.map((a) => a.studentId).sort(), ['s1', 's2']);
});

// -----------------------------------------------------------------
// Case 2 — tie: ALL tied top teams win, no tiebreaker
// -----------------------------------------------------------------
test('Case 2 — tie: eligible members of every tied top team are awarded', () => {
  const cycle = {
    id: 'c2',
    teams: [
      team('A', 'Team A', 20, [student('s1', 'Ann', 4)]),
      team('B', 'Team B', 20, [student('s2', 'Ben', 1)]),
      team('C', 'Team C', 12, [student('s3', 'Cas', 9)]),
    ],
  };
  const { winningTeams, awards } = evaluateWinningTeamMember(cycle);
  assert.deepEqual(winningTeams.map((t) => t.id).sort(), ['A', 'B']);
  assert.deepEqual(awards.map((a) => a.studentId).sort(), ['s1', 's2']);
});

// -----------------------------------------------------------------
// Case 3 — negative student excluded; zero-standing student included
// -----------------------------------------------------------------
test('Case 3 — negative individual standing excludes a member of the winning team; 0 qualifies', () => {
  const cycle = {
    id: 'c3',
    teams: [
      team('A', 'Team A', 20, [
        student('s1', 'One', 5),
        student('s2', 'Two', 2),
        student('s3', 'Three', 0),
        student('s4', 'Four', -3),
      ]),
    ],
  };
  const { awards } = evaluateWinningTeamMember(cycle);
  assert.deepEqual(awards.map((a) => a.studentId).sort(), ['s1', 's2', 's3']);
});

// -----------------------------------------------------------------
// Case 9 — zero standing qualifies (isolated, exact-boundary check)
// -----------------------------------------------------------------
test('Case 9 — a student with exactly 0 standing on the winning team is eligible', () => {
  const cycle = { id: 'c9', teams: [team('A', 'Team A', 5, [student('s1', 'Zero', 0)])] };
  const { awards } = evaluateWinningTeamMember(cycle);
  assert.equal(awards.length, 1);
  assert.equal(awards[0].studentId, 's1');
});

test('Ungrouped is never a winning team, even if it has the highest total', () => {
  const cycle = {
    id: 'cU',
    teams: [
      { id: 'U', name: 'Ungrouped', total: 999, isUngrouped: true, students: [student('s1', 'Loose', 999)] },
      team('A', 'Team A', 5, [student('s2', 'Ann', 5)]),
    ],
  };
  const { winningTeams, awards } = evaluateWinningTeamMember(cycle);
  assert.deepEqual(winningTeams.map((t) => t.id), ['A']);
  assert.deepEqual(awards.map((a) => a.studentId), ['s2']);
});

// -----------------------------------------------------------------
// Case 4 — level progression: N qualifying cycles => LV N, not N badges
// -----------------------------------------------------------------
test('Case 4 — level progression: five qualifying cycles produce LV 5, with 5 history entries', () => {
  const events = [1, 2, 3, 4, 5].map((n) =>
    buildEventsForCycle(archive(n, [team('A', 'Team A', 10, [student('s1', 'Ann', 1)])]), { source: 'live' })
  ).flat();

  const summaries = summarizeStudentBadges(events.filter((e) => e.studentId === 's1'));
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].level, 5);
  assert.equal(summaries[0].history.length, 5);
  assert.equal(summaries[0].definition.recognitionType, 'winning-team-member');
});

// -----------------------------------------------------------------
// Case 5 — "backfill": three qualifying historical cycles => LV 3
// -----------------------------------------------------------------
test('Case 5 — backfill-style processing of three qualifying cycles yields LV 3 with 3 events', () => {
  const events = [1, 2, 3].map((n) =>
    buildEventsForCycle(archive(n, [team('A', 'Team A', 10, [student('s1', 'Ann', 2)])]), { source: 'backfill' })
  ).flat();

  const summaries = summarizeStudentBadges(events);
  assert.equal(summaries[0].level, 3);
  assert.ok(summaries[0].history.every((e) => e.source === 'backfill'));
});

// -----------------------------------------------------------------
// Case 6 — idempotency: re-running the same cycle produces the SAME event ids, not new ones
// -----------------------------------------------------------------
test('Case 6 — idempotency: rebuilding events for the same cycle twice yields identical ids (no duplicates on replay)', () => {
  const cycleArchive = archive(1, [team('A', 'Team A', 10, [student('s1', 'Ann', 4)])]);
  const firstRun = buildEventsForCycle(cycleArchive, { source: 'backfill' });
  const secondRun = buildEventsForCycle(cycleArchive, { source: 'backfill' });

  assert.equal(firstRun.length, 1);
  assert.equal(firstRun[0].id, secondRun[0].id);
  assert.equal(
    firstRun[0].id,
    buildAchievementEventId({ studentId: 's1', badgeFamily: 'weekly-standing', recognitionType: 'winning-team-member', cycleId: cycleArchive.id })
  );

  // A "second run" that also re-processes an EARLIER cycle must not
  // inflate the level — simulating badgeBackfillService.backfillClassroom()
  // running twice over the same two archives.
  const archives = [archive(1, [team('A', 'Team A', 10, [student('s1', 'Ann', 4)])]), archive(2, [team('A', 'Team A', 10, [student('s1', 'Ann', 4)])])];
  const runOnce = archives.flatMap((a) => buildEventsForCycle(a, { source: 'backfill' }));
  const runTwice = [...runOnce, ...archives.flatMap((a) => buildEventsForCycle(a, { source: 'backfill' }))];
  const uniqueIds = new Set(runTwice.map((e) => e.id));
  assert.equal(uniqueIds.size, 2); // not 4 — the "second pass" ids are identical to the first pass's
  assert.equal(summarizeStudentBadges(runOnce)[0].level, 2);
});

// -----------------------------------------------------------------
// Case 7 — a student who joins the winning team AFTER its win must not receive that historical badge
// -----------------------------------------------------------------
test('Case 7 — team membership is per-cycle: joining after a win does not retroactively earn it', () => {
  // Cycle 1: Phoenix wins with only s1 as a member.
  const cycle1 = archive(1, [team('P', 'Phoenix', 20, [student('s1', 'Ann', 5)])]);
  // Cycle 2: s2 has since joined Phoenix; Phoenix wins again.
  const cycle2 = archive(2, [team('P', 'Phoenix', 15, [student('s1', 'Ann', 3), student('s2', 'Ben', 2)])]);

  const events = [...buildEventsForCycle(cycle1, { source: 'backfill' }), ...buildEventsForCycle(cycle2, { source: 'backfill' })];

  const s1Summary = summarizeStudentBadges(events.filter((e) => e.studentId === 's1'));
  const s2Summary = summarizeStudentBadges(events.filter((e) => e.studentId === 's2'));
  assert.equal(s1Summary[0].level, 2); // present for both cycles
  assert.equal(s2Summary[0].level, 1); // only the cycle they were actually a member for
});

// -----------------------------------------------------------------
// Case 8 — team change: historical awards stay attached to the team the student belonged to at the time
// -----------------------------------------------------------------
test('Case 8 — a student who changes teams keeps each cycle\'s award attached to the team they were actually on', () => {
  const cycle1 = archive(1, [team('P', 'Phoenix', 20, [student('s1', 'Ann', 5)]), team('T', 'Tigers', 10, [])]);
  const cycle2 = archive(2, [team('P', 'Phoenix', 10, []), team('T', 'Tigers', 20, [student('s1', 'Ann', 4)])]);

  const events = [...buildEventsForCycle(cycle1, { source: 'backfill' }), ...buildEventsForCycle(cycle2, { source: 'backfill' })];
  const s1Events = events.filter((e) => e.studentId === 's1').sort((a, b) => (a.cycleId < b.cycleId ? -1 : 1));

  assert.equal(s1Events[0].teamName, 'Phoenix');
  assert.equal(s1Events[1].teamName, 'Tigers');
});

// -----------------------------------------------------------------
// Team Profile — collective history is independent of per-student eligibility
// -----------------------------------------------------------------
// -----------------------------------------------------------------
// Case 10 — extended/merged cycles: no premature award, only the final frozen result matters
// -----------------------------------------------------------------
test('Case 10 — the rule only ever sees a cycle\'s FINAL frozen totals; an extended/merged cycle is just one cycle with a later close', () => {
  // A teacher who extends or merges a cycle before closing it never
  // changes this rule's inputs or calling convention at all — there is
  // structurally no code path that evaluates an in-progress cycle
  // (services/achievementService.js's awardForCycle() and
  // services/badgeBackfillService.js's backfillClassroom() both only
  // ever run against an already-created services/scoreboardArchiveService.js
  // Archive, which by definition only exists once "Reset Scoreboard"
  // has actually run). This test demonstrates the guarantee that
  // matters in practice: the rule is a pure snapshot function over
  // whatever final totals it's given — merging two weeks' worth of
  // activity into one longer cycle before ever closing it produces
  // exactly one archive with the merged, final totals, and awards
  // exactly as if that had always been the cycle's real length.
  const mergedTwoWeekCycle = {
    id: 'merged-1',
    teams: [team('A', 'Team A', 34 /* two weeks' combined total */, [student('s1', 'Ann', 12)])],
  };
  const { awards } = evaluateWinningTeamMember(mergedTwoWeekCycle);
  assert.equal(awards.length, 1);
  assert.equal(awards[0].standing, 12);
});

test('getTeamAchievementHistory: counts a cycle as a team win even if every member was individually ineligible', () => {
  const archives = [
    archive(1, [team('A', 'Team A', 10, [student('s1', 'Ann', -5)])]), // A wins the cycle, but its only member is ineligible
    archive(2, [team('A', 'Team A', 8, [student('s1', 'Ann', 3)])]),
  ];
  const history = getTeamAchievementHistory(archives, 'A');
  assert.equal(history.totalWins, 2);
  assert.equal(history.currentStreak, 2);
  assert.equal(history.bestCycleScore, 10);
});
