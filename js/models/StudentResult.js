/**
 * models/StudentResult.js
 *
 * One student's result within one AssessmentSubject (see
 * models/AssessmentSubject.js). Deliberately minimal, per this
 * module's own explicit scope: marks, an optional absence flag, an
 * optional remark. No grade is computed or stored here — "Do not
 * implement grades yet" — and nothing here references a Concept, a
 * Unit, or any Learning Management data at all. Assessment Management
 * is a record-keeping module, independent of Learning Management by
 * design; the two are combined later, in reporting, not coupled here.
 *
 * `studentId` is a reference into the classroom's own real roster
 * (`classroom.teams[].students[]`), not a copy of the student's name
 * — the same "store a reference, resolve the current value live"
 * principle applied to `AssessmentSubject.subjectId` for exactly the
 * same reason: if a student is renamed later, every past assessment
 * result should reflect that, not freeze a name at entry time.
 *
 * Does not exist ahead of time for every student in a classroom —
 * created (or updated) only once a teacher actually enters something
 * for that student (see services/assessmentService.js's
 * recordStudentMarks()). A student with no entry yet simply has no
 * StudentResult at all; the UI reads the classroom's live roster
 * separately and shows a blank row for anyone without one.
 */

import { generateId } from '../utils/idGenerator.js';

export function createStudentResult({ id, studentId, marks = null, absent = false, remarks = '' } = {}) {
  return {
    id: id || generateId(),
    studentId,
    marks,
    absent,
    remarks,
  };
}
