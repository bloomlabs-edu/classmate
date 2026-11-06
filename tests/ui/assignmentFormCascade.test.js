/**
 * tests/ui/assignmentFormCascade.test.js
 *
 * Workstream 4B: ui/views/AssignmentTrackerView.js's own
 * renderAssignmentForm() — the Subject -> Unit -> Concept cascade.
 * Previously the Concept section showed every concept across every
 * subject/unit in the whole classroom, completely unfiltered, and
 * never re-rendered when Subject changed at all. Real-browser test
 * (not a hand-rolled DOM shim) since this is genuine event-driven
 * cascade behavior (change listeners rebuilding dependent <select>s and
 * re-rendering a dependent section) — same rationale as this
 * directory's other real-Chromium tests.
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

/** Builds a classroom with two Subjects, each with two Units, each with two Concepts -- enough to prove cascade isolation in both directions -- then mounts renderAssignmentForm() and drives it entirely in-page. */
async function withForm(scenario) {
  return page.evaluate(async (scenario) => {
    const { renderAssignmentForm } = await import('/js/ui/views/AssignmentTrackerView.js');
    const { createLearningSubject } = await import('/js/models/LearningSubject.js');
    const { createLearningUnit } = await import('/js/models/LearningUnit.js');
    const { createLearningConcept } = await import('/js/models/LearningConcept.js');
    const { createAssignmentCategory } = await import('/js/models/AssignmentCategory.js');

    const scienceU1 = createLearningUnit({
      id: 'sci-u1',
      title: 'Chemical Reactions',
      number: 12,
      concepts: [createLearningConcept({ id: 'c-sci-u1-a', title: 'Balancing Equations' }), createLearningConcept({ id: 'c-sci-u1-b', title: 'Types of Reactions' })],
    });
    const scienceU2 = createLearningUnit({
      id: 'sci-u2',
      title: 'Metals and Non-metals',
      number: 13,
      concepts: [createLearningConcept({ id: 'c-sci-u2-a', title: 'Reactivity Series' })],
    });
    const mathsU1 = createLearningUnit({
      id: 'math-u1',
      title: 'Algebra Basics',
      number: 1,
      concepts: [createLearningConcept({ id: 'c-math-u1-a', title: 'Linear Equations' })],
    });

    const science = createLearningSubject({ id: 'subj-sci', subjectId: 'science', title: 'Science', units: [scienceU1, scienceU2] });
    const maths = createLearningSubject({ id: 'subj-math', subjectId: 'mathematics', title: 'Mathematics', units: [mathsU1] });

    const classroom = {
      assignmentConfig: { categories: [] },
      assignments: [],
      learningRecord: { subjects: [science, maths] },
    };
    const category = createAssignmentCategory({ id: 'cat-1', name: 'Worksheets' });
    classroom.assignmentConfig.categories.push(category);

    let saved = null;
    const handlers = { onSave: (fields) => { saved = fields; }, onCancelEdit: () => {} };

    const container = document.createElement('div');
    document.body.appendChild(container);
    container.appendChild(renderAssignmentForm(scenario.existingAssignment || null, classroom, handlers));

    // `scenario.run` crosses page.evaluate()'s own serialization boundary
    // as a plain string (functions can't be passed through), so it's
    // compiled back into a real function here, inside the page.
    // eslint-disable-next-line no-eval
    const runFn = (0, eval)(scenario.run);
    const result = await runFn({ container, saved: () => saved });
    container.remove();
    return result;
  }, scenario);
}

test('CASCADE: selecting a Subject populates the Unit select with exactly that subject’s own units', async () => {
  const result = await withForm({
    run: `(async ({ container }) => {
      const [, subjectSelect, unitSelect] = container.querySelectorAll('select');
      subjectSelect.value = 'subj-sci';
      subjectSelect.dispatchEvent(new Event('change', { bubbles: true }));
      const unitLabels = Array.from(unitSelect.options).map((o) => o.textContent);
      return { unitLabels };
    })`,
  });
  assert.deepEqual(result.unitLabels, ['No unit set', 'Unit 12: Chemical Reactions', 'Unit 13: Metals and Non-metals']);
});

test('CASCADE: selecting a Unit shows ONLY that unit’s own concepts, not the whole subject’s', async () => {
  const result = await withForm({
    run: `(async ({ container }) => {
      const [, subjectSelect, unitSelect] = container.querySelectorAll('select');
      subjectSelect.value = 'subj-sci';
      subjectSelect.dispatchEvent(new Event('change', { bubbles: true }));
      unitSelect.value = 'sci-u1';
      unitSelect.dispatchEvent(new Event('change', { bubbles: true }));
      const conceptLabels = Array.from(container.querySelectorAll('.assignment-form__concept-option span')).map((s) => s.textContent);
      return { conceptLabels };
    })`,
  });
  assert.deepEqual(result.conceptLabels, ['Balancing Equations', 'Types of Reactions']);
});

test('CASCADE: changing Unit refreshes to the new unit’s own concepts only', async () => {
  const result = await withForm({
    run: `(async ({ container }) => {
      const [, subjectSelect, unitSelect] = container.querySelectorAll('select');
      subjectSelect.value = 'subj-sci';
      subjectSelect.dispatchEvent(new Event('change', { bubbles: true }));
      unitSelect.value = 'sci-u1';
      unitSelect.dispatchEvent(new Event('change', { bubbles: true }));
      unitSelect.value = 'sci-u2';
      unitSelect.dispatchEvent(new Event('change', { bubbles: true }));
      const conceptLabels = Array.from(container.querySelectorAll('.assignment-form__concept-option span')).map((s) => s.textContent);
      return { conceptLabels };
    })`,
  });
  assert.deepEqual(result.conceptLabels, ['Reactivity Series']);
});

