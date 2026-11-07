/**
 * tests/ui/lessonPlanBuilderObjectivesAutoGrow.test.js
 *
 * WORK-0024: Lesson Objectives (and the sibling Assessment/evidence
 * dynamic-row items, since both share createDynamicListRow() in
 * ui/views/LessonPlanBuilderView.js) now render as auto-growing
 * textareas, matching the field pattern every other long-form Builder
 * field already uses (Activity/Interaction/Spark/Differentiation) —
 * never a plain single-line `<input>` that silently clips long text.
 * The Spark title field, which reuses the SAME
 * `.lesson-plan-builder__dynamic-input` class name standalone (outside
 * a dynamic-row), must stay a plain single-line `<input>`, unaffected.
 *
 * SCOPE NOTE: ui/views/LessonPlanBuilderView.js's own exported
 * renderLessonPlanBuilderView() is a strict, multi-stage guided flow —
 * the Objectives ("Why"/Purpose) stage only renders once the preceding
 * Subject and Concept stages are satisfied by real, valid
 * classroom/curriculum data (subjectId resolving in
 * classroom.notebookConfig, a real curriculum concept, etc.). Building
 * that full fixture is disproportionate to this one CSS/element-type
 * fix. This file instead verifies the actual risk surface directly:
 * real CSS (css/styles.css) + the real attachAutoGrowTextarea()
 * behavior, against the exact markup createDynamicListRow() produces —
 * the same proven approach already used to verify WORK-0023 (the
 * title/status-badge check) without a full page mount. The JS
 * element-type change itself (`createElement('input')` ->
 * `createElement('textarea')`) is additionally pinned by a direct
 * source-text assertion below, so a future revert is caught even
 * without a full guided-flow integration test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const CONTENT_TYPES = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html' };
const LONG_TEXT =
  'Explain, with reference to at least three specific historical examples drawn from the chapter, why the revolt ultimately failed to achieve its stated aims despite widespread early support across multiple regions.';

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') {
      const html = `<!doctype html><html><head><link rel="stylesheet" href="/css/styles.css"></head>
<body>
  <div style="max-width: 700px; margin: 2rem auto;">
    <div class="lesson-plan-builder__dynamic-row">
      <div class="lesson-plan-builder__dynamic-reorder">
        <button type="button" class="lesson-plan-builder__activity-reorder-button">▲</button>
        <button type="button" class="lesson-plan-builder__activity-reorder-button">▼</button>
      </div>
      <textarea class="lesson-plan-builder__dynamic-input" id="long-objective" rows="1" placeholder="e.g. Explain the causes of the revolt"></textarea>
      <button type="button" class="lesson-plan-builder__dynamic-remove">✕</button>
    </div>
    <div class="lesson-plan-builder__field">
      <input type="text" class="lesson-plan-builder__dynamic-input" id="spark-title" value="Why does ice float?">
    </div>
  </div>
  <script type="module">
    import { attachAutoGrowTextarea } from '/js/ui/components/AutoGrowTextarea.js';
    window.__attach = attachAutoGrowTextarea;
  </script>
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
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream' });
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
});

test.beforeEach(async () => {
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__attach);
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

test('a dynamic-row textarea with long text, once attachAutoGrowTextarea() runs, grows to fit its full content with zero clipped overflow', async () => {
  const result = await page.evaluate((longText) => {
    const textarea = document.getElementById('long-objective');
    textarea.value = longText;
    window.__attach(textarea);
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
      resolve({ clipped: textarea.scrollHeight - textarea.clientHeight, height: textarea.getBoundingClientRect().height });
    })));
  }, LONG_TEXT);

  assert.ok(result.clipped <= 2, `scrollHeight must match clientHeight once grown (within border rounding) -- ${result.clipped}px of content is still clipped`);
  assert.ok(result.height > 40, 'a long objective must grow well beyond the single-line baseline height');
});

test('a short dynamic-row textarea stays at the compact single-line baseline height -- auto-grow never inflates short content', async () => {
  const result = await page.evaluate(() => {
    const textarea = document.getElementById('long-objective');
    textarea.value = 'Define the term revolt.';
    window.__attach(textarea);
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(textarea.getBoundingClientRect().height))));
  });
  assert.ok(result < 40, `a short objective must stay compact (got ${result}px) -- never inflated just because auto-grow is attached`);
});

test('no internal scrollbar/manual resize handle ever appears on the grown textarea (resize:none, overflow:hidden from the real stylesheet)', async () => {
  const styles = await page.evaluate(() => {
    const textarea = document.getElementById('long-objective');
    const computed = getComputedStyle(textarea);
    return { resize: computed.resize, overflowY: computed.overflowY };
  });
  assert.equal(styles.resize, 'none');
  assert.equal(styles.overflowY, 'hidden');
});

test('the Spark title field -- a plain <input> reusing the SAME class name standalone -- is completely unaffected by the textarea-scoped rule', async () => {
  const styles = await page.evaluate(() => {
    const input = document.getElementById('spark-title');
    const textarea = document.getElementById('long-objective');
    return { tagName: input.tagName, inputMinHeight: getComputedStyle(input).minHeight, textareaMinHeight: getComputedStyle(textarea).minHeight };
  });
  assert.equal(styles.tagName, 'INPUT');
  // `textarea.lesson-plan-builder__dynamic-input`'s own min-height
  // (2.1rem) is an element-type-scoped selector -- it must apply to the
  // textarea and must NOT apply to the plain <input> reusing the same
  // class name, confirmed directly by comparing the two computed values
  // rather than assuming the selector worked.
  assert.equal(styles.textareaMinHeight, '33.6px', 'sanity check: the textarea-scoped rule\'s own 2.1rem min-height is actually in effect');
  assert.notEqual(styles.inputMinHeight, '33.6px', 'the textarea-scoped min-height must never leak onto the plain <input> sharing the same class name');
});

test('SOURCE PIN: createDynamicListRow() creates a <textarea>, never reverts to a plain <input>', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'js/ui/views/LessonPlanBuilderView.js'), 'utf8');
  const fnStart = source.indexOf('function createDynamicListRow(');
  assert.ok(fnStart !== -1, 'createDynamicListRow must still exist under this exact name');
  const fnBody = source.slice(fnStart, fnStart + 2500);
  assert.match(fnBody, /createElement\('textarea'\)/);
  assert.doesNotMatch(fnBody, /createElement\('input'\)/, 'must never revert to a plain single-line input');
  assert.match(fnBody, /attachAutoGrowTextarea\(input\)/);
});
