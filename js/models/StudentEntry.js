/**
 * models/StudentEntry.js
 *
 * PHASE 3 — Student Identity & Learning Circle Data Boundary.
 *
 * classrooms/{classroomId}/programmeSessions/{sessionId}/studentEntries/{studentId}
 *
 * Exists for exactly one structural reason: `ProgrammeSession`
 * contains every roster student's own attendance, goals, and
 * observations in one document, and Firestore cannot expose part of
 * a document to a client — a student can never safely be granted
 * `allow read` on the canonical session document without leaking
 * every other student's own data. `StudentEntry` is the minimum slice
 * that can be its own, independently-addressable, independently-
 * rule-scoped document.
 *
 * Deliberately minimal — only the two fields a student is actually
 * shown or can actually write:
 *
 *   attendance — TEACHER-WRITTEN, MIRRORED. Canonical source remains
 *     `ProgrammeSession.attendance[studentId]`; this is a read-only
 *     copy, kept in sync by the teacher's own client in the same
 *     atomic batch that writes the canonical record (see
 *     services/programmeSessionService.js's own saveAttendancePatch()).
 *     `null` means "no explicit record" — the *display* default
 *     ("Present") is still computed the same way it already is for
 *     ProgrammeSession, never stored here as a fabricated value.
 *
 *   goals — for a session with `usesStudentEntries: true`, THIS is
 *     the canonical source (not `ProgrammeSession.goals`, which
 *     simply isn't written to for these sessions at all). Shaped
 *     identically to `session.goals[studentId]` — `{ [categoryId]:
 *     { text, source, outcome, reflection } }` — so every existing
 *     UI function built around that shape (buildGoalPicker(),
 *     buildExistingGoalDisplay(), etc.) needs no shape-level changes,
 *     only a different read/write target.
 *
 * Deliberately excludes teacherObservations and activities — neither
 * is ever shown to a student anywhere in this app, and copying them
 * here would recreate exactly the multi-student-data-in-one-place
 * problem this document exists to avoid, just at a smaller scale.
 */

export function createStudentEntry({ attendance = null, goals = {} } = {}) {
  return {
    attendance,
    goals,
  };
}
