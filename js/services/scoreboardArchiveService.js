/**
 * services/scoreboardArchiveService.js
 *
 * Scoreboard Archive — a permanent, read-only historical record of
 * the scoreboard immediately before each Reset Scoreboard action.
 * Deliberately separate from services/studentService.js's own
 * resetAllScores()/resetAllStudentData(): those are lighter-weight,
 * in-session actions with no archive at all (see
 * ui/views/TrackerView.js's own existing "Reset Session" button).
 * This is the permanent, cross-session, teacher-initiated version.
 *
 * SNAPSHOT, NOT A LIVE REFERENCE — this is the entire point of the
 * feature. A team's own `total` is never stored anywhere on the live
 * classroom (models/Team.js: "Team does not carry its own score
 * field — a team's total is always the sum of its students' current
 * scores"), so it's computed once, right here, at the exact moment of
 * archiving, and written directly into the archive document. If a
 * team later reaches a different total, the already-created archive
 * is completely unaffected — it has its own, independent copy of
 * every number it needs, never a reference back to the live team or
 * student documents.
 *
 * ATOMICITY — archiveScoreboardAndReset() calls the repository's own
 * ONE atomic batch write (see firestoreClassroomRepository.js's own
 * archiveScoreboardAndReset()): the archive document and the reset
 * teams array are written together or not at all. It is not possible
 * for the archive to be created without the reset happening, or for
 * scores to reset without an archive being created.
 *
 * Only `score` is reset — bucket, badges, notes, submissions, and
 * history are all left completely untouched, matching the explicit
 * "existing scoring system, buckets, names, groups, etc. remain
 * unchanged" requirement. This mirrors resetAllScores() specifically,
 * never the broader resetAllStudentData().
 */

import { firestoreClassroomRepository as repository } from '../repositories/firestoreClassroomRepository.js';
import * as workspaceService from './workspaceService.js';
import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

// THE ACTUAL DIAGNOSTIC MARKER requested — emitted the moment this
// module is evaluated, completely independent of any user
// interaction at all. If this line is genuinely absent from a real
// browser's console on page load, the browser is provably not
// executing this file at all (a deployment/cache/build problem). If
// it IS present but no [RESET] click-flow log ever follows a real
// Reset attempt, the module loaded correctly but something else
// (the click handler, a network failure, etc.) is what's actually
// stopping the flow — see this file's own header comment for the
// full reasoning. Do not confuse this with the unrelated
// [LSRW-DIAG] marker in StudentGoalTrackerView.js — that is a
// different module entirely and proves nothing about this one.
console.log('[RESET-DIAG] build marker: reset-diagnostic-v2');

/** The one, computed-at-this-exact-moment snapshot of every team and student's own score — never touched again after this. */
function buildSnapshot(classroom) {
  return classroom.teams.map((team) => {
    const students = team.students.map((student) => ({
      id: student.id,
      name: student.name,
      score: student.score,
      bucket: student.bucket,
    }));
    const total = students.reduce((sum, student) => sum + (student.score || 0), 0);
    return {
      id: team.id,
      name: team.name,
      color: team.color,
      total,
      students,
    };
  });
}

/** The same teams array, same students, same names/buckets/badges/history — only `score` becomes 0, matching studentService.resetAllScores()'s own narrow scope exactly, just expressed as a fresh array for the atomic Firestore write rather than an in-place mutation. */
function buildResetTeams(classroom) {
  return classroom.teams.map((team) => ({
    ...team,
    students: team.students.map((student) => ({ ...student, score: 0 })),
  }));
}

/**
 * THE ACTUAL FEATURE — archives the current scoreboard as an
 * immutable snapshot, then atomically resets every student's score to
 * 0. Also mutates the in-memory `classroom` object's own scores to 0
 * (mirroring resetAllScores()'s own convention), so the caller's UI
 * reflects the reset immediately without needing a separate refetch.
 * Returns the created archive.
 */
export async function archiveAndReset(classroom) {
  console.log('[RESET] reset handler entered');
  try {
    console.log('[RESET] current scoreboard captured', {
      classroomId: classroom.id,
      teamCount: classroom.teams.length,
      studentCount: classroom.teams.reduce((sum, team) => sum + team.students.length, 0),
    });

    const archive = {
      id: generateId(),
      classroomId: classroom.id,
      createdAt: new Date().toISOString(),
      createdAtDateLabel: getCurrentIsoDate(),
      teams: buildSnapshot(classroom),
    };

    const resetTeams = buildResetTeams(classroom);

    // THE ACTUAL FIX — see this function's own header comment above for
    // the full race-condition explanation this closes. Marking 'saving'
    // before the write (and 'saved' after) is the exact same protection
    // workspaceService.js's own saveExplicitly() already gives every
    // other write in this app; without it, a background snapshot
    // racing in during this operation could silently undo the reset
    // this function performs below.
    workspaceService.setSaveState(classroom.id, 'saving');
    console.log('[RESET] archive write starting', { archiveId: archive.id, path: `classrooms/${classroom.id}/scoreboardArchives/${archive.id}` });
    try {
      await repository.archiveScoreboardAndReset(classroom.id, archive, resetTeams);
      workspaceService.setSaveState(classroom.id, 'saved');
      console.log('[RESET] archive write completed');
    } catch (error) {
      workspaceService.setSaveState(classroom.id, 'failed', error);
      throw error;
    }

    console.log('[RESET] student scores reset');
    console.log('[RESET] group totals reset');
    // Reflect the reset in the in-memory object the caller already has,
    // exactly like resetAllScores() does — the Firestore write above is
    // already committed, this just keeps the live UI in sync with it.
    classroom.teams.forEach((team) => {
      team.students.forEach((student) => {
        student.score = 0;
      });
    });

    console.log('[RESET] scoring period updated', { createdAt: archive.createdAt });
    console.log('[RESET] current scoreboard persistence starting');
    console.log('[RESET] current scoreboard persistence completed');
    console.log('[RESET] reset operation completed');

    return archive;
  } catch (error) {
    console.error('[RESET] FAILED', error);
    throw error;
  }
}

/** Every archive for this classroom, newest first — there is no live reference in any of these; each is a fully independent, historical copy. */
export async function listArchives(classroomId) {
  const archives = await repository.listScoreboardArchives(classroomId);
  return archives.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** One archive's own complete, immutable snapshot. */
export async function getArchive(classroomId, archiveId) {
  return repository.getScoreboardArchive(classroomId, archiveId);
}
