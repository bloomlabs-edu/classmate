/**
 * tests/ui/assignmentDetailViewReviewRecognition.test.js
 *
 * Scope C: the Assignment Checkpoints mirror of
 * tests/ui/notebookCheckpointsViewReviewRecognition.test.js -- regression
 * coverage proving ui/views/AssignmentDetailView.js's own onQuickReview
 * and the review portion of onSaveCell genuinely route through
 * services/recognitionService.js's recordAssignmentCheckpointReview()
 * (WORK-0038), by mounting the real, exported renderAssignmentDetailView()
 * in a real Chromium page and driving its actual DOM, then reading back
 * the resulting student state. See that sibling file's own header comment
 * for the full rationale (no injectable handlers exist on this view
 * either, and why that file's own structured-clone-boundary discipline
 * applies here too).
 *
 * SAFETY: same as the Notebook Checkpoints sibling file -- the only
 * Firestore-backed module reachable from this view's handler paths is
 * services/workspaceService.js's save() (confirmed by inspection: this
 * view, unlike NotebookCheckpointsView.js, never imports
 * notificationService.js or notebookBadgeAwardService.js at all), stubbed
 * out below before any test runs. Every other imported module
 * (assignmentCheckpointService, recognitionService, assignmentService,
 * assignmentConfigService, learningRecordService, assessmentService,
 * workspaceCoordinator) is genuinely pure/in-memory.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const CONTENT_TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' };

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><html><body></body></html>');
      return;
    }
    const filePath = path.join(REPO_ROOT, urlPath);
    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

let server;
let port;
let browser;
let page;

test.before(async () => {
  ({ server, port } = await startStaticServer());
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.route('**/js/services/workspaceService.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: 'export function save() {}\n' })
  );
});

