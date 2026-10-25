/**
 * tests/ui/assignmentCompletionToggle.test.js
 *
 * Workstream 4C/3B end-to-end UI coverage: ui/views/AssignmentDetailView.js's
 * own Done/Not Done/Not Recorded toggle (buildCompletionTogglePill()),
 * including with ZERO checkpoints (renderEmptyCheckpointsGrid()'s own
 * code path) -- the explicit "a worksheet must be trackable with zero
 * checkpoints" requirement -- and the completion-star award/reversal it
 * triggers via services/recognitionService.js. Real Chromium, matching
 * this directory's other UI tests involving live DOM event wiring.
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
    const filePath = path.join(REPO_ROOT, urlPath === '/' ? '/index.html' : urlPath);
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
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  // workspaceService.save() is a real Firestore write with no emulator
  // or auth session available to this standalone render -- stubbed to a
  // no-op exactly like js/main.js is stubbed in
  // tests/ui/startupErrorHandling.test.js, since this file only tests
  // buildCompletionTogglePill()'s own DOM/star behavior, never real
  // persistence.
  await page.route('**/js/services/workspaceService.js', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: 'export function save() {} export function getClassroomOnce() {}' })
  );
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

async function withDetailView(run) {
  return page.evaluate(async (runSrc) => {
    const { renderAssignmentDetailView } = await import('/js/ui/views/AssignmentDetailView.js');
    const { createStudent } = await import('/js/models/Student.js');
    const { createTeam } = await import('/js/models/Team.js');
    const { createAssignmentCategory } = await import('/js/models/AssignmentCategory.js');
    const { createAssignment } = await import('/js/models/Assignment.js');

    const student = createStudent({ id: 'stu1', name: 'Priya' });
    const team = createTeam({ id: 'team1', name: 'Team A', students: [student] });
    const category = createAssignmentCategory({ id: 'cat-1', name: 'Worksheets' });
    const assignment = createAssignment({ id: 'assign-1', categoryId: 'cat-1', title: 'WS 1' });

    const classroom = {
      id: 'c1',
      teams: [team],
      assignmentConfig: { categories: [category] },
      assignments: [assignment],
      assignmentCheckpoints: [], // zero checkpoints -- renderEmptyCheckpointsGrid()'s own path
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderAssignmentDetailView(container, { classroom, assignmentId: 'assign-1', onBack: () => {}, onSelectStudent: () => {} });

    // eslint-disable-next-line no-eval
    const runFn = (0, eval)(runSrc);
    const result = await runFn({ container, student, classroom });
    container.remove();
    return result;
  }, run);
}

test('zero checkpoints: the Done/Not Done toggle still renders (renderEmptyCheckpointsGrid path)', async () => {
  const result = await withDetailView(`(async ({ container }) => {
    const toggle = container.querySelector('.assignment-completion-toggle');
    return {
      exists: !!toggle,
      notRecordedShown: !!container.querySelector('.assignment-completion-toggle__not-recorded'),
    };
  })`);
  assert.equal(result.exists, true);
  assert.equal(result.notRecordedShown, true, 'a fresh assignment starts Not Recorded');
});

test('clicking Done marks the pill active and awards exactly one star', async () => {
  const result = await withDetailView(`(async ({ container, student }) => {
    container.querySelector('.assignment-completion-toggle__button--done').click();
    const doneButton = container.querySelector('.assignment-completion-toggle__button--done');
    return {
      isActive: doneButton.classList.contains('assignment-completion-toggle__button--active'),
      ariaPressed: doneButton.getAttribute('aria-pressed'),
      score: student.score,
      notRecordedShown: !!container.querySelector('.assignment-completion-toggle__not-recorded'),
    };
  })`);
  assert.equal(result.isActive, true);
  assert.equal(result.ariaPressed, 'true');
  assert.equal(result.score, 1);
  assert.equal(result.notRecordedShown, false);
});

test('clicking Done again (toggle off) returns to Not Recorded and reverses the star', async () => {
  // updateCompletionPill() replaces the whole pill element on every
  // click (a fresh closure over the just-updated status) -- so each
  // click must re-query for the CURRENT button, exactly like a real
  // user clicking whatever is actually on screen would; reusing one
  // stale element reference would keep re-firing its own original,
  // now-outdated closure instead.
  const result = await withDetailView(`(async ({ container, student }) => {
    container.querySelector('.assignment-completion-toggle__button--done').click();
    container.querySelector('.assignment-completion-toggle__button--done').click();
    const doneButton = container.querySelector('.assignment-completion-toggle__button--done');
    return {
      isActive: doneButton.classList.contains('assignment-completion-toggle__button--active'),
      score: student.score,
      notRecordedShown: !!container.querySelector('.assignment-completion-toggle__not-recorded'),
    };
  })`);
  assert.equal(result.isActive, false);
  assert.equal(result.score, 0);
  assert.equal(result.notRecordedShown, true);
});

test('clicking Not Done marks it active and never awards a star', async () => {
  const result = await withDetailView(`(async ({ container, student }) => {
    container.querySelector('.assignment-completion-toggle__button--not-done').click();
    const notDoneButton = container.querySelector('.assignment-completion-toggle__button--not-done');
    return { isActive: notDoneButton.classList.contains('assignment-completion-toggle__button--active'), score: student.score };
  })`);
  assert.equal(result.isActive, true);
  assert.equal(result.score, 0);
});

test('re-marking Done after Undo awards a fresh star (idempotent, reversible, repeatable)', async () => {
  const result = await withDetailView(`(async ({ container, student }) => {
    const click = () => container.querySelector('.assignment-completion-toggle__button--done').click();
    click(); // not_recorded -> done (+1)
    click(); // done -> not_recorded (-1)
    click(); // not_recorded -> done (+1)
    return { score: student.score, autoEntryCount: student.history.filter((e) => e.source === 'auto').length };
  })`);
  assert.equal(result.score, 1, 'done -> undone -> done nets to one active star');
  assert.equal(result.autoEntryCount, 3, 'award, reversal, re-award -- all three preserved (append-only)');
});

test('repeated clicks on the same stale button element never accumulate runaway awards/reversals', async () => {
  // Simulates a double-fired click event on one element (e.g. a stray
  // duplicate browser event) rather than three separate, deliberate
  // user clicks on three separately-rendered buttons -- each of these
  // shares the SAME (first) click's own closed-over "done" status, so
  // only the first of these three actually changes anything; the
  // second and third are no-ops because, by then, the real stored
  // status already reflects the reversal the second call also happens
  // to try to apply again.
  const result = await withDetailView(`(async ({ container, student }) => {
    container.querySelector('.assignment-completion-toggle__button--done').click(); // not_recorded -> done (+1)
    const button = container.querySelector('.assignment-completion-toggle__button--done'); // closure: status === 'done'
    button.click(); // done -> not_recorded (-1)
    button.click(); // already not_recorded; this stale closure's own toggle-to-null is a true no-op
    button.click(); // same no-op again
    return { score: student.score, autoEntryCount: student.history.filter((e) => e.source === 'auto').length };
  })`);
  assert.equal(result.score, 0, 'no runaway negative score from repeated stale clicks');
  assert.equal(result.autoEntryCount, 2, 'exactly one award and one reversal -- the repeated stale clicks added nothing further');
});

test('the Overall Rating pill and the completion toggle coexist without interfering with each other', async () => {
  const result = await withDetailView(`(async ({ container, student }) => {
    container.querySelector('.assignment-completion-toggle__button--done').click();
    const overallPillExists = !!container.querySelector('.notebook-checkpoints__overall-rating-pill');
    const completionStillActive = container.querySelector('.assignment-completion-toggle__button--done').classList.contains('assignment-completion-toggle__button--active');
    return { overallPillExists, completionStillActive, score: student.score };
  })`);
  assert.equal(result.overallPillExists, true);
  assert.equal(result.completionStillActive, true);
  assert.equal(result.score, 1);
});
