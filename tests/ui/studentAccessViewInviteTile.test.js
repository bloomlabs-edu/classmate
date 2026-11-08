/**
 * tests/ui/studentAccessViewInviteTile.test.js
 *
 * UNIFIED CLASSROOM CODE (product decision, 2026-11-08): a teacher
 * generates, remembers, and shares exactly ONE classroom code — it must
 * work in both ClassMate's own Student Portal and Learning Hub's "Join
 * a Classroom" screen. This supersedes an earlier, narrower fix to this
 * same file that only disambiguated two genuinely different codes in
 * copy (a real incident where a learner was handed
 * classroom.classroomStudentJoinCode and it failed in Learning Hub,
 * because at the time it really was a different code). This suite now
 * proves the tile communicates that the SAME code works everywhere, and
 * that the separate "Connect Learning Hub" tile no longer displays or
 * generates a second, competing code.
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

test('exactly one tile displays the shared classroom.classroomStudentJoinCode value — no other tile echoes a second, competing student-join code', async () => {
  const tiles = await renderBento();
  const tilesShowingSharedCode = tiles.filter((t) => t.code === 'ZW4R4C');
  assert.equal(tilesShowingSharedCode.length, 1, 'exactly one tile should display the shared classroom code (other tiles have their own, unrelated codes — Co-Teacher, Program Manager, Visitor — which is expected and untouched by this change)');
});

test('the single Invite Students tile communicates that its one code works for BOTH ClassMate and Learning Hub', async () => {
  const tiles = await renderBento();
  const inviteTile = tiles.find((t) => t.code === 'ZW4R4C');
  assert.ok(inviteTile, 'expected to find the tile rendering the shared classroom code');
  assert.match(inviteTile.description, /Learning Hub/, 'description must mention Learning Hub, not just ClassMate');
  assert.doesNotMatch(inviteTile.description, /not a Learning Hub invitation code/i, 'must not still claim this code is Learning-Hub-incompatible');
});

test('the code label confirms this one code works for both student experiences, not "not for Learning Hub"', async () => {
  const tiles = await renderBento();
  const inviteTile = tiles.find((t) => t.code === 'ZW4R4C');
  assert.match(inviteTile.codeLabel, /ClassMate/);
  assert.match(inviteTile.codeLabel, /Learning Hub/);
  assert.doesNotMatch(inviteTile.codeLabel, /not for Learning Hub/i);
});

test('the Learning Hub tile no longer advertises its own separate code — it is purely a request-review entry point now', async () => {
  const tiles = await renderBento();
  const learningHubTile = tiles.find((t) => /Learning Hub/.test(t.heading));
  assert.ok(learningHubTile, 'a Learning-Hub-related tile must still exist');
  assert.equal(learningHubTile.code, '', 'this tile must not render its own code display anymore');
  assert.doesNotMatch(learningHubTile.description, /share a connection code/i, 'must not still describe sharing a separate code');
});
