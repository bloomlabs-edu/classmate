/**
 * services/achievementService.js
 *
 * The Badge & Achievement Engine's Firestore-touching layer — thin on
 * purpose. Every actual rule/decision (ties, negative-standing
 * exclusion, deterministic ids, level-by-count, per-cycle team
 * membership) lives in services/achievementEngine.js, which has NO
 * Firestore import at all specifically so it stays directly
 * unit-testable (see that file's own header comment). This file only
 * adds the two things a pure module can never do itself: writing
 * events, and reading them back.
 *
 * Deliberately has NO import of services/scoreboardArchiveService.js —
 * that file imports THIS one (to award badges the moment a cycle
 * closes; see its own archiveAndReset()), so this file must never
 * import back, or every load of either module would form a cycle.
 */

import { firestoreClassroomRepository as repository } from '../repositories/firestoreClassroomRepository.js';
import { buildEventsForCycle } from './achievementEngine.js';

export { toStandingCycle, summarizeStudentBadges, getTeamAchievementHistory, buildEventsForCycle } from './achievementEngine.js';

/**
 * Awards every eligible student for one closed Standing Cycle (today,
 * always a Scoreboard Archive) — the ONE function both the live
 * cycle-close hook (services/scoreboardArchiveService.js's
 * archiveAndReset()) and services/badgeBackfillService.js's historical
 * pass call, so there is exactly one award evaluation path in the
 * whole app, never two versions that could drift apart.
 *
 * Idempotent by construction: every Achievement Event's id is
 * deterministic (student + badge + this exact cycle — see
 * models/AchievementEvent.js), and every write is a `setDoc` to that
 * id, never an `addDoc`. Calling this twice for the same archive
 * produces the exact same documents, not duplicates — this is what
 * makes services/badgeBackfillService.js safe to re-run.
 *
 * Returns every event written (whether newly created or an idempotent
 * overwrite of an identical prior award) — callers that only care
 * about "how many NEW awards happened this run" should diff against
 * events that already existed before calling this, not rely on this
 * return value to distinguish the two.
 */
export async function awardForCycle(classroomId, archive, { source } = {}) {
  const events = buildEventsForCycle(archive, { source });
  await Promise.all(events.map((event) => repository.saveAchievementEvent(classroomId, event)));
  return events;
}

/** Every Achievement Event this classroom has ever recorded, for a specific student. */
export async function listEventsForStudent(classroomId, studentId) {
  const events = await repository.listAchievementEvents(classroomId);
  return events.filter((event) => event.studentId === studentId);
}

/** Every Achievement Event this classroom has ever recorded — used by services/badgeBackfillService.js to diff "new vs already-existing" for its own summary. */
export async function listAllEvents(classroomId) {
  return repository.listAchievementEvents(classroomId);
}
