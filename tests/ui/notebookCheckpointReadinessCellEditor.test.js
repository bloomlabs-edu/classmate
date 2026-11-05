/**
 * tests/ui/notebookCheckpointReadinessCellEditor.test.js
 *
 * Regression coverage for the Readiness Champion override/revoke
 * section inside ui/views/NotebookCheckpointsView.js's own
 * renderCellEditor() — drives that real, exported function directly in
 * a real Chromium page, same reasoning as
 * tests/ui/notebookCheckpointsStudentRow.test.js's own header comment.
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

test('a student who has not submitted shows "Not awarded" with no override/revoke button at all', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = { id: 'cp1', title: 'Unit 2', dueDate: '2026-09-10', records: [] };
    const student = { id: 's1', name: 'Anjali' };
    const editor = renderCellEditor(checkpoint, student, {});
    const labels = [...editor.querySelectorAll('.notebook-checkpoints__cell-editor-section-label')].map((el) => el.textContent);
    const actionsButtons = [...editor.querySelectorAll('button')].map((b) => b.textContent);
    return { hasReadinessLabel: labels.includes('Readiness Champion'), actionsButtons };
  });
  assert.equal(result.hasReadinessLabel, true);
  assert.ok(!result.actionsButtons.includes('Award anyway (override)'));
  assert.ok(!result.actionsButtons.includes('Revoke'));
});

test('a submitted student with no active Readiness award shows "Not awarded" and an "Award anyway (override)" button', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = { id: 'cp1', title: 'Unit 2', dueDate: '2026-09-10', records: [{ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-15', reviewStatus: 'not_reviewed', badgeAwards: [] }] };
    const student = { id: 's1', name: 'Anjali' };
    const editor = renderCellEditor(checkpoint, student, {});
    const text = editor.textContent;
    const buttons = [...editor.querySelectorAll('button')].map((b) => b.textContent);
    return { hasNotAwarded: text.includes('Not awarded'), buttons };
  });
  assert.equal(result.hasNotAwarded, true);
  assert.ok(result.buttons.includes('Award anyway (override)'));
  assert.ok(!result.buttons.includes('Revoke'));
});

test('an active AUTOMATIC Readiness award shows the correct status text and a Revoke button, never an override button', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = {
      id: 'cp1', title: 'Unit 2', dueDate: '2026-09-10',
      records: [{
        studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-05', reviewStatus: 'not_reviewed',
        badgeAwards: [{ id: 'a1', badgeTypeId: 'readiness-champion', source: 'automatic', revoked: false }],
      }],
    };
    const student = { id: 's1', name: 'Anjali' };
    const editor = renderCellEditor(checkpoint, student, {});
    const text = editor.textContent;
    const buttons = [...editor.querySelectorAll('button')].map((b) => b.textContent);
    return { text, buttons };
  });
  assert.match(result.text, /Awarded \(automatic — on time\)/);
  assert.ok(result.buttons.includes('Revoke'));
  assert.ok(!result.buttons.includes('Award anyway (override)'));
});

test('an active OVERRIDE Readiness award shows "teacher override" in its status text', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = {
      id: 'cp1', title: 'Unit 2', dueDate: '2026-09-10',
      records: [{
        studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-15', reviewStatus: 'not_reviewed',
        badgeAwards: [{ id: 'a1', badgeTypeId: 'readiness-champion', source: 'override', revoked: false }],
      }],
    };
    const student = { id: 's1', name: 'Anjali' };
    const editor = renderCellEditor(checkpoint, student, {});
    return editor.textContent;
  });
  assert.match(result, /Awarded \(teacher override\)/);
});

test('a REVOKED award is treated as not-active — shows "Not awarded" and the override button again, not Revoke', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = {
      id: 'cp1', title: 'Unit 2', dueDate: '2026-09-10',
      records: [{
        studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-05', reviewStatus: 'not_reviewed',
        badgeAwards: [{ id: 'a1', badgeTypeId: 'readiness-champion', source: 'automatic', revoked: true, revokedBy: 'teacher-uid', revokedAt: '2026-09-06T00:00:00.000Z' }],
      }],
    };
    const student = { id: 's1', name: 'Anjali' };
    const editor = renderCellEditor(checkpoint, student, {});
    const text = editor.textContent;
    const buttons = [...editor.querySelectorAll('button')].map((b) => b.textContent);
    return { text, buttons };
  });
  assert.match(result.text, /Not awarded/);
  assert.ok(result.buttons.includes('Award anyway (override)'));
  assert.ok(!result.buttons.includes('Revoke'));
});

test('clicking "Award anyway (override)" calls handlers.onOverrideReadiness with the checkpoint and student ids', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = { id: 'cp1', title: 'Unit 2', dueDate: '2026-09-10', records: [{ studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-15', reviewStatus: 'not_reviewed', badgeAwards: [] }] };
    const student = { id: 's1', name: 'Anjali' };
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
    const checkpoint = {
      id: 'cp1', title: 'Unit 2', dueDate: '2026-09-10',
      records: [{
        studentId: 's1', submissionStatus: 'submitted', submittedDate: '2026-09-05', reviewStatus: 'not_reviewed',
        badgeAwards: [{ id: 'a1', badgeTypeId: 'readiness-champion', source: 'automatic', revoked: false }],
      }],
    };
    const student = { id: 's1', name: 'Anjali' };
    const calls = [];
    const editor = renderCellEditor(checkpoint, student, { onRevokeReadiness: (checkpointId, studentId) => calls.push([checkpointId, studentId]) });
    [...editor.querySelectorAll('button')].find((b) => b.textContent === 'Revoke').click();
    return calls;
  });
  assert.deepEqual(result, [['cp1', 's1']]);
});
