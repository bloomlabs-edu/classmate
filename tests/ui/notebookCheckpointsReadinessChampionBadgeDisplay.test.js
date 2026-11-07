/**
 * tests/ui/notebookCheckpointsReadinessChampionBadgeDisplay.test.js
 *
 * PERMANENT, PER-INSPECTION Readiness Champion redesign (2026-11-07):
 * the student-row badge chip (ui/views/NotebookCheckpointsView.js's own
 * populateStudentNameCell()) now shows TWO separate things for this
 * badge type:
 *   - "Readiness Champion" — a plain, ever-increasing total of
 *     permanent per-inspection badges (notebookReadinessChampionService.js's
 *     own countReadinessChampionAchievementsForStudent()), never capped
 *     at one per notebook, never net-summed, never reduced.
 *   - "Previous system — historical awards" — a SEPARATE chip for any
 *     OLD-shape (pre-redesign, `notebook_readiness`) legacy history
 *     this student still carries, read in the OLD model's own net-sum
 *     terms (countActiveReadinessChampionNotebooksForStudent()), never
 *     merged into the count above.
 * Exercises the REAL data-to-UI path (the actual exported
 * populateStudentNameCell(), a real Chromium DOM, a real stylesheet)
 * rather than the counting helpers in isolation, same convention as the
 * sibling tests/ui/notebookCheckpointsStudentRow.test.js.
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
      res.end('<!doctype html><html><head><link rel="stylesheet" href="/css/styles.css"></head><body></body></html>');
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
  await page.goto('http://127.0.0.1:' + port + '/');
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

const INSPECTION_REF_1 = { type: 'notebook_readiness_inspection', subjectId: 's1', notebookTypeId: 'nt1', checkpointId: 'cp-a' };
const INSPECTION_REF_1_LATER = { type: 'notebook_readiness_inspection', subjectId: 's1', notebookTypeId: 'nt1', checkpointId: 'cp-b' };
const INSPECTION_REF_2 = { type: 'notebook_readiness_inspection', subjectId: 's2', notebookTypeId: 'nt1', checkpointId: 'cp-c' };
const LEGACY_REF_1 = { type: 'notebook_readiness', subjectId: 's1', notebookTypeId: 'nt1' };

function buildClassroom() {
  return {
    id: 'c1',
    checkpoints: [],
    settings: {
      notebookBadgeTypes: [
        { id: 'organization', name: 'Organization', icon: 'folder', theme: 'green' },
        { id: 'readiness-champion', name: 'Readiness Champion', icon: 'calendar-check', theme: 'purple' },
      ],
    },
  };
}

function buildStudent({ legacyCount = 0, history = [], organizationCount = 0 } = {}) {
  return {
    id: 'student-1',
    name: 'Test Student',
    score: 0,
    notebookBadgeCounts: { 'readiness-champion': legacyCount, organization: organizationCount },
    history,
  };
}

async function getBadgeChips(classroom, student) {
  return page.evaluate(
    async ({ classroom, student }) => {
      const { populateStudentNameCell } = await import('/js/ui/views/NotebookCheckpointsView.js');
      document.body.innerHTML = '';
      const cell = document.createElement('td');
      document.body.appendChild(cell);
      populateStudentNameCell(cell, student, { onSelectStudent: () => {} }, classroom.checkpoints, classroom);
      return [...cell.querySelectorAll('.notebook-checkpoints__badge-chip')].map((chip) => ({
        title: chip.title,
        count: chip.querySelector('.notebook-checkpoints__badge-chip-count').textContent,
      }));
    },
    { classroom, student }
  );
}

test('no history at all shows no Readiness Champion chip and no legacy chip', async () => {
  const student = buildStudent({ history: [] });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.ok(!chips.some((c) => c.title === 'Readiness Champion'));
  assert.ok(!chips.some((c) => c.title === 'Previous system — historical awards'));
});

test('a disconnected legacy notebookBadgeCounts field is never shown -- only the real ledger-derived counts matter', async () => {
  const student = buildStudent({ legacyCount: 5, history: [] });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.ok(!chips.some((c) => c.title === 'Readiness Champion'));
  assert.ok(!chips.some((c) => c.title === 'Previous system — historical awards'));
});

test('one permanent inspection-event achievement displays "Readiness Champion" with count 1', async () => {
  const student = buildStudent({
    history: [{ id: 'h1', kind: 'readiness-champion', label: 'Readiness Champion', delta: 1, source: 'automatic', workItemRef: INSPECTION_REF_1 }],
  });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.deepEqual(chips.find((c) => c.title === 'Readiness Champion'), { title: 'Readiness Champion', count: '1' });
});

test('TWO permanent achievements for the SAME notebook (two distinct triggering checkpoints) display count 2 -- never capped at one per notebook', async () => {
  const student = buildStudent({
    history: [
      { id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: INSPECTION_REF_1 },
      { id: 'h2', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: INSPECTION_REF_1_LATER },
    ],
  });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.deepEqual(chips.find((c) => c.title === 'Readiness Champion'), { title: 'Readiness Champion', count: '2' });
});

test('two achievements across two different notebooks also display count 2', async () => {
  const student = buildStudent({
    history: [
      { id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: INSPECTION_REF_1 },
      { id: 'h2', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: INSPECTION_REF_2 },
    ],
  });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.deepEqual(chips.find((c) => c.title === 'Readiness Champion'), { title: 'Readiness Champion', count: '2' });
});

test('an exact duplicate inspection-event entry (defensive -- should never occur in practice) still counts every entry present, since this chip is a plain history count, not a dedupe', async () => {
  // Deliberately distinct from the OLD model's own "never inflate past
  // 1 per notebook" guarantee -- under the new permanent model, the
  // duplicate-prevention guarantee lives in
  // inspectReadinessChampionOnNewCheckpoint() itself (one entry per
  // exact checkpointId), not in this display count, which simply
  // counts whatever is genuinely on the ledger.
  const student = buildStudent({
    history: [
      { id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: INSPECTION_REF_1 },
      { id: 'h2', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: INSPECTION_REF_1 },
    ],
  });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.deepEqual(chips.find((c) => c.title === 'Readiness Champion'), { title: 'Readiness Champion', count: '2' });
});

test('a LEGACY (old-shape, pre-redesign) history entry never counts toward "Readiness Champion" -- it surfaces only as the separate "Previous system" chip', async () => {
  const student = buildStudent({
    history: [{ id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: LEGACY_REF_1 }],
  });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.ok(!chips.some((c) => c.title === 'Readiness Champion'));
  assert.deepEqual(chips.find((c) => c.title === 'Previous system — historical awards'), { title: 'Previous system — historical awards', count: '1' });
});

test('a legacy entry later net-reversed under the old model shows no "Previous system" chip either (net zero)', async () => {
  const student = buildStudent({
    history: [
      { id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: LEGACY_REF_1 },
      { id: 'h2', kind: 'readiness-champion', delta: -1, source: 'automatic', workItemRef: LEGACY_REF_1, reason: 'notebook_incomplete' },
    ],
  });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.ok(!chips.some((c) => c.title === 'Previous system — historical awards'));
});

test('a legacy chip and a new achievement chip can both appear at once, as two separate chips, never merged into one count', async () => {
  const student = buildStudent({
    history: [
      { id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: LEGACY_REF_1 },
      { id: 'h2', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: INSPECTION_REF_2 },
    ],
  });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.deepEqual(chips.find((c) => c.title === 'Readiness Champion'), { title: 'Readiness Champion', count: '1' });
  assert.deepEqual(chips.find((c) => c.title === 'Previous system — historical awards'), { title: 'Previous system — historical awards', count: '1' });
});

test('an OVERRIDE- or RETROACTIVE-BACKFILL-sourced new achievement counts identically to an automatic one -- the display never only recognizes one source', async () => {
  const student = buildStudent({
    history: [{ id: 'h1', kind: 'readiness-champion', delta: 1, source: 'override', workItemRef: INSPECTION_REF_1 }],
  });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.deepEqual(chips.find((c) => c.title === 'Readiness Champion'), { title: 'Readiness Champion', count: '1' });
});

test('existing non-Readiness-Champion badge displays (legacy-counter-driven) remain completely unchanged, including when Readiness Champion is ALSO active in the same render', async () => {
  const student = buildStudent({
    organizationCount: 4,
    history: [{ id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: INSPECTION_REF_1 }],
  });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.deepEqual(
    chips.sort((a, b) => a.title.localeCompare(b.title)),
    [
      { title: 'Organization', count: '4' },
      { title: 'Readiness Champion', count: '1' },
    ]
  );
});

test('the cell-editor achievement listing and the row-level badge count now agree on the same notebook', async () => {
  const result = await page.evaluate(
    async ({ classroom, student, subjectId, notebookTypeId }) => {
      const { populateStudentNameCell } = await import('/js/ui/views/NotebookCheckpointsView.js');
      const notebookReadinessChampionService = await import('/js/services/notebookReadinessChampionService.js');
      document.body.innerHTML = '';
      const cell = document.createElement('td');
      document.body.appendChild(cell);
      populateStudentNameCell(cell, student, { onSelectStudent: () => {} }, classroom.checkpoints, classroom);
      const chip = [...cell.querySelectorAll('.notebook-checkpoints__badge-chip')].find((c) => c.title === 'Readiness Champion');
      const rowCount = chip ? Number(chip.querySelector('.notebook-checkpoints__badge-chip-count').textContent) : 0;
      const achievementCount = notebookReadinessChampionService.countReadinessChampionAchievementsForStudent(student, { subjectId, notebookTypeId });
      return { rowCount, achievementCount };
    },
    {
      classroom: buildClassroom(),
      student: buildStudent({ history: [{ id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: INSPECTION_REF_1 }] }),
      subjectId: INSPECTION_REF_1.subjectId,
      notebookTypeId: INSPECTION_REF_1.notebookTypeId,
    }
  );

  assert.equal(result.rowCount, 1);
  assert.equal(result.achievementCount, 1);
});

// ---------------------------------------------------------------------
// Founding Recognition (2026-11-07) — its own third, separately-labeled
// chip, never merged into either the "Readiness Champion" or "Previous
// system" counts above.
// ---------------------------------------------------------------------

const FOUNDING_REF_1 = { type: 'founding_recognition', subjectId: 's1', notebookTypeId: 'nt1' };
const FOUNDING_REF_2 = { type: 'founding_recognition', subjectId: 's2', notebookTypeId: 'nt1' };

test('a Founding Recognition entry displays its own chip, separate from "Readiness Champion" and "Previous system"', async () => {
  const student = buildStudent({
    history: [{ id: 'f1', kind: 'founding-recognition', label: 'Founding Recognition', delta: 1, source: 'historical_transition', workItemRef: FOUNDING_REF_1, cutoffIso: '2026-11-07T11:48:47Z' }],
  });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.deepEqual(chips.find((c) => c.title === 'Founding Recognition'), { title: 'Founding Recognition', count: '1' });
  assert.ok(!chips.some((c) => c.title === 'Readiness Champion'));
  assert.ok(!chips.some((c) => c.title === 'Previous system — historical awards'));
});

test('two Founding Recognition entries across two different notebooks display count 2', async () => {
  const student = buildStudent({
    history: [
      { id: 'f1', kind: 'founding-recognition', delta: 1, source: 'historical_transition', workItemRef: FOUNDING_REF_1 },
      { id: 'f2', kind: 'founding-recognition', delta: 1, source: 'historical_transition', workItemRef: FOUNDING_REF_2 },
    ],
  });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.deepEqual(chips.find((c) => c.title === 'Founding Recognition'), { title: 'Founding Recognition', count: '2' });
});

test('Founding Recognition, new-model Readiness Champion, and legacy chips can all appear at once, each with its own independent count', async () => {
  const student = buildStudent({
    legacyCount: 0,
    history: [
      { id: 'f1', kind: 'founding-recognition', delta: 1, source: 'historical_transition', workItemRef: FOUNDING_REF_1 },
      { id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: INSPECTION_REF_2 },
      { id: 'legacy-1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: LEGACY_REF_1 },
    ],
  });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.deepEqual(chips.find((c) => c.title === 'Founding Recognition'), { title: 'Founding Recognition', count: '1' });
  assert.deepEqual(chips.find((c) => c.title === 'Readiness Champion'), { title: 'Readiness Champion', count: '1' });
  assert.deepEqual(chips.find((c) => c.title === 'Previous system — historical awards'), { title: 'Previous system — historical awards', count: '1' });
});

test('no Founding Recognition history at all shows no Founding Recognition chip', async () => {
  const student = buildStudent({ history: [] });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.ok(!chips.some((c) => c.title === 'Founding Recognition'));
});
