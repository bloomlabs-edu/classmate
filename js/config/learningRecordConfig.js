/**
 * config/learningRecordConfig.js
 *
 * The three independent status dimensions Learning Record tracks per
 * concept. Deliberately three separate enums, not one combined
 * "concept state" — a concept can be taught but not yet understood by
 * anyone, or understood-by-self-report but notebook work still
 * pending, and every combination in between is valid and expected.
 * Collapsing these into one status would force an artificial
 * ordering that doesn't reflect how a classroom actually moves
 * through material.
 *
 * See docs/LEARNING_RECORD.md for the full architecture, including
 * why `understanding`/`notebook`/`helpRequested` live per-student
 * (Student.learningRecord) while `status` lives on the shared
 * classroom-level Concept — the same "create once at the classroom
 * level, mark per-student separately" split this app already uses for
 * Learning Activities (see models/LearningActivity.js).
 *
 * No logic here, only data — matching config/bucketConfig.js's own
 * stated convention.
 */

/** Whether a concept has been taught to the class yet. Classroom-level — see models/LearningConcept.js. Teacher-controlled. */
export const CONCEPT_STATUS_KEYS = Object.freeze(['not_taught', 'taught']);

export const CONCEPT_STATUS_LABELS = Object.freeze({
  not_taught: 'Not Taught',
  taught: 'Taught',
});

/** A student's own self-reported grasp of a concept. Per-student — see models/StudentConceptRecord.js. Student-controlled. */
export const UNDERSTANDING_KEYS = Object.freeze(['not_marked', 'understand', 'can_teach', 'need_help']);

export const UNDERSTANDING_LABELS = Object.freeze({
  not_marked: 'Not Marked',
  understand: 'I Understand',
  can_teach: 'I Can Teach This',
  need_help: 'I Need Help',
});

/** A student's notebook-work status for a concept. Per-student, but teacher-controlled — a teacher marks work pending/submitted/corrected the same way notebook checks work elsewhere in this app (see services/notebookCheckService.js). Not every concept requires notebook work — 'not_required' is the default. */
export const NOTEBOOK_STATUS_KEYS = Object.freeze(['not_required', 'pending', 'submitted', 'corrected']);

export const NOTEBOOK_STATUS_LABELS = Object.freeze({
  not_required: 'Not Required',
  pending: 'Pending',
  submitted: 'Submitted',
  corrected: 'Corrected',
});

export function getConceptStatusLabel(status) {
  return CONCEPT_STATUS_LABELS[status] || CONCEPT_STATUS_LABELS.not_taught;
}

export function getUnderstandingLabel(understanding) {
  return UNDERSTANDING_LABELS[understanding] || UNDERSTANDING_LABELS.not_marked;
}

export function getNotebookStatusLabel(notebookStatus) {
  return NOTEBOOK_STATUS_LABELS[notebookStatus] || NOTEBOOK_STATUS_LABELS.not_required;
}
