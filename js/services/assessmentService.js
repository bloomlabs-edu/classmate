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
import * as studentEventService from './studentEventService.js';
import { resolveSubjectTitle } from './timetableDisplayService.js';
import { STUDENT_EVENT_CATEGORIES } from '../config/studentEventCategories.js';
import { ASSESSMENT_TYPES } from '../config/assessmentTypesConfig.js';
import { PASS_MARK_PERCENT, getPassMarkForSubject } from '../config/assessmentMarksColorConfig.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

/** Every Assessment for this classroom, most recently created first. */
export function getAssessments(classroom) {
  return [...(classroom.assessments || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Student-facing "upcoming tests" — only Published assessments (a Draft isn't real to students yet) with a real date today or later, soonest first. */
export function getUpcomingAssessments(classroom) {
  const todayKey = getCurrentIsoDate().slice(0, 10);
  return (classroom.assessments || [])
    .filter((assessment) => assessment.status === 'Published' && assessment.date && assessment.date >= todayKey)
    .sort((a, b) => a.date.localeCompare(b.date));
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
 * A Subject's *current* title, resolved live — never a copy. Two
 * cases, checked in order:
 *
 * 1. `subjectId` matches a real Learning Record Subject's own `.id` —
 *    the original, still-primary meaning of this field (see
 *    models/AssessmentSubject.js) — returns that Subject's current
 *    title.
 * 2. No match — `subjectId` is instead a canonical subjectId (e.g.
 *    "physical_education"), the case for an Assessment covering a
 *    subject not yet added to this classroom's Learning Record (see
 *    ui/components/CreateAssessmentModal.js's own "not yet in Learning
 *    Activities" picks, and services/assessmentTimetableLinkService.js
 *    for the Timetable-linked case, which only ever uses case 1 since
 *    it requires the Subject to already exist there). Delegates to
 *    services/timetableDisplayService.js's own resolveSubjectTitle()
 *    — the same canonical-registry fallback Timetable already uses —
 *    rather than a second copy of that fallback chain.
 *
 * Never returns null/blank: resolveSubjectTitle()'s own last resort is
 * the raw id itself.
 */
export function getSubjectTitle(classroom, subjectId) {
  const subject = learningRecordService.getSubjects(classroom).find((s) => s.id === subjectId);
  if (subject) return subject.title;
  return resolveSubjectTitle(classroom, subjectId);
}

/**
 * The Assessment already linked to this ScheduledEvent, or null — the
 * guard that stops "Set up Assessment" from ever creating a second
 * Assessment for the same exam (see createAssessmentFromScheduledEvent()
 * below, and ui/views/AssessmentManagementView.js's own re-render on
 * every page load, which must never re-create anything).
 */
export function getLinkedAssessment(classroom, scheduledEventId) {
  return (classroom.assessments || []).find((assessment) => assessment.scheduledEventId === scheduledEventId) || null;
}

/**
 * Best-effort ASSESSMENT_TYPES match from an exam's own title (e.g.
 * "Quarterly Examinations" -> "Quarterly") — falls back to 'Custom'
 * rather than guessing wrong. models/ScheduledEvent.js has no field
 * more structured than `eventType` to use instead (today, only
 * `'exam'` exists — see that model's own header comment; it's a
 * coarse "what kind of thing is this," not a periodicity/category),
 * so title-matching is the least-bad option, not a placeholder for
 * something better that already exists.
 *
 * Matched on whole words only (`\bquarterly\b`, not a bare substring)
 * so a title like "Half Yearly" can never accidentally match "Annual"
 * or vice versa via a partial overlap — this is exactly the "must not
 * accidentally create incorrect assessment types" requirement. A
 * teacher can always correct the result via Edit Assessment Details
 * afterward; this is a reasonable starting value, never load-bearing.
 */
function inferAssessmentType(title) {
  const lower = (title || '').toLowerCase();
  const match = ASSESSMENT_TYPES.find((type) => {
    if (type === 'Custom') return false;
    const pattern = new RegExp(`\\b${type.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    return pattern.test(lower);
  });
  return match || 'Custom';
}

/**
 * "Set up Assessment" from a Timetable exam (see
 * ui/views/AssessmentManagementView.js's "Scheduled from Timetable"
 * section and services/assessmentTimetableLinkService.js's own
 * getSurfaceableExamAssessments(), which already guarantees `event`'s
 * subject is in this classroom's Learning Activities before this is
 * ever callable). Guards against duplicates itself — a second call for
 * the same event returns the existing linked Assessment unchanged
 * rather than creating another one, so a caller never has to
 * separately remember to check first.
 *
 * `learningSubject` is the classroom's own LearningSubject already
 * resolved by the caller (matching `event.subjectId`) — its `.id`
 * becomes this Assessment's one AssessmentSubject.subjectId, the exact
 * same reference-to-a-Learning-Record-Subject-record every manually
 * created Assessment already uses; no new subject-reference shape is
 * introduced for the auto-linked path.
 *
 * `date` is copied from the event once, here, only so this Assessment
 * sorts/filters correctly alongside manually-dated Assessments
 * (getUpcomingAssessments() etc.) — display code must still resolve
 * the CURRENT date/period from the live event (see
 * assessmentTimetableLinkService.getEventPeriodLabel()), never trust
 * this copy, since the event may be rescheduled after this Assessment
 * is created.
 */
export function createAssessmentFromScheduledEvent(classroom, event, learningSubject) {
  const existing = getLinkedAssessment(classroom, event.id);
  if (existing) return existing;

  const assessment = createAssessment({
    classroomId: classroom.id,
    title: event.title || 'Exam',
    type: inferAssessmentType(event.title),
    academicYear: classroom.academicYear || '',
    date: event.date,
    assessmentSubjects: [createAssessmentSubject({ subjectId: learningSubject.id })],
    scheduledEventId: event.id,
  });

  if (!classroom.assessments) classroom.assessments = [];
  classroom.assessments.push(assessment);
  return assessment;
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
 * This AssessmentSubject's own effective Total Marks — `100` for any
 * record with no `maximumMarks` at all (a document from before this
 * field existed, or one somehow malformed), the same "resolve a
 * missing field to its own documented default" fallback pattern
 * getPassMarkPercent() below already establishes for Pass Mark.
 * models/AssessmentSubject.js's own createAssessmentSubject() already
 * defaults fresh records to 100, so this only ever matters for a
 * record that bypassed that factory (e.g. spread directly from a raw
 * Firestore snapshot) — every read site in this feature goes through
 * this rather than `assessmentSubject.maximumMarks` directly, so
 * there's exactly one place this fallback is decided.
 */
export function getMaximumMarks(assessmentSubject) {
  return assessmentSubject.maximumMarks ?? 100;
}

/**
 * Validates a teacher-typed "Total Marks" (maximumMarks) input before
 * it's ever applied to an AssessmentSubject — required, numeric,
 * greater than 0, matching the same "reject outright, never silently
 * clamp" convention parsePassMarkPercentInput() above already
 * establishes for Pass Mark.
 *
 * ALSO rejects a new maximum that would be lower than an already-
 * entered mark still present in `existingResults` (an iterable of
 * `{ marks, absent }`-shaped results — either an AssessmentSubject's
 * own already-saved `studentResults`, or a Subject Step draft's own
 * in-progress `resultsByStudentId` Map values, both of which share
 * this exact shape). Per this feature's own explicit rule, Total
 * Marks changes the interpretation/denominator only — it must never
 * silently rescale (35 -> 17.5) or clamp a stored raw mark, so the
 * one remaining safe option is refusing the edit outright until the
 * conflicting mark is corrected first. Decimal totals are allowed —
 * this app has never restricted Maximum Marks to whole numbers (see
 * models/AssessmentSubject.js's own createAssessmentSubject()), so
 * this validator doesn't newly invent that restriction either.
 */
export function validateMaximumMarksInput(rawValue, existingResults = []) {
  const trimmed = String(rawValue ?? '').trim();
  const value = Number(trimmed);
  if (trimmed === '' || !Number.isFinite(value) || value <= 0) {
    return { valid: false, value: null, error: 'Total Marks is required and must be a number greater than 0.' };
  }

  const exceedingMarks = Array.from(existingResults)
    .filter((result) => result && !result.absent && result.marks !== null && result.marks > value)
    .map((result) => result.marks);
  if (exceedingMarks.length > 0) {
    const highest = Math.max(...exceedingMarks);
    return {
      valid: false,
      value: null,
      error: `Total Marks can't be lower than an already-entered mark (highest entered: ${highest}). Correct that mark first.`,
    };
  }

  return { valid: true, value, error: null };
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

/** "Edit Assessment" — updates only the Assessment's own top-level fields (name, type, year, date, pass mark); never touches its Subjects or their results. Stamps detailsLastSavedAt, driving that section's own "Last saved" display. */
export function updateAssessmentDetails(assessment, { title, type, academicYear, date, passMarkPercent }) {
  assessment.title = title;
  assessment.type = type;
  assessment.academicYear = academicYear;
  assessment.date = date;
  assessment.passMarkPercent = passMarkPercent;
  assessment.detailsLastSavedAt = getCurrentIsoDate();
}

/**
 * This Assessment's own effective Pass Mark percentage — `null` (never
 * explicitly edited) resolves to config/assessmentMarksColorConfig.js's
 * own system-wide PASS_MARK_PERCENT, the same default every Assessment
 * effectively used before this field existed. This IS also the
 * Red/Yellow bucket boundary (config/assessmentMarksColorConfig.js's
 * own getMarksColorClass()) — the two are the same confirmed
 * threshold, deliberately, not two independent scales; only the fixed
 * 70% Green threshold is independent of this value.
 */
export function getPassMarkPercent(assessment) {
  return assessment.passMarkPercent ?? PASS_MARK_PERCENT;
}

/**
 * One student's overall outcome for this Assessment — 'passed' |
 * 'failed' | 'not_assessed'. Reuses this Assessment's own effective
 * Pass Mark (getPassMarkPercent() above) and each AssessmentSubject's
 * own maximumMarks via config/assessmentMarksColorConfig.js's own
 * getPassMarkForSubject() — never a second, independent pass-mark
 * calculation.
 *
 * Rule (documented here since it isn't obvious from the data model
 * alone — most Assessments have exactly one Subject, where this
 * reduces to exactly the task's own worked examples, but a manually
 * bundled multi-Subject Assessment needs an explicit rule):
 *   - 'not_assessed': the student has no usable mark (never entered,
 *     or explicitly marked absent) in ANY of this Assessment's
 *     Subjects yet. Absent is treated the same as "not yet entered,"
 *     not as an automatic fail — this app already models absence as
 *     its own distinct state (StudentResult.absent), separate from a
 *     low/failing mark, and this function preserves that distinction
 *     rather than collapsing it.
 *   - 'passed': the student has at least one usable mark, AND every
 *     Subject they have a usable mark in meets or exceeds that
 *     Subject's own Pass Mark threshold ("weakest link" — passing
 *     "this Assessment" is read as passing every part of it that's
 *     been graded so far, not merely a blended average that could
 *     mask an outright failing Subject).
 *   - 'failed': the student has at least one usable mark, and at
 *     least one of those marked Subjects falls below its own Pass
 *     Mark threshold.
 */
export function getStudentOutcome(assessment, studentId) {
  const passMarkPercent = getPassMarkPercent(assessment);
  let hasUsableMark = false;
  let allPassed = true;

  assessment.assessmentSubjects.forEach((assessmentSubject) => {
    const result = getStudentResult(assessmentSubject, studentId);
    if (!result || result.absent || result.marks === null) return;
    hasUsableMark = true;
    const threshold = getPassMarkForSubject(getMaximumMarks(assessmentSubject), passMarkPercent);
    if (threshold === null || result.marks < threshold) allPassed = false;
  });

  if (!hasUsableMark) return 'not_assessed';
  return allPassed ? 'passed' : 'failed';
}

/** Passed/Failed/Not Assessed counts across every student passed in — the Assessment header's own summary line (see ui/views/AssessmentManagementView.js). Every student counts toward exactly one bucket. */
export function summarizeAssessmentOutcomes(assessment, students) {
  const counts = { passed: 0, failed: 0, notAssessed: 0 };
  students.forEach((student) => {
    const outcome = getStudentOutcome(assessment, student.id);
    if (outcome === 'passed') counts.passed += 1;
    else if (outcome === 'failed') counts.failed += 1;
    else counts.notAssessed += 1;
  });
  return counts;
}

/**
 * Parses a teacher-typed Pass Mark field value from "Edit Assessment
 * Details." An empty/blank input is valid and means "go back to the
 * system default" (`value: null`, resolved by getPassMarkPercent()
 * above) — not an error. Anything non-numeric, or numeric but outside
 * 0-100 (an impossible percentage), is rejected outright rather than
 * silently clamped, so a teacher who mistypes "360" is told, not
 * quietly given "100."
 */
export function parsePassMarkPercentInput(rawValue) {
  const trimmed = String(rawValue ?? '').trim();
  if (trimmed === '') return { valid: true, value: null };

  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 100) return { valid: false, value: null };
  return { valid: true, value };
}

/**
 * Transitions an Assessment from 'Draft' to 'Published' — the first
 * real code path that ever sets this status (see models/Assessment.js's
 * own comment: the field existed already, specifically so a future
 * milestone could implement this without a data migration; this is
 * that milestone, for the Student Event Feed's own third publisher —
 * see this project's own Student Event Feed milestone). A no-op,
 * returning false, for anything already Published or Locked.
 *
 * Notifies every student currently on the classroom's own roster, not
 * only those with an existing StudentResult — an Assessment applies to
 * the whole class the moment it's published, regardless of whether a
 * teacher has entered any marks for a given student yet.
 */
export function publishAssessment(classroom, assessment) {
  if (assessment.status !== 'Draft') return false;

  assessment.status = 'Published';

  studentEventService.publishEventToAllStudents(classroom, {
    type: 'assessment_published',
    category: STUDENT_EVENT_CATEGORIES.ASSESSMENT,
    title: assessment.title,
    message: 'Your results are now available.',
    payload: { assessmentId: assessment.id },
  });

  return true;
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
