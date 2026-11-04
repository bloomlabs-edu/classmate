/**
 * tests/ui/studentExternalActivities.test.js
 *
 * Coverage for the student-facing External Activities section added to
 * ui/student-portal/views/StudentLearningView.js (Phase 2): card
 * rendering (provider badge/title/description), opening in a new tab
 * via window.open(..., 'noopener,noreferrer') rather than any in-page
 * navigation or iframe, and loadAndRenderExternalActivities()'s own
 * "only ever appear when there's something real to show" contract —
 * no mapping, and an unreachable Learning Hub service (simulated via a
 * firestoreEmulator target nothing is listening on, so the query
 * fails exactly the way a genuinely offline/undeployed Learning Hub
 * would) both leave the container empty rather than erroring or
 * flashing a loading/empty state of their own.
 *
 * A real, seeded Learning Hub Firestore emulator is NOT part of this
 * suite (see docs/learning-hub-phase2-testing.md) — that integration
 * is covered separately, manually, against a local emulator, since it
 * would otherwise make this repo's own committed test suite depend on
 * a sibling repo's worktree path. The cases below only need the real
 * production code's own never-throw contract, which holds regardless
 * of what's on the other end of the query.
 *
 * Uses the same real-Chromium-via-Playwright static-server approach as
 * tests/ui/classModeStudentRow.test.js's own header comment explains.
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
  // A firestoreEmulator target nothing is listening on — every
  // Firestore call made by this page (default app AND the Learning Hub
  // app, which shares the same redirect mechanism) fails fast with a
  // connection error instead of silently reaching a real, possibly
  // unrelated emulator on the default port.
  await page.goto(`http://127.0.0.1:${port}/index.html?firestoreEmulator=127.0.0.1:1`);
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

test('createExternalActivityCard: renders provider badge, title, and description', async () => {
  const result = await page.evaluate(async () => {
    const { createExternalActivityCard } = await import('/js/ui/student-portal/views/StudentLearningView.js');
    const card = createExternalActivityCard({
      id: 'a1', title: 'Weather Kahoot Quiz', description: 'A quick review quiz.',
      provider: 'kahoot', url: 'https://kahoot.it/weather-quiz',
    });
    document.body.appendChild(card);
    const out = {
      tagName: card.tagName,
      badgeText: card.querySelector('.student-learning__external-activity-badge')?.textContent,
      badgeClass: card.querySelector('.student-learning__external-activity-badge')?.className,
      titleText: card.querySelector('.student-learning__external-activity-title')?.textContent,
      descriptionText: card.querySelector('.student-learning__external-activity-description')?.textContent,
      hasIframe: card.querySelectorAll('iframe').length,
      hasAnchor: card.querySelectorAll('a').length,
    };
    card.remove();
    return out;
  });
  assert.equal(result.tagName, 'BUTTON');
  assert.equal(result.badgeText, 'Kahoot');
  assert.match(result.badgeClass, /student-learning__external-activity-badge--kahoot/);
  assert.equal(result.titleText, 'Weather Kahoot Quiz');
  assert.equal(result.descriptionText, 'A quick review quiz.');
  assert.equal(result.hasIframe, 0, 'must never render an iframe');
  assert.equal(result.hasAnchor, 0, 'must never render an anchor (navigation happens via window.open, not a link)');
});

test('createExternalActivityCard: omits the description element entirely when there is none (no empty paragraph)', async () => {
  const hasDescriptionEl = await page.evaluate(async () => {
    const { createExternalActivityCard } = await import('/js/ui/student-portal/views/StudentLearningView.js');
    const card = createExternalActivityCard({ id: 'a2', title: 'Weather Reflection Form', description: '', provider: 'google-forms', url: 'https://forms.google.com/weather-reflection' });
    const result = card.querySelectorAll('.student-learning__external-activity-description').length > 0;
    card.remove();
    return result;
  });
  assert.equal(hasDescriptionEl, false);
});

test('createExternalActivityCard: clicking opens the activity URL in a new tab via window.open with noopener,noreferrer — never iframes or in-page navigation', async () => {
  const call = await page.evaluate(async () => {
    const { createExternalActivityCard } = await import('/js/ui/student-portal/views/StudentLearningView.js');
    const card = createExternalActivityCard({ id: 'a1', title: 'Weather Kahoot Quiz', provider: 'kahoot', url: 'https://kahoot.it/weather-quiz' });
    document.body.appendChild(card);

    let captured = null;
    const originalOpen = window.open;
    window.open = (url, target, features) => { captured = { url, target, features }; return null; };
    card.click();
    window.open = originalOpen;

    card.remove();
    return captured;
  });
  assert.deepEqual(call, { url: 'https://kahoot.it/weather-quiz', target: '_blank', features: 'noopener,noreferrer' });
});

test('loadAndRenderExternalActivities: a concept with no Learning Hub mapping leaves the container empty, with no query attempted', async () => {
  const html = await page.evaluate(async () => {
    const { loadAndRenderExternalActivities } = await import('/js/ui/student-portal/views/StudentLearningView.js');
    const container = document.createElement('div');
    document.body.appendChild(container);
    await loadAndRenderExternalActivities(container, { id: 'concept-1', learningHubConcept: null });
    const result = container.innerHTML;
    container.remove();
    return result;
  });
  assert.equal(html, '');
});

test('loadAndRenderExternalActivities: an unreachable/unavailable Learning Hub service resolves gracefully — container stays empty, no throw, no unhandled rejection', async () => {
  const outcome = await page.evaluate(async () => {
    const { loadAndRenderExternalActivities } = await import('/js/ui/student-portal/views/StudentLearningView.js');
    const container = document.createElement('div');
    document.body.appendChild(container);
    let threw = false;
    try {
      await loadAndRenderExternalActivities(container, { id: 'concept-1', learningHubConcept: { conceptId: 'weather', title: 'Weather' } });
    } catch {
      threw = true;
    }
    const result = { threw, html: container.innerHTML };
    container.remove();
    return result;
  });
  assert.equal(outcome.threw, false, 'an unavailable Learning Hub service must never surface as a thrown error to the student view');
  assert.equal(outcome.html, '', 'nothing real to show -> container stays empty, no error state of its own');
});

test('loadAndRenderExternalActivities: a container that has navigated away mid-query (isConnected false) is left untouched, never written into', async () => {
  const outcome = await page.evaluate(async () => {
    const { loadAndRenderExternalActivities } = await import('/js/ui/student-portal/views/StudentLearningView.js');
    const container = document.createElement('div');
    container.innerHTML = '<p>stale content that must survive</p>';
    // Deliberately never appended to document.body, so container.isConnected is false.
    await loadAndRenderExternalActivities(container, { id: 'concept-1', learningHubConcept: { conceptId: 'weather', title: 'Weather' } });
    return container.innerHTML;
  });
  assert.equal(outcome, '<p>stale content that must survive</p>');
});
