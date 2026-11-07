/**
 * tests/services/notebookFoundingRecognitionService.test.js
 *
 * Founding Recognition (2026-11-07) — a separate, permanent, one-time
 * historical achievement category. See
 * services/notebookFoundingRecognitionService.js's own header comment
 * for the full eligibility rule and cutoff rationale.
 *
 * The four real students this feature was built to cover (R.
 * Varalaxmi, Jasmine, Pugazh, Blessy) are exercised below as named
 * TEST FIXTURES with synthetic ids/history, matching their real
 * checkpoint counts (12 and 14) from the organisation-wide audit —
 * this file never touches production data and never awards the real
 * students; "including them as test cases" means reproducing their
 * documented scenario in a local, synthetic classroom object only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createStudent } from '../../js/models/Student.js';
import { createTeam } from '../../js/models/Team.js';
import { addMember } from '../../js/services/memberService.js';
import { MEMBER_ROLES } from '../../js/config/memberRoles.js';
import * as checkpointService from '../../js/services/checkpointService.js';
import * as notebookFoundingRecognitionService from '../../js/services/notebookFoundingRecognitionService.js';
import * as notebookReadinessChampionService from '../../js/services/notebookReadinessChampionService.js';

const OWNER_UID = 'owner-uid';
const TEACHER_UID = 'teacher-uid';
const VIEWER_UID = 'viewer-uid';
const SUBJECT_ID = 'subj-1';
const NOTEBOOK_TYPE_ID = 'type-1';
const CUTOFF = notebookFoundingRecognitionService.FOUNDING_RECOGNITION_CUTOFF_ISO; // 2026-11-07T11:48:47Z
const { CONFIRMED_REAL, CONFIRMED_TEST, NEEDS_REVIEW } = notebookFoundingRecognitionService.FOUNDING_RECOGNITION_CLASSIFICATIONS;
const BEFORE_CUTOFF = '2026-09-01T09:00:00.000Z';
const AFTER_CUTOFF = '2026-11-10T09:00:00.000Z';

function buildClassroomWithStudent({ withTeam = false, schoolName = 'A School', classroomName, gradeSection = 'Grade 8' } = {}) {
  const classroom = createClassroom({ id: 'c1', schoolName, gradeSection });
  if (classroomName) classroom.classroomName = classroomName;
  addMember(classroom, OWNER_UID, MEMBER_ROLES.OWNER, 'The Owner');
  addMember(classroom, TEACHER_UID, MEMBER_ROLES.TEACHER, 'A Teacher');
  addMember(classroom, VIEWER_UID, MEMBER_ROLES.VIEWER, 'A Viewer');
  const student = createStudent({ id: 's1', name: 'Anjali' });
  if (withTeam) classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  return { classroom, student };
}

/** Creates a checkpoint via the real service (real id generation), then overrides createdAt directly -- createNewCheckpoint() itself has no createdAt param (always "now"), so direct override is the only way to test cutoff-relative behavior deterministically. */
function addHistoricalCheckpoint(classroom, { title, createdAt = BEFORE_CUTOFF, dueDate = '2026-08-31', subjectId = SUBJECT_ID, notebookTypeId = NOTEBOOK_TYPE_ID } = {}) {
  const cp = checkpointService.createNewCheckpoint(classroom, { subjectId, notebookTypeId, title, givenDate: '2026-08-01', dueDate });
  cp.createdAt = createdAt;
  return cp;
}

function submit(checkpoint, studentId, submittedDate) {
  checkpointService.setSubmission(checkpoint, studentId, { status: 'submitted', submittedDate });
}

function review(checkpoint, studentId, status) {
  checkpointService.setReview(checkpoint, studentId, { status, reviewedDate: '2026-09-02' });
}

/** Builds and fully submits+reviews N historical checkpoints for one student, all on time, all complete -- the common "fully eligible" fixture shape. */
function buildFullyEligibleNotebook(classroom, student, count, { subjectId = SUBJECT_ID, notebookTypeId = NOTEBOOK_TYPE_ID } = {}) {
  const checkpoints = [];
  for (let i = 0; i < count; i += 1) {
    const cp = addHistoricalCheckpoint(classroom, { title: `Unit ${i + 1}`, subjectId, notebookTypeId });
    submit(cp, student.id, '2026-08-20');
    review(cp, student.id, 'complete');
    checkpoints.push(cp);
  }
  return checkpoints;
}

// ---------------------------------------------------------------------
// computeHistoricalCompletenessForNotebook
// ---------------------------------------------------------------------

test('computeHistoricalCompletenessForNotebook: fewer than 5 historical checkpoints never meets the minimum, even if every one is complete', () => {
  const { classroom, student } = buildClassroomWithStudent();
  buildFullyEligibleNotebook(classroom, student, 4);

  const result = notebookFoundingRecognitionService.computeHistoricalCompletenessForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id);
  assert.equal(result.totalRequired, 4);
  assert.equal(result.meetsMinimumCheckpoints, false);
  assert.equal(result.isHistoricallyComplete, false);
});

