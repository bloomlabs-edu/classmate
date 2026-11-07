/**
 * tests/scripts/auditFoundingRecognitionEligibility.test.js
 *
 * Tests scripts/auditFoundingRecognitionEligibility.js's own pure
 * report-building functions directly (importing the script performs
 * zero Firestore connection attempts and zero writes -- see that
 * file's own header comment and its `isRunDirectly` guard), plus a
 * static proof that the script never imports or references
 * applyFoundingRecognition() or any Firestore write method anywhere in
 * its own source text.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildClassroomReport, buildOrgWideReport, findPossibleDuplicateIdentities } from '../../scripts/auditFoundingRecognitionEligibility.js';
import { createClassroom } from '../../js/models/Classroom.js';
import { createStudent } from '../../js/models/Student.js';
import { createTeam } from '../../js/models/Team.js';
import * as checkpointService from '../../js/services/checkpointService.js';
import { FOUNDING_RECOGNITION_CLASSIFICATIONS } from '../../js/services/notebookFoundingRecognitionService.js';

const { CONFIRMED_REAL, CONFIRMED_TEST, NEEDS_REVIEW } = FOUNDING_RECOGNITION_CLASSIFICATIONS;

const SCRIPT_PATH = path.resolve(import.meta.dirname, '..', '..', 'scripts', 'auditFoundingRecognitionEligibility.js');
const BEFORE_CUTOFF = '2026-09-01T09:00:00.000Z';

function buildClassroomWithStudent({ schoolName = 'A School', classroomName, gradeSection = 'Grade 8' } = {}) {
  const classroom = createClassroom({ id: 'c1', schoolName, gradeSection });
  if (classroomName) classroom.classroomName = classroomName;
  const student = createStudent({ id: 's1', name: 'Anjali' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [student] })];
  return { classroom, student };
}

function addHistoricalCheckpoint(classroom, { title, subjectId = 'subj-1', notebookTypeId = 'type-1', dueDate = '2026-08-31' } = {}) {
  const cp = checkpointService.createNewCheckpoint(classroom, { subjectId, notebookTypeId, title, givenDate: '2026-08-01', dueDate });
  cp.createdAt = BEFORE_CUTOFF;
  return cp;
}

function buildFullyEligibleNotebook(classroom, student, count, opts = {}) {
  for (let i = 0; i < count; i += 1) {
    const cp = addHistoricalCheckpoint(classroom, { title: `Unit ${i + 1}`, ...opts });
    checkpointService.setSubmission(cp, student.id, { status: 'submitted', submittedDate: '2026-08-20' });
    checkpointService.setReview(cp, student.id, { status: 'complete', reviewedDate: '2026-08-21' });
  }
}

// ---------------------------------------------------------------------
// Static proof: never imports or calls applyFoundingRecognition(), and
// never calls a Firestore write method anywhere in its own source.
// ---------------------------------------------------------------------

test('the script source never imports applyFoundingRecognition -- the one guarantee that makes calling it structurally impossible', () => {
  const source = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const importLine = source.match(/^import \{[^}]*\} from '\.\.\/js\/services\/notebookFoundingRecognitionService\.js';$/m);
  assert.ok(importLine, 'must import named exports from the service file');
  assert.ok(!importLine[0].includes('applyFoundingRecognition'), 'applyFoundingRecognition must never be among the imported names -- this is the real guarantee: the header comment mentions the function BY NAME, in prose, to explain why it is never called, so a plain text search for the substring is not a reliable check on its own. Not being imported at all is what makes calling it structurally impossible, regardless of what the comments say about it.');
});

test('the script source never calls a Firestore write method on its own `db` handle (.set/.update/.delete/.add chained off `db`)', () => {
  const source = fs.readFileSync(SCRIPT_PATH, 'utf8');
  // Scoped to calls chained off the script's own `db` handle, not a
  // bare substring search -- this file legitimately uses plain
  // JavaScript Map#set() (`byName.set(...)`) for its own in-memory
  // duplicate-name grouping, which is not a Firestore write and must
  // not trip this check.
  assert.ok(!/\bdb\.[\w.()'"]*\.(set|update|delete|add)\(/.test(source));
});

test('importing the script performs no side effects -- main() never auto-runs when imported as a module', () => {
  // If main() had run on import, this process would already have
  // either thrown (missing projectId usage error -> process.exit) or
  // attempted a real Firestore connection. Reaching this assertion at
  // all is the proof.
  assert.equal(typeof buildClassroomReport, 'function');
  assert.equal(typeof buildOrgWideReport, 'function');
});

// ---------------------------------------------------------------------
// buildClassroomReport -- reuses the real service, never reimplements
// eligibility logic.
// ---------------------------------------------------------------------

test('buildClassroomReport: an eligible student is reported with required/on-time/late counts and a proposed award, clearly labeled as proposed', () => {
  const { classroom, student } = buildClassroomWithStudent();
  buildFullyEligibleNotebook(classroom, student, 5);

  const report = buildClassroomReport(classroom);
  assert.equal(report.proposedEligibleStudentCount, 1);
  assert.equal(report.proposedAwardCount_notebookPairs, 1);
  assert.equal(report.proposedAwards[0].studentId, student.id);
  assert.equal(report.proposedAwards[0].requiredCheckpointCount, 5);
  assert.equal(report.flaggedAsLikelyTestOrSandbox, false);
});

test('buildClassroomReport: an incomplete notebook is reported in exclusionDetail.incomplete with a human-readable reason, never in proposedAwards', () => {
  const { classroom, student } = buildClassroomWithStudent();
  for (let i = 0; i < 4; i += 1) {
    const cp = addHistoricalCheckpoint(classroom, { title: `Unit ${i + 1}` });
    checkpointService.setSubmission(cp, student.id, { status: 'submitted', submittedDate: '2026-08-20' });
    checkpointService.setReview(cp, student.id, { status: 'complete', reviewedDate: '2026-08-21' });
  }
  addHistoricalCheckpoint(classroom, { title: 'Unit 5' }); // left pending

  const report = buildClassroomReport(classroom);
  assert.equal(report.proposedAwardCount_notebookPairs, 0);
  assert.equal(report.excludedBecauseIncomplete_notebookPairs, 1);
  assert.match(report.exclusionDetail.incomplete[0].reason, /not submitted or returned\/incomplete/);
});

test('buildClassroomReport: below the 5-checkpoint minimum is reported distinctly from "incomplete"', () => {
  const { classroom, student } = buildClassroomWithStudent();
  buildFullyEligibleNotebook(classroom, student, 3);

  const report = buildClassroomReport(classroom);
  assert.equal(report.proposedAwardCount_notebookPairs, 0);
  assert.equal(report.excludedBecauseBelowFiveCheckpointMinimum_notebookPairs, 1);
  assert.equal(report.excludedBecauseIncomplete_notebookPairs, 0);
  assert.match(report.exclusionDetail.belowMinimumCheckpoints[0].reason, /below the 5-checkpoint minimum/);
});

test('buildClassroomReport: a classroom flagged as likely test/sandbox is marked flaggedAsLikelyTestOrSandbox, but still reports what WOULD be eligible', () => {
  const { classroom, student } = buildClassroomWithStudent({ schoolName: 'Trial' });
  buildFullyEligibleNotebook(classroom, student, 5);

  const report = buildClassroomReport(classroom);
  assert.equal(report.flaggedAsLikelyTestOrSandbox, true);
  assert.equal(report.proposedAwardCount_notebookPairs, 1, 'the report still shows the proposal -- only applyFoundingRecognition() itself would refuse to act on it');
});

test('buildClassroomReport: a classroom with zero notebooks configured reports zero everything, never throws', () => {
  const { classroom } = buildClassroomWithStudent();
  const report = buildClassroomReport(classroom);
  assert.equal(report.notebooksConfigured, 0);
  assert.equal(report.proposedAwardCount_notebookPairs, 0);
});

test('buildClassroomReport: with no registry entry for this classroom id, classification defaults to NEEDS_REVIEW and every detail field is null', () => {
  const { classroom, student } = buildClassroomWithStudent();
  buildFullyEligibleNotebook(classroom, student, 5);
  const report = buildClassroomReport(classroom, {}); // empty registry
  assert.equal(report.classification, NEEDS_REVIEW);
  assert.equal(report.classificationReason, null);
  assert.equal(report.classificationReviewedBy, null);
  assert.equal(report.classificationReviewedAt, null);
  assert.equal(report.proposedAwardCount_notebookPairs, 1, 'classification never changes the eligibility computation -- only what is reported alongside it');
});

test('buildClassroomReport: a registry entry confirming this exact classroom id real is reported faithfully, including its reviewer/reason/timestamp', () => {
  const { classroom, student } = buildClassroomWithStudent();
  buildFullyEligibleNotebook(classroom, student, 5);
  const registry = { [classroom.id]: { classification: CONFIRMED_REAL, reason: 'Confirmed via roster cross-check.', reviewedBy: 'staff@example.org', reviewedAt: '2026-11-10T00:00:00.000Z' } };
  const report = buildClassroomReport(classroom, registry);
  assert.equal(report.classification, CONFIRMED_REAL);
  assert.equal(report.classificationReason, 'Confirmed via roster cross-check.');
  assert.equal(report.classificationReviewedBy, 'staff@example.org');
  assert.equal(report.classificationReviewedAt, '2026-11-10T00:00:00.000Z');
});

test('buildClassroomReport: a registry entry for a DIFFERENT classroom id never leaks onto this one -- keyed strictly by id, never by name', () => {
  const { classroom, student } = buildClassroomWithStudent({ schoolName: 'CMS MH Road', gradeSection: '7A' });
  buildFullyEligibleNotebook(classroom, student, 5);
  const registry = { 'some-other-classroom-id': { classification: CONFIRMED_REAL } };
  const report = buildClassroomReport(classroom, registry);
  assert.equal(report.classification, NEEDS_REVIEW, 'this classroom\'s own id is not in the registry -- a same-named/same-looking different classroom\'s entry must never apply to it');
});

test('buildClassroomReport: a classroom confirmed test still reports its full proposed-eligibility numbers -- never silently excluded from the report', () => {
  const { classroom, student } = buildClassroomWithStudent();
  buildFullyEligibleNotebook(classroom, student, 5);
  const registry = { [classroom.id]: { classification: CONFIRMED_TEST, reason: 'Known sandbox classroom used for onboarding demos.', reviewedBy: 'staff@example.org', reviewedAt: '2026-11-10T00:00:00.000Z' } };
  const report = buildClassroomReport(classroom, registry);
  assert.equal(report.classification, CONFIRMED_TEST);
  assert.equal(report.proposedAwardCount_notebookPairs, 1, 'still reported -- only applyFoundingRecognition() itself would refuse to act on a confirmed_test classroom');
});

// ---------------------------------------------------------------------
// buildOrgWideReport / findPossibleDuplicateIdentities
// ---------------------------------------------------------------------

test('buildOrgWideReport: aggregates totals across multiple classrooms and explicitly labels every count as a proposal', () => {
  const { classroom: classroomA, student: studentA } = buildClassroomWithStudent({ schoolName: 'School A' });
  buildFullyEligibleNotebook(classroomA, studentA, 5);
  const { classroom: classroomB, student: studentB } = buildClassroomWithStudent({ schoolName: 'School B' });
  buildFullyEligibleNotebook(classroomB, studentB, 6, { subjectId: 'subj-2', notebookTypeId: 'type-2' });

  const report = buildOrgWideReport([classroomA, classroomB]);
  assert.equal(report.classroomsInspected, 2);
  assert.equal(report.totalProposedEligibleStudents, 2);
  assert.equal(report.totalProposedAwards_notebookPairs, 2);
  assert.equal(report.readOnly, true);
  assert.equal(report.writesPerformed, 0);
  assert.match(report.note, /DRY RUN ONLY/);
});

test('buildOrgWideReport: lists every classroom flagged as likely test/sandbox in its own top-level summary', () => {
  const { classroom: real } = buildClassroomWithStudent({ schoolName: 'Real School' });
  const { classroom: test1 } = buildClassroomWithStudent({ schoolName: 'Trial' });
  const report = buildOrgWideReport([real, test1]);
  assert.equal(report.classroomsFlaggedAsLikelyTestOrSandbox.length, 1);
  assert.equal(report.classroomsFlaggedAsLikelyTestOrSandbox[0].classroomId, test1.id);
});

test('buildOrgWideReport: groups every classroom by its own registry classification, with unreviewed classrooms correctly bucketed under NEEDS_REVIEW by default', () => {
  const { classroom: realClassroom } = buildClassroomWithStudent({ schoolName: 'Real School' });
  const { classroom: testClassroom } = buildClassroomWithStudent({ schoolName: 'Sandbox School' });
  const { classroom: unreviewedClassroom } = buildClassroomWithStudent({ schoolName: 'Another Real-Sounding School' });
  realClassroom.id = 'classroom-real';
  testClassroom.id = 'classroom-test';
  unreviewedClassroom.id = 'classroom-unreviewed';
  const registry = {
    [realClassroom.id]: { classification: CONFIRMED_REAL },
    [testClassroom.id]: { classification: CONFIRMED_TEST },
    // unreviewedClassroom deliberately has no entry at all
  };

  const report = buildOrgWideReport([realClassroom, testClassroom, unreviewedClassroom], registry);

  assert.deepEqual(report.classroomsByClassification[CONFIRMED_REAL].map((c) => c.classroomId), [realClassroom.id]);
  assert.deepEqual(report.classroomsByClassification[CONFIRMED_TEST].map((c) => c.classroomId), [testClassroom.id]);
  assert.deepEqual(report.classroomsByClassification[NEEDS_REVIEW].map((c) => c.classroomId), [unreviewedClassroom.id]);
});

test('findPossibleDuplicateIdentities: flags an exact-name match across two DIFFERENT classrooms, never within the same one, and never merges them', () => {
  const { classroom: classroomOne, student: studentOne } = buildClassroomWithStudent({ schoolName: 'CMS MH Road', gradeSection: '7 A' });
  const { classroom: classroomTwo, student: studentTwo } = buildClassroomWithStudent({ schoolName: 'CMS MH Road', gradeSection: '7A' });
  classroomOne.id = 'classroom-one';
  classroomTwo.id = 'classroom-two';
  studentOne.id = 'student-one';
  studentTwo.id = 'student-two';
  studentOne.name = 'Rani P.';
  studentTwo.name = 'Rani P';

  const duplicates = findPossibleDuplicateIdentities([], [classroomOne, classroomTwo]);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].occurrences.length, 2);
  const ids = duplicates[0].occurrences.map((o) => o.studentId).sort();
  assert.deepEqual(ids, [studentOne.id, studentTwo.id].sort());
});

test('findPossibleDuplicateIdentities: two students with the same name in the SAME classroom are never flagged as a cross-classroom duplicate', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'A School', gradeSection: 'Grade 8' });
  const studentOne = createStudent({ id: 's1', name: 'Anjali' });
  const studentTwo = createStudent({ id: 's2', name: 'Anjali' });
  classroom.teams = [createTeam({ id: 'team1', name: 'Team A', students: [studentOne, studentTwo] })];

  const duplicates = findPossibleDuplicateIdentities([], [classroom]);
  assert.equal(duplicates.length, 0, 'same-classroom name collisions are a different, unrelated concern -- this detector is specifically about cross-classroom overlap');
});

test('findPossibleDuplicateIdentities: no false positive when names are genuinely unique across classrooms', () => {
  const { classroom: classroomOne } = buildClassroomWithStudent({ schoolName: 'School One' });
  const { classroom: classroomTwo, student: studentTwo } = buildClassroomWithStudent({ schoolName: 'School Two' });
  studentTwo.name = 'A Completely Different Name';

  const duplicates = findPossibleDuplicateIdentities([], [classroomOne, classroomTwo]);
  assert.equal(duplicates.length, 0);
});
