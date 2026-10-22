/**
 * tests/ui/addExistingStudentsModal.test.js
 *
 * ui/components/AddExistingStudentsModal.js creates real DOM (an
 * overlay + modal + a reused StudentMultiSelect instance that gets
 * rebuilt on every search keystroke) — same reasoning as
 * tests/ui/studentNameElement.test.js's own header comment on why this
 * can't be exercised under plain `node --test` without a real
 * `document`. Drives a real headless Chromium page via Playwright,
 * serving this repo's actual files from a local static server — no
 * Firestore, no production, nothing written anywhere outside the page.
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
    // Deliberately NOT the real index.html — this suite only needs a
    // same-origin document so page.evaluate() can `import()` this
    // component module directly (which has no dependency on the app
    // shell at all). Serving a blank page keeps this test fully clear
    // of main.js's own Firebase bootstrap, matching this repo's "never
    // touch production Firestore from a test" rule.
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
  await page.goto(`http://127.0.0.1:${port}/`);
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

function buildFixtureClassroom() {
  return {
    id: 'classroom-1',
    teams: [
      {
        id: 'team-blue',
        name: 'Blue Team',
        students: [
          { id: 's-blue-1', name: 'Already Here' },
        ],
      },
      {
        id: 'team-red',
        name: 'Red Team',
        students: [
          { id: 's-red-1', name: 'Anjali' },
          { id: 's-red-2', name: 'Ankit' },
          { id: 's-red-3', name: 'Bhavani' },
        ],
      },
      {
        id: 'ungrouped',
        name: 'Ungrouped',
        isUngrouped: true,
        students: [{ id: 's-ungrouped-1', name: 'Chetan' }],
      },
    ],
  };
}

/** Opens the modal in-page for `targetTeamId` and returns a description of its rendered state. */
async function openModalAndDescribe(classroom, targetTeamId) {
  return page.evaluate(
    async ({ classroom, targetTeamId }) => {
      const { openAddExistingStudentsModal } = await import('/js/ui/components/AddExistingStudentsModal.js');
      const targetTeam = classroom.teams.find((t) => t.id === targetTeamId);
      window.__onConfirmCalls = [];
      document.querySelectorAll('.modal-overlay').forEach((el) => el.remove()); // this page is reused across tests — clear any prior test's unclosed overlay first
      openAddExistingStudentsModal({
        classroom,
        targetTeam,
        onConfirm: (ids) => window.__onConfirmCalls.push(ids),
      });
      const overlay = document.querySelector('.modal-overlay');
      const rows = [...overlay.querySelectorAll('.student-multi-select__row')].map((row) => row.textContent.trim());
      const hasTextInputForNewName = !!overlay.querySelector('input[placeholder="Student name"]');
      return {
        hasOverlay: !!overlay,
        rows,
        hasSearchInput: !!overlay.querySelector('.add-existing-students-modal__search'),
        hasTextInputForNewName, // the "create new" flow's own input — must never appear here
        confirmText: overlay.querySelector('.btn--primary').textContent,
        confirmDisabled: overlay.querySelector('.btn--primary').disabled,
      };
    },
    { classroom, targetTeamId }
  );
}

test('excludes students already in the target team from the picker entirely', async () => {
  const result = await openModalAndDescribe(buildFixtureClassroom(), 'team-blue');
  assert.equal(result.hasOverlay, true);
  assert.equal(result.rows.some((text) => text.includes('Already Here')), false);
  // Everyone else in the classroom IS pickable.
  assert.equal(result.rows.some((text) => text.includes('Anjali')), true);
  assert.equal(result.rows.some((text) => text.includes('Chetan')), true);
});

test('renders a search input for search-as-you-type, and never the "create new student" name field', async () => {
  const result = await openModalAndDescribe(buildFixtureClassroom(), 'team-blue');
  assert.equal(result.hasSearchInput, true);
  assert.equal(result.hasTextInputForNewName, false);
});

test('confirm button starts disabled with nothing selected, and is correctly labelled', async () => {
  const result = await openModalAndDescribe(buildFixtureClassroom(), 'team-blue');
  assert.equal(result.confirmDisabled, true);
  assert.equal(result.confirmText, 'Add Students');
});