test('computeHistoricalCompletenessForNotebook: exactly 5 complete historical checkpoints meets the minimum and is historically complete', () => {
  const { classroom, student } = buildClassroomWithStudent();
  buildFullyEligibleNotebook(classroom, student, 5);

  const result = notebookFoundingRecognitionService.computeHistoricalCompletenessForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id);
  assert.equal(result.totalRequired, 5);
  assert.equal(result.meetsMinimumCheckpoints, true);
  assert.equal(result.isHistoricallyComplete, true);
});

test('computeHistoricalCompletenessForNotebook: late submissions still count toward historical completeness', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const checkpoints = [];
  for (let i = 0; i < 5; i += 1) checkpoints.push(addHistoricalCheckpoint(classroom, { title: `Unit ${i + 1}`, dueDate: '2026-08-10' }));
  checkpoints.forEach((cp) => {
    submit(cp, student.id, '2026-09-30'); // well after the 2026-08-10 due date
    review(cp, student.id, 'complete');
  });

  const result = notebookFoundingRecognitionService.computeHistoricalCompletenessForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id);
  assert.equal(result.lateCount, 5);
  assert.equal(result.onTimeCount, 0);
  assert.equal(result.notCountingCount, 0, 'lateness never disqualifies');
  assert.equal(result.isHistoricallyComplete, true);
});

test('computeHistoricalCompletenessForNotebook: a checkpoint awaiting review (not_reviewed) counts -- nothing has been returned or rejected', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const checkpoints = [];
  for (let i = 0; i < 5; i += 1) checkpoints.push(addHistoricalCheckpoint(classroom, { title: `Unit ${i + 1}` }));
  checkpoints.forEach((cp) => submit(cp, student.id, '2026-08-20')); // submitted, never reviewed at all

  const result = notebookFoundingRecognitionService.computeHistoricalCompletenessForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id);
  assert.equal(result.notCountingCount, 0);
  assert.equal(result.isHistoricallyComplete, true);
});

test('computeHistoricalCompletenessForNotebook: a checkpoint explicitly reviewed incomplete ("returned/rejected") does NOT count', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const checkpoints = [];
  for (let i = 0; i < 5; i += 1) checkpoints.push(addHistoricalCheckpoint(classroom, { title: `Unit ${i + 1}` }));
  checkpoints.forEach((cp) => submit(cp, student.id, '2026-08-20'));
  checkpoints.slice(0, 4).forEach((cp) => review(cp, student.id, 'complete'));
  review(checkpoints[4], student.id, 'incomplete'); // the fifth is returned

  const result = notebookFoundingRecognitionService.computeHistoricalCompletenessForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id);
  assert.equal(result.notCountingCount, 1);
  assert.equal(result.isHistoricallyComplete, false);
});

test('computeHistoricalCompletenessForNotebook: an incomplete review later CORRECTED to complete counts -- current state is read, not a stale snapshot', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const checkpoints = [];
  for (let i = 0; i < 5; i += 1) checkpoints.push(addHistoricalCheckpoint(classroom, { title: `Unit ${i + 1}` }));
  checkpoints.forEach((cp) => submit(cp, student.id, '2026-08-20'));
  checkpoints.forEach((cp) => review(cp, student.id, 'complete'));
  review(checkpoints[4], student.id, 'incomplete'); // returned...
  review(checkpoints[4], student.id, 'complete'); // ...then corrected and re-reviewed complete

  const result = notebookFoundingRecognitionService.computeHistoricalCompletenessForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id);
  assert.equal(result.notCountingCount, 0);
  assert.equal(result.isHistoricallyComplete, true);
});

test('computeHistoricalCompletenessForNotebook: an incomplete checkpoint (never submitted) among otherwise-complete ones does not count', () => {
  const { classroom, student } = buildClassroomWithStudent();
  const checkpoints = [];
  for (let i = 0; i < 5; i += 1) checkpoints.push(addHistoricalCheckpoint(classroom, { title: `Unit ${i + 1}` }));
  checkpoints.slice(0, 4).forEach((cp) => {
    submit(cp, student.id, '2026-08-20');
    review(cp, student.id, 'complete');
  });
  // checkpoints[4] left entirely untouched -- never submitted

  const result = notebookFoundingRecognitionService.computeHistoricalCompletenessForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id);
  assert.equal(result.notCountingCount, 1);
  assert.equal(result.isHistoricallyComplete, false);
});

