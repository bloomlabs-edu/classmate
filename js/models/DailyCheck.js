/**
 * models/DailyCheck.js
 *
 * One student's daily-check record for one 'daily' trackingMode
 * notebook type (see models/NotebookType.js), for one specific
 * calendar date — the source-of-truth record services/dailyCheckService.js's
 * streak calculation derives from, never a stored streak count itself
 * (streaks are always recomputed from these records + the notebook's
 * own working-day/excluded-date rules, matching this app's own
 * established "derive, don't cache" principle already used elsewhere —
 * see docs/PROGRESS_ENGINE.md).
 *
 * Identity is (subjectId, notebookTypeId, studentId, date) — mirrors
 * models/Checkpoint.js's own (subjectId, notebookTypeId) identity
 * pair, plus studentId and date since a daily check is inherently
 * per-student-per-day, unlike a Checkpoint (one row per checkpoint,
 * many student records nested inside it). Stored as a flat array on
 * classroom.dailyChecks — the same flat-array-on-classroom convention
 * already used for classroom.checkpoints/classroom.workRequests.
 *
 * `status` — 'checked' | 'not_checked'. A DailyCheck row is only ever
 * created once a teacher actually marks a date (see
 * dailyCheckService.js's setDailyCheck()) — an unmarked expected day
 * simply has no row at all, the same "sparse, never fabricated" rule
 * models/StudentCheckpointRecord.js already follows.
 *
 * `score` — optional, only meaningful when the notebook type's own
 * dailySettings.scoringEnabled is true. Omitted entirely (never
 * `undefined`) when absent, per this app's own established
 * Firestore-safety convention (`undefined` values are rejected
 * outright) — see models/WorkRequest.js's own comment for the same
 * rule applied to its own optional fields.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createDailyCheck({ id, subjectId, notebookTypeId, studentId, date, status = 'checked', score, updatedAt } = {}) {
  const record = {
    id: id || generateId(),
    subjectId,
    notebookTypeId,
    studentId,
    date,
    status,
    updatedAt: updatedAt || getCurrentIsoDate(),
  };
  if (score !== undefined) record.score = score;
  return record;
}
