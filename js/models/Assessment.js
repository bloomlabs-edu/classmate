/**
 * models/Assessment.js
 *
 * Assessment Management's own top-level record — a school-administration
 * artifact (Mid Term Examination, Unit Test 1, ...), deliberately
 * independent of Learning Management. Nothing in this file, or
 * anything it owns (see models/AssessmentSubject.js,
 * models/StudentResult.js), references a Concept, a Unit, a
 * curriculum link, or a Resource. The only connection to Learning
 * Management at all is each AssessmentSubject's own `subjectId`
 * reference — see that model's own header comment for why it's a
 * reference and not a copy.
 *
 * Owns its AssessmentSubjects directly, the same "owns its children as
 * a plain array" pattern already used throughout this app (see
 * models/Team.js, models/LearningSubject.js).
 *
 * `status` — one of 'Draft' | 'Published' | 'Locked'. Only 'Draft' is
 * functional today (every Assessment starts and stays there); the
 * other two are real, storable values now specifically so a future
 * milestone can implement the actual publish/lock behavior without
 * migrating existing data or touching this field's shape.
 *
 * `detailsLastSavedAt` — null until the Assessment Details section's
 * own View/Edit lifecycle (see ui/views/AssessmentManagementView.js)
 * is explicitly saved for the first time via "Edit" -> "Save"; until
 * then, that screen displays `createdAt` as the effective "Last
 * saved" time, since the details were already correct the moment the
 * Assessment was created — there's no reason to force an "Initially
 * editable" state the way a never-saved AssessmentSubject's marks
 * entry does.
 *
 * `examinationCycleId` — null for every Assessment created before this
 * field existed (i.e. every Assessment today). The STABLE, long-term
 * identity for "which examination cycle is this" (e.g. one specific
 * Quarterly Examinations window), shared across both manually-created
 * and Timetable-linked Assessments alike — see
 * services/academicProgressService.js's own resolveCycleKey(), and
 * docs/architecture/ACADEMIC_PROGRESS_METRIC_SPEC.md §0.1 for the full
 * rationale. Deliberately NOT auto-populated by anything yet — no UI
 * exists today to create/select an examination cycle, so every current
 * Assessment resolves its cycle via the title+academicYear compatibility
 * fallback (same doc) until a future milestone adds that UI and begins
 * setting this field. Reading this field anywhere outside
 * academicProgressService.js's own resolveCycleKey() is almost
 * certainly wrong — go through that function, never this field
 * directly, so the fallback stays centralized in one place.
 *
 * `passMarkPercent` — null for every Assessment created before this
 * field existed, and for a new Assessment until a teacher explicitly
 * edits it via "Edit Details". `null` means "use the system default"
 * — config/assessmentMarksColorConfig.js's own PASS_MARK_PERCENT (the
 * same 36% every Assessment already effectively used before this
 * field existed) — resolved by services/assessmentService.js's own
 * getPassMarkPercent(), never inlined at a call site. A percentage of
 * each AssessmentSubject's own maximumMarks, matching the existing
 * semantic meaning "Pass Mark: 36%" already had — never an absolute
 * mark.
 *
 * ALSO the Red/Yellow bucket boundary (see
 * config/assessmentMarksColorConfig.js's own getMarksColorClass()):
 * a score below this Assessment's own Pass Mark is Red, at or above
 * it is Yellow (or Green, past the separate, fixed 70% Green
 * threshold) — this is a CONFIRMED business rule, not an incidental
 * side effect. Do not reintroduce a second, hardcoded Red/Yellow
 * threshold independent of this field; that exact bug (a Pass Mark
 * of 35% still classifying a 35% score as Red, because the bucket
 * boundary was a separate, stale hardcoded 36%) is what this
 * paragraph itself was rewritten to prevent from recurring.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createAssessment({
  id,
  classroomId,
  title,
  type,
  academicYear = '',
  date = '',
  status = 'Draft',
  createdAt,
  detailsLastSavedAt = null,
  assessmentSubjects = [],
  pinnedToDashboard = false,
  passMarkPercent = null,
  examinationCycleId = null,
} = {}) {
  return {
    id: id || generateId(),
    classroomId,
    title,
    type,
    academicYear,
    date,
    status,
    createdAt: createdAt || getCurrentIsoDate(),
    detailsLastSavedAt,
    assessmentSubjects,
    pinnedToDashboard,
    passMarkPercent,
    examinationCycleId,
  };
}
