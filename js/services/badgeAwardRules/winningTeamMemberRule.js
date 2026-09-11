/**
 * services/badgeAwardRules/winningTeamMemberRule.js
 *
 * The Winning Team Member award rule — the first of what the Badge &
 * Achievement Engine expects will eventually be several independent
 * award rules (see config/badgeDefinitions.js's own header comment).
 * This file knows nothing about Firestore, Achievement Events, or
 * levels — it is a pure function over a StandingCycle's already-frozen
 * facts, so the exact same function can be called from
 * services/achievementService.js's live cycle-close path and its
 * historical backfill path with zero behavioral difference between
 * them (the brief's own explicit requirement: "the live path must use
 * the SAME award evaluation logic as historical backfill").
 *
 * Deliberately NOT the same computation as config/recognitionCategories.js's
 * existing "Team Champion" (resolverId: 'team_stars') live recognition:
 * that one ranks teams by positive-only "stars" within an arbitrary
 * date range recomputed on demand; this one ranks teams by their real,
 * net Standing Cycle total (positive AND negative points), frozen at
 * the moment a cycle actually closed. They read as similar ideas to a
 * teacher but are genuinely different metrics over genuinely different
 * data — this file must never be quietly merged with or replaced by
 * that one.
 *
 * INPUT SHAPE — a StandingCycle, not a raw Scoreboard Archive:
 *   {
 *     id, label,
 *     teams: [{ id, name, total, students: [{ id, name, standing }] }],
 *   }
 * `total` is the team's own final score for this cycle; `standing` is
 * one student's own final individual score for this cycle. Today the
 * only real source for this shape is
 * services/scoreboardArchiveService.js's own archives, adapted by
 * services/achievementService.js's toStandingCycle() — but this rule
 * itself has no idea that's true, on purpose: if this app ever grows a
 * genuinely different Standing Cycle source (see docs on the "cycle"
 * concept independent of a calendar week), this rule needs no changes
 * at all, only a new adapter.
 *
 * `team.isUngrouped` teams (see services/classroomService.js's
 * getOrCreateUngroupedTeam()) are excluded from winner consideration —
 * matching the exact same exclusion every other team-level ranking in
 * this app already applies (services/teamStatisticsService.js's own
 * getRealTeams()) — there is no "team" for an ungrouped student to
 * have won.
 */

/**
 * Evaluates one closed Standing Cycle and returns every eligible
 * student award for the Winning Team Member badge.
 *
 * Rule, verbatim from the product brief:
 *   1. The winning team(s) are whichever real team(s) have the
 *      highest final total. ALL teams tied for that total are
 *      winners — there is no tiebreaker.
 *   2. A student is eligible only if they were a member of a winning
 *      team for this cycle AND their own final standing for this
 *      cycle is >= 0. A standing of exactly 0 qualifies; any negative
 *      standing does not, regardless of team.
 *
 * Returns `{ winningTeams, awards }` — `winningTeams` is provided
 * mainly for the Team Profile's own achievement history (so a team's
 * "how many cycles did we win" count doesn't require re-deriving this
 * same max/tie logic a second time); `awards` is the flat list of
 * `{ studentId, studentName, teamId, teamName, standing }` this
 * cycle's Achievement Events should be built from.
 */
export function evaluateWinningTeamMember(cycle) {
  const realTeams = (cycle.teams || []).filter((team) => !team.isUngrouped && team.name !== 'Ungrouped');

  if (realTeams.length === 0) {
    return { winningTeams: [], awards: [] };
  }

  const highestTotal = Math.max(...realTeams.map((team) => team.total));
  const winningTeams = realTeams.filter((team) => team.total === highestTotal);

  const awards = winningTeams.flatMap((team) =>
    (team.students || [])
      .filter((student) => student.standing >= 0)
      .map((student) => ({
        studentId: student.id,
        studentName: student.name,
        teamId: team.id,
        teamName: team.name,
        standing: student.standing,
      }))
  );

  return {
    winningTeams: winningTeams.map((team) => ({ id: team.id, name: team.name, total: team.total })),
    awards,
  };
}