test('computeHistoricalCompletenessForNotebook: a checkpoint created ON OR AFTER the cutoff is excluded from the required set entirely -- never helps, never hurts', () => {
  const { classroom, student } = buildClassroomWithStudent();
  buildFullyEligibleNotebook(classroom, student, 5); // 5 historical, all complete -- already eligible on its own
  const postCutoff = addHistoricalCheckpoint(classroom, { title: 'Future Unit', createdAt: AFTER_CUTOFF });
  // postCutoff left entirely pending -- if it were wrongly included, this would disqualify the notebook

  const result = notebookFoundingRecognitionService.computeHistoricalCompletenessForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id);
  assert.equal(result.totalRequired, 5, 'the post-cutoff checkpoint is never part of the required set');
  assert.equal(result.excludedPostCutoffCount, 1);
  assert.equal(result.isHistoricallyComplete, true, 'the pending post-cutoff checkpoint never disqualifies historical eligibility');
});

test('computeHistoricalCompletenessForNotebook: a checkpoint with a missing/unparseable createdAt is insufficient evidence, never guessed into or out of the required set', () => {
  const { classroom, student } = buildClassroomWithStudent();
  buildFullyEligibleNotebook(classroom, student, 5);
  const malformed = addHistoricalCheckpoint(classroom, { title: 'Mystery Unit' });
  malformed.createdAt = 'not-a-real-date';

  const result = notebookFoundingRecognitionService.computeHistoricalCompletenessForNotebook(classroom, SUBJECT_ID, NOTEBOOK_TYPE_ID, student.id);
  assert.equal(result.insufficientEvidenceCount, 1);
  assert.equal(result.hasInsufficientEvidence, true);
  assert.equal(result.isHistoricallyComplete, false, 'insufficient evidence blocks eligibility even though the other 5 are fully complete');
});

// ---------------------------------------------------------------------
// isLikelyTestOrSandboxClassroom
// ---------------------------------------------------------------------

test('isLikelyTestOrSandboxClassroom: matches "Trial", "[TEST] ...", "sandbox", "demo" classrooms', () => {
  assert.equal(notebookFoundingRecognitionService.isLikelyTestOrSandboxClassroom({ schoolName: 'Trial', gradeSection: 'Grade 7' }), true);
  assert.equal(notebookFoundingRecognitionService.isLikelyTestOrSandboxClassroom({ schoolName: 'Test School', classroomName: '[TEST] Identity Bridge Redemption' }), true);
  assert.equal(notebookFoundingRecognitionService.isLikelyTestOrSandboxClassroom({ schoolName: 'Real School', classroomName: 'Sandbox Class' }), true);
  assert.equal(notebookFoundingRecognitionService.isLikelyTestOrSandboxClassroom({ schoolName: 'Real School', gradeSection: 'Demo Section' }), true);
});

test('isLikelyTestOrSandboxClassroom: a real classroom name is never a false positive just for containing "test"/"trial" as a substring', () => {
  assert.equal(notebookFoundingRecognitionService.isLikelyTestOrSandboxClassroom({ schoolName: 'Contestant Public School', gradeSection: 'Grade 7' }), false);
  assert.equal(notebookFoundingRecognitionService.isLikelyTestOrSandboxClassroom({ schoolName: 'CHS Kannamapet', classroomName: 'Bloom Force 19', gradeSection: 'Grade 8A' }), false);
});

// ---------------------------------------------------------------------
// auditFoundingRecognitionEligibility
// ---------------------------------------------------------------------

test('auditFoundingRecognitionEligibility: correctly splits students across every bucket for the same classroom', () => {
  const { classroom } = buildClassroomWithStudent();
  const eligible = createStudent({ id: 'eligible', name: 'Eligible Student' });
  const incomplete = createStudent({ id: 'incomplete', name: 'Incomplete Student' });
  const belowMin = createStudent({ id: 'below-min', name: 'Below Minimum Student' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [eligible, incomplete, belowMin] })];

  buildFullyEligibleNotebook(classroom, eligible, 5);

  const partial = [];
  for (let i = 0; i < 5; i += 1) partial.push(addHistoricalCheckpoint(classroom, { title: `Partial Unit ${i + 1}`, subjectId: 'subj-2', notebookTypeId: 'type-2' }));
  partial.slice(0, 4).forEach((cp) => {
    submit(cp, incomplete.id, '2026-08-20');
    review(cp, incomplete.id, 'complete');
  });
  // partial[4] left pending for `incomplete`

  for (let i = 0; i < 3; i += 1) {
    const cp = addHistoricalCheckpoint(classroom, { title: `Thin Unit ${i + 1}`, subjectId: 'subj-3', notebookTypeId: 'type-3' });
    submit(cp, belowMin.id, '2026-08-20');
    review(cp, belowMin.id, 'complete');
  }

  const audit = notebookFoundingRecognitionService.auditFoundingRecognitionEligibility(classroom);
  assert.equal(audit.eligible.some((e) => e.studentId === 'eligible' && e.subjectId === SUBJECT_ID), true);
  assert.equal(audit.incomplete.some((e) => e.studentId === 'incomplete' && e.subjectId === 'subj-2'), true);
  assert.equal(audit.belowMinimumCheckpoints.some((e) => e.studentId === 'below-min' && e.subjectId === 'subj-3'), true);
  assert.equal(audit.isLikelyTestOrSandboxClassroom, false);
});

