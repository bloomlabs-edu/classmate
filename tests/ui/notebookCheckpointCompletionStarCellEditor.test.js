/**
 * tests/ui/notebookCheckpointCompletionStarCellEditor.test.js
 *
 * Regression coverage (WORK-0038) for the Completion Star section
 * inside ui/views/NotebookCheckpointsView.js's own renderCellEditor()
 * — drives that real, exported function directly in a real Chromium
 * page, same reasoning and harness as
 * tests/ui/notebookCheckpointReadinessCellEditor.test.js's own header
 * comment. Deliberately a separate file, not added to that one — these
 * two sections are entirely independent mechanisms (recognitionService.js
 * vs. notebookBadgeAwardService.js) and this file's own fixtures
 * (`student.history`-based) are structurally different from that file's
 * (`record.badgeAwards`-based).
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

test('REGRESSION (the original screenshot scenario): a submission marked Incomplete, with no star history, shows "Not awarded" and no Remove button', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = { id: 'cp1', subjectId: 'subj-1', notebookTypeId: 'type-1', title: 'U18 Organisation of Life', dueDate: '2026-09-10', records: [{ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-05', reviewStatus: 'incomplete', badgeAwards: [] }] };
    const student = { id: 's1', name: 'Anjali', score: 0, history: [] };
    const editor = renderCellEditor(checkpoint, student, {});
    const labels = [...editor.querySelectorAll('.notebook-checkpoints__cell-editor-section-label')].map((el) => el.textContent);
    const text = editor.textContent;
    const buttons = [...editor.querySelectorAll('button')].map((b) => b.textContent);
    return { hasCompletionStarLabel: labels.includes('Completion Star'), hasNotAwarded: text.includes('Not awarded'), buttons };
  });
  assert.equal(result.hasCompletionStarLabel, true);
  assert.equal(result.hasNotAwarded, true);
  assert.ok(!result.buttons.includes('Remove'));
});

test('a student who has not submitted at all shows "Not awarded" for Completion Star, no Remove button', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = { id: 'cp1', subjectId: 'subj-1', notebookTypeId: 'type-1', title: 'Unit 2', dueDate: '2026-09-10', records: [] };
    const student = { id: 's1', name: 'Anjali', score: 0, history: [] };
    const editor = renderCellEditor(checkpoint, student, {});
    const text = editor.textContent;
    const buttons = [...editor.querySelectorAll('button')].map((b) => b.textContent);
    return { hasNotAwarded: text.includes('Not awarded'), buttons };
  });
  assert.equal(result.hasNotAwarded, true);
  assert.ok(!result.buttons.includes('Remove'));
});

test('an active Completion Star (a real auto/points history entry for this exact checkpoint) shows "Awarded" and a Remove button', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = { id: 'cp1', subjectId: 'subj-1', notebookTypeId: 'type-1', title: 'Unit 2', dueDate: '2026-09-10', records: [{ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-05', reviewStatus: 'complete', badgeAwards: [] }] };
    const student = {
      id: 's1', name: 'Anjali', score: 1,
      history: [{ id: 'h1', kind: 'points', label: 'Completion Star', delta: 1, source: 'auto', workItemRef: { type: 'notebook_checkpoint', subjectId: 'subj-1', notebookTypeId: 'type-1', checkpointId: 'cp1' } }],
    };
    const editor = renderCellEditor(checkpoint, student, {});
    const text = editor.textContent;
    const buttons = [...editor.querySelectorAll('button')].map((b) => b.textContent);
    return { hasAwarded: text.includes('Awarded'), buttons };
  });
  assert.equal(result.hasAwarded, true);
  assert.ok(result.buttons.includes('Remove'));
});

test('a star belonging to a DIFFERENT checkpoint never shows as active here — work items are never conflated', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = { id: 'cp1', subjectId: 'subj-1', notebookTypeId: 'type-1', title: 'Unit 2', dueDate: '2026-09-10', records: [{ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-05', reviewStatus: 'complete', badgeAwards: [] }] };
    const student = {
      id: 's1', name: 'Anjali', score: 1,
      history: [{ id: 'h1', kind: 'points', label: 'Completion Star', delta: 1, source: 'auto', workItemRef: { type: 'notebook_checkpoint', subjectId: 'subj-1', notebookTypeId: 'type-1', checkpointId: 'OTHER-cp' } }],
    };
    const editor = renderCellEditor(checkpoint, student, {});
    const text = editor.textContent;
    const buttons = [...editor.querySelectorAll('button')].map((b) => b.textContent);
    return { hasNotAwarded: text.includes('Not awarded'), buttons };
  });
  assert.equal(result.hasNotAwarded, true);
  assert.ok(!result.buttons.includes('Remove'));
});

test('clicking "Remove" calls handlers.onRemoveCompletionStar with the checkpoint and student ids', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = { id: 'cp1', subjectId: 'subj-1', notebookTypeId: 'type-1', title: 'Unit 2', dueDate: '2026-09-10', records: [{ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-05', reviewStatus: 'complete', badgeAwards: [] }] };
    const student = {
      id: 's1', name: 'Anjali', score: 1,
      history: [{ id: 'h1', kind: 'points', label: 'Completion Star', delta: 1, source: 'auto', workItemRef: { type: 'notebook_checkpoint', subjectId: 'subj-1', notebookTypeId: 'type-1', checkpointId: 'cp1' } }],
    };
    const calls = [];
    const editor = renderCellEditor(checkpoint, student, { onRemoveCompletionStar: (checkpointId, studentId) => calls.push([checkpointId, studentId]) });
    [...editor.querySelectorAll('button')].find((b) => b.textContent === 'Remove').click();
    return calls;
  });
  assert.deepEqual(result, [['cp1', 's1']]);
});

test('Completion Star and Readiness Champion sections coexist independently in the same cell editor — an active one never implies or suppresses the other', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = {
      id: 'cp1', subjectId: 'subj-1', notebookTypeId: 'type-1', title: 'Unit 2', dueDate: '2026-09-10',
      records: [{
        studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-05', reviewStatus: 'complete',
        badgeAwards: [{ id: 'a1', badgeTypeId: 'readiness-champion', source: 'automatic', revoked: false }],
      }],
    };
    const student = {
      id: 's1', name: 'Anjali', score: 1,
      history: [], // Completion Star NOT awarded, even though Readiness Champion is
    };
    const editor = renderCellEditor(checkpoint, student, {});
    const labels = [...editor.querySelectorAll('.notebook-checkpoints__cell-editor-section-label')].map((el) => el.textContent);
    const text = editor.textContent;
    const buttons = [...editor.querySelectorAll('button')].map((b) => b.textContent);
    return { labels, text, buttons };
  });
  assert.ok(result.labels.includes('Readiness Champion'));
  assert.ok(result.labels.includes('Completion Star'));
  assert.match(result.text, /Awarded \(automatic — on time\)/); // Readiness Champion active
  assert.ok(result.buttons.includes('Revoke')); // Readiness Champion's own action
  assert.ok(!result.buttons.includes('Remove')); // Completion Star has nothing to remove
});
