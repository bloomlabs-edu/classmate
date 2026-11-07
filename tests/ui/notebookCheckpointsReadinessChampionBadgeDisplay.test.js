/**
 * tests/ui/notebookCheckpointsReadinessChampionBadgeDisplay.test.js
 *
 * Production display-discrepancy fix (2026-11-07): the student-row
 * badge chip for Readiness Champion (ui/views/NotebookCheckpointsView.js's
 * own populateStudentNameCell()) used to read
 * notebookBadgeService.listEarnedBadges()'s own legacy
 * student.notebookBadgeCounts['readiness-champion'] aggregate — a field
 * the new notebook-level award lifecycle
 * (services/notebookReadinessChampionService.js) never writes to on its
 * own terms and cannot reliably keep in sync for a student who was
 * never re-evaluated after this redesign shipped. This exercises the
 * REAL data-to-UI path (the actual exported populateStudentNameCell(),
 * a real Chromium DOM, a real stylesheet) rather than the counting
 * helper in isolation, same convention as the sibling
 * tests/ui/notebookCheckpointsStudentRow.test.js.
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

const READINESS_WORK_ITEM_REF_1 = { type: 'notebook_readiness', subjectId: 's1', notebookTypeId: 'nt1' };
const READINESS_WORK_ITEM_REF_2 = { type: 'notebook_readiness', subjectId: 's2', notebookTypeId: 'nt1' };

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

/** `history` entries use `kind: 'readiness-champion'` — the real new-ledger shape notebookReadinessChampionService.js itself writes. */
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

test('a legacy counter of 1 with NO active notebook-level award displays 0 (never shows the stale legacy count)', async () => {
  const student = buildStudent({ legacyCount: 1, history: [] });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.ok(!chips.some((c) => c.title === 'Readiness Champion'), 'must be entirely absent, not shown with count 0 or the stale legacy value');
});

test('one active notebook-level award (net +1) displays count 1, even though the legacy counter disagrees', async () => {
  const student = buildStudent({
    legacyCount: 0, // legacy counter says 0 -- the new ledger is the one that must win
    history: [{ id: 'h1', kind: 'readiness-champion', label: 'Readiness Champion', delta: 1, source: 'automatic', workItemRef: READINESS_WORK_ITEM_REF_1 }],
  });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.deepEqual(chips.find((c) => c.title === 'Readiness Champion'), { title: 'Readiness Champion', count: '1' });
});

test('two active awards for two different notebooks display count 2', async () => {
  const student = buildStudent({
    history: [
      { id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: READINESS_WORK_ITEM_REF_1 },
      { id: 'h2', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: READINESS_WORK_ITEM_REF_2 },
    ],
  });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.deepEqual(chips.find((c) => c.title === 'Readiness Champion'), { title: 'Readiness Champion', count: '2' });
});

test('multiple positive history entries for the SAME notebook never inflate the count past 1 for that notebook', async () => {
  const student = buildStudent({
    history: [
      // A genuinely impossible-in-practice but worth-guarding sequence:
      // two +1 automatic entries for the same notebook with no reversal
      // in between (e.g. a hypothetical double-write) must still count
      // as exactly one active notebook, never two.
      { id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: READINESS_WORK_ITEM_REF_1 },
      { id: 'h2', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: READINESS_WORK_ITEM_REF_1 },
    ],
  });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.deepEqual(chips.find((c) => c.title === 'Readiness Champion'), { title: 'Readiness Champion', count: '1' });
});

test('a fully reversed award (net back to 0) displays 0', async () => {
  const student = buildStudent({
    legacyCount: 1, // simulates the legacy counter never having been decremented in sync
    history: [
      { id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: READINESS_WORK_ITEM_REF_1 },
      { id: 'h2', kind: 'readiness-champion', delta: -1, source: 'automatic', workItemRef: READINESS_WORK_ITEM_REF_1, reason: 'notebook_incomplete' },
    ],
  });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.ok(!chips.some((c) => c.title === 'Readiness Champion'));
});