test('CASCADE: with no Unit selected, the concept section shows a hint, not every concept in the classroom', async () => {
  const result = await withForm({
    run: `(async ({ container }) => {
      const [, subjectSelect] = container.querySelectorAll('select');
      subjectSelect.value = 'subj-sci';
      subjectSelect.dispatchEvent(new Event('change', { bubbles: true }));
      const conceptLabels = Array.from(container.querySelectorAll('.assignment-form__concept-option span')).map((s) => s.textContent);
      const hintText = container.querySelector('.assignment-form__concept-empty')?.textContent || null;
      return { conceptLabels, hintText };
    })`,
  });
  assert.deepEqual(result.conceptLabels, []);
  assert.match(result.hintText, /Select a Subject and Unit/);
});

test('CASCADE: changing Subject clears the previously selected Unit and its concept checkboxes', async () => {
  const result = await withForm({
    run: `(async ({ container }) => {
      const [, subjectSelect, unitSelect] = container.querySelectorAll('select');
      subjectSelect.value = 'subj-sci';
      subjectSelect.dispatchEvent(new Event('change', { bubbles: true }));
      unitSelect.value = 'sci-u1';
      unitSelect.dispatchEvent(new Event('change', { bubbles: true }));
      container.querySelector('.assignment-form__concept-option input[type=checkbox]').click();

      // Now switch Subject entirely -- Unit 12/concept selection belongs to Science, not Mathematics.
      subjectSelect.value = 'subj-math';
      subjectSelect.dispatchEvent(new Event('change', { bubbles: true }));

      const unitLabels = Array.from(unitSelect.options).map((o) => o.textContent);
      const unitValue = unitSelect.value;
      const conceptLabels = Array.from(container.querySelectorAll('.assignment-form__concept-option span')).map((s) => s.textContent);
      return { unitLabels, unitValue, conceptLabels };
    })`,
  });
  assert.deepEqual(result.unitLabels, ['No unit set', 'Unit 1: Algebra Basics']);
  assert.equal(result.unitValue, '', 'Unit selection must reset to "No unit set"');
  assert.deepEqual(result.conceptLabels, [], 'no Unit is selected yet under the new Subject');
});

test('EDIT: opening an existing Assignment preserves its Subject, Unit, and checked concepts', async () => {
  const result = await withForm({
    existingAssignment: {
      id: 'assign-1',
      categoryId: 'cat-1',
      title: 'Balancing Practice',
      subjectId: 'subj-sci',
      unitId: 'sci-u1',
      conceptIds: ['c-sci-u1-b'],
      code: 'WS-SCI-U12-01',
    },
    run: `(async ({ container }) => {
      const checked = Array.from(container.querySelectorAll('.assignment-form__concept-option input[type=checkbox]'))
        .filter((cb) => cb.checked)
        .map((cb) => cb.closest('.assignment-form__concept-option').querySelector('span').textContent);
      const codeDisplay = container.querySelector('.assignment-form__code-display')?.textContent || null;
      const titleValue = container.querySelector('input[type=text]').value;
      return { checked, codeDisplay, titleValue };
    })`,
  });
  assert.deepEqual(result.checked, ['Types of Reactions']);
  assert.equal(result.codeDisplay, 'WS-SCI-U12-01');
  assert.equal(result.titleValue, 'Balancing Practice');
});

test('LEGACY: a concept id that no longer resolves to any current concept is preserved on save, never silently dropped', async () => {
  const result = await withForm({
    existingAssignment: {
      id: 'assign-1',
      categoryId: 'cat-1',
      title: 'Old Worksheet',
      subjectId: 'subj-sci',
      unitId: 'sci-u1',
      conceptIds: ['c-sci-u1-b', 'c-deleted-long-ago'],
    },
    run: `(async ({ container, saved }) => {
      const preservedNote = container.querySelector('.assignment-form__concept-empty')?.textContent || null;
      container.querySelector('.notebook-checkpoints__form-actions .btn--primary').click();
      return { preservedNote, savedConceptIds: saved().conceptIds };
    })`,
  });
  assert.match(result.preservedNote, /1 previously linked concept/);
  assert.ok(result.savedConceptIds.includes('c-deleted-long-ago'), 'the unresolvable legacy link must survive the save, not be dropped');
  assert.ok(result.savedConceptIds.includes('c-sci-u1-b'), 'the still-valid, checked concept must also be saved');
});

test('SAVE: a brand-new Assignment saves the selected Subject and Unit ids', async () => {
  const result = await withForm({
    run: `(async ({ container, saved }) => {
      container.querySelector('input[type=text]').value = 'New Worksheet';
      const [, subjectSelect, unitSelect] = container.querySelectorAll('select');
      subjectSelect.value = 'subj-sci';
      subjectSelect.dispatchEvent(new Event('change', { bubbles: true }));
      unitSelect.value = 'sci-u1';
      unitSelect.dispatchEvent(new Event('change', { bubbles: true }));
      container.querySelector('.notebook-checkpoints__form-actions .btn--primary').click();
      return { saved: saved() };
    })`,
  });
  assert.equal(result.saved.subjectId, 'subj-sci');
  assert.equal(result.saved.unitId, 'sci-u1');
});
