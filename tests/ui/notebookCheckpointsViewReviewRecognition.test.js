/**
 * tests/ui/notebookCheckpointsViewReviewRecognition.test.js
 *
 * Scope C: regression coverage proving ui/views/NotebookCheckpointsView.js's
 * own onQuickReview and the review portion of onSaveCell genuinely route
 * through services/recognitionService.js's recordNotebookCheckpointReview()
 * (WORK-0038), by mounting the real, exported renderNotebookCheckpointsView()
 * in a real Chromium page and driving its actual DOM (quick-review buttons,
 * the detailed cell editor), then reading back the resulting student state --
 * never spying on a mock, since this view wires its handlers directly to the
 * real service modules with no injection point (see
 * tests/ui/notebookCheckpointCompletionStarCellEditor.test.js's own header
 * comment for the one exported, pure, handlers-injectable sibling function
 * this file does NOT need to re-test).
 *
 * Every test does its mount-and-interact flow inside ONE page.evaluate()
 * call and returns only plain, serializable data (never the live classroom
 * object itself, which only exists inside the page) -- each evaluate() call
 * is a structured-clone boundary, so mutations made by a later, separate
 * evaluate() call can never retroactively apply to a value captured by an
 * earlier one.
 *
 * SAFETY: mounting the real view also reaches two genuinely
 * Firestore-backed modules on the handler paths this file exercises --
 * services/workspaceService.js's save() (persistClassroom()) and
 * services/notificationService.js's publishNotification() (the
 * "Incomplete" notification side effect). Both are intercepted at the
 * network/module level below and replaced with harmless no-op stubs before
 * any test runs, so no real Firestore write is ever attempted -- this
 * repo's own established rule (never seed/write real data during
 * verification) applies even to a fire-and-forget, errors-swallowed call
 * like these. Every OTHER module these two views import (checkpointService,
 * recognitionService, notebookConfigService, notebookBadgeService,
 * notebookBadgeAwardService, assessmentService, workspaceCoordinator) is
 * genuinely pure/in-memory (confirmed by inspection of their own import
 * lists) and is loaded for real -- exactly the logic this file exists to
 * verify.
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
  // No real Firestore write is ever attempted from this page -- see this
  // file's own header comment.
  await page.route('**/js/services/workspaceService.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: 'export function save() {}\n' })
  );
  await page.route('**/js/services/notificationService.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'export function publishNotification() { return Promise.resolve(null); }\n',
    })
  );
});

