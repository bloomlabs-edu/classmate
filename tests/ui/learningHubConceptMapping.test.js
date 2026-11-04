/**
 * tests/ui/learningHubConceptMapping.test.js
 *
 * Coverage for the teacher-facing Learning Hub concept mapping picker
 * (Phase 2): ui/views/ConceptWorkspaceView.js's own read-mode control
 * (renderLearningHubConceptMappingControl — linked/not-linked text,
 * Change/+Link/Remove buttons) and
 * ui/components/LearningHubConceptMappingModal.js's search -> select ->
 * save/cancel flow, plus the save-failure retry path.
 *
 * The modal's only external dependency is
 * services/learningHubConceptService.js's searchConcepts() — rather
 * than standing up a real Learning Hub Firestore emulator (see
 * tests/ui/studentExternalActivities.test.js's own header comment for
 * why that stays out of this repo's committed suite), each search-
 * dependent test here intercepts that exact module URL via
 * page.route() and serves a small stub module, so the picker's own
 * UI behavior (ranking display, selection, save/cancel wiring) is
 * exercised against a real DOM without depending on cross-project
 * infrastructure. searchConcepts() itself is already covered
 * separately (ranking/never-throw contract) wherever it's tested
 * directly against a real emulator.
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

test.before(async () => {
  ({ server, port } = await startStaticServer());
  browser = await chromium.launch();
});

test.after(async () => {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

// ---------------------------------------------------------------------
// renderLearningHubConceptMappingControl — pure DOM, no Firestore
// involved at all, so these run against a plain fresh page.
// ---------------------------------------------------------------------

async function withPage(fn) {
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    return await fn(page);
  } finally {
    await page.close();
  }
}

test('renderLearningHubConceptMappingControl: an unmapped concept shows "Not linked yet", a "+ Link" button, and no Remove button', async () => {
  const result = await withPage((page) => page.evaluate(async () => {
    const { renderLearningHubConceptMappingControl } = await import('/js/ui/views/ConceptWorkspaceView.js');
    const el = renderLearningHubConceptMappingControl({ learningHubConcept: null }, {});
    const buttons = [...el.querySelectorAll('button')].map((b) => b.textContent);
    return { statusText: el.querySelector('.concept-workspace__description-text')?.textContent, buttons };
  }));
  assert.match(result.statusText, /Not linked yet/);
  assert.deepEqual(result.buttons, ['+ Link to Learning Hub concept']);
});

test('renderLearningHubConceptMappingControl: a mapped concept shows the linked title, a "Change" button, and a "Remove" button', async () => {
  const result = await withPage((page) => page.evaluate(async () => {
    const { renderLearningHubConceptMappingControl } = await import('/js/ui/views/ConceptWorkspaceView.js');
    const el = renderLearningHubConceptMappingControl({ learningHubConcept: { conceptId: 'weather', title: 'Weather' } }, {});
    const buttons = [...el.querySelectorAll('button')].map((b) => b.textContent);
    return { statusText: el.querySelector('.concept-workspace__description-text')?.textContent, buttons };
  }));
  assert.equal(result.statusText, 'Linked to "Weather"');
  assert.deepEqual(result.buttons, ['Change', 'Remove']);
});

test('renderLearningHubConceptMappingControl: Change/Remove buttons call the respective handlers, never saving/clearing directly themselves', async () => {
  const result = await withPage((page) => page.evaluate(async () => {
    const { renderLearningHubConceptMappingControl } = await import('/js/ui/views/ConceptWorkspaceView.js');
    const calls = { opened: 0, cleared: 0 };
    const el = renderLearningHubConceptMappingControl(
      { learningHubConcept: { conceptId: 'weather', title: 'Weather' } },
      { onOpenLearningHubConceptMapping: () => { calls.opened += 1; }, onClearLearningHubConceptMapping: () => { calls.cleared += 1; } }
    );
    document.body.appendChild(el);
    [...el.querySelectorAll('button')].find((b) => b.textContent === 'Change').click();
    [...el.querySelectorAll('button')].find((b) => b.textContent === 'Remove').click();
    el.remove();
    return calls;
  }));
  assert.deepEqual(result, { opened: 1, cleared: 1 });
});

// ---------------------------------------------------------------------
// LearningHubConceptMappingModal — search/select/save/cancel, with
// services/learningHubConceptService.js's searchConcepts() stubbed via
// network-level module interception (see this file's own header
// comment). Each test that needs a particular stub opens its own
// page/route so the ES module cache never leaks a prior test's stub
// into the next one.
// ---------------------------------------------------------------------

async function withStubbedModal({ searchImpl, onSaveImpl }, fn) {
  const page = await browser.newPage();
  try {
    await page.route('**/js/services/learningHubConceptService.js', (route) => {
      route.fulfill({ contentType: 'text/javascript', body: `export async function searchConcepts(q) { ${searchImpl} }` });
    });
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await page.evaluate((onSaveImplSrc) => {
      window.__onSaveCalls = [];
      window.__onSave = new Function('mapping', `
        window.__onSaveCalls.push(mapping);
        ${onSaveImplSrc}
      `);
    }, onSaveImpl || 'return Promise.resolve();');
    return await fn(page);
  } finally {
    await page.close();
  }
}

