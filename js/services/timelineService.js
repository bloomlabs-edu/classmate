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

/**
 * `id` — defaults to a random id (every existing caller's own
 * behavior, unchanged), but a caller MAY pass a stable, deterministic
 * id instead, specifically to make its own entry findable/removable
 * later via findEntryById()/removeEntryById() below — see
 * services/checkpointService.js's syncCheckpointCompletionPoint() for
 * the first real use of this.
 *
 * `source`/`sourceId`/`studentId` — optional, additive provenance
 * fields (same "additive fields on an existing shape" convention
 * already used for models/Student.js's own `submissions` entries —
 * see that model's own header comment). Only populated by a caller
 * that needs its entries to be identifiable by something sturdier
 * than `label` text (see checkpointService.js's
 * syncCheckpointCompletionPoint()) — every existing caller (badges,
 * Class Mode stars/points, Log Participation) omits them, unchanged.
 * `studentId` is redundant with which student's own `history` array
 * this entry already lives in — included anyway so a single entry
 * remains self-identifying if it's ever read outside that per-student
 * array context (e.g. a flattened export).
 */
export function logEntry(student, { id, kind, label, delta = 0, source, sourceId, studentId } = {}) {
  if (!student.history) student.history = [];
  const entry = { id: id || generateId(), kind, label, delta, recordedAt: getCurrentIsoDate() };
  if (source !== undefined) entry.source = source;
  if (sourceId !== undefined) entry.sourceId = sourceId;
  if (studentId !== undefined) entry.studentId = studentId;
  student.history.push(entry);
  if (kind === 'points') student.score += delta;
  return entry;
}

export function logPoints(student, delta, label, extra = {}) {
  return logEntry(student, { kind: 'points', label, delta, ...extra });
}

/** The one entry with this exact id, or null — the read half of the findable-by-id contract logPoints()'s own optional `id` override exists for. */
export function findEntryById(student, id) {
  return (student.history || []).find((entry) => entry.id === id) || null;
}

/**
 * Removes exactly the entry with this id and reverses exactly its own
 * `delta` — never a blind ±1 — mirroring services/classModeService.js's
 * own removeHistoryEntry()/undo-callback pattern (`student.score -=
 * delta; removeHistoryEntry(student, entry.id)`), promoted here as a
 * shared, DURABLE primitive: that file's own version only lives in a
 * session-only, in-memory undo stack (wiped on reload, by its own
 * explicit design — see that file's own header comment), which can't
 * satisfy a caller that needs to find and reverse a SPECIFIC entry
 * keyed by a stable id at any later point, including after a reload.
 * Returns the removed entry (so a caller can log/inspect what was
 * reversed), or `null` if no entry with this id exists — a safe no-op,
 * not an error, since a caller reversing an already-absent award is an
 * expected, idempotent case (see checkpointService.js's own
 * syncCheckpointCompletionPoint()).
 */
export function removeEntryById(student, id) {
  const entry = findEntryById(student, id);
  if (!entry) return null;
  student.history = (student.history || []).filter((existing) => existing.id !== id);
  if (entry.kind === 'points') student.score -= entry.delta;
  return entry;
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

/**
 * THE LIVE SCOREBOARD's own score function — net points since
 * `classroom.currentScoringPeriodStartedAt`, per the approved Reset
 * Scoreboard design. Deliberately separate from getNetPoints() above,
 * which remains all-time and completely untouched (StudentProfileView.js
 * depends on that all-time semantics; changing getNetPoints() itself
 * was explicitly ruled out).
 *
 * Deliberately does NOT reuse studentProgressService.js's own
 * getStarsInRange(): that function compares date-only keys
 * (`recordedAt.slice(0, 10)`), which is the right granularity for a
 * calendar week/month view, but wrong here — two Reset Scoreboard
 * actions on the same calendar day would otherwise be treated as the
 * same period, since a date-only comparison can't distinguish "before
 * 2pm" from "after 2pm" on the same day. This compares full ISO
 * timestamps directly instead, for genuine time precision.
 *
 * `classroom.currentScoringPeriodStartedAt === null` (a classroom that
 * has never been reset, or one created before this field existed) is
 * treated as "no lower bound" — every existing history entry belongs
 * to the current period, preserving exactly what a classroom already
 * displayed before this change, per explicit design decision.
 */
export function getNetPointsInCurrentPeriod(classroom, student) {
  const periodStart = classroom.currentScoringPeriodStartedAt;
  const entries = (student.history || []).filter((entry) => entry.kind === 'points' && (!periodStart || entry.recordedAt >= periodStart));
  const positive = entries.filter((entry) => entry.delta > 0).reduce((sum, entry) => sum + entry.delta, 0);
  const negative = Math.abs(entries.filter((entry) => entry.delta < 0).reduce((sum, entry) => sum + entry.delta, 0));
  return positive - negative;
}
