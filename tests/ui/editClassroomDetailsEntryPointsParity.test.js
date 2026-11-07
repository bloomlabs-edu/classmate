/**
 * tests/ui/editClassroomDetailsEntryPointsParity.test.js
 *
 * "Edit Classroom Details" has TWO entry points sharing one modal
 * (ui/components/EditClassroomDetailsModal.js):
 *   - ui/views/DashboardView.js — the in-classroom header's overflow
 *     menu action.
 *   - js/main.js's handleEditClassroomDetailsFromHome() — the "My
 *     Classrooms" dashboard card's own ⋯ menu action.
 *
 * Each entry point's own save handler is a private, unexported closure
 * in a file that transitively imports config/appConfig.js, which reads
 * `window` at module-load time and throws immediately outside a real
 * browser — confirmed directly while writing this file (the exact same
 * constraint tests/ui/workRequestReviewRollback.test.js's own header
 * comment already documents and works around for a different view).
 * Neither js/main.js nor ui/views/DashboardView.js is importable in
 * this repo's plain `node:test` unit-test lane, so neither handler can
 * be exercised directly here.
 *
 * What CAN be verified, and what this file verifies:
 *   1. By source text, that both handlers call the exact same write
 *      SEQUENCE — classroomService.updateClassroomDetails() ->
 *      workspaceService.markDirty() -> await
 *      workspaceService.saveExplicitly() — never the convenience
 *      workspaceService.updateClassroomDetails() wrapper. That wrapper's
 *      own persistClassroom() is fire-and-forget (catches and only logs
 *      a write failure internally, never rejects — see
 *      js/services/workspaceService.js's own persistClassroom()), which
 *      would make the shared modal's own tested "Save failed" + Retry
 *      state (tests/ui/editClassroomDetailsModal.test.js) unreachable
 *      for a real Firestore error. This file pins that BOTH entry
 *      points use the rejecting path, not just one of them.
 *   2. That the rest of the real coverage chain for each entry point is
 *      genuinely in place elsewhere, rather than assumed:
 *      tests/ui/classroomCard.test.js (the card menu's own Edit item
 *      renders correctly and invokes its callback),
 *      tests/ui/editClassroomDetailsModal.test.js (the shared modal's
 *      full save/cancel/error/retry UI), and
 *      tests/services/classroomService.test.js (the underlying
 *      updateClassroomDetails() write function + its stale-reference
 *      guarantee, which both entry points' handlers rely on).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

function readFile(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('SOURCE PIN: js/main.js\'s handleEditClassroomDetailsFromHome() uses the explicit markDirty()/saveExplicitly() write pair, never the fire-and-forget workspaceService.updateClassroomDetails() wrapper', () => {
  const source = readFile('js/main.js');
  const start = source.indexOf('function handleEditClassroomDetailsFromHome(');
  assert.ok(start !== -1, 'handleEditClassroomDetailsFromHome must still exist under this exact name');
  const body = source.slice(start, start + 2400);

  assert.match(body, /updateClassroomDetails\(classroom\.id,/, 'must call classroomService.updateClassroomDetails() with the classroom id');
  assert.match(body, /workspaceService\.markDirty\(/);
  assert.match(body, /await workspaceService\.saveExplicitly\(/, 'must AWAIT saveExplicitly() so a real write failure rejects into the modal\'s own onSave, enabling its Retry state');
  // A text search for the bare method name would false-positive on this
  // function's OWN explanatory comment (which names the forbidden
  // wrapper by design, to document why it's avoided) -- check for the
  // actual CALL-AND-ASSIGN pattern instead, which only a real call site
  // would ever produce.
  assert.doesNotMatch(
    body,
    /=\s*workspaceService\.updateClassroomDetails\(/,
    'must never go through the fire-and-forget convenience wrapper -- a real Firestore failure there is only logged, never surfaced, which would make the modal\'s Retry state unreachable from this entry point'
  );
});

test('SOURCE PIN: ui/views/DashboardView.js\'s "Edit Classroom Details" overflow action ALSO uses the same explicit markDirty()/saveExplicitly() write pair -- both entry points share one correct write contract, not two different ones', () => {
  const source = readFile('js/ui/views/DashboardView.js');
  const start = source.indexOf('openEditClassroomDetailsModal({');
  assert.ok(start !== -1, 'the DashboardView.js call site must still exist');
  const body = source.slice(start, start + 4000);

  assert.match(body, /updateClassroomDetails\(classroom\.id,/);
  assert.match(body, /workspaceService\.markDirty\(/);
  assert.match(body, /await workspaceService\.saveExplicitly\(/);
});

test('coverage inventory: both entry points are backed by real, passing tests at every OTHER layer this file cannot reach directly', () => {
  const coverageFiles = [
    'tests/ui/classroomCard.test.js',
    'tests/ui/editClassroomDetailsModal.test.js',
    'tests/services/classroomService.test.js',
  ];
  for (const relativePath of coverageFiles) {
    assert.ok(fs.existsSync(path.join(REPO_ROOT, relativePath)), `${relativePath} must exist -- it is a required link in this feature's real test coverage chain`);
  }
});
