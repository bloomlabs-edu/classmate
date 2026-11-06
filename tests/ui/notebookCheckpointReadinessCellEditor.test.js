/**
 * tests/ui/notebookCheckpointReadinessCellEditor.test.js
 *
 * Regression coverage for the Readiness Champion override/revoke
 * section inside ui/views/NotebookCheckpointsView.js's own
 * renderCellEditor() — drives that real, exported function directly in
 * a real Chromium page, same reasoning as
 * tests/ui/notebookCheckpointsStudentRow.test.js's own header comment.
 *
 * Rewritten for the notebook-level Readiness Champion redesign
 * (2026-11-06): this section now reads the STUDENT's own append-only
 * `history` (via notebookReadinessChampionService.js's own
 * getActiveReadinessSourcesForNotebook()), never the checkpoint
 * record's own (now Organization/Punctuation-only) `badgeAwards`
 * array — see services/notebookReadinessChampionService.js's own
 * header comment for why. `checkpoint` fixtures below accordingly carry
 * `subjectId`/`notebookTypeId` (needed to build the notebook identity),
 * and `student` fixtures carry `history` instead of the checkpoint
 * record carrying `badgeAwards` for this badge type.
 *
 * Organization/Punctuation Champion are deliberately NOT covered here —
 * they're only ever offered via the separate post-Save
 * AwardReviewBadgesModal prompt (see
 * tests/ui/awardReviewBadgesModal.test.js), never from inside this
 * editor itself (see renderCellEditor()'s own comment on exactly why).
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
});

test.beforeEach(async () => {
  await page.goto(`http://127.0.0.1:${port}/`);
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

test('a student who has not submitted shows "Not awarded" with no revoke button, but still offers the whole-notebook override', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = { id: 'cp1', title: 'Unit 2', dueDate: '2026-09-10', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [] };
    const student = { id: 's1', name: 'Anjali', history: [] };
    const editor = renderCellEditor(checkpoint, student, {});
    const labels = [...editor.querySelectorAll('.notebook-checkpoints__cell-editor-section-label')].map((el) => el.textContent);
    const actionsButtons = [...editor.querySelectorAll('button')].map((b) => b.textContent);
    return { hasReadinessLabel: labels.includes('Readiness Champion (whole notebook)'), actionsButtons };
  });
  assert.equal(result.hasReadinessLabel, true);
  assert.ok(!result.actionsButtons.includes('Revoke'));
  // Override is offered regardless of THIS checkpoint's own submission
  // status now -- it is a whole-notebook decision, not gated per cell.
  assert.ok(result.actionsButtons.includes('Award anyway (override)'));
});

test('a notebook with no Readiness history at all shows "Not awarded" and an "Award anyway (override)" button', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = { id: 'cp1', title: 'Unit 2', dueDate: '2026-09-10', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [{ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-15', reviewStatus: 'not_reviewed', badgeAwards: [] }] };
    const student = { id: 's1', name: 'Anjali', history: [] };
    const editor = renderCellEditor(checkpoint, student, {});
    const text = editor.textContent;
    const buttons = [...editor.querySelectorAll('button')].map((b) => b.textContent);
    return { hasNotAwarded: text.includes('Not awarded'), buttons };
  });
  assert.equal(result.hasNotAwarded, true);
  assert.ok(result.buttons.includes('Award anyway (override)'));
  assert.ok(!result.buttons.includes('Revoke'));
});

test('an active AUTOMATIC Readiness award (on the STUDENT\'s own history, not this checkpoint\'s record) shows the correct status text and a Revoke button, never an override button', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = { id: 'cp1', title: 'Unit 2', dueDate: '2026-09-10', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [{ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-05', reviewStatus: 'not_reviewed', badgeAwards: [] }] };
    const student = {
      id: 's1', name: 'Anjali',
      history: [{ id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: { type: 'notebook_readiness', subjectId: 'subj-1', notebookTypeId: 'type-1' }, recordedAt: '2026-09-05T00:00:00.000Z' }],
    };
    const editor = renderCellEditor(checkpoint, student, {});
    const text = editor.textContent;
    const buttons = [...editor.querySelectorAll('button')].map((b) => b.textContent);
    return { text, buttons };
  });
  assert.match(result.text, /Awarded \(automatic — notebook complete and on time\)/);
  assert.ok(result.buttons.includes('Revoke'));
  assert.ok(!result.buttons.includes('Award anyway (override)'));
});

test('an active OVERRIDE Readiness award shows "teacher override" in its status text', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = { id: 'cp1', title: 'Unit 2', dueDate: '2026-09-10', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [{ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-15', reviewStatus: 'not_reviewed', badgeAwards: [] }] };
    const student = {
      id: 's1', name: 'Anjali',
      history: [{ id: 'h1', kind: 'readiness-champion', delta: 1, source: 'override', workItemRef: { type: 'notebook_readiness', subjectId: 'subj-1', notebookTypeId: 'type-1' }, recordedAt: '2026-09-15T00:00:00.000Z' }],
    };
    const editor = renderCellEditor(checkpoint, student, {});
    return editor.textContent;
  });
  assert.match(result, /Awarded \(teacher override\)/);
});

test('an active RETROACTIVE BACKFILL Readiness award shows "retroactive backfill" in its status text', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = { id: 'cp1', title: 'Unit 2', dueDate: '2026-09-10', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [{ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-05', reviewStatus: 'not_reviewed', badgeAwards: [] }] };
    const student = {
      id: 's1', name: 'Anjali',
      history: [{ id: 'h1', kind: 'readiness-champion', delta: 1, source: 'retroactive_backfill', workItemRef: { type: 'notebook_readiness', subjectId: 'subj-1', notebookTypeId: 'type-1' }, recordedAt: '2026-09-05T00:00:00.000Z' }],
    };
    const editor = renderCellEditor(checkpoint, student, {});
    return editor.textContent;
  });
  assert.match(result, /Awarded \(retroactive backfill\)/);
});

test('a REVOKED award (net zero) is treated as not-active -- shows "Not awarded" and the override button again, not Revoke', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = { id: 'cp1', title: 'Unit 2', dueDate: '2026-09-10', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [{ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-05', reviewStatus: 'not_reviewed', badgeAwards: [] }] };
    const ref = { type: 'notebook_readiness', subjectId: 'subj-1', notebookTypeId: 'type-1' };
    const student = {
      id: 's1', name: 'Anjali',
      history: [
        { id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: ref, recordedAt: '2026-09-05T00:00:00.000Z' },
        { id: 'h2', kind: 'readiness-champion', delta: -1, source: 'automatic', workItemRef: ref, reason: 'teacher_revoked', revokedBy: 'teacher-uid', recordedAt: '2026-09-06T00:00:00.000Z' },
      ],
    };
    const editor = renderCellEditor(checkpoint, student, {});
    const text = editor.textContent;
    const buttons = [...editor.querySelectorAll('button')].map((b) => b.textContent);
    return { text, buttons };
  });
  assert.match(result.text, /Not awarded/);
  assert.ok(result.buttons.includes('Award anyway (override)'));
  assert.ok(!result.buttons.includes('Revoke'));
});

test('a Readiness award recorded against a DIFFERENT notebook (different subjectId) is never shown as active here -- notebooks never cross-contaminate', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = { id: 'cp1', title: 'Unit 2', dueDate: '2026-09-10', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [{ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-05', reviewStatus: 'not_reviewed', badgeAwards: [] }] };
    const student = {
      id: 's1', name: 'Anjali',
      history: [{ id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: { type: 'notebook_readiness', subjectId: 'OTHER-SUBJECT', notebookTypeId: 'type-1' }, recordedAt: '2026-09-05T00:00:00.000Z' }],
    };
    const editor = renderCellEditor(checkpoint, student, {});
    const text = editor.textContent;
    const buttons = [...editor.querySelectorAll('button')].map((b) => b.textContent);
    return { text, buttons };
  });
  assert.match(result.text, /Not awarded/);
  assert.ok(result.buttons.includes('Award anyway (override)'));
});

test('clicking "Award anyway (override)" calls handlers.onOverrideReadiness with the checkpoint and student ids', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = { id: 'cp1', title: 'Unit 2', dueDate: '2026-09-10', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [{ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-15', reviewStatus: 'not_reviewed', badgeAwards: [] }] };
    const student = { id: 's1', name: 'Anjali', history: [] };
    const calls = [];
    const editor = renderCellEditor(checkpoint, student, { onOverrideReadiness: (checkpointId, studentId) => calls.push([checkpointId, studentId]) });
    [...editor.querySelectorAll('button')].find((b) => b.textContent === 'Award anyway (override)').click();
    return calls;
  });
  assert.deepEqual(result, [['cp1', 's1']]);
});

test('clicking "Revoke" calls handlers.onRevokeReadiness with the checkpoint and student ids', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = { id: 'cp1', title: 'Unit 2', dueDate: '2026-09-10', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [{ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-05', reviewStatus: 'not_reviewed', badgeAwards: [] }] };
    const student = {
      id: 's1', name: 'Anjali',
      history: [{ id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: { type: 'notebook_readiness', subjectId: 'subj-1', notebookTypeId: 'type-1' }, recordedAt: '2026-09-05T00:00:00.000Z' }],
    };
    const calls = [];
    const editor = renderCellEditor(checkpoint, student, { onRevokeReadiness: (checkpointId, studentId) => calls.push([checkpointId, studentId]) });
    [...editor.querySelectorAll('button')].find((b) => b.textContent === 'Revoke').click();
    return calls;
  });
  assert.deepEqual(result, [['cp1', 's1']]);
});
