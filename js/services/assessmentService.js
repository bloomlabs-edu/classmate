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
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

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
 * Which of the classroom's real Subjects are NOT yet part of this
 * Assessment — what "+ Add Subject" (see
 * ui/components/AddSubjectToAssessmentModal.js) offers. Never
 * suggests or creates a new classroom Subject; only ever surfaces
 * Subjects that already exist in Learning Management.
 */
export function getAvailableSubjectsToAdd(classroom, assessment) {
  const includedSubjectIds = new Set(assessment.assessmentSubjects.map((as) => as.subjectId));
  return learningRecordService.getSubjects(classroom).filter((subject) => !includedSubjectIds.has(subject.id));
}

/**
 * Adds one more Subject to an already-existing Assessment — the
 * same AssessmentSubject shape as at creation time (default 100
 * maximum marks, no student results yet), just added later rather
 * than all at once. Does not check for duplicates itself — callers
 * are expected to have already filtered via
 * getAvailableSubjectsToAdd(), so a Subject already in this
 * Assessment is never offered again.
 */
export function addSubjectToAssessment(assessment, subjectId) {
  const assessmentSubject = createAssessmentSubject({ subjectId });
  assessment.assessmentSubjects.push(assessmentSubject);
  return assessmentSubject;
}

/** Maximum marks are per-Assessment-Subject and editable — different Subjects in the same Assessment may have entirely different totals. */
export function setMaximumMarks(assessmentSubject, maximumMarks) {
  assessmentSubject.maximumMarks = maximumMarks;
}

/**
 * Standard competition ranking ("1224"): tied marks share the same
 * rank, and the next distinct value's rank reflects how many students
 * are actually ahead of it (so a 3-way tie for 1st is followed by 4th,
 * not 2nd). A student who is absent or has no marks entered yet is
 * excluded from ranking entirely — not ranked last, not given a
 * fabricated value — and gets `null` back, which the UI shows as "-".
 *
 * Returns a Map<studentId, rank | null> covering every student passed
 * in, not just the ones with a rank.
 */
export function computeRankings(assessmentSubject, students) {
  const rankByStudentId = new Map();

  const ranked = students
    .map((student) => ({ student, result: getStudentResult(assessmentSubject, student.id) }))
    .filter(({ result }) => result && !result.absent && result.marks !== null)
    .sort((a, b) => b.result.marks - a.result.marks);

  let previousMarks = null;
  let previousRank = 0;
  ranked.forEach(({ student, result }, index) => {
    const rank = result.marks === previousMarks ? previousRank : index + 1;
    rankByStudentId.set(student.id, rank);
    previousMarks = result.marks;
    previousRank = rank;
  });

  students.forEach((student) => {
    if (!rankByStudentId.has(student.id)) rankByStudentId.set(student.id, null);
  });

  return rankByStudentId;
}

/**
 * Removes one Subject from an Assessment — "Remove from Assessment"
 * on that Subject's own overflow menu. Removes only this Assessment's
 * own record of it (including whatever marks were entered); never
 * touches the classroom Subject itself in Learning Management.
 */
export function removeSubjectFromAssessment(assessment, subjectId) {
  const before = assessment.assessmentSubjects.length;
  assessment.assessmentSubjects = assessment.assessmentSubjects.filter((as) => as.subjectId !== subjectId);
  return assessment.assessmentSubjects.length < before;
}

/** "Edit Assessment" — updates only the Assessment's own top-level fields (name, type, year, date); never touches its Subjects or their results. Stamps detailsLastSavedAt, driving that section's own "Last saved" display. */
export function updateAssessmentDetails(assessment, { title, type, academicYear, date }) {
  assessment.title = title;
  assessment.type = type;
  assessment.academicYear = academicYear;
  assessment.date = date;
  assessment.detailsLastSavedAt = getCurrentIsoDate();
}

/**
 * Applies a whole draft of changes to an AssessmentSubject in one
 * step — the document-editor "Save" action (see
 * ui/views/AssessmentManagementView.js). `draft` is
 * { maximumMarks, resultsByStudentId: Map<studentId, {marks, absent,
 * remarks}> }. Sets `lastSavedAt` to now, which is what switches the
 * marks screen from its editable "Initially" state to its read-only
 * "Last saved: ..." state afterward.
 */
export function saveAssessmentSubjectDraft(assessmentSubject, draft) {
  assessmentSubject.maximumMarks = draft.maximumMarks;
  draft.resultsByStudentId.forEach((updates, studentId) => {
    recordStudentMarks(assessmentSubject, studentId, updates);
  });
  assessmentSubject.lastSavedAt = getCurrentIsoDate();
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
