/**
 * models/LearningSubject.js
 *
 * The root of the Learning Record syllabus tree: Subject -> Unit ->
 * Concept (see models/LearningUnit.js, models/LearningConcept.js).
 * Stored as an array on classroom.learningRecord.subjects (see
 * models/Classroom.js) — order matters for display, so this factory
 * self-generates its id the same way Team/Student/NotebookSubject do.
 *
 * Deliberately named "LearningSubject", not "Subject" — this app
 * already has a distinct, unrelated `NotebookSubject`
 * (models/NotebookSubject.js, e.g. "English" as a Notebook Tracker
 * category). The two are conceptually similar (both are "a subject
 * taught in this classroom") but structurally and operationally
 * independent — a Learning Record subject's units/concepts have
 * nothing to do with a classroom's configured notebook types, and
 * nothing in this file or its services imports from or refers to the
 * Notebook Tracker in either direction.
 *
 * `linkedCurriculumIndexId` — optional, nullable. Set when this
 * Subject was created via services/curriculumLinkingService.js's
 * "Link Curriculum" (see ui/views/LearningManagementView.js), naming
 * which Curriculum Index it came from — this is what prevents linking
 * the same Curriculum Index into a classroom twice. Null for a
 * Subject a teacher created directly the existing way; nothing about
 * how a Subject otherwise behaves depends on whether this is set.
 */

import { generateId } from '../utils/idGenerator.js';

/**
 * `subjectId` is the canonical subject-type id (e.g. "mathematics"),
 * assigned once at creation by services/subjectIdentityService.js —
 * see that file's own header comment for the full reasoning. This is
 * a different thing from `id` below, which is this specific Subject
 * *record's* own unique identifier (what AssessmentSubject.subjectId
 * elsewhere in the app actually references — a reference to this
 * record, not to the canonical subject type). `title` is purely
 * presentation, whatever the teacher actually typed or chose to call
 * it; every linking/filtering operation compares `subjectId`, never
 * `title`.
 */
export function createLearningSubject({ id, subjectId = null, title, units = [], linkedCurriculumIndexId = null } = {}) {
  return {
    id: id || generateId(),
    subjectId,
    title,
    units,
    linkedCurriculumIndexId,
  };
}
