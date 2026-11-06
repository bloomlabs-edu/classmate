/**
 * tests/ui/notebookCheckpointsViewReadinessWiring.test.js
 *
 * Notebook-level Readiness Champion redesign (2026-11-06) — proves
 * ui/views/NotebookCheckpointsView.js's own handlers genuinely route
 * through services/notebookReadinessChampionService.js's
 * evaluateReadinessChampionForNotebook() (never the removed,
 * per-checkpoint notebookBadgeAwardService.evaluateReadinessChampion()),
 * by mounting the real, exported renderNotebookCheckpointsView() in a
 * real Chromium page and driving its actual DOM across a notebook with
 * MULTIPLE checkpoints — the one scenario a per-checkpoint-only test
 * harness can never exercise. Same mount/stub/plain-data-return
 * conventions as tests/ui/notebookCheckpointsViewReviewRecognition.test.js's
 * own header comment describes; not duplicating that file's own
 * Completion Star coverage.
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
  await page.route('**/js/services/notificationService.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'export function publishNotification() { return Promise.resolve(null); }\n',
    })
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

// dueDate defaults well into the future relative to "today" -- the quick-mark
// path (onQuickMarkSubmitted) always submits with getTodayDateKey(), the real
// wall-clock date, so a fixed past due date would make every quick-marked
// submission unintentionally late regardless of which real day this suite
// happens to run on.
function buildCheckpoint({ id, order = 0, dueDate = '2026-12-31', records = [] } = {}) {
  return { id, subjectId: 'subj-1', notebookTypeId: 'type-1', title: `Unit ${order + 1}`, description: '', givenDate: '2026-09-01', dueDate, order, records };
}

function buildClassroom({ checkpoints, student }) {
  return {
    id: 'classroom-1',
    members: { [OWNER_UID]: { role: 'owner' } },
    settings: { notebookBadgeTypes: [{ id: 'readiness-champion', name: 'Readiness Champion', icon: 'calendar-check', theme: 'purple' }] },
    notebookConfig: {
      subjects: [{ id: 'subj-1', name: 'Science' }],
      notebookTypes: [{ id: 'type-1', subjectId: 'subj-1', name: 'Classwork' }],
    },
    checkpoints,
    teams: [{ id: 'team-1', name: 'Team 1', students: [student] }],
  };
}

function buildStudent({ id = 's1', history = [] } = {}) {
  return { id, name: 'Anjali', rollNumber: null, score: 0, bucket: null, badges: [], notes: [], submissions: {}, learningRecord: {}, history, notebookBadgeCounts: {} };
}

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

test('QUICK MARK SUBMITTED: one on-time checkpoint out of two leaves the notebook incomplete -- no Readiness Champion badge', async () => {
  const checkpoints = [buildCheckpoint({ id: 'cp-1', order: 0 }), buildCheckpoint({ id: 'cp-2', order: 1 })];
  const classroom = buildClassroom({ checkpoints, student: buildStudent() });

  const result = await runInView(classroom, { uid: OWNER_UID }, async ({ container, classroom }) => {
    container.querySelector('td[data-checkpoint-id="cp-1"][data-student-id="s1"] .notebook-checkpoints__cell-quick-mark').click();
    const student = classroom.teams[0].students[0];
    return { count: student.notebookBadgeCounts['readiness-champion'] ?? 0, readinessEntries: student.history.filter((e) => e.kind === 'readiness-champion').length };
  });

  assert.equal(result.count, 0);
  assert.equal(result.readinessEntries, 0);
});