test('auditFoundingRecognitionEligibility: a notebook with no checkpoints created before the cutoff at all is never reported in any bucket', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  const cp = addHistoricalCheckpoint(classroom, { title: 'Future Only', createdAt: AFTER_CUTOFF });
  submit(cp, student.id, '2026-11-11');
  review(cp, student.id, 'complete');

  const audit = notebookFoundingRecognitionService.auditFoundingRecognitionEligibility(classroom);
  assert.equal(audit.eligible.length, 0);
  assert.equal(audit.incomplete.length, 0);
  assert.equal(audit.belowMinimumCheckpoints.length, 0);
  assert.equal(audit.insufficientEvidence.length, 0);
});

test('auditFoundingRecognitionEligibility: flags a likely test/sandbox classroom without excluding it from the report', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true, schoolName: 'Trial' });
  buildFullyEligibleNotebook(classroom, student, 5);

  const audit = notebookFoundingRecognitionService.auditFoundingRecognitionEligibility(classroom);
  assert.equal(audit.isLikelyTestOrSandboxClassroom, true);
  assert.equal(audit.eligible.length, 1, 'the audit itself still reports what WOULD be eligible, for visibility -- only apply refuses to act');
});

test('auditFoundingRecognitionEligibility: defaults to NEEDS_REVIEW classification when the caller supplies none, and reports classificationDetail faithfully when the caller does', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  buildFullyEligibleNotebook(classroom, student, 5);

  const defaulted = notebookFoundingRecognitionService.auditFoundingRecognitionEligibility(classroom);
  assert.equal(defaulted.classification, NEEDS_REVIEW);
  assert.equal(defaulted.classificationDetail, null);

  const detail = { classification: CONFIRMED_REAL, reason: 'Verified by program staff visit, 2026-11-10.', reviewedBy: 'staff@example.org', reviewedAt: '2026-11-10T00:00:00.000Z' };
  const withDetail = notebookFoundingRecognitionService.auditFoundingRecognitionEligibility(classroom, { classification: CONFIRMED_REAL, classificationDetail: detail });
  assert.equal(withDetail.classification, CONFIRMED_REAL);
  assert.deepEqual(withDetail.classificationDetail, detail);
  assert.equal(withDetail.eligible.length, defaulted.eligible.length, 'classification never changes the eligibility computation itself -- only what is reported alongside it');
});

// ---------------------------------------------------------------------
// applyFoundingRecognition
// ---------------------------------------------------------------------

test('applyFoundingRecognition: awards exactly the eligible group and nothing else', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  buildFullyEligibleNotebook(classroom, student, 5);

  const result = notebookFoundingRecognitionService.applyFoundingRecognition(classroom, TEACHER_UID, { migrationId: 'test-run-1', classification: CONFIRMED_REAL });

  assert.equal(result.appliedCount, 1);
  assert.equal(notebookFoundingRecognitionService.countFoundingRecognitionsForStudent(student), 1);
  const [entry] = student.history.filter((e) => e.kind === notebookFoundingRecognitionService.FOUNDING_RECOGNITION_KIND);
  assert.equal(entry.workItemRef.type, notebookFoundingRecognitionService.FOUNDING_RECOGNITION_WORK_ITEM_TYPE);
  assert.equal(entry.migrationId, 'test-run-1');
  assert.equal(entry.cutoffIso, CUTOFF);
  assert.equal(entry.delta, 1);
});

test('applyFoundingRecognition: never reuses the notebook_readiness_inspection or legacy notebook_readiness work item types', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  buildFullyEligibleNotebook(classroom, student, 5);
  notebookFoundingRecognitionService.applyFoundingRecognition(classroom, TEACHER_UID, { classification: CONFIRMED_REAL });

  const [entry] = student.history.filter((e) => e.kind === notebookFoundingRecognitionService.FOUNDING_RECOGNITION_KIND);
  assert.notEqual(entry.workItemRef.type, 'notebook_readiness_inspection');
  assert.notEqual(entry.workItemRef.type, 'notebook_readiness');
});