test.beforeEach(async () => {
  // A fresh navigation resets every ES module's own in-memory state
  // (workspaceCoordinator.js's active-workspace Map included) -- matching
  // tests/ui/notebookCheckpointCompletionStarCellEditor.test.js's own
  // established per-test isolation convention.
  await page.goto(`http://127.0.0.1:${port}/`);
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

const OWNER_UID = 'teacher-1';

function buildClassroom({ checkpoint, student, members = { [OWNER_UID]: { role: 'owner' } } } = {}) {
  return {
    id: 'classroom-1',
    members,
    settings: { notebookBadgeTypes: [] },
    notebookConfig: {
      subjects: [{ id: 'subj-1', name: 'Science' }],
      notebookTypes: [{ id: 'type-1', subjectId: 'subj-1', name: 'Classwork' }],
    },
    checkpoints: [checkpoint],
    teams: [{ id: 'team-1', name: 'Team 1', students: [student] }],
  };
}

function buildCheckpoint({ id = 'cp-1', dueDate = '', records = [] } = {}) {
  return { id, subjectId: 'subj-1', notebookTypeId: 'type-1', title: 'Unit 1', description: '', givenDate: '2026-01-01', dueDate, order: 0, records };
}

function buildRecord({ studentId = 's1', submissionStatus = 'not_submitted', submittedDate = null, reviewStatus = 'not_reviewed', reviewedDate = null } = {}) {
  return { id: `${studentId}-r`, studentId, submissionStatus, submittedDate, reviewStatus, reviewedDate, teacherNote: '', badgeAwards: [], updatedAt: '2026-01-05' };
}

function buildStudent({ id = 's1', score = 0, history = [] } = {}) {
  return { id, name: 'Anjali', rollNumber: null, score, bucket: null, badges: [], notes: [], submissions: {}, learningRecord: {}, history, notebookBadgeCounts: {} };
}

/** Mounts the real view and runs `run` entirely inside the page, returning only plain data. */
async function runInView(classroom, currentUser, run) {
  return page.evaluate(
    async ({ classroom, currentUser, run }) => {
      const { renderNotebookCheckpointsView } = await import('/js/ui/views/NotebookCheckpointsView.js');
      const container = document.createElement('div');
      document.body.appendChild(container);
      renderNotebookCheckpointsView(container, {
        classroom,
        currentUser,
        subjectId: 'subj-1',
        notebookTypeId: 'type-1',
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
    { classroom, currentUser, run: run.toString() }
  );
}

test('QUICK REVIEW: marking a submitted checkpoint Complete via the grid button awards a Completion Star through recordNotebookCheckpointReview()', async () => {
  const checkpoint = buildCheckpoint({ id: 'cp-1', records: [buildRecord({ submissionStatus: 'submitted', submittedDate: '2026-01-05' })] });
  const classroom = buildClassroom({ checkpoint, student: buildStudent() });

  const result = await runInView(classroom, { uid: OWNER_UID }, async ({ container, classroom }) => {
    const cell = container.querySelector('td[data-checkpoint-id="cp-1"][data-student-id="s1"]');
    cell.querySelector('.notebook-checkpoints__cell-quick-review-button--complete').click();
    const updatedCell = container.querySelector('td[data-checkpoint-id="cp-1"][data-student-id="s1"]');
    const student = classroom.teams[0].students[0];
    return {
      cellLabel: updatedCell.querySelector('.notebook-checkpoints__cell-label').textContent,
      score: student.score,
      autoEntries: student.history.filter((e) => e.kind === 'points' && e.source === 'auto'),
    };
  });

  assert.equal(result.cellLabel, 'Submitted · Complete', 'the grid cell reflects the real, persisted review outcome');
  assert.equal(result.score, 1, 'the Completion Star was genuinely awarded');
  assert.equal(result.autoEntries.length, 1);
  assert.deepEqual(result.autoEntries[0].workItemRef, { type: 'notebook_checkpoint', subjectId: 'subj-1', notebookTypeId: 'type-1', checkpointId: 'cp-1' });
});

test('QUICK REVIEW: Complete then Incomplete reverses the Completion Star back to net zero', async () => {
  const checkpoint = buildCheckpoint({ id: 'cp-2', records: [buildRecord({ submissionStatus: 'submitted', submittedDate: '2026-01-05' })] });
  const classroom = buildClassroom({ checkpoint, student: buildStudent() });

  const result = await runInView(classroom, { uid: OWNER_UID }, async ({ container, classroom }) => {
    const selector = 'td[data-checkpoint-id="cp-2"][data-student-id="s1"]';
    container.querySelector(`${selector} .notebook-checkpoints__cell-quick-review-button--complete`).click();
    const scoreAfterComplete = classroom.teams[0].students[0].score;

    // The quick-review buttons only render while reviewStatus is
    // 'not_reviewed' -- now that it's 'complete', flipping to Incomplete
    // has to go through the detailed cell editor's own review dropdown
    // instead (the same review-outcome-changing path onSaveCell wires to
    // recordNotebookCheckpointReview() too).
    container.querySelector(`${selector} .notebook-checkpoints__cell-row`).click();
    const [submissionSelect, reviewSelect] = container.querySelectorAll('.notebook-checkpoints__cell-editor select');
    reviewSelect.value = 'incomplete';
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save').click();

    const student = classroom.teams[0].students[0];
    return { scoreAfterComplete, scoreAfterIncomplete: student.score, autoEntries: student.history.filter((e) => e.kind === 'points' && e.source === 'auto') };
  });

  assert.equal(result.scoreAfterComplete, 1);
  assert.equal(result.scoreAfterIncomplete, 0, 'the star was reversed, not left active, once the review was walked back to Incomplete');
  assert.equal(result.autoEntries.length, 2, 'append-only: the award and the reversal are both preserved, never deleted');
  assert.equal(result.autoEntries[0].delta, 1);
  assert.equal(result.autoEntries[1].delta, -1);
});

test('QUICK MARK SUBMITTED alone never awards a Completion Star -- submission alone is not a trigger', async () => {
  const checkpoint = buildCheckpoint({ id: 'cp-3', records: [] });
  const classroom = buildClassroom({ checkpoint, student: buildStudent() });

  const result = await runInView(classroom, { uid: OWNER_UID }, async ({ container, classroom }) => {
    container.querySelector('td[data-checkpoint-id="cp-3"][data-student-id="s1"] .notebook-checkpoints__cell-quick-mark').click();
    const student = classroom.teams[0].students[0];
    const updatedCheckpoint = classroom.checkpoints.find((c) => c.id === 'cp-3');
    return { score: student.score, autoEntryCount: student.history.filter((e) => e.source === 'auto').length, submissionStatus: updatedCheckpoint.records[0]?.submissionStatus };
  });

  assert.equal(result.submissionStatus, 'submitted', 'the submission itself did go through');
  assert.equal(result.score, 0, 'no Completion Star for submission alone');
  assert.equal(result.autoEntryCount, 0);
});

test('CELL EDITOR SAVE: marking Complete via the detailed cell editor’s review dropdown awards a Completion Star independently of the quick-review buttons', async () => {
  const checkpoint = buildCheckpoint({ id: 'cp-4', records: [buildRecord({ submissionStatus: 'submitted', submittedDate: '2026-01-05' })] });
  const classroom = buildClassroom({ checkpoint, student: buildStudent() });

  const result = await runInView(classroom, { uid: OWNER_UID }, async ({ container, classroom }) => {
    container.querySelector('td[data-checkpoint-id="cp-4"][data-student-id="s1"] .notebook-checkpoints__cell-row').click();
    const [, reviewSelect] = container.querySelectorAll('.notebook-checkpoints__cell-editor select');
    reviewSelect.value = 'complete';
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save').click();
    const student = classroom.teams[0].students[0];
    return { score: student.score, autoEntries: student.history.filter((e) => e.source === 'auto') };
  });

  assert.equal(result.score, 1);
  assert.equal(result.autoEntries.length, 1);
  assert.deepEqual(result.autoEntries[0].workItemRef, { type: 'notebook_checkpoint', subjectId: 'subj-1', notebookTypeId: 'type-1', checkpointId: 'cp-4' });
});

test('CELL EDITOR SAVE: a brand-new submission saved as "submitted" with review left Not Reviewed never awards a star, even through the detailed editor', async () => {
  const checkpoint = buildCheckpoint({ id: 'cp-5', records: [] });
  const classroom = buildClassroom({ checkpoint, student: buildStudent() });

  const result = await runInView(classroom, { uid: OWNER_UID }, async ({ container, classroom }) => {
    container.querySelector('td[data-checkpoint-id="cp-5"][data-student-id="s1"] .notebook-checkpoints__cell-row').click();
    const [submissionSelect] = container.querySelectorAll('.notebook-checkpoints__cell-editor select');
    submissionSelect.value = 'submitted';
    submissionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save').click();
    const student = classroom.teams[0].students[0];
    const updatedCheckpoint = classroom.checkpoints.find((c) => c.id === 'cp-5');
    return { score: student.score, submissionStatus: updatedCheckpoint.records[0]?.submissionStatus, reviewStatus: updatedCheckpoint.records[0]?.reviewStatus };
  });

  assert.equal(result.submissionStatus, 'submitted');
  assert.equal(result.reviewStatus, 'not_reviewed');
  assert.equal(result.score, 0, 'no star for a submission-only save, exactly like the quick-mark path');
});

test('LATE SUBMISSION: a checkpoint reviewed Complete after its own due date still earns a Completion Star -- unlike Readiness Champion, this is never date-gated', async () => {
  const checkpoint = buildCheckpoint({ id: 'cp-6', dueDate: '2026-01-01', records: [buildRecord({ submissionStatus: 'submitted', submittedDate: '2026-01-10' })] });
  const classroom = buildClassroom({ checkpoint, student: buildStudent() });

  const result = await runInView(classroom, { uid: OWNER_UID }, async ({ container, classroom }) => {
    const cell = container.querySelector('td[data-checkpoint-id="cp-6"][data-student-id="s1"]');
    cell.querySelector('.notebook-checkpoints__cell-quick-review-button--complete').click();
    const updatedCell = container.querySelector('td[data-checkpoint-id="cp-6"][data-student-id="s1"]');
    const student = classroom.teams[0].students[0];
    return { cellLabel: updatedCell.querySelector('.notebook-checkpoints__cell-label').textContent, score: student.score };
  });

  assert.equal(result.cellLabel, 'Submitted late · Complete', 'lateness is still shown as a label detail');
  assert.equal(result.score, 1, 'eligibility is untouched by lateness -- Completion Star has no date rule');
});

test('AUTHORIZATION: an acting uid without AWARD_POINTS still successfully marks a review Complete, but no Completion Star is awarded (the write is never gated, only the award)', async () => {
  const checkpoint = buildCheckpoint({ id: 'cp-7', records: [buildRecord({ submissionStatus: 'submitted', submittedDate: '2026-01-05' })] });
  const classroom = buildClassroom({ checkpoint, student: buildStudent(), members: { 'nobody-in-particular': { role: 'owner' } } });

  const result = await runInView(classroom, { uid: 'unauthorized-uid' }, async ({ container, classroom }) => {
    const cell = container.querySelector('td[data-checkpoint-id="cp-7"][data-student-id="s1"]');
    cell.querySelector('.notebook-checkpoints__cell-quick-review-button--complete').click();
    const updatedCell = container.querySelector('td[data-checkpoint-id="cp-7"][data-student-id="s1"]');
    const student = classroom.teams[0].students[0];
    return { cellLabel: updatedCell.querySelector('.notebook-checkpoints__cell-label').textContent, score: student.score, autoEntryCount: student.history.filter((e) => e.source === 'auto').length };
  });

  assert.equal(result.cellLabel, 'Submitted · Complete', 'the review status itself is never blocked by this gate');
  assert.equal(result.score, 0, 'but the automatic award is skipped for an unauthorized uid');
  assert.equal(result.autoEntryCount, 0);
});
