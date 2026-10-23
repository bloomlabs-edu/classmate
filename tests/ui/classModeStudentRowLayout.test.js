/**
 * tests/ui/classModeStudentRowLayout.test.js
 *
 * Visual-layout regression coverage for the Class Mode roster polish
 * pass (2026-10-23): compacting the remove-star circle, fixing its
 * vertical misalignment against the ⋮ overflow menu, and preventing a
 * long student name from colliding with the score/controls. See
 * css/styles.css's own .student-row / .student-row__remove-star /
 * .student-row__name comments for the full reasoning. Uses a real
 * Chromium layout (getBoundingClientRect) rather than asserting CSS
 * property strings, since the actual bug here (fixed-height flex items
 * not stretching the way min-height ones do) only shows up in real
 * layout geometry — same "real browser" rationale as this directory's
 * other ClassModeStudentRow tests.
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

/** Renders one row inside a fixed-width list container (mirrors .student-list's own real container) and returns layout geometry for every part of it. */
async function renderRowLayout({ name, displayScore = -3, containerWidth = 360 }) {
  return page.evaluate(
    async ({ name, displayScore, containerWidth }) => {
      const { createClassModeStudentRow } = await import('/js/ui/components/ClassModeStudentRow.js');
      const student = { id: 'layout-student', name, bucket: 'green' };

      const list = document.createElement('ul');
      list.className = 'student-list';
      list.style.width = `${containerWidth}px`;
      const row = createClassModeStudentRow(student, {
        onTap: () => {},
        onSwipeLeft: () => {},
        onLongPress: () => {},
        displayScore,
      });
      list.appendChild(row);
      document.body.appendChild(list);

      const rect = (el) => el?.getBoundingClientRect();
      const nameEl = row.querySelector('.student-row__name');
      const trailingEl = row.querySelector('.student-row__trailing');
      const removeStarEl = row.querySelector('.student-row__remove-star');
      const moreEl = row.querySelector('.student-row__more');

      const result = {
        name: rect(nameEl),
        trailing: rect(trailingEl),
        removeStar: rect(removeStarEl),
        more: rect(moreEl),
        row: rect(row),
      };
      list.remove();
      return JSON.parse(JSON.stringify(result));
    },
    { name, displayScore, containerWidth }
  );
}

test('LAYOUT: the remove-star circle is compact (smaller than the prior 40px standalone-button sizing) while staying a real, visible circle', async () => {
  const { removeStar } = await renderRowLayout({ name: 'Priya' });
  assert.ok(removeStar.width < 36, `expected a compact circle, got width ${removeStar.width}px`);
  assert.ok(removeStar.width > 16, `expected the circle to stay large enough to stay legible, got width ${removeStar.width}px`);
  // A circle: width and height must match (no accidental stretch-induced ellipse).
  assert.ok(Math.abs(removeStar.width - removeStar.height) < 1, 'remove-star button must render as a true circle, not stretched');
});

test('LAYOUT: the remove-star circle and the overflow (⋮) menu are vertically centered consistently against each other', async () => {
  const { removeStar, more } = await renderRowLayout({ name: 'Priya' });
  const removeStarCenterY = removeStar.top + removeStar.height / 2;
  const moreCenterY = more.top + more.height / 2;
  assert.ok(
    Math.abs(removeStarCenterY - moreCenterY) < 1,
    `expected both controls centered on the same Y axis, got remove-star center ${removeStarCenterY}, more center ${moreCenterY}`
  );
});

test('LAYOUT: a short name does not collide with the score/controls at a normal width', async () => {
  const { name, trailing } = await renderRowLayout({ name: 'Zoe', containerWidth: 360 });
  assert.ok(name.right <= trailing.left, `expected no horizontal overlap, name.right=${name.right} trailing.left=${trailing.left}`);
});

test('LAYOUT: a long name wraps instead of overlapping the score/controls, even on a narrow strip', async () => {
  const { name, trailing, removeStar, more, row } = await renderRowLayout({
    name: 'Venkata Narasimha Subramanyam',
    containerWidth: 280,
  });
  // The name is allowed to grow taller (wrap to multiple lines) but must
  // never extend past where the score begins, and nothing may be clipped
  // outside the row's own right edge.
  assert.ok(name.right <= trailing.left + 1, `expected the wrapped name to stay clear of the score, name.right=${name.right} trailing.left=${trailing.left}`);
  assert.ok(removeStar.right <= row.right + 1, 'remove-star button must not be clipped outside the row');
  assert.ok(more.right <= row.right + 1, 'overflow menu must not be clipped outside the row');
});

test('LAYOUT: on a narrow screen width, the minus button and overflow menu remain visible and unclipped', async () => {
  await page.setViewportSize({ width: 320, height: 800 });
  const { removeStar, more, row } = await renderRowLayout({ name: 'Krishnamurthy', containerWidth: 300 });
  assert.ok(removeStar.width > 0 && removeStar.height > 0, 'remove-star button must still render with real dimensions');
  assert.ok(more.width > 0 && more.height > 0, 'overflow menu must still render with real dimensions');
  assert.ok(removeStar.right <= row.right + 1 && more.right <= row.right + 1, 'controls must stay within the row, not clipped off-screen');
  await page.setViewportSize({ width: 1280, height: 800 });
});
