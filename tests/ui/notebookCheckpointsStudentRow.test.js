/**
 * tests/ui/notebookCheckpointsStudentRow.test.js
 *
 * Regression coverage for the Notebook Tracker Student Row Redesign —
 * drives ui/views/NotebookCheckpointsView.js's own exported, real
 * building-block functions (populateStudentNameCell, buildStudentColumnHeader,
 * populateCheckpointCell) directly in a real Chromium page, same
 * reasoning as tests/ui/classModeStudentRow.test.js's own header
 * comment: no mocking, real DOM, a real stylesheet for computed-style
 * assertions (orange retint, pending-text styling).
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

function buildFixtureClassroomAndStudent() {
  return {
    classroom: {
      id: 'c1',
      checkpoints: [
        { id: 'cp1', subjectId: 's1', notebookTypeId: 'nt1', order: 0, title: 'Unit 1', givenDate: '2026-01-01', dueDate: '', records: [
          { id: 'r1', studentId: 'student-1', submissionStatus: 'submitted', submittedDate: '2026-01-02', reviewStatus: 'complete', reviewedDate: '2026-01-03', teacherNote: '' },
        ] },
        { id: 'cp2', subjectId: 's1', notebookTypeId: 'nt1', order: 1, title: 'Unit 2', givenDate: '2026-01-01', dueDate: '', records: [] },
      ],
      settings: {
        notebookBadgeTypes: [
          { id: 'organization', name: 'Organization', icon: 'folder', theme: 'green' },
          { id: 'punctuation-champion', name: 'Punctuation Champion', icon: 'quote', theme: 'blue' },
          { id: 'readiness-champion', name: 'Readiness Champion', icon: 'calendar-check', theme: 'purple' },
        ],
      },
    },
    student: {
      id: 'student-1',
      name: 'Anjali',
      score: 24,
      notebookBadgeCounts: { organization: 4, 'punctuation-champion': 3 }, // readiness-champion never earned
    },
  };
}

test('student name: clickable, calls onSelectStudent, never underlined even on hover', async () => {
  const result = await page.evaluate(async ({ classroom, student }) => {
    const { populateStudentNameCell } = await import('/js/ui/views/NotebookCheckpointsView.js');
    document.body.innerHTML = '';
    const cell = document.createElement('td');
    document.body.appendChild(cell);
    let selectedId = null;
    populateStudentNameCell(cell, student, { onSelectStudent: (id) => { selectedId = id; } }, classroom.checkpoints, classroom);

    const nameButton = cell.querySelector('.notebook-checkpoints__student-name');
    const decorationBefore = getComputedStyle(nameButton).textDecorationLine;

    nameButton.click();

    return { selectedId, decorationBefore, text: nameButton.textContent };
  }, buildFixtureClassroomAndStudent());

  assert.equal(result.selectedId, 'student-1');
  assert.equal(result.text, 'Anjali');
  assert.equal(result.decorationBefore, 'none');

  // Real :hover, not just a computed-style guess — confirms no hover rule reintroduces an underline.
  await page.hover('.notebook-checkpoints__student-name');
  const decorationOnHover = await page.locator('.notebook-checkpoints__student-name').evaluate((el) => getComputedStyle(el).textDecorationLine);
  assert.equal(decorationOnHover, 'none');
});

test('points: renders "⭐ 24 pts" from student.score, beside the name', async () => {
  const result = await page.evaluate(async ({ classroom, student }) => {
    const { populateStudentNameCell } = await import('/js/ui/views/NotebookCheckpointsView.js');
    document.body.innerHTML = '';
    const cell = document.createElement('td');
    document.body.appendChild(cell);
    populateStudentNameCell(cell, student, { onSelectStudent: () => {} }, classroom.checkpoints, classroom);
    const scoreEl = cell.querySelector('.notebook-checkpoints__student-score');
    return { text: scoreEl.textContent.trim() };
  }, buildFixtureClassroomAndStudent());

  assert.equal(result.text, '⭐24 pts');
});

test('badges: only earned types render, with the right count, and never an unearned type', async () => {
  const result = await page.evaluate(async ({ classroom, student }) => {
    const { populateStudentNameCell } = await import('/js/ui/views/NotebookCheckpointsView.js');
    document.body.innerHTML = '';
    const cell = document.createElement('td');
    document.body.appendChild(cell);
    populateStudentNameCell(cell, student, { onSelectStudent: () => {} }, classroom.checkpoints, classroom);
    const chips = [...cell.querySelectorAll('.notebook-checkpoints__badge-chip')];
    return chips.map((chip) => ({
      title: chip.title,
      count: chip.querySelector('.notebook-checkpoints__badge-chip-count').textContent,
    }));
  }, buildFixtureClassroomAndStudent());

  assert.deepEqual(result, [
    { title: 'Organization', count: '4' },
    { title: 'Punctuation Champion', count: '3' },
  ]);
  // Readiness Champion was never earned by this student — confirmed absent, not merely "not asserted".
  assert.ok(!result.some((b) => b.title === 'Readiness Champion'));
});

test('badges: no count ever renders with an "x" prefix', async () => {
  const result = await page.evaluate(async ({ classroom, student }) => {
    const { populateStudentNameCell } = await import('/js/ui/views/NotebookCheckpointsView.js');
    document.body.innerHTML = '';
    const cell = document.createElement('td');
    document.body.appendChild(cell);
    populateStudentNameCell(cell, student, { onSelectStudent: () => {} }, classroom.checkpoints, classroom);
    return [...cell.querySelectorAll('.notebook-checkpoints__badge-chip-count')].map((el) => el.textContent);
  }, buildFixtureClassroomAndStudent());

  result.forEach((count) => assert.doesNotMatch(count, /^x/i));
});

test('badges: a student with none earned shows no badge row at all', async () => {
  const result = await page.evaluate(async ({ classroom }) => {
    const { populateStudentNameCell } = await import('/js/ui/views/NotebookCheckpointsView.js');
    document.body.innerHTML = '';
    const cell = document.createElement('td');
    document.body.appendChild(cell);
    const studentWithNoBadges = { id: 'student-2', name: 'Bhavani', score: 0, notebookBadgeCounts: {} };
    populateStudentNameCell(cell, studentWithNoBadges, { onSelectStudent: () => {} }, classroom.checkpoints, classroom);
    return { badgesRowExists: !!cell.querySelector('.notebook-checkpoints__student-badges') };
  }, buildFixtureClassroomAndStudent());

  assert.equal(result.badgesRowExists, false);
});

test('badges: clicking a chip reveals the full badge name (click interaction, in addition to the native title tooltip)', async () => {
  const result = await page.evaluate(async ({ classroom, student }) => {
    const { populateStudentNameCell } = await import('/js/ui/views/NotebookCheckpointsView.js');
    document.body.innerHTML = '';
    const cell = document.createElement('td');
    document.body.appendChild(cell);
    populateStudentNameCell(cell, student, { onSelectStudent: () => {} }, classroom.checkpoints, classroom);
    const chip = cell.querySelector('.notebook-checkpoints__badge-chip');
    const beforeClick = !!chip.querySelector('.notebook-checkpoints__badge-chip-label');
    chip.click();
    const label = chip.querySelector('.notebook-checkpoints__badge-chip-label');
    return { beforeClick, afterClickText: label?.textContent, nativeTitle: chip.title };
  }, buildFixtureClassroomAndStudent());

  assert.equal(result.beforeClick, false);
  assert.equal(result.afterClickText, 'Organization');
  assert.equal(result.nativeTitle, 'Organization');
});

test('progress summary: "Status: X/Y" and "N pending" render correctly, with pending styled red, normal weight, same size as the rest', async () => {
  const result = await page.evaluate(async ({ classroom, student }) => {
    const { populateStudentNameCell } = await import('/js/ui/views/NotebookCheckpointsView.js');
    document.body.innerHTML = '';
    const cell = document.createElement('td');
    document.body.appendChild(cell);
    populateStudentNameCell(cell, student, { onSelectStudent: () => {} }, classroom.checkpoints, classroom);

    const summaryEl = cell.querySelector('.notebook-checkpoints__student-progress-summary');
    const pendingEl = cell.querySelector('.notebook-checkpoints__student-progress-pending');
    const summaryStyle = getComputedStyle(summaryEl);
    const pendingStyle = getComputedStyle(pendingEl);

    return {
      fullText: summaryEl.textContent.replace(/\s+/g, ' ').trim(),
      pendingText: pendingEl.textContent,
      pendingColor: pendingStyle.color,
      summaryColor: summaryStyle.color,
      pendingFontWeight: pendingStyle.fontWeight,
      pendingFontSize: pendingStyle.fontSize,
      summaryFontSize: summaryStyle.fontSize,
    };
  }, buildFixtureClassroomAndStudent());

  assert.equal(result.fullText, 'Status: 1/2 | 1 pending');
  assert.equal(result.pendingText, '1 pending');
  // Pending must actually be a different (red) colour from the rest of the line.
  assert.notEqual(result.pendingColor, result.summaryColor);
  // "Do not use bold" + "do not make it larger" — both checked directly against computed style.
  assert.ok(Number(result.pendingFontWeight) <= 400, `expected normal weight, got ${result.pendingFontWeight}`);
  assert.equal(result.pendingFontSize, result.summaryFontSize);
});

test('progress bar: present beneath the summary, width reflects percent complete', async () => {
  const result = await page.evaluate(async ({ classroom, student }) => {
    const { populateStudentNameCell } = await import('/js/ui/views/NotebookCheckpointsView.js');
    document.body.innerHTML = '';
    const cell = document.createElement('td');
    document.body.appendChild(cell);
    populateStudentNameCell(cell, student, { onSelectStudent: () => {} }, classroom.checkpoints, classroom);
    const bar = cell.querySelector('.notebook-checkpoints__student-progress-bar');
    const fill = cell.querySelector('.notebook-checkpoints__student-progress-bar-fill');
    return { barExists: !!bar, ariaValueNow: bar.getAttribute('aria-valuenow'), fillWidth: fill.style.width };
  }, buildFixtureClassroomAndStudent());

  assert.equal(result.barExists, true);
  assert.equal(result.ariaValueNow, '50'); // 1 of 2 complete
  assert.equal(result.fillWidth, '50%');
});

test('progress summary/bar: omitted entirely when this Notebook has no checkpoints yet (no fabricated 0/0)', async () => {
  const result = await page.evaluate(async ({ classroom, student }) => {
    const { populateStudentNameCell } = await import('/js/ui/views/NotebookCheckpointsView.js');
    document.body.innerHTML = '';
    const cell = document.createElement('td');
    document.body.appendChild(cell);
    populateStudentNameCell(cell, student, { onSelectStudent: () => {} }, [], classroom);
    return {
      summaryExists: !!cell.querySelector('.notebook-checkpoints__student-progress-summary'),
      barExists: !!cell.querySelector('.notebook-checkpoints__student-progress-bar'),
    };
  }, buildFixtureClassroomAndStudent());

  assert.equal(result.summaryExists, false);
  assert.equal(result.barExists, false);
});

test('Student column header: "+ Add Badge Type" action is present and wired to handlers.onAddBadgeType', async () => {
  const result = await page.evaluate(async () => {
    const { buildStudentColumnHeader } = await import('/js/ui/views/NotebookCheckpointsView.js');
    document.body.innerHTML = '';
    let called = false;
    const th = buildStudentColumnHeader('Student', { onAddBadgeType: () => { called = true; } });
    document.body.appendChild(th);
    th.querySelector('.notebook-checkpoints__add-badge-type-button').click();
    return { called, text: th.textContent };
  });

  assert.equal(result.called, true);
  assert.match(result.text, /Add Badge Type/);
});

test('orange retint: the Incomplete status icon now computes to a clear orange, not the old brown (#b7691a)', async () => {
  const color = await page.evaluate(() => {
    document.body.innerHTML = '';
    const span = document.createElement('span');
    span.className = 'notebook-checkpoints__status-icon notebook-checkpoints__status-icon--orange';
    document.body.appendChild(span);
    return getComputedStyle(span).backgroundColor;
  });

  assert.equal(color, 'rgb(242, 153, 74)'); // #F2994A
});

test('existing functionality preserved: a Not Submitted cell still shows "Mark Submitted" and still calls onQuickMarkSubmitted unchanged', async () => {
  const result = await page.evaluate(async ({ classroom, student }) => {
    const { populateCheckpointCell } = await import('/js/ui/views/NotebookCheckpointsView.js');
    document.body.innerHTML = '';
    const cell = document.createElement('td');
    document.body.appendChild(cell);
    let quickMarkArgs = null;
    const checkpointWithNoRecord = classroom.checkpoints[1]; // Unit 2 — no record for this student
    populateCheckpointCell(cell, checkpointWithNoRecord, student, {
      onOpenCell: () => {},
      onQuickMarkSubmitted: (checkpointId, studentId) => { quickMarkArgs = { checkpointId, studentId }; },
    });
    const quickMarkButton = cell.querySelector('.notebook-checkpoints__cell-quick-mark');
    const label = quickMarkButton.textContent;
    quickMarkButton.click();
    return { label, quickMarkArgs };
  }, buildFixtureClassroomAndStudent());

  assert.match(result.label, /Mark Submitted/);
  assert.deepEqual(result.quickMarkArgs, { checkpointId: 'cp2', studentId: 'student-1' });
});
