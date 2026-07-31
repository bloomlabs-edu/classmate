/**
 * services/assessmentService.js
 *
 * Assessment Management's own service — deliberately independent of
 * Learning Management. The only place this file reads from that
 * module at all is getSubjectTitle() below, resolving a Subject's
 * *current* title from its id — never copying it, so a rename in
 * Learning Management is reflected in every existing Assessment
 * automatically, per the explicit architectural decision made before
 * implementation. Nothing here reads Units, Concepts, curriculum
 * links, or Resources.
 *
 * Students are treated the same way, for the same reason: a
 * StudentResult (models/StudentResult.js) stores only a `studentId`,
 * resolved live against the classroom's own real roster
 * (`classroom.teams[].students[]`) — not a name copied at entry time.
 *
 * Mutates the classroom object in memory; matches this app's
 * established convention (see services/learningRecordTeacherService.js
 * and others) — the caller persists via services/workspaceService.js's
 * save() afterward.
 */

import { createAssessment } from '../models/Assessment.js';
import { createAssessmentSubject } from '../models/AssessmentSubject.js';
import { createStudentResult } from '../models/StudentResult.js';
import * as learningRecordService from './learningRecordService.js';

/** Every Assessment for this classroom, most recently created first. */
export function getAssessments(classroom) {
  return [...(classroom.assessments || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function getAssessmentById(classroom, assessmentId) {
  return (classroom.assessments || []).find((assessment) => assessment.id === assessmentId) || null;
}

/**
 * Creates and persists a new Assessment in one step, one
 * AssessmentSubject per chosen subjectId, each starting with the
 * default 100 maximum marks and no student results yet — results are
 * only ever created once a teacher actually enters something for a
 * given student (see recordStudentMarks() below).
 */
export function createNewAssessment(classroom, { title, type, academicYear, date, subjectIds }) {
  const assessmentSubjects = subjectIds.map((subjectId) => createAssessmentSubject({ subjectId }));
  const assessment = createAssessment({
    classroomId: classroom.id,
    title,
    type,
    academicYear,
    date,
    assessmentSubjects,
  });

  if (!classroom.assessments) classroom.assessments = [];
  classroom.assessments.push(assessment);
  return assessment;
}

export function deleteAssessment(classroom, assessmentId) {
  const before = (classroom.assessments || []).length;
  classroom.assessments = (classroom.assessments || []).filter((assessment) => assessment.id !== assessmentId);
  return classroom.assessments.length < before;
}

/**
 * A Subject's *current* title, resolved live from Learning
 * Management's own Subject list — never a copy. Returns null if the
 * Subject no longer exists (e.g. removed since this Assessment was
 * created) — callers should handle that honestly (see
 * ui/views/AssessmentManagementView.js), not hide it.
 */
export function getSubjectTitle(classroom, subjectId) {
  const subject = learningRecordService.getSubjects(classroom).find((s) => s.id === subjectId);
  return subject ? subject.title : null;
}

/** Every student currently on this classroom's real roster — the live source AssessmentSubject rows are matched against, never a copy taken at Assessment-creation time. */
export function getClassroomStudents(classroom) {
  return classroom.teams.flatMap((team) => team.students);
}

/** An existing StudentResult for this student within this AssessmentSubject, or null if nothing has been entered for them yet. */
export function getStudentResult(assessmentSubject, studentId) {
  return assessmentSubject.studentResults.find((result) => result.studentId === studentId) || null;
}

/**
 * Creates or updates this student's result within this
 * AssessmentSubject — the only place a StudentResult is ever written.
 * `updates` may include any of `marks`, `absent`, `remarks`; whichever
 * fields are passed are applied on top of the existing result (or
 * sensible defaults, for a student with no prior entry).
 */
export function recordStudentMarks(assessmentSubject, studentId, updates) {
  const existing = getStudentResult(assessmentSubject, studentId);
  if (existing) {
    Object.assign(existing, updates);
    return existing;
  }
  const result = createStudentResult({ studentId, ...updates });
  assessmentSubject.studentResults.push(result);
  return result;
}
