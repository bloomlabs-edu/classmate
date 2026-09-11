/**
 * models/AchievementEvent.js
 *
 * An Achievement Event records the fact that one specific student
 * earned one specific badge, once. This is the Badge & Achievement
 * Engine's source of truth — a student's current badge *level* is
 * always a derived count over these events (see
 * services/achievementService.js's getStudentBadgeSummaries()), never
 * a separately-stored counter that could drift from the history it's
 * supposed to represent.
 *
 * Stored at classrooms/{classroomId}/achievementEvents/{id} — its own
 * Firestore subcollection, the same pattern
 * services/scoreboardArchiveService.js already established for
 * Scoreboard Archives, not a growing array embedded on the classroom
 * document itself.
 *
 * `id` is ALWAYS the deterministic id from buildAchievementEventId()
 * below, never a random one — this is the entire idempotency
 * mechanism. Re-running the same evaluation (live or backfill) for the
 * same student/badge/cycle recomputes the exact same id and overwrites
 * the same document instead of creating a duplicate; see
 * services/achievementService.js's awardForCycle() for where this is
 * actually relied on.
 */

/**
 * Deterministic identity for one award: student + badge + the Standing
 * Cycle that caused it. This is the "student + badge + standingCycle"
 * uniqueness the badge engine brief calls for, expressed as a real,
 * database-safe document id rather than a separate uniqueness index —
 * a duplicate award attempt is structurally a `setDoc` to the same
 * path, not a new document, so there is nothing to detect or clean up
 * after the fact.
 */
export function buildAchievementEventId({ studentId, badgeFamily, recognitionType, cycleId }) {
  return [studentId, badgeFamily, recognitionType, cycleId].join('__');
}

/**
 * Fields:
 *   id            - buildAchievementEventId()'s own output; also the Firestore doc id.
 *   studentId     - which student.
 *   badgeFamily   - e.g. 'weekly-standing' (config/badgeDefinitions.js).
 *   recognitionType - e.g. 'winning-team-member'.
 *   cycleId       - the Standing Cycle (today: a scoreboardArchive id) that caused this award.
 *   cycleLabel    - a human-readable label for that cycle, snapshotted at award time
 *                   (the archive itself is immutable, but this avoids every
 *                   history view needing a second fetch just to show a date).
 *   teamId/teamName - the winning team this student belonged to for this cycle, if applicable.
 *   standing      - this student's own final individual standing for this cycle (the
 *                   value eligibility was judged against) — kept for auditability, per
 *                   the brief's explicit "what was the relevant standing/result?" requirement.
 *   awardedAt     - ISO timestamp this event was actually written (not the cycle's own date).
 *   source        - 'live' | 'backfill' — which path produced this event.
 */
export function createAchievementEvent({
  studentId,
  badgeFamily,
  recognitionType,
  cycleId,
  cycleLabel = null,
  teamId = null,
  teamName = null,
  standing,
  awardedAt,
  source,
}) {
  return {
    id: buildAchievementEventId({ studentId, badgeFamily, recognitionType, cycleId }),
    studentId,
    badgeFamily,
    recognitionType,
    cycleId,
    cycleLabel,
    teamId,
    teamName,
    standing,
    awardedAt,
    source,
  };
}
