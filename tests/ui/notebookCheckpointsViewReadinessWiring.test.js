/**
 * tests/ui/notebookCheckpointsViewReadinessWiring.test.js
 *
 * PERMANENT, PER-INSPECTION Readiness Champion redesign (2026-11-07) —
 * proves ui/views/NotebookCheckpointsView.js's own handlers wire
 * EXACTLY one Readiness Champion trigger: creating a fresh checkpoint
 * (the "+ Add Checkpoint" form's create path) calls
 * services/notebookReadinessChampionService.js's own
 * inspectReadinessChampionOnNewCheckpoint(). Every other handler that
 * used to re-evaluate or auto-revoke under the prior notebook-level
 * model (editing an existing checkpoint, deleting one, quick-marking
 * submitted, and the detailed cell editor's submission/review/
 * withdrawal save) must now leave Readiness Champion history
 * completely untouched — proven here by mounting the real, exported
 * renderNotebookCheckpointsView() in a real Chromium page and driving
 * its actual DOM, never a mocked handler.
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
      // Fills and saves the "+ Add Checkpoint" form -- the ONE live
      // inspection-event trigger. Defined here (in-page), not at
      // Node module scope, so it is reachable from `run`'s own
      // eval'd, in-page body below.
      window.createCheckpointViaForm = (container, { title, dueDate = '2026-12-31' }) => {
        container.querySelector('.notebook-checkpoints__add-button').click();
        const form = container.querySelector('.notebook-checkpoints__form');
        const titleInput = form.querySelector('input[type="text"]');
        titleInput.value = title;
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
        const [, dueDateInput] = form.querySelectorAll('input[type="date"]');
        dueDateInput.value = dueDate;
        dueDateInput.dispatchEvent(new Event('input', { bubbles: true }));
        [...form.querySelectorAll('button')].find((b) => b.textContent === 'Save').click();
      };
      // eslint-disable-next-line no-eval
      const runFn = (0, eval)(run);
      const result = await runFn({ container, classroom });
      container.remove();
      return result;
    },
    { classroom, currentUser, run: run.toString() }
  );
}

test('CREATE: a fresh checkpoint with all previously-assigned work complete awards exactly one permanent badge', async () => {
  const cp1 = buildCheckpoint({ id: 'cp-1', order: 0 });
  cp1.records = [{ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-08', reviewStatus: 'not_reviewed', badgeAwards: [] }];
  const classroom = buildClassroom({ checkpoints: [cp1], student: buildStudent() });

  const result = await runInView(classroom, { uid: OWNER_UID }, async ({ container, classroom }) => {
    createCheckpointViaForm(container, { title: 'Unit 2' });
    const student = classroom.teams[0].students[0];
    return { count: student.notebookBadgeCounts['readiness-champion'] ?? 0, entries: student.history.filter((e) => e.kind === 'readiness-champion').length };
  });

  assert.equal(result.count, 1, 'exactly one badge for the whole notebook, earned at the new checkpoint\'s own creation');
  assert.equal(result.entries, 1);
});

test('CREATE: a pending prior checkpoint prevents the award at the new checkpoint\'s own creation', async () => {
  const cp1 = buildCheckpoint({ id: 'cp-1', order: 0 }); // never submitted
  const classroom = buildClassroom({ checkpoints: [cp1], student: buildStudent() });

  const result = await runInView(classroom, { uid: OWNER_UID }, async ({ container, classroom }) => {
    createCheckpointViaForm(container, { title: 'Unit 2' });
    const student = classroom.teams[0].students[0];
    return { count: student.notebookBadgeCounts['readiness-champion'] ?? 0 };
  });

  assert.equal(result.count, 0);
});

test('CREATE: a LATE (but submitted) prior checkpoint still qualifies -- historical lateness is irrelevant under the new rule', async () => {
  const cp1 = buildCheckpoint({ id: 'cp-1', order: 0, dueDate: '2026-09-10' });
  cp1.records = [{ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-25', reviewStatus: 'not_reviewed', badgeAwards: [] }];
  const classroom = buildClassroom({ checkpoints: [cp1], student: buildStudent() });

  const result = await runInView(classroom, { uid: OWNER_UID }, async ({ container, classroom }) => {
    createCheckpointViaForm(container, { title: 'Unit 2' });
    const student = classroom.teams[0].students[0];
    return { count: student.notebookBadgeCounts['readiness-champion'] ?? 0 };
  });

  assert.equal(result.count, 1);
});

test('CREATE: two distinct qualifying checkpoint-creation events produce two independent, permanent badges for the same notebook', async () => {
  const cp1 = buildCheckpoint({ id: 'cp-1', order: 0 });
  cp1.records = [{ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-08', reviewStatus: 'not_reviewed', badgeAwards: [] }];
  const classroom = buildClassroom({ checkpoints: [cp1], student: buildStudent() });

  const result = await runInView(classroom, { uid: OWNER_UID }, async ({ container, classroom }) => {
    createCheckpointViaForm(container, { title: 'Unit 2' }); // qualifies: cp1 complete -- badge #1

    // Submit the newly-created cp2 so the THIRD checkpoint's own creation also qualifies.
    const cp2 = classroom.checkpoints.find((c) => c.title === 'Unit 2');
    cp2.records.push({ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-15', reviewStatus: 'not_reviewed', badgeAwards: [] });

    createCheckpointViaForm(container, { title: 'Unit 3' }); // qualifies again -- badge #2

    const student = classroom.teams[0].students[0];
    return { count: student.notebookBadgeCounts['readiness-champion'] ?? 0, entries: student.history.filter((e) => e.kind === 'readiness-champion' && e.delta === 1).length };
  });

  assert.equal(result.count, 2, 'two qualifying inspections -- two permanent badges, never capped at one per notebook');
  assert.equal(result.entries, 2);
});

test('EDIT (not create): changing an existing checkpoint\'s due date never awards or revokes Readiness Champion', async () => {
  const cp1 = buildCheckpoint({ id: 'cp-1', order: 0 });
  cp1.records = [{ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-08', reviewStatus: 'not_reviewed', badgeAwards: [] }];
  const cp2 = buildCheckpoint({ id: 'cp-2', order: 1 }); // left pending
  const classroom = buildClassroom({ checkpoints: [cp1, cp2], student: buildStudent() });

  const result = await runInView(classroom, { uid: OWNER_UID }, async ({ container, classroom }) => {
    // Open cp1's own checkpoint-level overflow menu -> Edit checkpoint
    // (not the per-student cell editor) and resave it with a different
    // due date.
    container.querySelector('th[data-checkpoint-id="cp-1"] .overflow-menu__trigger').click();
    [...container.querySelectorAll('.overflow-menu__item')].find((b) => b.textContent === 'Edit checkpoint').click();
    const form = container.querySelector('.notebook-checkpoints__form');
    if (form) {
      const [, dueDateInput] = form.querySelectorAll('input[type="date"]');
      dueDateInput.value = '2026-10-31';
      dueDateInput.dispatchEvent(new Event('input', { bubbles: true }));
      [...form.querySelectorAll('button')].find((b) => b.textContent === 'Save')?.click();
    }
    const student = classroom.teams[0].students[0];
    return { count: student.notebookBadgeCounts['readiness-champion'] ?? 0, entries: student.history.filter((e) => e.kind === 'readiness-champion').length, formFound: !!form };
  });

  assert.equal(result.formFound, true, 'the edit form must actually have been reachable for this test to be meaningful');
  assert.equal(result.count, 0);
  assert.equal(result.entries, 0, 'editing is never an inspection event, regardless of what it changes');
});

test('DELETE: removing a checkpoint never awards or revokes Readiness Champion, even when it newly completes the notebook', async () => {
  const cp1 = buildCheckpoint({ id: 'cp-1', order: 0 });
  cp1.records = [{ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-08', reviewStatus: 'not_reviewed', badgeAwards: [] }];
  const cp2 = buildCheckpoint({ id: 'cp-2', order: 1 }); // left pending
  const classroom = buildClassroom({ checkpoints: [cp1, cp2], student: buildStudent() });

  const result = await runInView(classroom, { uid: OWNER_UID }, async ({ container, classroom }) => {
    window.confirm = () => true;
    container.querySelector('th[data-checkpoint-id="cp-2"] .overflow-menu__trigger').click();
    [...container.querySelectorAll('.overflow-menu__item')].find((b) => b.textContent === 'Delete checkpoint').click();
    const student = classroom.teams[0].students[0];
    return { count: student.notebookBadgeCounts['readiness-champion'] ?? 0, entries: student.history.filter((e) => e.kind === 'readiness-champion').length, remaining: classroom.checkpoints.length };
  });

  assert.equal(result.remaining, 1, 'the delete must actually have happened for this test to be meaningful');
  assert.equal(result.count, 0);
  assert.equal(result.entries, 0, 'deletion is never an inspection event');
});

test('QUICK MARK SUBMITTED: submitting the final required checkpoint never awards anything by itself -- only the NEXT checkpoint\'s own creation can', async () => {
  const checkpoints = [buildCheckpoint({ id: 'cp-1', order: 0 }), buildCheckpoint({ id: 'cp-2', order: 1 })];
  const classroom = buildClassroom({ checkpoints, student: buildStudent() });

  const result = await runInView(classroom, { uid: OWNER_UID }, async ({ container, classroom }) => {
    container.querySelector('td[data-checkpoint-id="cp-1"][data-student-id="s1"] .notebook-checkpoints__cell-quick-mark').click();
    container.querySelector('td[data-checkpoint-id="cp-2"][data-student-id="s1"] .notebook-checkpoints__cell-quick-mark').click();
    const student = classroom.teams[0].students[0];
    return { count: student.notebookBadgeCounts['readiness-champion'] ?? 0, entries: student.history.filter((e) => e.kind === 'readiness-champion').length };
  });

  assert.equal(result.count, 0, 'submitting is never an inspection event under the new rule, regardless of what it completes');
  assert.equal(result.entries, 0);
});

test('WITHDRAWAL via the detailed cell editor never revokes an already-earned permanent badge', async () => {
  const cp1 = buildCheckpoint({ id: 'cp-1', order: 0 });
  cp1.records = [{ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-08', reviewStatus: 'not_reviewed', badgeAwards: [] }];
  const classroom = buildClassroom({ checkpoints: [cp1], student: buildStudent() });

  const result = await runInView(classroom, { uid: OWNER_UID }, async ({ container, classroom }) => {
    // Earn the badge first, via a qualifying checkpoint creation.
    createCheckpointViaForm(container, { title: 'Unit 2' });
    const student = classroom.teams[0].students[0];
    const countAfterAward = student.notebookBadgeCounts['readiness-champion'] ?? 0;

    // Now withdraw cp1's own submission via the detailed cell editor.
    container.querySelector('td[data-checkpoint-id="cp-1"][data-student-id="s1"] .notebook-checkpoints__cell-row').click();
    const [submissionSelect] = container.querySelectorAll('.notebook-checkpoints__cell-editor select');
    submissionSelect.value = 'not_submitted';
    submissionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save').click();

    return { countAfterAward, countAfterWithdrawal: student.notebookBadgeCounts['readiness-champion'] ?? 0, entriesAfterWithdrawal: student.history.filter((e) => e.kind === 'readiness-champion' && e.delta === -1).length };
  });

  assert.equal(result.countAfterAward, 1);
  assert.equal(result.countAfterWithdrawal, 1, 'the badge, once earned, survives a later withdrawal of the very checkpoint that made it possible');
  assert.equal(result.entriesAfterWithdrawal, 0, 'no code path in the new model ever writes a delta:-1 entry for this kind');
});
