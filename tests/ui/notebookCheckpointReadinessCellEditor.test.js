/**
 * tests/ui/notebookCheckpointReadinessCellEditor.test.js
 *
 * Regression coverage for the Readiness Champion section inside
 * ui/views/NotebookCheckpointsView.js's own renderCellEditor() — drives
 * that real, exported function directly in a real Chromium page, same
 * reasoning as tests/ui/notebookCheckpointsStudentRow.test.js's own
 * header comment.
 *
 * Rewritten for the PERMANENT, PER-INSPECTION redesign (2026-11-07):
 * this section is now entirely READ-ONLY — no override, no revoke, no
 * action of any kind — and shows two deliberately separate things:
 *   - "N permanent badge(s) earned for this notebook" plus a per-
 *     inspection history list, derived from
 *     notebookReadinessChampionService.listReadinessChampionAchievementsForNotebook(),
 *     the NEW `notebook_readiness_inspection`-shaped ledger entries.
 *   - A separate "Previous system — historical awards" note for any
 *     OLD-shape (`notebook_readiness`) legacy entries, via
 *     listLegacyReadinessChampionEntriesForNotebook() — never merged
 *     into the count above, never reinterpreted.
 * renderCellEditor() now takes a 4th `classroom` argument (needed to
 * resolve each achievement's own triggering checkpoint's title) — see
 * that function's own header comment.
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

test('no Readiness history at all shows "No Readiness Champion badges yet for this notebook" and no legacy note', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const checkpoint = { id: 'cp1', title: 'Unit 2', dueDate: '2026-09-10', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [] };
    const classroom = { id: 'c1', checkpoints: [checkpoint] };
    const student = { id: 's1', name: 'Anjali', history: [] };
    const editor = renderCellEditor(checkpoint, student, {}, classroom);
    const labels = [...editor.querySelectorAll('.notebook-checkpoints__cell-editor-section-label')].map((el) => el.textContent);
    const text = editor.textContent;
    const buttons = [...editor.querySelectorAll('button')].map((b) => b.textContent);
    return { hasReadinessLabel: labels.includes('Readiness Champion (whole notebook)'), text, buttons };
  });
  assert.equal(result.hasReadinessLabel, true);
  assert.match(result.text, /No Readiness Champion badges yet for this notebook/);
  assert.ok(!result.text.includes('Previous system'));
  assert.ok(!result.buttons.includes('Revoke'));
  assert.ok(!result.buttons.includes('Award anyway (override)'), 'no override action exists any more -- the only way to earn a badge is a fresh checkpoint\'s own creation');
});

test('one permanent inspection-event achievement shows the count and its own triggering checkpoint title', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const priorCheckpoint = { id: 'cp1', title: 'Unit 1', dueDate: '2026-09-10', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [] };
    const triggeringCheckpoint = { id: 'cp2', title: 'Unit 2', dueDate: '2026-09-20', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [] };
    const classroom = { id: 'c1', checkpoints: [priorCheckpoint, triggeringCheckpoint] };
    const student = {
      id: 's1', name: 'Anjali',
      history: [{ id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: { type: 'notebook_readiness_inspection', subjectId: 'subj-1', notebookTypeId: 'type-1', checkpointId: 'cp2' }, recordedAt: '2026-09-20T00:00:00.000Z' }],
    };
    const editor = renderCellEditor(priorCheckpoint, student, {}, classroom);
    return editor.textContent;
  });
  assert.match(result, /1 permanent badge earned for this notebook/);
  assert.match(result, /Earned at "Unit 2"/, 'the history line names the checkpoint whose own creation triggered the inspection');
});

test('two permanent achievements for the same notebook (different triggering checkpoints) are both listed, and pluralize correctly', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const cp1 = { id: 'cp1', title: 'Unit 1', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [] };
    const cp2 = { id: 'cp2', title: 'Unit 2', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [] };
    const cp3 = { id: 'cp3', title: 'Unit 3', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [] };
    const classroom = { id: 'c1', checkpoints: [cp1, cp2, cp3] };
    const student = {
      id: 's1', name: 'Anjali',
      history: [
        { id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: { type: 'notebook_readiness_inspection', subjectId: 'subj-1', notebookTypeId: 'type-1', checkpointId: 'cp2' }, recordedAt: '2026-09-15T00:00:00.000Z' },
        { id: 'h2', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: { type: 'notebook_readiness_inspection', subjectId: 'subj-1', notebookTypeId: 'type-1', checkpointId: 'cp3' }, recordedAt: '2026-09-25T00:00:00.000Z' },
      ],
    };
    const editor = renderCellEditor(cp1, student, {}, classroom);
    const text = editor.textContent;
    const items = [...editor.querySelectorAll('.notebook-checkpoints__cell-editor-readiness-history li')].map((li) => li.textContent);
    return { text, items };
  });
  assert.match(result.text, /2 permanent badges earned for this notebook/);
  assert.equal(result.items.length, 2);
  assert.ok(result.items.some((t) => t.includes('Unit 2')));
  assert.ok(result.items.some((t) => t.includes('Unit 3')));
});

test('an achievement whose triggering checkpoint was since deleted still displays, without a checkpoint title', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const cp1 = { id: 'cp1', title: 'Unit 1', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [] };
    const classroom = { id: 'c1', checkpoints: [cp1] }; // the triggering checkpoint ('cp2') no longer exists
    const student = {
      id: 's1', name: 'Anjali',
      history: [{ id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: { type: 'notebook_readiness_inspection', subjectId: 'subj-1', notebookTypeId: 'type-1', checkpointId: 'cp2' }, recordedAt: '2026-09-20T00:00:00.000Z' }],
    };
    const editor = renderCellEditor(cp1, student, {}, classroom);
    return editor.textContent;
  });
  assert.match(result, /1 permanent badge earned for this notebook/, 'the permanent badge itself is unaffected by the triggering checkpoint later being deleted');
  assert.match(result, /triggering unit since removed/);
});

test('an achievement recorded against a DIFFERENT notebook (different subjectId) is never shown here -- notebooks never cross-contaminate', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const cp1 = { id: 'cp1', title: 'Unit 1', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [] };
    const classroom = { id: 'c1', checkpoints: [cp1] };
    const student = {
      id: 's1', name: 'Anjali',
      history: [{ id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: { type: 'notebook_readiness_inspection', subjectId: 'OTHER-SUBJECT', notebookTypeId: 'type-1', checkpointId: 'cp9' }, recordedAt: '2026-09-20T00:00:00.000Z' }],
    };
    const editor = renderCellEditor(cp1, student, {}, classroom);
    return editor.textContent;
  });
  assert.match(result, /No Readiness Champion badges yet for this notebook/);
});

test('a LEGACY (old-shape, pre-redesign) history entry shows as a separate, clearly-labeled "Previous system" note, never merged into the permanent-badge count', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const cp1 = { id: 'cp1', title: 'Unit 1', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [] };
    const classroom = { id: 'c1', checkpoints: [cp1] };
    const student = {
      id: 's1', name: 'Anjali',
      history: [{ id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: { type: 'notebook_readiness', subjectId: 'subj-1', notebookTypeId: 'type-1' }, recordedAt: '2026-09-05T00:00:00.000Z' }],
    };
    const editor = renderCellEditor(cp1, student, {}, classroom);
    return editor.textContent;
  });
  assert.match(result, /No Readiness Champion badges yet for this notebook/, 'the legacy entry is never counted as a new achievement');
  assert.match(result, /Previous system — historical awards: 1 record on file for this notebook/);
});

test('a legacy entry and a new achievement can coexist for the same notebook, each shown in its own, separate place', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const cp1 = { id: 'cp1', title: 'Unit 1', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [] };
    const cp2 = { id: 'cp2', title: 'Unit 2', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [] };
    const classroom = { id: 'c1', checkpoints: [cp1, cp2] };
    const student = {
      id: 's1', name: 'Anjali',
      history: [
        { id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: { type: 'notebook_readiness', subjectId: 'subj-1', notebookTypeId: 'type-1' }, recordedAt: '2026-08-01T00:00:00.000Z' },
        { id: 'h2', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: { type: 'notebook_readiness_inspection', subjectId: 'subj-1', notebookTypeId: 'type-1', checkpointId: 'cp2' }, recordedAt: '2026-09-20T00:00:00.000Z' },
      ],
    };
    const editor = renderCellEditor(cp1, student, {}, classroom);
    return editor.textContent;
  });
  assert.match(result, /1 permanent badge earned for this notebook/);
  assert.match(result, /Previous system — historical awards: 1 record on file for this notebook/);
});

test('no action buttons of any kind exist in this section -- it is entirely read-only', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const cp1 = { id: 'cp1', title: 'Unit 1', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [] };
    const classroom = { id: 'c1', checkpoints: [cp1] };
    const student = {
      id: 's1', name: 'Anjali',
      history: [{ id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: { type: 'notebook_readiness_inspection', subjectId: 'subj-1', notebookTypeId: 'type-1', checkpointId: 'cp1' }, recordedAt: '2026-09-01T00:00:00.000Z' }],
    };
    const editor = renderCellEditor(cp1, student, {}, classroom);
    return [...editor.querySelectorAll('button')].map((b) => b.textContent);
  });
  assert.ok(!result.includes('Revoke'));
  assert.ok(!result.includes('Award anyway (override)'));
});

test('a Founding Recognition entry for this notebook shows its own, separate, read-only section with no action buttons', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const cp1 = { id: 'cp1', title: 'Unit 1', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [] };
    const classroom = { id: 'c1', checkpoints: [cp1] };
    const student = {
      id: 's1', name: 'Anjali',
      history: [{ id: 'f1', kind: 'founding-recognition', label: 'Founding Recognition', delta: 1, source: 'historical_transition', workItemRef: { type: 'founding_recognition', subjectId: 'subj-1', notebookTypeId: 'type-1' }, cutoffIso: '2026-11-07T11:48:47Z', recordedAt: '2026-11-08T00:00:00.000Z' }],
    };
    const editor = renderCellEditor(cp1, student, {}, classroom);
    const labels = [...editor.querySelectorAll('.notebook-checkpoints__cell-editor-section-label')].map((el) => el.textContent);
    return { text: editor.textContent, labels, buttons: [...editor.querySelectorAll('button')].map((b) => b.textContent) };
  });
  assert.ok(result.labels.includes('Founding Recognition'));
  assert.match(result.text, /1 historical achievement recognized for this notebook/);
  assert.match(result.text, /2026-11-07/);
  assert.ok(!result.buttons.includes('Revoke'));
  assert.ok(!result.buttons.includes('Award anyway (override)'));
});

test('no Founding Recognition history for this notebook shows no Founding Recognition section at all', async () => {
  const result = await page.evaluate(async () => {
    const { renderCellEditor } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const cp1 = { id: 'cp1', title: 'Unit 1', subjectId: 'subj-1', notebookTypeId: 'type-1', records: [] };
    const classroom = { id: 'c1', checkpoints: [cp1] };
    const student = { id: 's1', name: 'Anjali', history: [] };
    const editor = renderCellEditor(cp1, student, {}, classroom);
    return [...editor.querySelectorAll('.notebook-checkpoints__cell-editor-section-label')].map((el) => el.textContent);
  });
  assert.ok(!result.includes('Founding Recognition'));
});
