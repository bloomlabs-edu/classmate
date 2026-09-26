/**
 * tests/ui/studentNameElement.test.js
 *
 * ui/components/StudentNameElement.js is the canonical, portal-wide
 * mechanism for "student identity -> student profile navigation" (see
 * that file's own header comment) — it creates real DOM elements via
 * `document.createElement`, so unlike this repo's usual pure-logic UI
 * tests (see tests/ui/notebookCheckpointsScoreCell.test.js's own header
 * comment on why THAT module needs no DOM), this one genuinely can't be
 * exercised under plain `node --test` without a real `document`. Rather
 * than hand-roll a fake DOM shim, this suite drives a real headless
 * Chromium page via Playwright (already a devDependency) serving this
 * repo's actual files — the same real browser engine used for this
 * feature's own live verification, just pointed at a static file server
 * instead of production. Import correctness is the actual open
 * question (does clicking the rendered element call back with the
 * right student, never conflating two students with the same name),
 * not visual layout.
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
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

/** Renders one createStudentNameElement() call in-page and returns a plain-object description of the result — never returns a live handle, since page.evaluate() can't serialize DOM nodes back to Node. */
async function renderStudentNameElement(student, { withOnSelect = true } = {}) {
  return page.evaluate(
    async ({ student, withOnSelect }) => {
      const { createStudentNameElement } = await import('/js/ui/components/StudentNameElement.js');
      window.__lastSelectedStudentId = null;
      const element = createStudentNameElement({
        student,
        onSelect: withOnSelect ? (selected) => { window.__lastSelectedStudentId = selected.id; } : undefined,
      });
      document.body.appendChild(element);
      const nestedInteractive = element.querySelectorAll('button, a').length; // element itself excluded — querySelectorAll only matches descendants
      const description = {
        tagName: element.tagName,
        isButton: element.tagName === 'BUTTON',
        type: element.getAttribute('type'),
        textContent: element.textContent.trim(),
        classList: [...element.classList],
        nestedInteractiveCount: nestedInteractive,
      };
      element.remove();
      return description;
    },
    { student, withOnSelect }
  );
}

async function clickAndGetSelectedId(student) {
  return page.evaluate(async (student) => {
    const { createStudentNameElement } = await import('/js/ui/components/StudentNameElement.js');
    let selectedId = null;
    const element = createStudentNameElement({ student, onSelect: (selected) => { selectedId = selected.id; } });
    document.body.appendChild(element);
    element.click();
    element.remove();
    return selectedId;
  }, student);
}

test('a valid student renders as a real, clickable <button> — not a plain span/div', async () => {
  const description = await renderStudentNameElement({ id: 'student-1', name: 'Bhavani' });
  assert.equal(description.isButton, true);
  assert.equal(description.type, 'button');
  assert.equal(description.textContent, 'Bhavani');
  assert.ok(description.classList.includes('student-name-element--clickable'));
});

test('clicking the rendered element calls onSelect with the correct student', async () => {
  const selectedId = await clickAndGetSelectedId({ id: 'student-42', name: 'Blessy' });
  assert.equal(selectedId, 'student-42');
});

test('SIMILAR-NAME ACCEPTANCE TEST: two students who share the exact same display name still navigate to their own distinct profiles, keyed by id', async () => {
  const studentA = { id: 'id-aaa', name: 'Sri' };
  const studentB = { id: 'id-bbb', name: 'Sri' }; // identical name, different id — the whole point of never keying navigation off the name

  const selectedForA = await clickAndGetSelectedId(studentA);
  const selectedForB = await clickAndGetSelectedId(studentB);

  assert.equal(selectedForA, 'id-aaa');
  assert.equal(selectedForB, 'id-bbb');
  assert.notEqual(selectedForA, selectedForB);
});

test('no invalid nested interactive elements — the rendered button contains no descendant <button> or <a>', async () => {
  const description = await renderStudentNameElement({ id: 'student-1', name: 'Dhiyasri' });
  assert.equal(description.nestedInteractiveCount, 0);
});

test('without an onSelect callback, the element renders as a plain, non-interactive <div> — existing non-clickable usages (e.g. the student profile page\'s own header) are unaffected', async () => {
  const description = await renderStudentNameElement({ id: 'student-1', name: 'Hareeksha' }, { withOnSelect: false });
  assert.equal(description.isButton, false);
  assert.equal(description.tagName, 'DIV');
  assert.ok(!description.classList.includes('student-name-element--clickable'));
});

/**
 * The Red/Yellow/Green/Not-Assessed swatch — Scorecard/Gradebook's own
 * assessment-PERFORMANCE bucket signal (see StudentNameElement.js's own
 * `performanceBucketKey` header comment), never the teacher-assigned
 * Learning Bucket. Renders one `leadingMarker: 'swatch'` call in-page and
 * returns the swatch's own colour + accessible name — colour is asserted
 * against config/bucketConfig.js's own BUCKET_ROW_STYLES border values
 * (the exact ones this component reads from), and the accessible name
 * against config/assessmentMarksColorConfig.js's own
 * getPerformanceBucketLabel() — so a screen-reader/tooltip user gets the
 * same state colour alone communicates to a sighted user (this feature's
 * own "never colour as the only channel" requirement).
 */