const WEATHER_RESULT_STUB = `
  if (!q) return [];
  return [{ conceptId: 'weather', title: 'Weather', subject: 'Science' }];
`;

test('LearningHubConceptMappingModal: typing a query renders the matching result with title and subject', async () => {
  const resultText = await withStubbedModal({ searchImpl: WEATHER_RESULT_STUB }, async (page) => {
    await page.evaluate(() => {
      window.__modalModulePromise = import('/js/ui/components/LearningHubConceptMappingModal.js').then(({ openLearningHubConceptMappingModal }) => {
        openLearningHubConceptMappingModal({ currentMapping: null, onSave: window.__onSave });
      });
    });
    await page.waitForFunction(() => window.__modalModulePromise);
    await page.fill('.modal__input', 'weath');
    await page.waitForTimeout(300); // past the 150ms debounce
    return page.$eval('.learning-hub-concept-mapping-result', (el) => el.textContent);
  });
  assert.match(resultText, /Weather/);
  assert.match(resultText, /Science/);
});

test('LearningHubConceptMappingModal: Save is disabled until a result is selected, then selecting one enables it', async () => {
  const states = await withStubbedModal({ searchImpl: WEATHER_RESULT_STUB }, async (page) => {
    await page.evaluate(() => {
      import('/js/ui/components/LearningHubConceptMappingModal.js').then(({ openLearningHubConceptMappingModal }) => {
        openLearningHubConceptMappingModal({ currentMapping: null, onSave: window.__onSave });
      });
    });
    await page.fill('.modal__input', 'weath');
    await page.waitForTimeout(300);
    const before = await page.$eval('.modal__actions .btn--primary', (b) => b.disabled);
    await page.click('.learning-hub-concept-mapping-result');
    const after = await page.$eval('.modal__actions .btn--primary', (b) => b.disabled);
    return { before, after };
  });
  assert.equal(states.before, true);
  assert.equal(states.after, false);
});

test('LearningHubConceptMappingModal: selecting a result and saving calls onSave with {conceptId, title} and closes the modal', async () => {
  const outcome = await withStubbedModal({ searchImpl: WEATHER_RESULT_STUB }, async (page) => {
    await page.evaluate(() => {
      import('/js/ui/components/LearningHubConceptMappingModal.js').then(({ openLearningHubConceptMappingModal }) => {
        openLearningHubConceptMappingModal({ currentMapping: null, onSave: window.__onSave });
      });
    });
    await page.fill('.modal__input', 'weath');
    await page.waitForTimeout(300);
    await page.click('.learning-hub-concept-mapping-result');
    await page.click('.modal__actions .btn--primary');
    await page.waitForTimeout(100);
    const modalStillOpen = (await page.$('.modal-overlay')) !== null;
    const saveCalls = await page.evaluate(() => window.__onSaveCalls);
    return { modalStillOpen, saveCalls };
  });
  assert.equal(outcome.modalStillOpen, false, 'modal must close after a successful save');
  assert.deepEqual(outcome.saveCalls, [{ conceptId: 'weather', title: 'Weather' }]);
});

