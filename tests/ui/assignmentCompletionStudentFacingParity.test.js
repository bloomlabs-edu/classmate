/**
 * tests/ui/assignmentCompletionStudentFacingParity.test.js
 *
 * Workstream 4C's Done/Not Done completion status is surfaced on BOTH
 * the teacher-facing (ui/views/StudentProfileView.js) and student-
 * facing (ui/student-portal/views/StudentProfileView.js) assignment
 * evidence cards, fed by services/studentPortalDataService.js's own
 * getAssignmentProgressForCurrentStudent(). None of these three files
 * is importable in this repo's plain `node:test` unit-test lane:
 * ui/student-portal/views/StudentProfileView.js's own exported
 * renderStudentProfileView() pulls its data internally from
 * workspaceService/studentPortalDataService, both of which
 * transitively import config/appConfig.js, which reads `window` at
 * module-load time and throws immediately outside a real browser —
 * the same documented constraint tests/ui/workRequestReviewRollback.test.js
 * and tests/ui/editClassroomDetailsEntryPointsParity.test.js already
 * established for other, similarly-wired views.
 *
 * The teacher-facing rendering IS exercised live, end-to-end, by
 * tests/ui/assignmentCompletionToggle.test.js (real DOM, real
 * Chromium) — this file does not re-test that path. What it verifies,
 * by source text, is that the student-facing path mirrors it exactly:
 * the same data shape surfaced, the same chip markup/omission rule
 * applied, so the two can never silently drift apart.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

function readFile(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('SOURCE PIN: studentPortalDataService.js surfaces completionStatus via assignmentService.getCompletionStatus(), alongside the existing checkpointProgress field', () => {
  const source = readFile('js/services/studentPortalDataService.js');
  const start = source.indexOf('export async function getAssignmentProgressForCurrentStudent(');
  assert.ok(start !== -1, 'getAssignmentProgressForCurrentStudent must still exist under this exact name');
  const body = source.slice(start, start + 1200);

  assert.match(body, /completionStatus:\s*assignmentService\.getCompletionStatus\(/, 'must surface the real, current completion status for the student-facing view -- never omitted, never a stale snapshot');
});

test('SOURCE PIN: the student-facing StudentProfileView.js renders the identical Done/Not Done chip the teacher-facing view does, and omits it for "not_recorded" the same way', () => {
  const source = readFile('js/ui/student-portal/views/StudentProfileView.js');
  const start = source.indexOf('function createAssignmentsSection(');
  assert.ok(start !== -1, 'createAssignmentsSection must still exist under this exact name');
  const body = source.slice(start, start + 2800);

  assert.match(body, /completionStatus/, 'must destructure completionStatus from each entry');
  assert.match(body, /completionStatus !== 'not_recorded'/, 'must omit the chip entirely for not_recorded -- never render a false "Marked Not Done" default');
  assert.match(body, /work-request-roster__chip work-request-roster__chip--\$\{completionStatus === 'done' \? 'green' : 'red'\}/, 'must use the exact same green/red chip classing the teacher-facing card uses');
});

test('SOURCE PIN: the teacher-facing StudentProfileView.js (createAssignmentEvidenceCard) uses the same chip markup/omission rule the student-facing view mirrors', () => {
  const source = readFile('js/ui/views/StudentProfileView.js');
  const start = source.indexOf('function createAssignmentEvidenceCard(');
  assert.ok(start !== -1, 'createAssignmentEvidenceCard must still exist under this exact name');
  const body = source.slice(start, start + 1600);

  assert.match(body, /getCompletionStatus\(assignment, student\.id\)/);
  assert.match(body, /completionStatus !== 'not_recorded'/);
});
