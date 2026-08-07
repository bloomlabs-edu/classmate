/**
 * services/timelineService.js
 *
 * Reads and appends to a Student's Timeline — the append-only log
 * backing "Current Session Score", "Total Positive Points", "Total
 * Negative Points", and the profile's Activity tab (see
 * models/Student.js's `history` field). `score` is a derived cache kept
 * in sync with this log, not the source of truth itself.
 *
 * Every domain service that changes something worth remembering about a
 * student — badgeService (award/revoke), noteService (add), bucketService
 * (change), learningActivityService (status set) — logs through here, so
 * the Timeline reads as one unified chronological record rather than
 * several disconnected logs. This is scoped to the Student Profile's own
 * "Log Participation" control for points specifically — a separate,
 * minimal way to record a point change with a reason. It is not the
 * click-a-team-card scoring system referenced elsewhere in the project's
 * history, which remains a future milestone.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function logEntry(student, { kind, label, delta = 0 }) {
  if (!student.history) student.history = [];
  const entry = { id: generateId(), kind, label, delta, recordedAt: getCurrentIsoDate() };
  student.history.push(entry);
  if (kind === 'points') student.score += delta;
  return entry;
}

export function logPoints(student, delta, label) {
  return logEntry(student, { kind: 'points', label, delta });
}

/**
 * Most recent entry first. Reverses insertion order rather than sorting
 * by timestamp — entries logged within the same millisecond would
 * otherwise tie and silently fall back to insertion order for just
 * those entries, which looks like a bug (newest-first breaking) even
 * though the log itself is correct.
 */
export function listTimeline(student) {
  return [...(student.history || [])].reverse();
}

export function getTotalPositivePoints(student) {
  return (student.history || [])
    .filter((entry) => entry.kind === 'points' && entry.delta > 0)
    .reduce((sum, entry) => sum + entry.delta, 0);
}

/** Returned as a positive magnitude (e.g. 3, not -3) for display. */
export function getTotalNegativePoints(student) {
  const total = (student.history || [])
    .filter((entry) => entry.kind === 'points' && entry.delta < 0)
    .reduce((sum, entry) => sum + entry.delta, 0);
  return Math.abs(total);
}

/**
 * A student's own all-time NET star total — positive minus negative,
 * per the platform-wide rule (see services/studentProgressService.js's
 * own header comment for the range-scoped equivalent, getStarsInRange()).
 * Always derived directly from history, the same source of truth
 * every other star computation in this app already uses — never
 * reads student.score, which is only an incrementally-maintained
 * cache and can genuinely drift from this (confirmed: see
 * services/studentService.js's resetAllScores(), which zeroes score
 * while leaving history untouched). This is the function every
 * all-time star display should call.
 */
export function getNetPoints(student) {
  return getTotalPositivePoints(student) - getTotalNegativePoints(student);
}