test('applyFoundingRecognition: an explicitly supplied migrationId is preserved exactly, never altered or suffixed', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  buildFullyEligibleNotebook(classroom, student, 5);

  const result = notebookFoundingRecognitionService.applyFoundingRecognition(classroom, TEACHER_UID, { migrationId: 'founding-recognition-bloom-force-19-2026-11-10', classification: CONFIRMED_REAL });

  assert.equal(result.migrationId, 'founding-recognition-bloom-force-19-2026-11-10');
  const [entry] = student.history.filter((e) => e.kind === notebookFoundingRecognitionService.FOUNDING_RECOGNITION_KIND);
  assert.equal(entry.migrationId, 'founding-recognition-bloom-force-19-2026-11-10');
});

test('applyFoundingRecognition: two SEPARATE invocations that both omit migrationId produce distinct, unique fallback ids -- never the same fixed string twice', () => {
  const { classroom: classroomOne, student: studentOne } = buildClassroomWithStudent({ withTeam: true });
  const { classroom: classroomTwo, student: studentTwo } = buildClassroomWithStudent({ withTeam: true });
  buildFullyEligibleNotebook(classroomOne, studentOne, 5);
  buildFullyEligibleNotebook(classroomTwo, studentTwo, 5);

  const resultOne = notebookFoundingRecognitionService.applyFoundingRecognition(classroomOne, TEACHER_UID, { classification: CONFIRMED_REAL });
  const resultTwo = notebookFoundingRecognitionService.applyFoundingRecognition(classroomTwo, TEACHER_UID, { classification: CONFIRMED_REAL });

  assert.ok(resultOne.migrationId, 'a fallback id must still be generated, never left blank');
  assert.ok(resultTwo.migrationId);
  assert.notEqual(resultOne.migrationId, resultTwo.migrationId, 'two separate real runs must never collapse onto the same fallback id just because the fixed cutoff is identical');
  assert.match(resultOne.migrationId, /^founding-recognition-2026-11-07T11:48:47Z-.+/, 'still clearly identifiable as a Founding Recognition run against the real cutoff, with a unique suffix appended');
});

test('applyFoundingRecognition: idempotent -- a second call against the same classroom applies nothing further', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  buildFullyEligibleNotebook(classroom, student, 5);

  const first = notebookFoundingRecognitionService.applyFoundingRecognition(classroom, TEACHER_UID, { classification: CONFIRMED_REAL });
  const second = notebookFoundingRecognitionService.applyFoundingRecognition(classroom, TEACHER_UID, { classification: CONFIRMED_REAL });

  assert.equal(first.appliedCount, 1);
  assert.equal(second.appliedCount, 0);
  assert.equal(second.skippedAlreadyRecognized, 1);
  assert.equal(notebookFoundingRecognitionService.countFoundingRecognitionsForStudent(student), 1, 'still exactly one entry after two apply calls');
});

test('applyFoundingRecognition: CLASSIFICATION REGISTRY -- defaults to NEEDS_REVIEW and refuses outright when the caller supplies no classification at all', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  buildFullyEligibleNotebook(classroom, student, 5);

  const result = notebookFoundingRecognitionService.applyFoundingRecognition(classroom, TEACHER_UID, {});

  assert.equal(result.appliedCount, 0);
  assert.match(result.skippedReason, /needs_review/);
  assert.equal(notebookFoundingRecognitionService.countFoundingRecognitionsForStudent(student), 0);
});

test('applyFoundingRecognition: CLASSIFICATION REGISTRY -- an explicit NEEDS_REVIEW classification refuses outright, same as the default', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  buildFullyEligibleNotebook(classroom, student, 5);

  const result = notebookFoundingRecognitionService.applyFoundingRecognition(classroom, TEACHER_UID, { classification: NEEDS_REVIEW });

  assert.equal(result.appliedCount, 0);
  assert.equal(notebookFoundingRecognitionService.countFoundingRecognitionsForStudent(student), 0);
});

test('applyFoundingRecognition: CLASSIFICATION REGISTRY -- CONFIRMED_TEST refuses outright, identically to NEEDS_REVIEW, never weakened', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true, schoolName: 'A Perfectly Real-Sounding School' });
  buildFullyEligibleNotebook(classroom, student, 5);

  const result = notebookFoundingRecognitionService.applyFoundingRecognition(classroom, TEACHER_UID, { classification: CONFIRMED_TEST });

  assert.equal(result.appliedCount, 0);
  assert.match(result.skippedReason, /confirmed_test/);
  assert.equal(notebookFoundingRecognitionService.countFoundingRecognitionsForStudent(student), 0);
});

test('applyFoundingRecognition: CLASSIFICATION REGISTRY -- CONFIRMED_REAL proceeds and awards normally', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  buildFullyEligibleNotebook(classroom, student, 5);

  const result = notebookFoundingRecognitionService.applyFoundingRecognition(classroom, TEACHER_UID, { classification: CONFIRMED_REAL });

  assert.equal(result.appliedCount, 1);
  assert.equal(result.skippedReason, null);
  assert.equal(notebookFoundingRecognitionService.countFoundingRecognitionsForStudent(student), 1);
});

