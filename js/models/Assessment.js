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
 * `deletedAt` — null for a live Assessment. "Delete Assessment" (see
 * services/assessmentService.js's own deleteAssessment()) only ever
 * stamps this field; it never removes the Assessment or any of its
 * AssessmentSubjects/StudentResults from the array. Every normal read
 * path excludes a deletedAt-stamped Assessment by default (so it
 * disappears from the Gradebook, Scorecard, and any student's own
 * growth trajectory immediately), but nothing about its marks is ever
 * destroyed — restoreAssessment() clears this one field and every
 * reader sees the exact original Assessment again, with zero
 * re-entry. An existing Assessment created before this field existed
 * simply has `deletedAt: undefined`, which every check below treats
 * identically to `null`.
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
  deletedAt = null,
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
    deletedAt,
  };
}
