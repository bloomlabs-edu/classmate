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

/** A student's own self-reported grasp of a concept. Per-student — see models/StudentConceptRecord.js. Student-controlled. 'confident' sits between 'understand' ("still learning") and 'can_teach' (the top/Mastered tier) — see ui/views/ConceptWorkspaceView.js's own masteredCount, which deliberately continues to count 'can_teach' only, never 'confident', per explicit product decision. */
export const UNDERSTANDING_KEYS = Object.freeze(['not_marked', 'understand', 'can_teach', 'need_help', 'confident']);

export const UNDERSTANDING_LABELS = Object.freeze({
  not_marked: 'Not Marked',
  understand: 'I Understand',
  can_teach: 'I Can Teach This',
  need_help: 'I Need Help',
  confident: 'I Feel Confident',
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

/**
 * The student-facing reflection vocabulary — same underlying
 * UNDERSTANDING_KEYS values, deliberately different words than
 * UNDERSTANDING_LABELS above, which remains exactly as-is for the
 * teacher-facing ConceptWorkspaceView.js. This mirrors the same
 * "different vocabulary at different layers, same underlying object"
 * principle already used for Learning Hub terminology — the student
 * never needs to know this maps onto a key also displayed to their
 * teacher as "I Need Help".
 */
export const STUDENT_UNDERSTANDING_LABELS = Object.freeze({
  not_marked: 'Not explored yet',
  need_help: "I don't understand this yet",
  understand: "I'm still learning this",
  confident: 'I feel confident with this',
  can_teach: 'I can teach this',
});

export const STUDENT_UNDERSTANDING_ICONS = Object.freeze({
  not_marked: '\u26aa',
  need_help: '\ud83d\udd34',
  understand: '\ud83d\udfe1',
  confident: '\ud83d\udfe2',
  can_teach: '\u2b50',
});

export function getStudentUnderstandingLabel(understanding) {
  return STUDENT_UNDERSTANDING_LABELS[understanding] || STUDENT_UNDERSTANDING_LABELS.not_marked;
}

export function getStudentUnderstandingIcon(understanding) {
  return STUDENT_UNDERSTANDING_ICONS[understanding] || STUDENT_UNDERSTANDING_ICONS.not_marked;
}

export function getNotebookStatusLabel(notebookStatus) {
  return NOTEBOOK_STATUS_LABELS[notebookStatus] || NOTEBOOK_STATUS_LABELS.not_required;
}
