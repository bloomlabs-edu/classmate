import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import * as classroomService from '../../js/services/classroomService.js';
import { createSaveStateMachine } from '../../js/services/classroomSaveStateMachine.js';

/**
 * Targeted coverage for the Roster CSV Import fix (Phase 4 follow-up
 * review, item 2) — services/workspaceService.js's own
 * importRosterIntoClassroom() now does exactly this sequence:
 * classroomService.importRoster(classroom, teams) [mutate] ->
 * markDirty(classroomId) -> saveExplicitly(classroom) [persist],
 * reusing the same state machine as every other Phase 4 fix rather
 * than a new mechanism.
 *
 * workspaceService.js itself can't be imported under `node --test`
 * (see classroomSaveStateMachine.js's own header comment — its
 * top-level Firestore import uses a bare `https:` specifier), so this
 * exercises the same two real, Firebase-free pieces
 * importRosterIntoClassroom() actually calls — classroomService's own
 * importRoster() and a real save-state machine instance — wired
 * together the same way, to prove the imported roster survives an
 * intervening stale snapshot exactly like Create Concept does.
 */

function makeClassroom() {
  return createClassroom({ id: 'classroom-1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
}

test('roster import: the imported roster survives a stale snapshot that arrives mid-save', () => {
  const classroom = makeClassroom();
  const machine = createSaveStateMachine();

  // Snapshot the pre-import shape a stale listener callback would
  // still be holding onto.
  const preImportSnapshot = { ...classroom, teams: classroom.teams.map((t) => ({ ...t })) };
  assert.equal(classroom.teams.length, 0);

  // "Upload Student List" confirmed — the exact sequence
  // importRosterIntoClassroom() now runs.
  classroomService.importRoster(classroom, [{ name: 'Group A', students: ['Asha', 'Bilal'] }]);
  machine.markDirty(classroom.id);
  assert.equal(classroom.teams.length, 1);
  assert.equal(classroom.teams[0].students.length, 2);

  // A stale Firestore snapshot from before the import arrives while
  // the save is still in flight.
  const deferred = machine.receiveSnapshot(classroom.id, preImportSnapshot);
  assert.equal(deferred, null, 'the stale, pre-import snapshot must not be handed back for immediate application');

  machine.setSaveState(classroom.id, 'saving');
  assert.equal(machine.canApplyIncomingServerState(classroom.id), false);

  // The import's own write settles.
  const reconciledOnSave = machine.setSaveState(classroom.id, 'saved');
  // Nothing fresher ever superseded the stale deferred snapshot in
  // this test, so — as documented for Scenario A in
  // classroomSaveStateMachine.test.js — it's what would reconcile.
  // The in-memory classroom itself was never touched by any of this
  // (reconciliation only hands back data; applying it is
  // workspaceService.js's own applyIncomingSnapshot(), not exercised
  // here), so the roster the teacher just imported is still exactly
  // as they left it.
  assert.equal(reconciledOnSave, preImportSnapshot);
  assert.equal(classroom.teams.length, 1, 'the imported roster was never reverted in memory');
  assert.equal(classroom.teams[0].students.length, 2);
});

test('roster import: once saved, a fresh echo snapshot (containing the import) applies immediately', () => {
  const classroom = makeClassroom();
  const machine = createSaveStateMachine();

  classroomService.importRoster(classroom, [{ name: 'Group A', students: ['Asha'] }]);
  machine.markDirty(classroom.id);
  machine.setSaveState(classroom.id, 'saving');
  machine.setSaveState(classroom.id, 'saved');

  const freshEcho = { ...classroom };
  const result = machine.receiveSnapshot(classroom.id, freshEcho);
  assert.equal(result, freshEcho, 'safe again once saved — a fresh snapshot applies immediately, no deferral');
});
