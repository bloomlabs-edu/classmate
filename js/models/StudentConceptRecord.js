/**
 * models/StudentConceptRecord.js
 *
 * The per-student half of a Concept — everything that varies by
 * student rather than being shared across the whole class (see
 * models/LearningConcept.js's doc comment for why these are split).
 * Stored as the value in a Student's `learningRecord` map, keyed by
 * concept id: `student.learningRecord[conceptId]` (see
 * models/Student.js) — the same shape Student.submissions uses for
 * Learning Activities, keyed by activity id instead of concept id.
 *
 * Not stored in an array and has no id of its own — the map key (the
 * concept's id) is its identity, exactly like `submissions[activityId]`.
 *
 * Fields:
 *   understanding  - the student's own self-reported grasp (see
 *                     config/learningRecordConfig.js's
 *                     UNDERSTANDING_KEYS). Student-controlled.
 *   notebook       - this student's notebook-work status for this
 *                     concept (see NOTEBOOK_STATUS_KEYS).
 *                     Teacher-controlled.
 *   helpRequested  - true if the student has flagged that they need
 *                     help with this concept. Student-controlled — set
 *                     true by the student, cleared by either the
 *                     student (withdrawing the request) or the teacher
 *                     (having addressed it). See
 *                     services/learningRecordStudentService.js and
 *                     services/learningRecordTeacherService.js.
 *   updatedAt      - ISO date string, set whenever any field above
 *                     changes — mirrors Student.submissions'
 *                     updatedAt.
 */

export function createStudentConceptRecord({
  understanding = 'not_marked',
  notebook = 'not_required',
  helpRequested = false,
  updatedAt = null,
} = {}) {
  return {
    understanding,
    notebook,
    helpRequested,
    updatedAt,
  };
}
