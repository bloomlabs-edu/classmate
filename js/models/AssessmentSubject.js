/**
 * models/AssessmentSubject.js
 *
 * One Subject included in an Assessment (see models/Assessment.js) —
 * its maximum marks and every student's result for it.
 *
 * `subjectId` is a reference into Learning Management's own Subject
 * list (`learningRecordService.getSubjects(classroom)`), not a copy
 * of the Subject's title — this is the architectural change made
 * explicitly before implementation: if a Subject is later renamed
 * ("Social Science" -> "Humanities"), every Assessment that includes
 * it should reflect the new name automatically, not freeze the old
 * one at the moment the Assessment was created. Resolving the actual
 * current title from that ID at display time is
 * services/assessmentService.js's job, not this model's.
 *
 * This is the *only* connection Assessment Management has to Learning
 * Management — a Subject's id and current title. Nothing here reads
 * or references Units, Concepts, curriculum links, or Resources; this
 * module is independent by design, not just by omission.
 *
 * `lastSavedAt` — null until the marks-entry screen's own document
 * editor pattern (see ui/views/AssessmentManagementView.js's
 * renderSubjectStep()) is saved for the first time; set on every
 * subsequent save. Drives whether that screen shows editable fields
 * ("Initially" / never saved yet) or read-only ones with "Last saved:
 * ..." and an Edit action.
 */

import { generateId } from '../utils/idGenerator.js';

export function createAssessmentSubject({ id, subjectId, maximumMarks = 100, studentResults = [], lastSavedAt = null } = {}) {
  return {
    id: id || generateId(),
    subjectId,
    maximumMarks,
    studentResults,
    lastSavedAt,
  };
}
