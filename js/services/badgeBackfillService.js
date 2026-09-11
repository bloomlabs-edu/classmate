/**
 * services/badgeBackfillService.js
 *
 * Populates Achievement Events for every Standing Cycle a classroom
 * already closed before the Badge & Achievement Engine existed —
 * required so existing Student/Team Profiles aren't stuck at "LV 0"
 * the moment this feature ships, per the product brief's own explicit
 * "do not start everyone at LV 0 simply because the badge system is
 * new" requirement.
 *
 * DATA SOURCE AND ITS ONE REAL LIMITATION — read before running this
 * against a real classroom:
 *
 * services/scoreboardArchiveService.js's Scoreboard Archives are the
 * only genuinely reliable historical Standing Cycle record this app
 * has. Each archive freezes a team's exact roster and every member's
 * exact final score at the precise moment "Reset Scoreboard" ran —
 * real point-in-time accuracy, not a reconstruction. This means
 * backfill correctly handles a student who changed teams between two
 * archives (each archive independently recorded whichever roster was
 * real at that moment) and correctly excludes a student who joined a
 * team only after that team's earlier win (they simply aren't in that
 * earlier archive's own student list at all).
 *
 * The limitation: this app has NO historical record of team membership
 * for any period that ISN'T bounded by an archive — every other
 * "standing for a past week" calculation in this codebase
 * (services/teamStatisticsService.js's getTeamStandings(), used by
 * Weekly Reports, Recognition, etc.) applies a team's CURRENT roster
 * retroactively to any past date range, because no per-student
 * team-change log exists anywhere in the data model. This is not a gap
 * introduced by the badge engine — it is how this app has always
 * computed every historical period, everywhere. Backfilling from
 * archives specifically (rather than from arbitrary calendar weeks via
 * teamStatisticsService) is what avoids inheriting that same
 * imprecision here: a classroom that has been using Reset Scoreboard
 * regularly gets fully accurate backfill; a classroom with NO archives
 * yet (never reset) has no historical cycles to backfill at all —
 * genuinely nothing to award, not a bug.
 *
 * Idempotent by construction, not by any check this file performs
 * itself — see services/achievementService.js's awardForCycle() and
 * models/AchievementEvent.js: every event's id is deterministic, and
 * every write is a setDoc to that id. Running this twice recomputes
 * and overwrites the exact same documents.
 */

import * as scoreboardArchiveService from './scoreboardArchiveService.js';
import * as achievementService from './achievementService.js';

/**
 * Runs the backfill for one classroom: every existing Scoreboard
 * Archive, oldest first (chronological order matters for future rules
 * that compare a cycle to the one before it, e.g. Climber — not
 * required for Winning Team Member's own rule today, but this
 * establishes the correct processing order now rather than needing a
 * behavior change later).
 *
 * Returns a plain summary rather than the raw events — this is what
 * ui/views/ScoreboardArchiveView.js (or a future admin/diagnostics
 * entry point) surfaces to a teacher, and what this project's own
 * release report cites.
 */
export async function backfillClassroom(classroomId) {
  const archives = await scoreboardArchiveService.listArchives(classroomId);
  const chronological = [...archives].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

  const existingEvents = await achievementService.listAllEvents(classroomId);
  const existingIds = new Set(existingEvents.map((event) => event.id));

  let eventsWritten = 0;
  let newEvents = 0;
  const studentIdsAwarded = new Set();

  for (const archive of chronological) {
    const events = await achievementService.awardForCycle(classroomId, archive, { source: 'backfill' });
    eventsWritten += events.length;
    events.forEach((event) => {
      if (!existingIds.has(event.id)) newEvents += 1;
      studentIdsAwarded.add(event.studentId);
    });
  }

  return {
    cyclesProcessed: chronological.length,
    eventsWritten,
    newEvents,
    studentsAwarded: studentIdsAwarded.size,
  };
}
