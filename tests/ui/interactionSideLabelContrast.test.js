/**
 * tests/ui/interactionSideLabelContrast.test.js
 *
 * WORK-0022: the Teacher/Student interaction-side label (icon + short
 * uppercase label atop a tinted card, shared markup pattern across
 * ui/views/LessonPlanBuilderView.js, ui/views/LessonPlanReviewView.js,
 * and ui/components/LessonContentReadOnly.js) previously rendered its
 * label text/icon color (`currentColor`) with a measured contrast
 * ratio against its own tinted background of 2.31:1 (teacher) and
 * 3.80:1 (student) -- both fail WCAG AA's 4.5:1 minimum for normal-size
 * text (the student side, while measurably better than the teacher
 * side here, still fails; this directly informed scoping the fix to
 * both sides, not only "the student side" as originally reported --
 * see the corresponding WORK-0022 handover note for the full
 * measurement). This test computes the REAL rendered contrast ratio
 * directly from the real stylesheet (css/styles.css), for all three
 * affected surfaces, rather than asserting a hardcoded hex value that
 * would pass even if the actual rendered colors drifted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

function relativeLuminance([r, g, b]) {
  const lin = (c) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

function parseRgb(rgbString) {
  const match = rgbString.match(/\d+/g);
  return match.slice(0, 3).map(Number);
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') {
      const html = `<!doctype html><html><head><link rel="stylesheet" href="/css/styles.css"></head>
<body>
  <div class="lesson-plan-builder__interaction-side lesson-plan-builder__interaction-side--teacher">
    <div class="lesson-plan-builder__interaction-side-label" id="builder-teacher"><span>TEACHER</span></div>
  </div>
  <div class="lesson-plan-builder__interaction-side lesson-plan-builder__interaction-side--students">
    <div class="lesson-plan-builder__interaction-side-label" id="builder-student"><span>STUDENTS</span></div>
  </div>
  <div class="lesson-plan-review__interaction-side lesson-plan-review__interaction-side--teacher">
    <div class="lesson-plan-review__interaction-side-label" id="review-teacher"><span>TEACHER</span></div>
  </div>
  <div class="lesson-plan-review__interaction-side lesson-plan-review__interaction-side--students">
    <div class="lesson-plan-review__interaction-side-label" id="review-student"><span>STUDENTS</span></div>
  </div>
  <div class="lesson-content-readonly__interaction-side lesson-content-readonly__interaction-side--teacher">
    <div class="lesson-content-readonly__interaction-side-label" id="readonly-teacher"><span>TEACHER</span></div>
  </div>
  <div class="lesson-content-readonly__interaction-side lesson-content-readonly__interaction-side--students">
    <div class="lesson-content-readonly__interaction-side-label" id="readonly-student"><span>STUDENTS</span></div>
  </div>
</body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }
    const filePath = path.join(REPO_ROOT, urlPath);
    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': path.extname(filePath) === '.css' ? 'text/css' : 'text/plain' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
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

async function measure(labelId, sideSelector) {
  return page.evaluate(
    ({ labelId, sideSelector }) => {
      const label = document.getElementById(labelId);
      const side = label.closest(sideSelector);
      return { textColor: getComputedStyle(label).color, bgColor: getComputedStyle(side).backgroundColor };
    },
    { labelId, sideSelector }
  );
}

for (const [surface, selectorPrefix] of [
  ['Lesson Plan Builder', 'lesson-plan-builder'],
  ['Lesson Plan Review', 'lesson-plan-review'],
  ['Lesson Content Read-Only', 'lesson-content-readonly'],
]) {
  test(`${surface}: the Teacher interaction-side label passes WCAG AA (>= 4.5:1) against its own tinted background`, async () => {
    const { textColor, bgColor } = await measure(`${selectorPrefix === 'lesson-plan-builder' ? 'builder' : selectorPrefix === 'lesson-plan-review' ? 'review' : 'readonly'}-teacher`, `.${selectorPrefix}__interaction-side`);
    const ratio = contrastRatio(parseRgb(textColor), parseRgb(bgColor));
    assert.ok(ratio >= 4.5, `${surface} teacher label contrast is ${ratio.toFixed(2)}:1, below the WCAG AA 4.5:1 minimum for normal text`);
  });

  test(`${surface}: the Students interaction-side label passes WCAG AA (>= 4.5:1) against its own tinted background`, async () => {
    const { textColor, bgColor } = await measure(`${selectorPrefix === 'lesson-plan-builder' ? 'builder' : selectorPrefix === 'lesson-plan-review' ? 'review' : 'readonly'}-student`, `.${selectorPrefix}__interaction-side`);
    const ratio = contrastRatio(parseRgb(textColor), parseRgb(bgColor));
    assert.ok(ratio >= 4.5, `${surface} student label contrast is ${ratio.toFixed(2)}:1, below the WCAG AA 4.5:1 minimum for normal text`);
  });
}

test('the teacher and student label colors remain hue-distinct from each other (blue vs. orange/brown, never converged to a similar color while both got darkened for contrast)', async () => {
  // Luminance-based contrast ratio is the wrong tool here -- two
  // different hues at similar darkness can share a LOW contrast ratio
  // against each other while still reading as obviously different
  // colors to a person. Checking which channel dominates (blue for
  // teacher, red for student) is the actual property that matters:
  // "do not rely on colour alone" (icon+label already handles that),
  // but the colour itself must still differ once both are darkened.
  const teacher = await measure('builder-teacher', '.lesson-plan-builder__interaction-side');
  const student = await measure('builder-student', '.lesson-plan-builder__interaction-side');
  const [tr, , tb] = parseRgb(teacher.textColor);
  const [sr, , sb] = parseRgb(student.textColor);
  assert.ok(tb > tr, `teacher label must stay blue-dominant (R=${tr}, B=${tb})`);
  assert.ok(sr > sb, `student label must stay red/orange-dominant (R=${sr}, B=${sb})`);
});