test('LearningHubConceptMappingModal: Cancel closes the modal without ever calling onSave', async () => {
  const outcome = await withStubbedModal({ searchImpl: WEATHER_RESULT_STUB }, async (page) => {
    await page.evaluate(() => {
      import('/js/ui/components/LearningHubConceptMappingModal.js').then(({ openLearningHubConceptMappingModal }) => {
        openLearningHubConceptMappingModal({ currentMapping: null, onSave: window.__onSave });
      });
    });
    await page.fill('.modal__input', 'weath');
    await page.waitForTimeout(300);
    await page.click('.learning-hub-concept-mapping-result'); // select, then still cancel
    await page.click('.modal__actions .btn--text');
    const modalStillOpen = (await page.$('.modal-overlay')) !== null;
    const saveCalls = await page.evaluate(() => window.__onSaveCalls);
    return { modalStillOpen, saveCalls };
  });
  assert.equal(outcome.modalStillOpen, false);
  assert.deepEqual(outcome.saveCalls, []);
});

test('LearningHubConceptMappingModal: an existing mapping is shown as "Currently linked to ..." (the Change flow)', async () => {
  const noteText = await withStubbedModal({ searchImpl: WEATHER_RESULT_STUB }, async (page) => {
    await page.evaluate(() => {
      import('/js/ui/components/LearningHubConceptMappingModal.js').then(({ openLearningHubConceptMappingModal }) => {
        openLearningHubConceptMappingModal({ currentMapping: { conceptId: 'old-concept', title: 'Old Concept' }, onSave: window.__onSave });
      });
    });
    await page.waitForSelector('.modal-overlay');
    return page.$eval('.missionCaption', (el) => el.textContent);
  });
  assert.match(noteText, /Currently linked to "Old Concept"/);
});

test('LearningHubConceptMappingModal: a blank search clears results rather than calling searchConcepts', async () => {
  const outcome = await withStubbedModal({ searchImpl: 'window.__searchCallCount = (window.__searchCallCount||0)+1; ' + WEATHER_RESULT_STUB }, async (page) => {
    await page.evaluate(() => {
      import('/js/ui/components/LearningHubConceptMappingModal.js').then(({ openLearningHubConceptMappingModal }) => {
        openLearningHubConceptMappingModal({ currentMapping: null, onSave: window.__onSave });
      });
    });
    await page.fill('.modal__input', 'weath');
    await page.waitForTimeout(300);
    await page.fill('.modal__input', '');
    await page.waitForTimeout(300);
    const resultsHtml = await page.$eval('.learning-hub-concept-mapping-results', (el) => el.innerHTML);
    const callCount = await page.evaluate(() => window.__searchCallCount);
    return { resultsHtml, callCount };
  });
  assert.equal(outcome.resultsHtml, '');
  assert.equal(outcome.callCount, 1, 'searchConcepts should only have been called for the non-blank query, not the blank one');
});

test('LearningHubConceptMappingModal: a save failure shows an inline error, re-enables Save, and keeps the modal open for retry', async () => {
  const outcome = await withStubbedModal(
    { searchImpl: WEATHER_RESULT_STUB, onSaveImpl: 'throw new Error("network down");' },
    async (page) => {
      await page.evaluate(() => {
        window.__onSave = async (mapping) => {
          window.__onSaveCalls.push(mapping);
          throw new Error('network down');
        };
      });
      await page.evaluate(() => {
        import('/js/ui/components/LearningHubConceptMappingModal.js').then(({ openLearningHubConceptMappingModal }) => {
          openLearningHubConceptMappingModal({ currentMapping: null, onSave: window.__onSave });
        });
      });
      await page.fill('.modal__input', 'weath');
      await page.waitForTimeout(300);
      await page.click('.learning-hub-concept-mapping-result');
      await page.click('.modal__actions .btn--primary');
      await page.waitForTimeout(100);
      const modalStillOpen = (await page.$('.modal-overlay')) !== null;
      const errorVisible = await page.$eval('.modal__error', (el) => !el.hidden);
      const saveDisabled = await page.$eval('.modal__actions .btn--primary', (b) => b.disabled);
      return { modalStillOpen, errorVisible, saveDisabled };
    }
  );
  assert.equal(outcome.modalStillOpen, true, 'a failed save must keep the modal open so the teacher can retry');
  assert.equal(outcome.errorVisible, true);
  assert.equal(outcome.saveDisabled, false, 'Save must be re-enabled after a failed attempt, not stuck disabled');
});
