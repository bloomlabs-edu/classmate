/**
 * services/unitProgressService.js
 *
 * "Assigned vs. completed units" (e.g. "8/12 units") — read-only,
 * entirely derived from this app's existing, single sources of truth:
 *   - ASSIGNED: `classroom.learningRecord.subjects[].units[]` (see
 *     models/LearningSubject.js/models/LearningUnit.js) — whichever
 *     curriculum is currently linked to each Subject
 *     (services/curriculumLinkingService.js's own assignCurriculumToSubject()
 *     REPLACES `subject.units` wholesale on every (re)assignment, never
 *     appends — so this is always the current, de-duplicated list; no
 *     term/textbook-spanning dedup logic needs to exist here at all).
 *   - COMPLETED: services/timetableDisplayService.js's own
 *     isUnitTaughtComplete(unit) — ClassMate's one, pre-existing
 *     completion rule (every Concept in the Unit has `status ===
 *     'taught'`), reused verbatim rather than re-derived here.
 *
 * EXPLICIT PRODUCT DECISION (2026-10-29, confirmed before this file was
 * written — see this feature's own investigation): Concept.status is a
 * CLASSROOM-WIDE fact, identical for every student in a classroom/
 * subject — there is no existing per-student "I personally finished
 * this unit" concept anywhere in ClassMate (the only per-student
 * fields, StudentConceptRecord.understanding/.notebook, are a
 * self-reported confidence check-in and a notebook-catch-up status,
 * neither of which means "completed"). Building a genuinely
 * personalized ratio would mean inventing a brand-new per-student
 * tracking concept — out of scope without a separate design decision.
 * This file therefore intentionally computes ONE classroom-wide number
 * per Subject (and, summed, per classroom) — the exact same ratio for
 * every student in it — displayed on each student's own profile for
 * scannability, not as a claim of individual pacing/mastery. Every
 * caller/renderer of this number should treat it as "how far this
 * class has gotten through its assigned units," not "what this
 * specific student has personally mastered."
 *
 * Nothing here is cached or counted manually — every function is a
 * pure read over `classroom.learningRecord` as it exists right now, so
 * a curriculum (re)assignment or a taught-status toggle is reflected
 * immediately on the next read, with nothing to keep in sync and
 * nothing that can drift.
 */

import { isUnitTaughtComplete } from './timetableDisplayService.js';

/**
 * `{ completedUnits, assignedUnits }` for ONE LearningSubject (keyed by
 * its own `id`, not the deliberately separate `subjectId` reference
 * field — see models/LearningSubject.js's own header comment on why
 * those are two different things). `assignedUnits` is simply
 * `subject.units.length`; `assignedUnits: 0` (no units linked/added to
 * this Subject yet) is a real, valid state, never an error — callers
 * must check for it before dividing (see formatUnitProgress() below,
 * which already does).
 */
export function getUnitProgressForSubject(classroom, learningSubjectId) {
  const subject = (classroom.learningRecord?.subjects || []).find((s) => s.id === learningSubjectId);
  const units = subject?.units || [];
  return {
    assignedUnits: units.length,
    completedUnits: units.filter(isUnitTaughtComplete).length,
  };
}

/**
 * The single, combined "X/Y units" figure across EVERY Subject in this
 * classroom's own Learning Record — what the Student Profile's compact
 * indicator shows (see ui/views/StudentProfileView.js). Summing across
 * Subjects is always safe from double-counting: each Subject owns its
 * own, disjoint `units[]` array (a Unit belongs to exactly one Subject,
 * never shared), so this is a plain sum, never a set-union that would
 * need its own dedup logic.
 */
export function getUnitProgressForClassroom(classroom) {
  return (classroom.learningRecord?.subjects || []).reduce(
    (totals, subject) => {
      const units = subject.units || [];
      return {
        assignedUnits: totals.assignedUnits + units.length,
        completedUnits: totals.completedUnits + units.filter(isUnitTaughtComplete).length,
      };
    },
    { assignedUnits: 0, completedUnits: 0 }
  );
}

/**
 * The 0-100 percentage for a readable progress bar/ring — `0` (never
 * NaN/Infinity) when `assignedUnits` is 0, matching
 * formatUnitProgress()'s own zero-units wording below rather than
 * forcing every renderer to separately guard the same division.
 */
export function getUnitProgressPercent({ completedUnits, assignedUnits }) {
  if (assignedUnits === 0) return 0;
  return Math.round((completedUnits / assignedUnits) * 100);
}

/** "8/12 units", or an honest "No units assigned yet" for the zero-assigned case — never "0/0 units" (technically correct but reads as a possible bug) and never a bare NaN%/division artifact. */
export function formatUnitProgress({ completedUnits, assignedUnits }) {
  if (assignedUnits === 0) return 'No units assigned yet';
  return `${completedUnits}/${assignedUnits} units`;
}