test('applyFoundingRecognition: CLASSIFICATION REGISTRY -- an unrecognized/malformed classification string (e.g. a registry entry with a typo) refuses outright, fail-closed, never treated as confirmed_real', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  buildFullyEligibleNotebook(classroom, student, 5);

  const result = notebookFoundingRecognitionService.applyFoundingRecognition(classroom, TEACHER_UID, { classification: 'CONFIRMED_REAL' }); // wrong case -- not the exact valid string

  assert.equal(result.appliedCount, 0);
  assert.equal(notebookFoundingRecognitionService.countFoundingRecognitionsForStudent(student), 0);
});

test('applyFoundingRecognition: HEURISTIC AS WARNING ONLY -- a name-heuristic false positive ("Trial Bay Public School"-style) no longer blocks a classroom the registry has explicitly confirmed real', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true, schoolName: 'Trial' }); // the heuristic WOULD flag this
  buildFullyEligibleNotebook(classroom, student, 5);

  const result = notebookFoundingRecognitionService.applyFoundingRecognition(classroom, TEACHER_UID, { classification: CONFIRMED_REAL });

  assert.equal(result.heuristicWarning, true, 'the heuristic still fires and is still reported...');
  assert.equal(result.appliedCount, 1, '...but it no longer blocks the award once the registry has confirmed this classroom real');
  assert.equal(notebookFoundingRecognitionService.countFoundingRecognitionsForStudent(student), 1);
});

test('applyFoundingRecognition: HEURISTIC AS WARNING ONLY -- a classroom the heuristic does NOT flag is still refused when classification defaults to NEEDS_REVIEW (a false negative never grants a free pass)', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true, schoolName: 'QA Classroom' }); // a confirmed heuristic false-negative naming convention
  buildFullyEligibleNotebook(classroom, student, 5);

  const result = notebookFoundingRecognitionService.applyFoundingRecognition(classroom, TEACHER_UID, {});

  assert.equal(result.heuristicWarning, false, 'the heuristic misses this naming convention entirely');
  assert.equal(result.appliedCount, 0, 'but the registry default (needs_review) still refuses it -- the heuristic missing something is never treated as permission');
});

test('applyFoundingRecognition: throws for an unauthorized acting uid and applies nothing', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  buildFullyEligibleNotebook(classroom, student, 5);

  assert.throws(() => notebookFoundingRecognitionService.applyFoundingRecognition(classroom, VIEWER_UID, {}));
  assert.equal(notebookFoundingRecognitionService.countFoundingRecognitionsForStudent(student), 0);
});

test('applyFoundingRecognition: never touches incomplete, below-minimum, or insufficient-evidence groups', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  const checkpoints = [];
  for (let i = 0; i < 5; i += 1) checkpoints.push(addHistoricalCheckpoint(classroom, { title: `Unit ${i + 1}` }));
  checkpoints.slice(0, 4).forEach((cp) => {
    submit(cp, student.id, '2026-08-20');
    review(cp, student.id, 'complete');
  });
  // checkpoints[4] left pending -- incomplete

  notebookFoundingRecognitionService.applyFoundingRecognition(classroom, TEACHER_UID, { classification: CONFIRMED_REAL });
  assert.equal(notebookFoundingRecognitionService.countFoundingRecognitionsForStudent(student), 0);
});

test('applyFoundingRecognition: multiple notebooks for the same student produce independent recognitions', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  buildFullyEligibleNotebook(classroom, student, 5, { subjectId: 'subj-A', notebookTypeId: 'type-A' });
  buildFullyEligibleNotebook(classroom, student, 6, { subjectId: 'subj-B', notebookTypeId: 'type-B' });

  const result = notebookFoundingRecognitionService.applyFoundingRecognition(classroom, TEACHER_UID, { classification: CONFIRMED_REAL });

  assert.equal(result.appliedCount, 2);
  assert.equal(notebookFoundingRecognitionService.countFoundingRecognitionsForStudent(student), 2);
  assert.equal(notebookFoundingRecognitionService.countFoundingRecognitionsForStudent(student, { subjectId: 'subj-A', notebookTypeId: 'type-A' }), 1);
  assert.equal(notebookFoundingRecognitionService.countFoundingRecognitionsForStudent(student, { subjectId: 'subj-B', notebookTypeId: 'type-B' }), 1);
});

