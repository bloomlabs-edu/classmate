/**
 * tests/ui/studentAccessViewInviteTile.test.js
 *
 * Regression test for a real production incident: the "Invite Students"
 * bento tile on ui/views/StudentAccessView.js displays
 * classroom.classroomStudentJoinCode — a code that only ever grants
 * access to ClassMate's own built-in Student Portal (#/student). It used
 * to carry no copy distinguishing it from the separate "Connect Learning
 * Hub" tile/code (classroomInvitations, an unrelated Firestore
 * collection), so a teacher handed a learner this tile's code, the
 * learner tried redeeming it in Learning Hub, and it was correctly and
 * deterministically rejected — it was never a Learning Hub invitation
 * code. This suite proves the tile's own text now makes the two codes
 * impossible to confuse, without touching either code's value or
 * generation mechanism.
 *
 * Renders a real headless Chromium page (same pattern as
 * tests/ui/approveDeviceSignInView.test.js's own header comment) rather
 * than a fake DOM shim, since this repo's sandbox has no jsdom
 * dependency and createInviteStudentsTile() builds real DOM nodes.
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

async function renderBento() {
  return page.evaluate(async () => {
    const { renderStudentAccessView } = await import('/js/ui/views/StudentAccessView.js');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const classroom = {
      id: 'test-classroom-1',
      teams: [],
      ownerUid: 'teacher-1',
      members: {},
      classroomStudentJoinCode: 'ZW4R4C',
      classroomJoinCode: 'R775Q6',
      programManagerJoinCode: 'HGPWKC',
      visitorAccessCode: 'CBVSMY',
      deviceResetPin: '1234',
    };
    const currentUser = { uid: 'teacher-1' };

    renderStudentAccessView(container, {
      classroom,
      currentUser,
      onBack: () => {},
      onSelectStudent: () => {},
      onOpenConnectLearningHub: () => {},
    });

    const tiles = Array.from(container.querySelectorAll('.classroom-access-bento__tile'));
    return tiles.map((tile) => ({
      heading: tile.querySelector('.classroom-access-bento__heading')?.textContent || '',
      description: tile.querySelector('.classroom-access-bento__description')?.textContent || '',
      codeLabel: tile.querySelector('.invite-students-card__code-label')?.textContent || '',
      code: tile.querySelector('.invite-students-card__code')?.textContent || '',
    }));
  });
}

test('Invite Students tile heading no longer reads as a generic, confusable "Invite Students"', async () => {
  const tiles = await renderBento();
  const inviteTile = tiles.find((t) => t.code === 'ZW4R4C');
  assert.ok(inviteTile, 'expected to find the tile rendering the ClassMate Student Portal code');
  assert.notEqual(inviteTile.heading, 'Invite Students', 'the old, ambiguous heading must not still be in use');
  assert.match(inviteTile.heading, /ClassMate/, 'heading should explicitly name ClassMate');
});

test('Invite Students tile description explicitly says this code is not a Learning Hub invitation code', async () => {
  const tiles = await renderBento();
  const inviteTile = tiles.find((t) => t.code === 'ZW4R4C');
  assert.match(inviteTile.description, /not a Learning Hub invitation code/i);
});

test('Invite Students tile labels its own code as the ClassMate Student Portal code, distinct from Learning Hub', async () => {
  const tiles = await renderBento();
  const inviteTile = tiles.find((t) => t.code === 'ZW4R4C');
  assert.match(inviteTile.codeLabel, /ClassMate Student Portal/);
  assert.match(inviteTile.codeLabel, /not for Learning Hub/i);
});

test('Connect Learning Hub tile remains a separate, clearly-labeled tile (not merged with the Student Portal tile)', async () => {
  const tiles = await renderBento();
  const learningHubTile = tiles.find((t) => t.heading === 'Connect Learning Hub');
  assert.ok(learningHubTile, 'the Connect Learning Hub tile must still exist as its own distinct tile');
  assert.match(learningHubTile.description, /Learning Hub/);
});
