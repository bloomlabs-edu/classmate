/**
 * services/learningRecordStudentService.js
 *
 * Every Learning Record mutation a *student* is allowed to make:
 * self-reporting their own understanding of a concept, and flagging
 * (or withdrawing) a help request. Deliberately a separate file from
 * services/learningRecordTeacherService.js — see that file's doc
 * comment for why. This file has no path to touch syllabus structure
 * or a concept's taught status, and no path to set another student's
 * record — every function here takes the one `student` it's allowed
 * to modify directly as an argument, not a studentId to look up,
 * which would open the door to a caller passing in someone else's id.
 *
 * Same mutate-then-caller-saves convention as the teacher service —
 * see that file's doc comment.
 *
 * See docs/LEARNING_RECORD.md for the full architecture.
 */

import { createStudentConceptRecord } from '../models/StudentConceptRecord.js';
import { getStudentConceptRecord } from './learningRecordService.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

/** A student self-reporting their own grasp of a concept — see config/learningRecordConfig.js's UNDERSTANDING_KEYS. */
export function setUnderstanding(student, conceptId, understanding) {
  if (!student.learningRecord) student.learningRecord = {};
  const existing = getStudentConceptRecord(student, conceptId);
  student.learningRecord[conceptId] = createStudentConceptRecord({
    ...existing,
    understanding,
    updatedAt: getCurrentIsoDate(),
  });
  return student.learningRecord[conceptId];
}

/** A student flagging that they need help with a concept. */
export function requestHelp(student, conceptId) {
  if (!student.learningRecord) student.learningRecord = {};
  const existing = getStudentConceptRecord(student, conceptId);
  student.learningRecord[conceptId] = createStudentConceptRecord({
    ...existing,
    helpRequested: true,
    updatedAt: getCurrentIsoDate(),
  });
  return student.learningRecord[conceptId];
}

/** A student withdrawing their own help request — e.g. they figured it out before the teacher got to them. A teacher can also clear this once addressed; see learningRecordTeacherService.js's resolveHelpRequest(). */
export function withdrawHelpRequest(student, conceptId) {
  if (!student.learningRecord) student.learningRecord = {};
  const existing = getStudentConceptRecord(student, conceptId);
  student.learningRecord[conceptId] = createStudentConceptRecord({
    ...existing,
    helpRequested: false,
    updatedAt: getCurrentIsoDate(),
  });
  return student.learningRecord[conceptId];
}