test('applyFoundingRecognition: duplicate-named students across two SEPARATE classroom objects never merge and never block each other', () => {
  // Mirrors the real CMS MH Road "7A"/"7A" duplicate-classroom scenario
  // from the organisation-wide audit -- this file has no way to know
  // whether two such records are the same real person, and must not
  // guess; each classroom is processed completely independently.
  const { classroom: classroomOne, student: studentOne } = buildClassroomWithStudent({ withTeam: true, schoolName: 'CMS MH Road', gradeSection: '7 A' });
  const { classroom: classroomTwo, student: studentTwo } = buildClassroomWithStudent({ withTeam: true, schoolName: 'CMS MH Road', gradeSection: '7A' });
  studentOne.name = 'Rani P.';
  studentTwo.name = 'Rani P';
  buildFullyEligibleNotebook(classroomOne, studentOne, 5);
  buildFullyEligibleNotebook(classroomTwo, studentTwo, 5);

  const resultOne = notebookFoundingRecognitionService.applyFoundingRecognition(classroomOne, TEACHER_UID, { classification: CONFIRMED_REAL });
  const resultTwo = notebookFoundingRecognitionService.applyFoundingRecognition(classroomTwo, TEACHER_UID, { classification: CONFIRMED_REAL });

  assert.equal(resultOne.appliedCount, 1);
  assert.equal(resultTwo.appliedCount, 1);
  assert.equal(notebookFoundingRecognitionService.countFoundingRecognitionsForStudent(studentOne), 1, 'each classroom-scoped student record gets its own independent recognition');
  assert.equal(notebookFoundingRecognitionService.countFoundingRecognitionsForStudent(studentTwo), 1);
});

// ---------------------------------------------------------------------
// Regression: existing Readiness Champion / legacy / Completion Star
// counts are provably unaffected by Founding Recognition entries.
// ---------------------------------------------------------------------

test('REGRESSION: a Founding Recognition entry is never counted by countReadinessChampionAchievementsForStudent (new-model count)', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  buildFullyEligibleNotebook(classroom, student, 5);
  notebookFoundingRecognitionService.applyFoundingRecognition(classroom, TEACHER_UID, { classification: CONFIRMED_REAL });

  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student), 0);
  assert.equal(notebookFoundingRecognitionService.countFoundingRecognitionsForStudent(student), 1);
});

test('REGRESSION: a Founding Recognition entry is never counted by the legacy countActiveReadinessChampionNotebooksForStudent, and vice versa', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  buildFullyEligibleNotebook(classroom, student, 5);
  notebookFoundingRecognitionService.applyFoundingRecognition(classroom, TEACHER_UID, { classification: CONFIRMED_REAL });

  assert.equal(notebookReadinessChampionService.countActiveReadinessChampionNotebooksForStudent(student), 0);

  const legacyRef = notebookReadinessChampionService.buildNotebookReadinessWorkItemRef({ subjectId: 'legacy-subj', notebookTypeId: 'legacy-type' });
  student.history.push({ id: 'legacy-1', kind: 'readiness-champion', label: 'Readiness Champion', delta: 1, source: 'automatic', workItemRef: legacyRef, recordedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(notebookFoundingRecognitionService.countFoundingRecognitionsForStudent(student), 1, 'unaffected by an unrelated legacy entry being added afterward');
});

test('REGRESSION: a real new-model inspection achievement and a Founding Recognition entry for the SAME notebook coexist without interfering with either count', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true });
  buildFullyEligibleNotebook(classroom, student, 5);
  notebookFoundingRecognitionService.applyFoundingRecognition(classroom, TEACHER_UID, { classification: CONFIRMED_REAL });

  const freshUnit = addHistoricalCheckpoint(classroom, { title: 'Unit 6', createdAt: AFTER_CUTOFF });
  notebookReadinessChampionService.inspectReadinessChampionOnNewCheckpoint(classroom, freshUnit, TEACHER_UID);

  assert.equal(notebookFoundingRecognitionService.countFoundingRecognitionsForStudent(student), 1);
  assert.equal(notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student), 1);
});

// ---------------------------------------------------------------------
// The four identified real students, reproduced as synthetic fixtures
// matching their documented real checkpoint counts. Never touches
// production; these are local, synthetic classroom objects only.
// ---------------------------------------------------------------------

