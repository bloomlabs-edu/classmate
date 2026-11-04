/**
 * tests/ui/classroomCard.test.js
 *
 * ui/components/ClassroomCard.js's ⋯ actions menu — the exact menu a
 * teacher sees on a "My Classrooms" dashboard card (see
 * ui/views/PersonalHubView.js's own buildClassroomCard()). Regression
 * coverage for the bug this file was added to fix: the menu previously
 * only ever offered "Delete Classroom", because no caller ever passed
 * `canEditClassroomDetails`/`onEditClassroomDetails` at all — "Edit
 * Classroom Details" was wired into a different menu entirely
 * (ui/views/DashboardView.js's in-classroom header), never this card.
 *
 * Creates real DOM via createClassroomCardElement() directly — same
 * reasoning as tests/ui/editClassroomDetailsModal.test.js's own header
 * comment on why this needs a real browser, not plain `node --test`.
 * Drives a real headless Chromium page via Playwright, serving this
 * repo's actual files from a local static server — no Firestore, no
 * production, nothing written anywhere outside the page.
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
  await page.goto(`http://127.0.0.1:${port}/`);
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

// Function props (onClick/onDeleteClassroom/onEditClassroomDetails)
// can't cross the page.evaluate() serialization boundary as arguments —
// each test below builds them INSIDE the browser-context callback
// instead, passing in only plain, serializable flags (isOwner,
// canEditClassroomDetails).

test('OWNER sees both "Edit Classroom Details" and "Delete Classroom" in the ⋯ menu', async () => {
  const result = await page.evaluate(async ({ isOwner, canEditClassroomDetails }) => {
    const { createClassroomCardElement } = await import('/js/ui/components/ClassroomCard.js');
    document.body.innerHTML = '';
    const card = createClassroomCardElement({
      displayName: 'Bloom Force 19', subtitle: 'Grade 8A', studentCount: 20, memberCount: 2,
      onClick: () => {}, onDeleteClassroom: () => {}, onEditClassroomDetails: () => {},
      isOwner, canEditClassroomDetails,
    });
    document.body.appendChild(card);
    const menuButton = card.querySelector('.classroom-card__menu-button');
    const items = [...card.querySelectorAll('.classroom-card__menu-item')].map((el) => el.textContent);
    return { hasMenuButton: !!menuButton, items };
  }, { isOwner: true, canEditClassroomDetails: true });

  assert.equal(result.hasMenuButton, true);
  assert.deepEqual(result.items, ['Edit Classroom Details', 'Delete Classroom']);
});

test('TEACHER (non-owner) sees only "Edit Classroom Details" — never "Delete Classroom"', async () => {
  const result = await page.evaluate(async ({ isOwner, canEditClassroomDetails }) => {
    const { createClassroomCardElement } = await import('/js/ui/components/ClassroomCard.js');
    document.body.innerHTML = '';
    const card = createClassroomCardElement({
      displayName: 'Bloom Force 19', subtitle: 'Grade 8A', studentCount: 20, memberCount: 2,
      onClick: () => {}, onDeleteClassroom: () => {}, onEditClassroomDetails: () => {},
      isOwner, canEditClassroomDetails,
    });
    document.body.appendChild(card);
    const menuButton = card.querySelector('.classroom-card__menu-button');
    const items = [...card.querySelectorAll('.classroom-card__menu-item')].map((el) => el.textContent);
    return { hasMenuButton: !!menuButton, items };
  }, { isOwner: false, canEditClassroomDetails: true });

  assert.equal(result.hasMenuButton, true);
  assert.deepEqual(result.items, ['Edit Classroom Details']);
});

test('VIEWER (neither owner nor editor) sees no ⋯ menu at all', async () => {
  const result = await page.evaluate(async ({ isOwner, canEditClassroomDetails }) => {
    const { createClassroomCardElement } = await import('/js/ui/components/ClassroomCard.js');
    document.body.innerHTML = '';
    const card = createClassroomCardElement({
      displayName: 'Bloom Force 19', subtitle: 'Grade 8A', studentCount: 20, memberCount: 2,
      onClick: () => {}, onDeleteClassroom: () => {}, onEditClassroomDetails: () => {},
      isOwner, canEditClassroomDetails,
    });
    document.body.appendChild(card);
    const menuButton = card.querySelector('.classroom-card__menu-button');
    const items = [...card.querySelectorAll('.classroom-card__menu-item')].map((el) => el.textContent);
    return { hasMenuButton: !!menuButton, items };
  }, { isOwner: false, canEditClassroomDetails: false });

  assert.equal(result.hasMenuButton, false);
  assert.deepEqual(result.items, []);
});

test('clicking "Edit Classroom Details" calls onEditClassroomDetails with no arguments, and never touches onDeleteClassroom', async () => {
  const result = await page.evaluate(async () => {
    const { createClassroomCardElement } = await import('/js/ui/components/ClassroomCard.js');
    document.body.innerHTML = '';
    let editCalls = 0;
    let deleteCalls = 0;
    const card = createClassroomCardElement({
      displayName: 'Bloom Force 19', subtitle: 'Grade 8A', studentCount: 20, memberCount: 2,
      onClick: () => {}, isOwner: true, canEditClassroomDetails: true,
      onEditClassroomDetails: () => { editCalls += 1; },
      onDeleteClassroom: () => { deleteCalls += 1; },
    });
    document.body.appendChild(card);
    card.querySelector('.classroom-card__menu-button').click();
    const editItem = [...card.querySelectorAll('.classroom-card__menu-item')].find((el) => el.textContent === 'Edit Classroom Details');
    editItem.click();
    return { editCalls, deleteCalls, menuClosed: card.querySelector('.classroom-card__menu').hidden };
  });

  assert.equal(result.editCalls, 1);
  assert.equal(result.deleteCalls, 0);
  assert.equal(result.menuClosed, true);
});

test('clicking "Delete Classroom" calls onDeleteClassroom with no arguments, and never touches onEditClassroomDetails', async () => {
  const result = await page.evaluate(async () => {
    const { createClassroomCardElement } = await import('/js/ui/components/ClassroomCard.js');
    document.body.innerHTML = '';
    let editCalls = 0;
    let deleteCalls = 0;
    const card = createClassroomCardElement({
      displayName: 'Bloom Force 19', subtitle: 'Grade 8A', studentCount: 20, memberCount: 2,
      onClick: () => {}, isOwner: true, canEditClassroomDetails: true,
      onEditClassroomDetails: () => { editCalls += 1; },
      onDeleteClassroom: () => { deleteCalls += 1; },
    });
    document.body.appendChild(card);
    card.querySelector('.classroom-card__menu-button').click();
    const deleteItem = [...card.querySelectorAll('.classroom-card__menu-item')].find((el) => el.textContent === 'Delete Classroom');
    deleteItem.click();
    return { editCalls, deleteCalls };
  });

  assert.equal(result.editCalls, 0);
  assert.equal(result.deleteCalls, 1);
});

test('clicking the card surface itself (not the ⋯ menu) still opens the classroom, unaffected by the menu being present', async () => {
  const result = await page.evaluate(async () => {
    const { createClassroomCardElement } = await import('/js/ui/components/ClassroomCard.js');
    document.body.innerHTML = '';
    let openCalls = 0;
    const card = createClassroomCardElement({
      displayName: 'Bloom Force 19', subtitle: 'Grade 8A', studentCount: 20, memberCount: 2,
      isOwner: true, canEditClassroomDetails: true,
      onDeleteClassroom: () => {}, onEditClassroomDetails: () => {},
      onClick: () => { openCalls += 1; },
    });
    document.body.appendChild(card);
    card.querySelector('.classroom-card__open-button').click();
    return { openCalls };
  });

  assert.equal(result.openCalls, 1);
});
