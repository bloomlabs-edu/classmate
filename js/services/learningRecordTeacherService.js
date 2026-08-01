/**
 * services/learningRecordTeacherService.js
 *
 * Every Learning Record mutation a *teacher* is allowed to make:
 * building the syllabus (subjects/units/concepts), marking a concept
 * taught, and setting a student's notebook status for a concept.
 * Deliberately a separate file from
 * services/learningRecordStudentService.js — not just a commented
 * section of one shared file — so the teacher/student control
 * boundary is structural, not a convention someone could accidentally
 * cross by adding a function in the wrong place. Both files read
 * through the same services/learningRecordService.js.
 *
 * Follows this app's established mutate-then-caller-saves convention
 * (see ui/views/SettingsView.js and ui/views/SetupWizardView.js's own
 * doc comments): every function here mutates the classroom/student
 * object directly and returns; it never calls
 * workspaceService.save(classroom) itself. The caller (a future UI)
 * is responsible for calling that once, after whatever combination of
 * these functions it just ran — the same pattern every other service
 * in this app already follows.
 *
 * No Timeline logging here yet, unlike
 * services/learningActivityService.js's setSubmissionStatus(), which
 * logs a Timeline entry per status change. Marking a concept taught or
 * a notebook corrected could plausibly happen one-at-a-time or in a
 * bulk "mark this whole unit taught" action once there's a UI — which
 * shape it'll actually take affects whether Timeline logging here
 * would be meaningful or just flood a student's history with one
 * entry per concept. Deferred to the UI design phase rather than
 * guessed at now — see docs/LEARNING_RECORD.md.
 *
 * See docs/LEARNING_RECORD.md for the full architecture.
 */

import { createLearningSubject } from '../models/LearningSubject.js';
import { createLearningUnit } from '../models/LearningUnit.js';
import { createLearningConcept } from '../models/LearningConcept.js';
import { createStudentConceptRecord } from '../models/StudentConceptRecord.js';
import { getConceptById, getStudentConceptRecord, getSubjectById, getUnitById } from './learningRecordService.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

function ensureLearningRecord(classroom) {
  if (!classroom.learningRecord) classroom.learningRecord = { subjects: [] };
  if (!classroom.learningRecord.subjects) classroom.learningRecord.subjects = [];
  return classroom.learningRecord;
}

// ---- Syllabus structure -----------------------------------------

export function createSubject(classroom, { title, subjectId, linkedCurriculumIndexId } = {}) {
  const learningRecord = ensureLearningRecord(classroom);
  const subject = createLearningSubject({ title, subjectId, linkedCurriculumIndexId });
  learningRecord.subjects.push(subject);
  return subject;
}

export function renameSubject(classroom, subjectId, newTitle) {
  const subject = getSubjectById(classroom, subjectId);
  if (subject) subject.title = newTitle;
  return subject;
}

export function deleteSubject(classroom, subjectId) {
  const learningRecord = ensureLearningRecord(classroom);
  const before = learningRecord.subjects.length;
  learningRecord.subjects = learningRecord.subjects.filter((subject) => subject.id !== subjectId);
  return learningRecord.subjects.length < before;
}

export function createUnit(classroom, subjectId, { title, partName, linkedCurriculumUnitId } = {}) {
  const subject = getSubjectById(classroom, subjectId);
  if (!subject) return null;
  const unit = createLearningUnit({ title, partName, linkedCurriculumUnitId });
  subject.units.push(unit);
  return unit;
}

export function renameUnit(classroom, unitId, newTitle) {
  const unit = getUnitById(classroom, unitId);
  if (unit) unit.title = newTitle;
  return unit;
}

export function deleteUnit(classroom, subjectId, unitId) {
  const subject = getSubjectById(classroom, subjectId);
  if (!subject) return false;
  const before = subject.units.length;
  subject.units = subject.units.filter((unit) => unit.id !== unitId);
  return subject.units.length < before;
}

export function createConcept(classroom, unitId, { title }) {
  const unit = getUnitById(classroom, unitId);
  if (!unit) return null;
  const concept = createLearningConcept({ title });
  unit.concepts.push(concept);
  return concept;
}

export function renameConcept(classroom, conceptId, newTitle) {
  const concept = getConceptById(classroom, conceptId);
  if (concept) concept.title = newTitle;
  return concept;
}

export function deleteConcept(classroom, unitId, conceptId) {
  const unit = getUnitById(classroom, unitId);
  if (!unit) return false;
  const before = unit.concepts.length;
  unit.concepts = unit.concepts.filter((concept) => concept.id !== conceptId);
  return unit.concepts.length < before;
}

// ---- Taught status (classroom-level, shared by the whole class) --

export function setConceptTaughtStatus(classroom, conceptId, status) {
  const concept = getConceptById(classroom, conceptId);
  if (concept) concept.status = status;
  return concept;
}

// ---- Notebook status (per-student, teacher-set) -------------------

/**
 * Sets one student's notebook status for one concept. Teacher-
 * controlled even though it's per-student data, matching this
 * project's control split exactly (see docs/LEARNING_RECORD.md) — a
 * student can report their own understanding, but notebook
 * pending/submitted/corrected is the teacher's call, the same way
 * Notebook Tracker checks elsewhere in this app are always a teacher
 * action against a student's work, never self-reported.
 */
export function setNotebookStatus(student, conceptId, notebookStatus) {
  if (!student.learningRecord) student.learningRecord = {};
  const existing = getStudentConceptRecord(student, conceptId);
  student.learningRecord[conceptId] = createStudentConceptRecord({
    ...existing,
    notebook: notebookStatus,
    updatedAt: getCurrentIsoDate(),
  });
  return student.learningRecord[conceptId];
}

/**
 * A teacher clearing a help request once it's been addressed — the
 * one exception to "student controls help requests" (see
 * services/learningRecordStudentService.js's requestHelp()): a
 * student can withdraw their own request, and a teacher can also
 * resolve it once handled, the same two-sided-clear pattern as a
 * support ticket.
 */
export function resolveHelpRequest(student, conceptId) {
  if (!student.learningRecord) student.learningRecord = {};
  const existing = getStudentConceptRecord(student, conceptId);
  student.learningRecord[conceptId] = createStudentConceptRecord({
    ...existing,
    helpRequested: false,
    updatedAt: getCurrentIsoDate(),
  });
  return student.learningRecord[conceptId];
}