test('an incomplete notebook with no award history at all never appears in the count', async () => {
  // No readiness-champion history exists for this notebook at all --
  // confirms absence-of-award (not merely absence-of-completion) is
  // what the count reflects; this function never independently
  // re-evaluates completeness, it only counts what's already been
  // decided and recorded.
  const student = buildStudent({ legacyCount: 0, history: [] });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.ok(!chips.some((c) => c.title === 'Readiness Champion'));
});

test('an OVERRIDE-sourced active award (never automatic) still counts correctly -- the fix must not accidentally only recognize the automatic pool', async () => {
  const student = buildStudent({
    history: [{ id: 'h1', kind: 'readiness-champion', delta: 1, source: 'override', workItemRef: READINESS_WORK_ITEM_REF_1 }],
  });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.deepEqual(chips.find((c) => c.title === 'Readiness Champion'), { title: 'Readiness Champion', count: '1' });
});

test('a RETROACTIVE BACKFILL-sourced active award still counts correctly', async () => {
  const student = buildStudent({
    history: [{ id: 'h1', kind: 'readiness-champion', delta: 1, source: 'retroactive_backfill', workItemRef: READINESS_WORK_ITEM_REF_1 }],
  });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.deepEqual(chips.find((c) => c.title === 'Readiness Champion'), { title: 'Readiness Champion', count: '1' });
});

test('one notebook active via automatic AND a second notebook active via override never double-counts the first notebook or misses the second -- exactly 2', async () => {
  const student = buildStudent({
    history: [
      { id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: READINESS_WORK_ITEM_REF_1 },
      { id: 'h2', kind: 'readiness-champion', delta: 1, source: 'override', workItemRef: READINESS_WORK_ITEM_REF_2 },
    ],
  });
  const chips = await getBadgeChips(buildClassroom(), student);
  assert.deepEqual(chips.find((c) => c.title === 'Readiness Champion'), { title: 'Readiness Champion', count: '2' });
});

test('existing non-Readiness-Champion badge displays (legacy-counter-driven) remain completely unchanged, including when Readiness Champion is ALSO active in the same render', async () => {
  const student = buildStudent({
    organizationCount: 4,
    history: [{ id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: READINESS_WORK_ITEM_REF_1 }],
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

test('the cell-editor Readiness display and the row-level badge count now agree: an active notebook via getActiveReadinessSourcesForNotebook() is exactly the notebook counted here', async () => {
  const result = await page.evaluate(async ({ classroom, student, workItemRef }) => {
    const { populateStudentNameCell } = await import('/js/ui/views/NotebookCheckpointsView.js');
    const notebookReadinessChampionService = await import('/js/services/notebookReadinessChampionService.js');
    document.body.innerHTML = '';
    const cell = document.createElement('td');
    document.body.appendChild(cell);
    populateStudentNameCell(cell, student, { onSelectStudent: () => {} }, classroom.checkpoints, classroom);
    const chip = [...cell.querySelectorAll('.notebook-checkpoints__badge-chip')].find((c) => c.title === 'Readiness Champion');
    const rowCount = chip ? Number(chip.querySelector('.notebook-checkpoints__badge-chip-count').textContent) : 0;
    const cellEditorSources = notebookReadinessChampionService.getActiveReadinessSourcesForNotebook(student, workItemRef);
    return { rowCount, cellEditorActiveForThisNotebook: cellEditorSources.length > 0 };
  }, { classroom: buildClassroom(), student: buildStudent({ history: [{ id: 'h1', kind: 'readiness-champion', delta: 1, source: 'automatic', workItemRef: READINESS_WORK_ITEM_REF_1 }] }), workItemRef: READINESS_WORK_ITEM_REF_1 });

  assert.equal(result.rowCount, 1);
  assert.equal(result.cellEditorActiveForThisNotebook, true);
});