async function renderSwatch(performanceBucketKey) {
  return page.evaluate(
    async (performanceBucketKey) => {
      const { createStudentNameElement } = await import('/js/ui/components/StudentNameElement.js');
      const student = { id: 'swatch-student', name: 'Swatch Student' };
      const element = createStudentNameElement({ student, leadingMarker: 'swatch', performanceBucketKey });
      document.body.appendChild(element);
      const swatch = element.querySelector('.student-name-element__swatch');
      const result = {
        backgroundColor: swatch.style.backgroundColor,
        ariaLabel: swatch.getAttribute('aria-label'),
        nameText: element.querySelector('.student-name-element__name').textContent,
      };
      element.remove();
      return result;
    },
    performanceBucketKey
  );
}

test('RED student (below Pass Mark) renders the red swatch treatment with an accessible "Needs Help" label', async () => {
  const result = await renderSwatch('red');
  assert.equal(result.backgroundColor, 'rgb(201, 123, 123)'); // bucketConfig.js BUCKET_ROW_STYLES.red.border (#C97B7B)
  assert.equal(result.ariaLabel, 'Needs Help');
});

test('YELLOW student (Pass Mark to <70%) renders the yellow swatch treatment with an accessible "Developing" label', async () => {
  const result = await renderSwatch('yellow');
  assert.equal(result.backgroundColor, 'rgb(234, 179, 8)'); // bucketConfig.js BUCKET_ROW_STYLES.yellow.border (#EAB308)
  assert.equal(result.ariaLabel, 'Developing');
});

test('GREEN student (70%+) renders the green swatch treatment with an accessible "Strong" label', async () => {
  const result = await renderSwatch('green');
  assert.equal(result.backgroundColor, 'rgb(46, 125, 50)'); // bucketConfig.js BUCKET_ROW_STYLES.green.border (#2e7d32)
  assert.equal(result.ariaLabel, 'Strong');
});

test('NOT-ASSESSED student (no mark recorded — performanceBucketKey explicitly null) renders the NEUTRAL swatch treatment, never Red', async () => {
  const result = await renderSwatch(null);
  assert.equal(result.backgroundColor, 'rgb(154, 165, 177)'); // bucketConfig.js BUCKET_ROW_STYLES.notAssigned.border (#9AA5B1) — the neutral treatment
  assert.notEqual(result.backgroundColor, 'rgb(201, 123, 123)'); // must never silently collide with Red's own colour
  assert.equal(result.ariaLabel, 'Not Assessed');
});

test('student name text itself stays readable regardless of bucket colour — colour is never the only channel (name text content is unaffected by the swatch\'s own bucket state)', async () => {
  const red = await renderSwatch('red');
  const notAssessed = await renderSwatch(null);
  assert.equal(red.nameText, 'Swatch Student');
  assert.equal(notAssessed.nameText, 'Swatch Student');
});

/**
 * SCORECARD/GRADEBOOK TABLE-STRUCTURE CONTRACT: ui/views/ScorecardView.js's
 * own renderTable() mounts this exact `leadingMarker: 'swatch'` element
 * inside a real `<td>` (see that file's own assessment-gradebook__name-cell)
 * — this feature's own explicit requirement is that the Student column
 * stays a real table cell, never a card that breaks table semantics.
 * Verifies the element nests validly inside table markup (no block-level
 * wrapper that would visually or structurally break out of the cell), and
 * that clicking it fires only the identity's own onSelect — never anything
 * that could resemble a column-sort or bucket-filter side effect, since a
 * real header-sort listener lives on a completely separate `<th>` element
 * this click can't reach.
 */
test('SCORECARD TABLE STRUCTURE: mounted inside a real <td>, the swatch-mode element nests validly (table > tbody > tr > td > button) and clicking it calls only onSelect, once, with the right student — never a sort/filter side effect', async () => {
  const result = await page.evaluate(async () => {
    const { createStudentNameElement } = await import('/js/ui/components/StudentNameElement.js');
    const student = { id: 'row-1', name: 'Kavya' };
    let selectCount = 0;
    let selectedId = null;

    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.className = 'assessment-gradebook__name-cell';
    td.appendChild(
      createStudentNameElement({ student, onSelect: (s) => { selectCount += 1; selectedId = s.id; }, leadingMarker: 'swatch', performanceBucketKey: 'green' })
    );
    tr.appendChild(td);
    tbody.appendChild(tr);
    table.appendChild(tbody);
    document.body.appendChild(table);

    const button = td.querySelector('button.student-name-element');
    const structurallyValid = button && button.parentElement === td && td.parentElement === tr && tr.parentElement === tbody;
    button.click();

    const description = { structurallyValid, selectCount, selectedId, cellChildCount: td.children.length };
    table.remove();
    return description;
  });

  assert.equal(result.structurallyValid, true);
  assert.equal(result.selectCount, 1);
  assert.equal(result.selectedId, 'row-1');
  assert.equal(result.cellChildCount, 1); // exactly the identity element — no stray extra card markup in the cell
});