test('QUICK MARK SUBMITTED: submitting the FINAL required checkpoint on time completes the notebook and awards Readiness Champion exactly once', async () => {
  const checkpoints = [buildCheckpoint({ id: 'cp-1', order: 0 }), buildCheckpoint({ id: 'cp-2', order: 1 })];
  const classroom = buildClassroom({ checkpoints, student: buildStudent() });

  const result = await runInView(classroom, { uid: OWNER_UID }, async ({ container, classroom }) => {
    container.querySelector('td[data-checkpoint-id="cp-1"][data-student-id="s1"] .notebook-checkpoints__cell-quick-mark').click();
    container.querySelector('td[data-checkpoint-id="cp-2"][data-student-id="s1"] .notebook-checkpoints__cell-quick-mark').click();
    const student = classroom.teams[0].students[0];
    return {
      count: student.notebookBadgeCounts['readiness-champion'] ?? 0,
      activeEntries: student.history.filter((e) => e.kind === 'readiness-champion' && e.delta === 1).length,
    };
  });

  assert.equal(result.count, 1, 'exactly one badge for the whole notebook, not one per checkpoint');
  assert.equal(result.activeEntries, 1);
});

test('WITHDRAWAL: walking the only remaining required checkpoint back to Not Submitted auto-revokes an already-earned Readiness Champion badge', async () => {
  const checkpoints = [buildCheckpoint({ id: 'cp-1', order: 0 }), buildCheckpoint({ id: 'cp-2', order: 1 })];
  const classroom = buildClassroom({ checkpoints, student: buildStudent() });

  const result = await runInView(classroom, { uid: OWNER_UID }, async ({ container, classroom }) => {
    container.querySelector('td[data-checkpoint-id="cp-1"][data-student-id="s1"] .notebook-checkpoints__cell-quick-mark').click();
    container.querySelector('td[data-checkpoint-id="cp-2"][data-student-id="s1"] .notebook-checkpoints__cell-quick-mark').click();
    const countAfterAward = classroom.teams[0].students[0].notebookBadgeCounts['readiness-champion'] ?? 0;

    // Withdraw checkpoint 1 via the detailed cell editor (the only UI path
    // that can walk a submission back to Not Submitted).
    container.querySelector('td[data-checkpoint-id="cp-1"][data-student-id="s1"] .notebook-checkpoints__cell-row').click();
    const [submissionSelect] = container.querySelectorAll('.notebook-checkpoints__cell-editor select');
    submissionSelect.value = 'not_submitted';
    submissionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save').click();

    const student = classroom.teams[0].students[0];
    return { countAfterAward, countAfterWithdrawal: student.notebookBadgeCounts['readiness-champion'] ?? 0 };
  });

  assert.equal(result.countAfterAward, 1);
  assert.equal(result.countAfterWithdrawal, 0, 'the notebook is incomplete again, so the automatic award must not survive the withdrawal');
});

test('A LATE submission on the final required checkpoint never awards Readiness Champion, even though the notebook becomes fully submitted', async () => {
  const checkpoints = [buildCheckpoint({ id: 'cp-1', order: 0 }), buildCheckpoint({ id: 'cp-2', order: 1 })];
  const classroom = buildClassroom({ checkpoints, student: buildStudent() });

  const result = await runInView(classroom, { uid: OWNER_UID }, async ({ container, classroom }) => {
    container.querySelector('td[data-checkpoint-id="cp-1"][data-student-id="s1"] .notebook-checkpoints__cell-quick-mark').click();

    // Submit checkpoint 2 LATE via the detailed cell editor's own date field.
    container.querySelector('td[data-checkpoint-id="cp-2"][data-student-id="s1"] .notebook-checkpoints__cell-row').click();
    const [submissionSelect] = container.querySelectorAll('.notebook-checkpoints__cell-editor select');
    submissionSelect.value = 'submitted';
    submissionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    const dateInput = container.querySelector('.notebook-checkpoints__cell-editor input[type="date"]');
    dateInput.value = '2027-01-15'; // after the checkpoint's own 2026-12-31 due date
    dateInput.dispatchEvent(new Event('input', { bubbles: true }));
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save').click();

    const student = classroom.teams[0].students[0];
    const updatedCp2 = classroom.checkpoints.find((c) => c.id === 'cp-2');
    return { count: student.notebookBadgeCounts['readiness-champion'] ?? 0, cp2Status: updatedCp2.records.find((r) => r.studentId === 's1')?.submissionStatus };
  });

  assert.equal(result.cp2Status, 'submitted', 'the submission itself went through');
  assert.equal(result.count, 0, 'the notebook is complete but not on time, so no badge');
});