test("R. Varalaxmi's documented scenario (Science 12/12, Social Science 14/14, 4 and 1 late respectively) is eligible in BOTH notebooks", () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true, schoolName: 'CHS Kannamapet', classroomName: 'Bloom Force 19' });
  student.name = 'R. Varalaxmi';

  const science = [];
  for (let i = 0; i < 12; i += 1) science.push(addHistoricalCheckpoint(classroom, { title: `SCI Unit ${i + 1}`, subjectId: 'science', notebookTypeId: 'classwork', dueDate: '2026-08-10' }));
  science.slice(0, 8).forEach((cp) => { submit(cp, student.id, '2026-08-05'); review(cp, student.id, 'complete'); });
  science.slice(8).forEach((cp) => { submit(cp, student.id, '2026-08-25'); review(cp, student.id, 'complete'); }); // 4 late

  const socialScience = [];
  for (let i = 0; i < 14; i += 1) socialScience.push(addHistoricalCheckpoint(classroom, { title: `SOC Unit ${i + 1}`, subjectId: 'social-science', notebookTypeId: 'classwork', dueDate: '2026-08-10' }));
  socialScience.slice(0, 13).forEach((cp) => { submit(cp, student.id, '2026-08-05'); review(cp, student.id, 'complete'); });
  socialScience.slice(13).forEach((cp) => { submit(cp, student.id, '2026-08-25'); review(cp, student.id, 'complete'); }); // 1 late

  const audit = notebookFoundingRecognitionService.auditFoundingRecognitionEligibility(classroom);
  const eligibleSubjects = audit.eligible.filter((e) => e.studentId === student.id).map((e) => e.subjectId).sort();
  assert.deepEqual(eligibleSubjects, ['science', 'social-science']);

  const scienceEntry = audit.eligible.find((e) => e.subjectId === 'science');
  const socialEntry = audit.eligible.find((e) => e.subjectId === 'social-science');
  assert.equal(scienceEntry.completeness.lateCount, 4);
  assert.equal(socialEntry.completeness.lateCount, 1);
});

test("Jasmine's documented scenario (Science 12/12, 4 late) is eligible", () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true, schoolName: 'CHS Kannamapet', classroomName: 'Bloom Force 19' });
  student.name = 'Jasmine';
  const checkpoints = [];
  for (let i = 0; i < 12; i += 1) checkpoints.push(addHistoricalCheckpoint(classroom, { title: `SCI Unit ${i + 1}`, subjectId: 'science', notebookTypeId: 'classwork', dueDate: '2026-08-10' }));
  checkpoints.slice(0, 8).forEach((cp) => { submit(cp, student.id, '2026-08-05'); review(cp, student.id, 'complete'); });
  checkpoints.slice(8).forEach((cp) => { submit(cp, student.id, '2026-08-25'); review(cp, student.id, 'complete'); });

  const audit = notebookFoundingRecognitionService.auditFoundingRecognitionEligibility(classroom);
  assert.equal(audit.eligible.some((e) => e.studentId === student.id && e.subjectId === 'science'), true);
});

test("Pugazh's documented scenario (Social Science 14/14, 1 late) is eligible", () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true, schoolName: 'CHS Kannamapet', classroomName: 'Bloom Force 19' });
  student.name = 'Pugazh';
  const checkpoints = [];
  for (let i = 0; i < 14; i += 1) checkpoints.push(addHistoricalCheckpoint(classroom, { title: `SOC Unit ${i + 1}`, subjectId: 'social-science', notebookTypeId: 'classwork', dueDate: '2026-08-10' }));
  checkpoints.slice(0, 13).forEach((cp) => { submit(cp, student.id, '2026-08-05'); review(cp, student.id, 'complete'); });
  checkpoints.slice(13).forEach((cp) => { submit(cp, student.id, '2026-08-25'); review(cp, student.id, 'complete'); });

  const audit = notebookFoundingRecognitionService.auditFoundingRecognitionEligibility(classroom);
  assert.equal(audit.eligible.some((e) => e.studentId === student.id && e.subjectId === 'social-science'), true);
});

test("Blessy's documented scenario (Social Science 14/14, 2 late) is eligible", () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true, schoolName: 'CHS Kannamapet', classroomName: 'Bloom Force 19' });
  student.name = 'Blessy';
  const checkpoints = [];
  for (let i = 0; i < 14; i += 1) checkpoints.push(addHistoricalCheckpoint(classroom, { title: `SOC Unit ${i + 1}`, subjectId: 'social-science', notebookTypeId: 'classwork', dueDate: '2026-08-10' }));
  checkpoints.slice(0, 12).forEach((cp) => { submit(cp, student.id, '2026-08-05'); review(cp, student.id, 'complete'); });
  checkpoints.slice(12).forEach((cp) => { submit(cp, student.id, '2026-08-25'); review(cp, student.id, 'complete'); });

  const audit = notebookFoundingRecognitionService.auditFoundingRecognitionEligibility(classroom);
  assert.equal(audit.eligible.some((e) => e.studentId === student.id && e.subjectId === 'social-science'), true);
});

test('None of the four documented students are awarded as a side effect of running the audit alone -- only applyFoundingRecognition writes anything, and this test never calls it', () => {
  const { classroom, student } = buildClassroomWithStudent({ withTeam: true, schoolName: 'CHS Kannamapet', classroomName: 'Bloom Force 19' });
  student.name = 'R. Varalaxmi';
  buildFullyEligibleNotebook(classroom, student, 12, { subjectId: 'science', notebookTypeId: 'classwork' });

  notebookFoundingRecognitionService.auditFoundingRecognitionEligibility(classroom); // dry-run only
  assert.equal(notebookFoundingRecognitionService.countFoundingRecognitionsForStudent(student), 0);
});
