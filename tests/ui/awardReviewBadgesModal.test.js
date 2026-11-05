/**
 * tests/ui/awardReviewBadgesModal.test.js
 *
 * ui/components/AwardReviewBadgesModal.js creates real DOM (an overlay +
 * modal with one Award button per badge) — same reasoning as
 * tests/ui/addExistingStudentsModal.test.js's own header comment on why
 * this can't be exercised under plain `node --test`. Drives a real
 * headless Chromium page via Playwright, serving a blank same-origin
 * document — no app shell, no Firestore, nothing written anywhere
 * outside the page.
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

test('shows the student/checkpoint context and one row per badge, each starting as "Award"', async () => {
  const result = await page.evaluate(async () => {
    const { openAwardReviewBadgesModal } = await import('/js/ui/components/AwardReviewBadgesModal.js');
    openAwardReviewBadgesModal({
      studentName: 'Anjali',
      checkpointTitle: 'Unit 2',
      badges: [
        { id: 'organization', name: 'Organization', alreadyAwarded: false },
        { id: 'punctuation-champion', name: 'Punctuation Champion', alreadyAwarded: false },
      ],
      onAward: () => true,
    });
    const subheading = document.querySelector('.missionCaption')?.textContent;
    const buttons = [...document.querySelectorAll('.award-review-badges__row')].map((row) => ({
      name: row.querySelector('.award-review-badges__name')?.textContent,
      buttonText: row.querySelector('button')?.textContent,
    }));
    return { subheading, buttons };
  });

  assert.equal(result.subheading, 'Anjali — "Unit 2"');
  assert.deepEqual(result.buttons, [
    { name: 'Organization', buttonText: 'Award' },
    { name: 'Punctuation Champion', buttonText: 'Award' },
  ]);
});

test('a badge already awarded opens pre-locked as "Awarded ✓", disabled', async () => {
  const result = await page.evaluate(async () => {
    const { openAwardReviewBadgesModal } = await import('/js/ui/components/AwardReviewBadgesModal.js');
    openAwardReviewBadgesModal({
      studentName: 'Anjali',
      checkpointTitle: 'Unit 2',
      badges: [{ id: 'organization', name: 'Organization', alreadyAwarded: true }],
      onAward: () => true,
    });
    const button = document.querySelector('.award-review-badges__row button');
    return { text: button.textContent, disabled: button.disabled };
  });
  assert.equal(result.text, 'Awarded ✓');
  assert.equal(result.disabled, true);
});

test('clicking Award calls onAward(badgeTypeId) and locks the button to "Awarded ✓" on success', async () => {
  const result = await page.evaluate(async () => {
    const { openAwardReviewBadgesModal } = await import('/js/ui/components/AwardReviewBadgesModal.js');
    const calls = [];
    openAwardReviewBadgesModal({
      studentName: 'Anjali',
      checkpointTitle: 'Unit 2',
      badges: [{ id: 'organization', name: 'Organization', alreadyAwarded: false }],
      onAward: (badgeTypeId) => {
        calls.push(badgeTypeId);
        return true;
      },
    });
    const button = document.querySelector('.award-review-badges__row button');
    button.click();
    return { calls, text: button.textContent, disabled: button.disabled };
  });
  assert.deepEqual(result.calls, ['organization']);
  assert.equal(result.text, 'Awarded ✓');
  assert.equal(result.disabled, true);
});

test('clicking Award when onAward fails re-enables the button so the teacher can retry', async () => {
  const result = await page.evaluate(async () => {
    const { openAwardReviewBadgesModal } = await import('/js/ui/components/AwardReviewBadgesModal.js');
    openAwardReviewBadgesModal({
      studentName: 'Anjali',
      checkpointTitle: 'Unit 2',
      badges: [{ id: 'organization', name: 'Organization', alreadyAwarded: false }],
      onAward: () => false,
    });
    const button = document.querySelector('.award-review-badges__row button');
    button.click();
    return { text: button.textContent, disabled: button.disabled };
  });
  assert.equal(result.text, 'Award');
  assert.equal(result.disabled, false);
});

test('clicking an already-awarded (disabled) button never calls onAward again', async () => {
  const callCount = await page.evaluate(async () => {
    const { openAwardReviewBadgesModal } = await import('/js/ui/components/AwardReviewBadgesModal.js');
    let calls = 0;
    openAwardReviewBadgesModal({
      studentName: 'Anjali',
      checkpointTitle: 'Unit 2',
      badges: [{ id: 'organization', name: 'Organization', alreadyAwarded: true }],
      onAward: () => { calls += 1; return true; },
    });
    document.querySelector('.award-review-badges__row button').click();
    return calls;
  });
  assert.equal(callCount, 0);
});

test('Close removes the modal from the DOM without requiring every badge to be decided', async () => {
  const stillOpen = await page.evaluate(async () => {
    const { openAwardReviewBadgesModal } = await import('/js/ui/components/AwardReviewBadgesModal.js');
    openAwardReviewBadgesModal({
      studentName: 'Anjali',
      checkpointTitle: 'Unit 2',
      badges: [
        { id: 'organization', name: 'Organization', alreadyAwarded: false },
        { id: 'punctuation-champion', name: 'Punctuation Champion', alreadyAwarded: false },
      ],
      onAward: () => true,
    });
    [...document.querySelectorAll('.modal__actions button')].find((b) => b.textContent === 'Close').click();
    return document.querySelector('.modal-overlay') !== null;
  });
  assert.equal(stillOpen, false);
});
