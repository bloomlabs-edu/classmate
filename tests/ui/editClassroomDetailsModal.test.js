/**
 * tests/ui/editClassroomDetailsModal.test.js
 *
 * ui/components/EditClassroomDetailsModal.js creates real DOM (an
 * overlay + modal) and uses window.alert() for client-side validation —
 * same reasoning as tests/ui/addExistingStudentsModal.test.js's own
 * header comment on why this needs a real browser, not plain
 * `node --test`. Drives a real headless Chromium page via Playwright,
 * serving this repo's actual files from a local static server — no
 * Firestore, no production, nothing written anywhere outside the page.
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

function buildFixtureClassroom() {
  return { id: 'classroom-1', classroomName: 'Bloom Force 19', description: 'A great bunch of Grade 8 learners.' };
}

test('pre-fills the existing Classroom Name and Description, and labels the Save button correctly', async () => {
  const result = await page.evaluate(async (classroom) => {
    const { openEditClassroomDetailsModal } = await import('/js/ui/components/EditClassroomDetailsModal.js');
    document.querySelectorAll('.modal-overlay').forEach((el) => el.remove());
    openEditClassroomDetailsModal({ classroom, onSave: async () => {} });
    const overlay = document.querySelector('.modal-overlay');
    const inputs = overlay.querySelectorAll('.modal__input');
    return {
      hasOverlay: !!overlay,
      heading: overlay.querySelector('.modal__heading').textContent,
      nameValue: inputs[0].value,
      descriptionValue: inputs[1].value,
      saveText: overlay.querySelector('.btn--primary').textContent,
    };
  }, buildFixtureClassroom());

  assert.equal(result.hasOverlay, true);
  assert.equal(result.heading, 'Edit Classroom Details');
  assert.equal(result.nameValue, 'Bloom Force 19');
  assert.equal(result.descriptionValue, 'A great bunch of Grade 8 learners.');
  assert.equal(result.saveText, 'Save');
});

test('pre-fills blank fields honestly when the classroom has no name/description yet (never fabricated placeholder text)', async () => {
  const result = await page.evaluate(async () => {
    const { openEditClassroomDetailsModal } = await import('/js/ui/components/EditClassroomDetailsModal.js');
    document.querySelectorAll('.modal-overlay').forEach((el) => el.remove());
    openEditClassroomDetailsModal({ classroom: { id: 'c2' }, onSave: async () => {} });
    const overlay = document.querySelector('.modal-overlay');
    const inputs = overlay.querySelectorAll('.modal__input');
    return { nameValue: inputs[0].value, descriptionValue: inputs[1].value };
  });

  assert.equal(result.nameValue, '');
  assert.equal(result.descriptionValue, '');
});

test('validation: an empty Classroom Name shows an alert, keeps the modal open, and never calls onSave', async () => {
  let alertMessage = null;
  page.once('dialog', async (dialog) => {
    alertMessage = dialog.message();
    await dialog.accept();
  });

  const result = await page.evaluate(async (classroom) => {
    const { openEditClassroomDetailsModal } = await import('/js/ui/components/EditClassroomDetailsModal.js');
    document.querySelectorAll('.modal-overlay').forEach((el) => el.remove());
    let onSaveCallCount = 0;
    openEditClassroomDetailsModal({ classroom, onSave: async () => { onSaveCallCount += 1; } });
    const overlay = document.querySelector('.modal-overlay');
    const nameInput = overlay.querySelectorAll('.modal__input')[0];
    nameInput.value = '   '; // whitespace-only must also count as empty, after trim()
    overlay.querySelector('.btn--primary').click();
    // Give the click handler's synchronous validation branch a tick to run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.__onSaveCallCount = onSaveCallCount;
    return { stillOpen: !!document.querySelector('.modal-overlay'), onSaveCallCount };
  }, buildFixtureClassroom());

  assert.equal(alertMessage, 'Classroom Name is required.');
  assert.equal(result.stillOpen, true);
  assert.equal(result.onSaveCallCount, 0);
});

test('cancellation: Cancel closes the modal without ever calling onSave, and leaves the typed changes behind unsaved', async () => {
  const result = await page.evaluate(async (classroom) => {
    const { openEditClassroomDetailsModal } = await import('/js/ui/components/EditClassroomDetailsModal.js');
    document.querySelectorAll('.modal-overlay').forEach((el) => el.remove());
    let onSaveCallCount = 0;
    openEditClassroomDetailsModal({ classroom, onSave: async () => { onSaveCallCount += 1; } });
    const overlay = document.querySelector('.modal-overlay');
    overlay.querySelectorAll('.modal__input')[0].value = 'Unsaved New Name';
    [...overlay.querySelectorAll('.btn--text')].find((btn) => btn.textContent === 'Cancel').click();
    return { stillOpen: !!document.querySelector('.modal-overlay'), onSaveCallCount };
  }, buildFixtureClassroom());

  assert.equal(result.stillOpen, false);
  assert.equal(result.onSaveCallCount, 0);
});

test('clicking the overlay itself (outside the modal) also cancels without calling onSave', async () => {
  const result = await page.evaluate(async (classroom) => {
    const { openEditClassroomDetailsModal } = await import('/js/ui/components/EditClassroomDetailsModal.js');
    document.querySelectorAll('.modal-overlay').forEach((el) => el.remove());
    let onSaveCallCount = 0;
    openEditClassroomDetailsModal({ classroom, onSave: async () => { onSaveCallCount += 1; } });
    const overlay = document.querySelector('.modal-overlay');
    overlay.click(); // a click directly on the overlay, not the modal card inside it
    return { stillOpen: !!document.querySelector('.modal-overlay'), onSaveCallCount };
  }, buildFixtureClassroom());

  assert.equal(result.stillOpen, false);
  assert.equal(result.onSaveCallCount, 0);
});

test('editing: trims whitespace and calls onSave with exactly the Classroom Name and Description fields, then shows a success state before closing', async () => {
  const result = await page.evaluate(async (classroom) => {
    const { openEditClassroomDetailsModal } = await import('/js/ui/components/EditClassroomDetailsModal.js');
    document.querySelectorAll('.modal-overlay').forEach((el) => el.remove());
    const onSaveCalls = [];
    openEditClassroomDetailsModal({
      classroom,
      onSave: async (updates) => {
        onSaveCalls.push(updates);
      },
    });
    const overlay = document.querySelector('.modal-overlay');
    const inputs = overlay.querySelectorAll('.modal__input');
    inputs[0].value = '  Renamed Classroom  ';
    inputs[1].value = '  Updated description.  ';

    const saveButton = overlay.querySelector('.btn--primary');
    saveButton.click();
    // Capture the button's label the instant the click handler sets it,
    // before the (synchronously-resolving, in this test) onSave promise
    // settles — proves a visible "Saving…" state exists, not just an
    // instantaneous close.
    const savingText = saveButton.textContent;

    await new Promise((resolve) => setTimeout(resolve, 0));
    const savedText = saveButton.textContent;

    // The modal auto-closes shortly after success (see the component's
    // own setTimeout(close, 500)) — wait past that.
    await new Promise((resolve) => setTimeout(resolve, 700));
    return {
      onSaveCalls,
      savingText,
      savedText,
      stillOpenAfterDelay: !!document.querySelector('.modal-overlay'),
    };
  }, buildFixtureClassroom());

  assert.deepEqual(result.onSaveCalls, [{ classroomName: 'Renamed Classroom', description: 'Updated description.' }]);
  assert.equal(result.savingText, 'Saving…');
  assert.equal(result.savedText, '✓ Saved');
  assert.equal(result.stillOpenAfterDelay, false);
});

test('editing: Description can be cleared to empty — it is optional', async () => {
  const result = await page.evaluate(async (classroom) => {
    const { openEditClassroomDetailsModal } = await import('/js/ui/components/EditClassroomDetailsModal.js');
    document.querySelectorAll('.modal-overlay').forEach((el) => el.remove());
    const onSaveCalls = [];
    openEditClassroomDetailsModal({ classroom, onSave: async (updates) => { onSaveCalls.push(updates); } });
    const overlay = document.querySelector('.modal-overlay');
    overlay.querySelectorAll('.modal__input')[1].value = '';
    overlay.querySelector('.btn--primary').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return onSaveCalls;
  }, buildFixtureClassroom());

  assert.deepEqual(result, [{ classroomName: 'Bloom Force 19', description: '' }]);
});

test('persistence error: a rejected onSave shows an inline error, flips Save to Retry, re-enables the form, and never closes the modal', async () => {
  const result = await page.evaluate(async (classroom) => {
    const { openEditClassroomDetailsModal } = await import('/js/ui/components/EditClassroomDetailsModal.js');
    document.querySelectorAll('.modal-overlay').forEach((el) => el.remove());
    let attempt = 0;
    openEditClassroomDetailsModal({
      classroom,
      onSave: async () => {
        attempt += 1;
        throw new Error('simulated Firestore write failure');
      },
    });
    const overlay = document.querySelector('.modal-overlay');
    const saveButton = overlay.querySelector('.btn--primary');
    const nameInput = overlay.querySelectorAll('.modal__input')[0];

    saveButton.click();
    const disabledWhileSaving = { save: saveButton.disabled, name: nameInput.disabled };

    await new Promise((resolve) => setTimeout(resolve, 0));

    const errorEl = overlay.querySelector('.modal__error');
    return {
      stillOpen: !!document.querySelector('.modal-overlay'),
      disabledWhileSaving,
      disabledAfterFailure: { save: saveButton.disabled, name: nameInput.disabled },
      saveTextAfterFailure: saveButton.textContent,
      errorVisible: !errorEl.hidden,
      errorText: errorEl.textContent,
      attempt,
    };
  }, buildFixtureClassroom());

  assert.equal(result.stillOpen, true);
  assert.equal(result.disabledWhileSaving.save, true);
  assert.equal(result.disabledWhileSaving.name, true);
  assert.equal(result.disabledAfterFailure.save, false);
  assert.equal(result.disabledAfterFailure.name, false);
  assert.equal(result.saveTextAfterFailure, 'Retry');
  assert.equal(result.errorVisible, true);
  assert.match(result.errorText, /Save failed/);
  assert.equal(result.attempt, 1);
});

test('persistence error: clicking Retry after a failure calls onSave again and can succeed the second time', async () => {
  const result = await page.evaluate(async (classroom) => {
    const { openEditClassroomDetailsModal } = await import('/js/ui/components/EditClassroomDetailsModal.js');
    document.querySelectorAll('.modal-overlay').forEach((el) => el.remove());
    let attempt = 0;
    openEditClassroomDetailsModal({
      classroom,
      onSave: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('simulated Firestore write failure');
      },
    });
    const overlay = document.querySelector('.modal-overlay');
    const saveButton = overlay.querySelector('.btn--primary');

    saveButton.click(); // attempt 1 — fails
    await new Promise((resolve) => setTimeout(resolve, 0));
    const failedOnce = { stillOpen: !!document.querySelector('.modal-overlay'), attempt };

    saveButton.click(); // attempt 2 — succeeds (this is the same "Retry" button)
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 700)); // past the post-success auto-close delay

    return { failedOnce, attempt, stillOpenAfterRetry: !!document.querySelector('.modal-overlay') };
  }, buildFixtureClassroom());

  assert.equal(result.failedOnce.stillOpen, true);
  assert.equal(result.failedOnce.attempt, 1);
  assert.equal(result.attempt, 2);
  assert.equal(result.stillOpenAfterRetry, false);
});

test('a second click on Save while a save is already in flight is a no-op (re-entrancy guard)', async () => {
  const result = await page.evaluate(async (classroom) => {
    const { openEditClassroomDetailsModal } = await import('/js/ui/components/EditClassroomDetailsModal.js');
    document.querySelectorAll('.modal-overlay').forEach((el) => el.remove());
    let onSaveCallCount = 0;
    let resolveFirstSave;
    openEditClassroomDetailsModal({
      classroom,
      onSave: () => new Promise((resolve) => {
        onSaveCallCount += 1;
        resolveFirstSave = resolve;
      }),
    });
    const overlay = document.querySelector('.modal-overlay');
    const saveButton = overlay.querySelector('.btn--primary');
    saveButton.click(); // starts the in-flight save
    saveButton.click(); // disabled already — must not start a second one
    saveButton.click();
    resolveFirstSave();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { onSaveCallCount };
  }, buildFixtureClassroom());

  assert.equal(result.onSaveCallCount, 1);
});