test.beforeEach(async () => {
  await page.goto(`http://127.0.0.1:${port}/`);
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

const OWNER_UID = 'teacher-1';

function buildClassroom({ assignment, student, members = { [OWNER_UID]: { role: 'owner' } } } = {}) {
  return {
    id: 'classroom-1',
    members,
    assignmentConfig: { categories: [{ id: 'cat-1', name: 'Worksheets', aspects: [{ id: 'asp-1', name: 'Completion' }] }] },
    assignments: [assignment],
    learningRecord: { subjects: [] },
    teams: [{ id: 'team-1', name: 'Team 1', students: [student] }],
  };
}

function buildAssignment({ id = 'assign-1' } = {}) {
  return { id, categoryId: 'cat-1', title: 'Worksheet 1', description: '', givenDate: '2026-01-01', dueDate: '', order: 0, conceptIds: [], resourceUrl: '', subjectId: null, unitId: null, code: null };
}

function buildCheckpoint({ id = 'cp-1', assignmentId = 'assign-1', dueDate = '', records = [] } = {}) {
  return { id, assignmentId, title: 'Checkpoint 1', description: '', givenDate: '2026-01-01', dueDate, order: 0, records };
}

function buildRecord({ studentId = 's1', submissionStatus = 'not_submitted', submittedDate = null, reviewStatus = 'not_reviewed', reviewedDate = null } = {}) {
  return { id: `${studentId}-r`, studentId, submissionStatus, submittedDate, reviewStatus, reviewedDate, teacherNote: '', badgeAwards: [], updatedAt: '2026-01-05' };
}

function buildStudent({ id = 's1', score = 0, history = [] } = {}) {
  return { id, name: 'Anjali', rollNumber: null, score, bucket: null, badges: [], notes: [], submissions: {}, learningRecord: {}, history, notebookBadgeCounts: {} };
}

/** Mounts the real view and runs `run` entirely inside the page, returning only plain data. Assignment Checkpoints live on `classroom.assignmentCheckpoints` (assignmentCheckpointService's own storage array -- a sibling of classroom.checkpoints, never nested on the assignment itself), so `checkpoint` is seeded there directly, matching the view's own assignmentCheckpointService.listCheckpointsForAssignment()/getCheckpointById() reads. */
async function runInView(classroom, checkpoint, currentUser, run) {
  classroom.assignmentCheckpoints = [checkpoint];
  return page.evaluate(
    async ({ classroom, currentUser, run, assignmentId }) => {
      const { renderAssignmentDetailView } = await import('/js/ui/views/AssignmentDetailView.js');
      const container = document.createElement('div');
      document.body.appendChild(container);
      renderAssignmentDetailView(container, {
        classroom,
        assignmentId,
        currentUser,
        onBack: () => {},
        onSelectStudent: () => {},
        onGoToClassMode: null,
      });
      // eslint-disable-next-line no-eval
      const runFn = (0, eval)(run);
      const result = await runFn({ container, classroom });
      container.remove();
      return result;
    },
    { classroom, currentUser, run: run.toString(), assignmentId: 'assign-1' }
  );
}

test('QUICK REVIEW: marking a submitted checkpoint Complete via the grid button awards a Completion Star through recordAssignmentCheckpointReview()', async () => {
  const assignment = buildAssignment();
  const checkpoint = buildCheckpoint({ id: 'cp-1', records: [buildRecord({ submissionStatus: 'submitted', submittedDate: '2026-01-05' })] });
  const classroom = buildClassroom({ assignment, student: buildStudent() });

  const result = await runInView(classroom, checkpoint, { uid: OWNER_UID }, async ({ container, classroom }) => {
    container.querySelector('td[data-checkpoint-id="cp-1"][data-student-id="s1"] .notebook-checkpoints__cell-quick-review-button--complete').click();
    const updatedCell = container.querySelector('td[data-checkpoint-id="cp-1"][data-student-id="s1"]');
    const student = classroom.teams[0].students[0];
    return { cellLabel: updatedCell.querySelector('.notebook-checkpoints__cell-label').textContent, score: student.score, autoEntries: student.history.filter((e) => e.source === 'auto') };
  });

  assert.equal(result.cellLabel, 'Submitted · Complete');
  assert.equal(result.score, 1);
  assert.equal(result.autoEntries.length, 1);
  assert.deepEqual(result.autoEntries[0].workItemRef, { type: 'assignment_checkpoint', assignmentId: 'assign-1', checkpointId: 'cp-1' });
});

test('QUICK REVIEW: Complete then Incomplete (via the detailed editor) reverses the Completion Star back to net zero', async () => {
  const assignment = buildAssignment();
  const checkpoint = buildCheckpoint({ id: 'cp-2', records: [buildRecord({ submissionStatus: 'submitted', submittedDate: '2026-01-05' })] });
  const classroom = buildClassroom({ assignment, student: buildStudent() });

  const result = await runInView(classroom, checkpoint, { uid: OWNER_UID }, async ({ container, classroom }) => {
    const selector = 'td[data-checkpoint-id="cp-2"][data-student-id="s1"]';
    container.querySelector(`${selector} .notebook-checkpoints__cell-quick-review-button--complete`).click();
    const scoreAfterComplete = classroom.teams[0].students[0].score;

    container.querySelector(`${selector} .notebook-checkpoints__cell-row`).click();
    const [, reviewSelect] = container.querySelectorAll('.notebook-checkpoints__cell-editor select');
    reviewSelect.value = 'incomplete';
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save').click();

    const student = classroom.teams[0].students[0];
    return { scoreAfterComplete, scoreAfterIncomplete: student.score, autoEntries: student.history.filter((e) => e.source === 'auto') };
  });

  assert.equal(result.scoreAfterComplete, 1);
  assert.equal(result.scoreAfterIncomplete, 0);
  assert.equal(result.autoEntries.length, 2);
  assert.equal(result.autoEntries[0].delta, 1);
  assert.equal(result.autoEntries[1].delta, -1);
});

test('QUICK MARK SUBMITTED alone never awards a Completion Star -- submission alone is not a trigger', async () => {
  const assignment = buildAssignment();
  const checkpoint = buildCheckpoint({ id: 'cp-3', records: [] });
  const classroom = buildClassroom({ assignment, student: buildStudent() });

  const result = await runInView(classroom, checkpoint, { uid: OWNER_UID }, async ({ container, classroom }) => {
    container.querySelector('td[data-checkpoint-id="cp-3"][data-student-id="s1"] .notebook-checkpoints__cell-quick-mark').click();
    const student = classroom.teams[0].students[0];
    const updatedCheckpoint = classroom.assignmentCheckpoints.find((c) => c.id === 'cp-3');
    return { score: student.score, autoEntryCount: student.history.filter((e) => e.source === 'auto').length, submissionStatus: updatedCheckpoint.records[0]?.submissionStatus };
  });

  assert.equal(result.submissionStatus, 'submitted');
  assert.equal(result.score, 0);
  assert.equal(result.autoEntryCount, 0);
});

test('CELL EDITOR SAVE: marking Complete via the detailed cell editor’s review dropdown awards a Completion Star independently of the quick-review buttons', async () => {
  const assignment = buildAssignment();
  const checkpoint = buildCheckpoint({ id: 'cp-4', records: [buildRecord({ submissionStatus: 'submitted', submittedDate: '2026-01-05' })] });
  const classroom = buildClassroom({ assignment, student: buildStudent() });

  const result = await runInView(classroom, checkpoint, { uid: OWNER_UID }, async ({ container, classroom }) => {
    container.querySelector('td[data-checkpoint-id="cp-4"][data-student-id="s1"] .notebook-checkpoints__cell-row').click();
    const [, reviewSelect] = container.querySelectorAll('.notebook-checkpoints__cell-editor select');
    reviewSelect.value = 'complete';
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save').click();
    const student = classroom.teams[0].students[0];
    return { score: student.score, autoEntries: student.history.filter((e) => e.source === 'auto') };
  });

  assert.equal(result.score, 1);
  assert.equal(result.autoEntries.length, 1);
  assert.deepEqual(result.autoEntries[0].workItemRef, { type: 'assignment_checkpoint', assignmentId: 'assign-1', checkpointId: 'cp-4' });
});

test('CELL EDITOR SAVE: a brand-new submission saved as "submitted" with review left Not Reviewed never awards a star', async () => {
  const assignment = buildAssignment();
  const checkpoint = buildCheckpoint({ id: 'cp-5', records: [] });
  const classroom = buildClassroom({ assignment, student: buildStudent() });

  const result = await runInView(classroom, checkpoint, { uid: OWNER_UID }, async ({ container, classroom }) => {
    container.querySelector('td[data-checkpoint-id="cp-5"][data-student-id="s1"] .notebook-checkpoints__cell-row').click();
    const [submissionSelect] = container.querySelectorAll('.notebook-checkpoints__cell-editor select');
    submissionSelect.value = 'submitted';
    submissionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save').click();
    const student = classroom.teams[0].students[0];
    const updatedCheckpoint = classroom.assignmentCheckpoints.find((c) => c.id === 'cp-5');
    return { score: student.score, submissionStatus: updatedCheckpoint.records[0]?.submissionStatus, reviewStatus: updatedCheckpoint.records[0]?.reviewStatus };
  });

  assert.equal(result.submissionStatus, 'submitted');
  assert.equal(result.reviewStatus, 'not_reviewed');
  assert.equal(result.score, 0);
});

test('TIMELINESS FIX: a checkpoint reviewed Complete after its own due date NEVER earns a Completion Star (supersedes this file\'s own earlier "eligibility is untouched by lateness" assertion -- see services/recognitionService.js\'s own header comment for the 2026-11-06/07 timeliness follow-up to WORK-0038)', async () => {
  const assignment = buildAssignment();
  const checkpoint = buildCheckpoint({ id: 'cp-6', dueDate: '2026-01-01', records: [buildRecord({ submissionStatus: 'submitted', submittedDate: '2026-01-10' })] });
  const classroom = buildClassroom({ assignment, student: buildStudent() });

  const result = await runInView(classroom, checkpoint, { uid: OWNER_UID }, async ({ container, classroom }) => {
    const cell = container.querySelector('td[data-checkpoint-id="cp-6"][data-student-id="s1"]');
    cell.querySelector('.notebook-checkpoints__cell-quick-review-button--complete').click();
    const updatedCell = container.querySelector('td[data-checkpoint-id="cp-6"][data-student-id="s1"]');
    const student = classroom.teams[0].students[0];
    return { cellLabel: updatedCell.querySelector('.notebook-checkpoints__cell-label').textContent, score: student.score };
  });

  assert.equal(result.cellLabel, 'Submitted late · Complete');
  assert.equal(result.score, 0, 'a late submission must never earn a Completion Star, even though lateness is still shown as a label detail');
});

test('WITHDRAWAL: walking a submission back to Not Submitted through the cell editor reverses an already-active Completion Star (recordAssignmentCheckpointSubmission\'s own reversal branch)', async () => {
  const assignment = buildAssignment();
  const workItemRef = { type: 'assignment_checkpoint', assignmentId: 'assign-1', checkpointId: 'cp-8' };
  const checkpoint = buildCheckpoint({ id: 'cp-8', records: [buildRecord({ submissionStatus: 'submitted', submittedDate: '2026-01-05', reviewStatus: 'complete', reviewedDate: '2026-01-06' })] });
  const classroom = buildClassroom({
    assignment,
    student: buildStudent({ score: 1, history: [{ id: 'h1', kind: 'points', label: 'Completion Star', delta: 1, source: 'auto', workItemRef, recordedAt: '2026-01-06' }] }),
  });

  const result = await runInView(classroom, checkpoint, { uid: OWNER_UID }, async ({ container, classroom }) => {
    container.querySelector('td[data-checkpoint-id="cp-8"][data-student-id="s1"] .notebook-checkpoints__cell-row').click();
    const [submissionSelect] = container.querySelectorAll('.notebook-checkpoints__cell-editor select');
    submissionSelect.value = 'not_submitted';
    submissionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save').click();
    const student = classroom.teams[0].students[0];
    return { score: student.score, autoEntries: student.history.filter((e) => e.source === 'auto') };
  });

  assert.equal(result.score, 0);
  assert.equal(result.autoEntries.length, 2);
  assert.equal(result.autoEntries[1].delta, -1);
  assert.equal(result.autoEntries[1].reason, 'submission_withdrawn');
});

test('AUTHORIZATION: an acting uid without AWARD_POINTS still successfully marks a review Complete, but no Completion Star is awarded', async () => {
  const assignment = buildAssignment();
  const checkpoint = buildCheckpoint({ id: 'cp-7', records: [buildRecord({ submissionStatus: 'submitted', submittedDate: '2026-01-05' })] });
  const classroom = buildClassroom({ assignment, student: buildStudent(), members: { 'nobody-in-particular': { role: 'owner' } } });

  const result = await runInView(classroom, checkpoint, { uid: 'unauthorized-uid' }, async ({ container, classroom }) => {
    const cell = container.querySelector('td[data-checkpoint-id="cp-7"][data-student-id="s1"]');
    cell.querySelector('.notebook-checkpoints__cell-quick-review-button--complete').click();
    const updatedCell = container.querySelector('td[data-checkpoint-id="cp-7"][data-student-id="s1"]');
    const student = classroom.teams[0].students[0];
    return { cellLabel: updatedCell.querySelector('.notebook-checkpoints__cell-label').textContent, score: student.score, autoEntryCount: student.history.filter((e) => e.source === 'auto').length };
  });

  assert.equal(result.cellLabel, 'Submitted · Complete');
  assert.equal(result.score, 0);
  assert.equal(result.autoEntryCount, 0);
});
