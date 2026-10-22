/**
 * models/StudentComment.js
 *
 * One teacher-authored, PRIVATE comment about a student — optionally
 * attached while recording a completion/recognition event (a notebook
 * check, an assignment checkpoint, or a standalone recognition with no
 * specific work item at all). Lives at
 * classrooms/{classroomId}/studentComments/{commentId} — a genuinely
 * separate Firestore collection from models/Testimonial.js, never a
 * field alongside it on the same document, specifically so
 * firestore.rules can grant broad, student-reachable read access to
 * published testimonials without that rule ever being able to also
 * expose a comment (see firestore.rules's own header comment on this
 * collection for the full reasoning).
 *
 * This collection — and this model — must never grow a field for
 * contact details, government IDs, health/medical information, caste/
 * religion, or photos/videos of a student. `text` is a short, free-
 * form teacher observation about classroom performance or behaviour
 * only, per this project's standing data-handling rules.
 *
 * `workItemRef` is optional and additive-only in shape — null for a
 * standalone recognition comment not tied to any specific piece of
 * work. When present, its own `type` discriminates the rest of its
 * shape:
 *   { type: 'notebook', subjectId, notebookTypeId, dateKey }
 *   { type: 'assignment_checkpoint', assignmentId, checkpointId }
 * Deliberately the same compound keys services/notebookService.js and
 * services/assignmentCheckpointService.js already use to key their own
 * records — see services/recognitionService.js's own header comment —
 * so a comment can never be conflated across two different worksheets
 * or two different checkpoints that happen to share a date or a
 * student.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

export function createStudentComment({
  id,
  classroomId,
  studentId,
  workItemRef = null,
  text,
  createdByUid,
  createdAt,
  updatedByUid = null,
  updatedAt = null,
} = {}) {
  const now = getCurrentIsoDate();
  return {
    id: id || generateId(),
    classroomId,
    studentId,
    workItemRef,
    text,
    createdByUid,
    createdAt: createdAt || now,
    updatedByUid,
    updatedAt,
  };
}