test('selecting multiple existing students and confirming reports all of their ids back exactly once', async () => {
  const selectedIds = await page.evaluate(async (classroom) => {
    const { openAddExistingStudentsModal } = await import('/js/ui/components/AddExistingStudentsModal.js');
    const targetTeam = classroom.teams.find((t) => t.id === 'team-blue');
    let calls = [];
    document.querySelectorAll('.modal-overlay').forEach((el) => el.remove()); // this page is reused across tests — clear any prior test's unclosed overlay first
    openAddExistingStudentsModal({ classroom, targetTeam, onConfirm: (ids) => calls.push(ids) });

    const overlay = document.querySelector('.modal-overlay');
    const checkboxes = [...overlay.querySelectorAll('.student-multi-select__checkbox')];
    const rows = [...overlay.querySelectorAll('.student-multi-select__row')];
    const anjaliIndex = rows.findIndex((row) => row.textContent.includes('Anjali'));
    const chetanIndex = rows.findIndex((row) => row.textContent.includes('Chetan'));
    checkboxes[anjaliIndex].click();
    checkboxes[chetanIndex].click();

    overlay.querySelector('.btn--primary').click();
    return calls;
  }, buildFixtureClassroom());

  assert.equal(selectedIds.length, 1); // onConfirm called exactly once
  assert.deepEqual(selectedIds[0].sort(), ['s-red-1', 's-ungrouped-1'].sort());
});

test('search filters the visible list and preserves a prior selection made before filtering', async () => {
  const result = await page.evaluate(async (classroom) => {
    const { openAddExistingStudentsModal } = await import('/js/ui/components/AddExistingStudentsModal.js');
    const targetTeam = classroom.teams.find((t) => t.id === 'team-blue');
    let calls = [];
    document.querySelectorAll('.modal-overlay').forEach((el) => el.remove()); // this page is reused across tests — clear any prior test's unclosed overlay first
    openAddExistingStudentsModal({ classroom, targetTeam, onConfirm: (ids) => calls.push(ids) });

    const overlay = document.querySelector('.modal-overlay');
    const search = overlay.querySelector('.add-existing-students-modal__search');

    // Select Anjali first, while the list is unfiltered.
    let rows = [...overlay.querySelectorAll('.student-multi-select__row')];
    let checkboxes = [...overlay.querySelectorAll('.student-multi-select__checkbox')];
    const anjaliIndex = rows.findIndex((row) => row.textContent.includes('Anjali'));
    checkboxes[anjaliIndex].click();

    // Now filter down to "Ankit" — Anjali's row disappears from view.
    search.value = 'Ankit';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const rowsAfterFilter = [...overlay.querySelectorAll('.student-multi-select__row')].map((r) => r.textContent.trim());

    // Select Ankit too, then clear the filter and confirm.
    const ankitCheckbox = overlay.querySelector('.student-multi-select__checkbox');
    ankitCheckbox.click();

    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    overlay.querySelector('.btn--primary').click();
    return { rowsAfterFilter, calls };
  }, buildFixtureClassroom());

  assert.deepEqual(result.rowsAfterFilter.map((t) => t.includes('Ankit')), [true]);
  assert.equal(result.calls.length, 1);
  // Anjali's earlier selection survived the filter round-trip, alongside Ankit.
  assert.deepEqual(result.calls[0].sort(), ['s-red-1', 's-red-2'].sort());
});

test('when every student in the classroom is already in the target team, shows an explanatory note instead of an empty picker', async () => {
  const classroom = {
    id: 'classroom-1',
    teams: [{ id: 'only-team', name: 'Only Team', students: [{ id: 's1', name: 'Solo' }] }],
  };
  const result = await page.evaluate(async (classroom) => {
    const { openAddExistingStudentsModal } = await import('/js/ui/components/AddExistingStudentsModal.js');
    const targetTeam = classroom.teams.find((t) => t.id === 'only-team');
    document.querySelectorAll('.modal-overlay').forEach((el) => el.remove()); // this page is reused across tests — clear any prior test's unclosed overlay first
    openAddExistingStudentsModal({ classroom, targetTeam, onConfirm: () => {} });
    const overlay = document.querySelector('.modal-overlay');
    return {
      noteText: overlay.querySelector('.add-existing-students-modal__note')?.textContent,
      hasSearchInput: !!overlay.querySelector('.add-existing-students-modal__search'),
    };
  }, classroom);

  assert.match(result.noteText || '', /already in Only Team/);
  assert.equal(result.hasSearchInput, false);
});

test('Cancel closes the modal without ever calling onConfirm', async () => {
  const called = await page.evaluate(async (classroom) => {
    const { openAddExistingStudentsModal } = await import('/js/ui/components/AddExistingStudentsModal.js');
    const targetTeam = classroom.teams.find((t) => t.id === 'team-blue');
    let callCount = 0;
    document.querySelectorAll('.modal-overlay').forEach((el) => el.remove()); // this page is reused across tests — clear any prior test's unclosed overlay first
    openAddExistingStudentsModal({ classroom, targetTeam, onConfirm: () => { callCount += 1; } });
    const overlay = document.querySelector('.modal-overlay');
    [...overlay.querySelectorAll('.btn--text')].find((btn) => btn.textContent === 'Cancel').click();
    const stillOpen = !!document.querySelector('.modal-overlay');
    return { callCount, stillOpen };
  }, buildFixtureClassroom());

  assert.equal(called.callCount, 0);
  assert.equal(called.stillOpen, false);
});
