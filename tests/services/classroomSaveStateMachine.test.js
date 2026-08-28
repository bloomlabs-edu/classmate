import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSaveStateMachine } from '../../js/services/classroomSaveStateMachine.js';

// ---------------------------------------------------------------------
// Baseline status/predicate behavior
// ---------------------------------------------------------------------

test('an unseen classroom defaults to clean, and clean is safe to overwrite', () => {
  const machine = createSaveStateMachine();
  assert.deepEqual(machine.getSaveState('c1'), { status: 'clean', error: null });
  assert.equal(machine.canApplyIncomingServerState('c1'), true);
});

test('canApplyIncomingServerState is true only for clean/saved, false for dirty/saving/failed', () => {
  const machine = createSaveStateMachine();

  machine.setSaveState('c1', 'dirty');
  assert.equal(machine.canApplyIncomingServerState('c1'), false);

  machine.setSaveState('c1', 'saving');
  assert.equal(machine.canApplyIncomingServerState('c1'), false);

  machine.setSaveState('c1', 'failed', new Error('boom'));
  assert.equal(machine.canApplyIncomingServerState('c1'), false);

  machine.setSaveState('c1', 'saved');
  assert.equal(machine.canApplyIncomingServerState('c1'), true);
});

test('markDirty() transitions clean -> dirty', () => {
  const machine = createSaveStateMachine();
  machine.markDirty('c1');
  assert.equal(machine.getSaveState('c1').status, 'dirty');
});

test('markDirty() never downgrades an in-progress save back to dirty', () => {
  const machine = createSaveStateMachine();
  machine.setSaveState('c1', 'saving');
  machine.markDirty('c1');
  assert.equal(machine.getSaveState('c1').status, 'saving');
});

// ---------------------------------------------------------------------
// The actual Phase 4 fix: a stale snapshot must never overwrite a
// newer, not-yet-confirmed local mutation, but must be reconciled the
// moment it's safe to.
// ---------------------------------------------------------------------

test('a snapshot arriving while dirty is deferred, not applied, and returns null', () => {
  const machine = createSaveStateMachine();
  machine.markDirty('c1');

  const result = machine.receiveSnapshot('c1', { units: [] }); // the stale, pre-mutation server state
  assert.equal(result, null);
  assert.equal(machine.hasPendingSnapshot('c1'), true);
});

test('a snapshot arriving while clean/saved is applied immediately (returned, not deferred)', () => {
  const machine = createSaveStateMachine();
  const classroomData = { units: ['unit-a'] };
  const result = machine.receiveSnapshot('c1', classroomData);
  assert.equal(result, classroomData);
  assert.equal(machine.hasPendingSnapshot('c1'), false);
});

test('Scenario A (Create Concept): a stale snapshot deferred mid-save is superseded by this save’s own fresher echo, which is what actually gets reconciled — the newer local mutation is never lost', () => {
  const machine = createSaveStateMachine();

  // Teacher creates Concept X — local workspace is now "A + X".
  machine.markDirty('c1');

  // A Firestore snapshot containing the OLD state ("A" only, from
  // before the Concept existed) arrives before the save completes.
  const staleSnapshot = { concepts: [] }; // "A"
  const deferred = machine.receiveSnapshot('c1', staleSnapshot);
  assert.equal(deferred, null, 'the stale snapshot must not be handed back for immediate application');
  assert.equal(machine.canApplyIncomingServerState('c1'), false);

  // Save begins.
  machine.setSaveState('c1', 'saving');
  assert.equal(machine.canApplyIncomingServerState('c1'), false);

  // Firestore's own listener echoes this exact write back (its local-
  // cache-then-server-ack behavior guarantees this happens for any
  // write this same client makes) — still unsafe to apply immediately
  // (still 'saving'), so it's deferred too, REPLACING the stale one
  // ("only the newest deferred snapshot is ever kept" — see
  // classroomSaveStateMachine.js's own receiveSnapshot()).
  const freshEcho = { concepts: ['X'] }; // "A + X"
  const deferredEcho = machine.receiveSnapshot('c1', freshEcho);
  assert.equal(deferredEcho, null);

  // Save completes.
  const reconciledOnSave = machine.setSaveState('c1', 'saved');
  // What gets reconciled is the fresher echo that replaced the stale
  // entry above, not the original stale one — X is never lost.
  assert.equal(reconciledOnSave, freshEcho, 'the fresher echo (not the earlier stale snapshot, which was already replaced) is what reconciles');
});

test('a stale snapshot deferred mid-save, with no fresher echo ever arriving before the save settles, would be reconciled as-is — reconciliation always trusts the newest deferred snapshot, it does not independently verify freshness', () => {
  // This is the one sharp edge of the existing (unmodified by this
  // phase) mechanism: it relies on Firestore's own listener already
  // guaranteeing a client always sees a fresher echo of its own write
  // before that write's save-state settles (see the test above). If
  // that guarantee ever didn't hold, the stale snapshot deferred
  // earlier would still be the one applied here — documented, not
  // silently assumed.
  const machine = createSaveStateMachine();
  machine.markDirty('c1');
  const staleSnapshot = { concepts: [] };
  machine.receiveSnapshot('c1', staleSnapshot);
  machine.setSaveState('c1', 'saving');

  const reconciled = machine.setSaveState('c1', 'saved');
  assert.equal(reconciled, staleSnapshot);
});

test('only the newest deferred snapshot is kept — an older one is replaced, not queued', () => {
  const machine = createSaveStateMachine();
  machine.markDirty('c1');

  machine.receiveSnapshot('c1', { version: 1 });
  machine.receiveSnapshot('c1', { version: 2 });

  const reconciled = machine.setSaveState('c1', 'saved');
  assert.deepEqual(reconciled, { version: 2 });
});

test('a deferred snapshot reconciles the instant the classroom becomes safe again', () => {
  const machine = createSaveStateMachine();
  machine.setSaveState('c1', 'saving');

  const deferredWhileSaving = machine.receiveSnapshot('c1', { version: 'in-flight' });
  assert.equal(deferredWhileSaving, null);

  const reconciled = machine.setSaveState('c1', 'saved');
  assert.deepEqual(reconciled, { version: 'in-flight' });
  assert.equal(machine.hasPendingSnapshot('c1'), false);
});

// ---------------------------------------------------------------------
// Notification / multi-classroom isolation
// ---------------------------------------------------------------------

test('onChange fires for every transition, including markDirty()', () => {
  const machine = createSaveStateMachine();
  const seen = [];
  machine.onChange((classroomId, state) => seen.push([classroomId, state.status]));

  machine.markDirty('c1');
  machine.setSaveState('c1', 'saving');
  machine.setSaveState('c1', 'saved');

  assert.deepEqual(seen, [
    ['c1', 'dirty'],
    ['c1', 'saving'],
    ['c1', 'saved'],
  ]);
});

test('isAnySaveInProgress reflects "saving" across any classroom, and clears once none are saving', () => {
  const machine = createSaveStateMachine();
  assert.equal(machine.isAnySaveInProgress(), false);

  machine.setSaveState('c1', 'saving');
  assert.equal(machine.isAnySaveInProgress(), true);

  machine.setSaveState('c2', 'dirty');
  assert.equal(machine.isAnySaveInProgress(), true, 'c1 is still saving');

  machine.setSaveState('c1', 'saved');
  assert.equal(machine.isAnySaveInProgress(), false);
});

test('each classroom id tracks its own independent state', () => {
  const machine = createSaveStateMachine();
  machine.markDirty('c1');
  assert.equal(machine.getSaveState('c1').status, 'dirty');
  assert.equal(machine.getSaveState('c2').status, 'clean');
});

test('clearClassroom() removes both save state and any pending snapshot', () => {
  const machine = createSaveStateMachine();
  machine.markDirty('c1');
  machine.receiveSnapshot('c1', { version: 1 });
  assert.equal(machine.hasPendingSnapshot('c1'), true);

  machine.clearClassroom('c1');
  assert.equal(machine.getSaveState('c1').status, 'clean');
  assert.equal(machine.hasPendingSnapshot('c1'), false);
});

// ---------------------------------------------------------------------
// Scenario C/D (failure/retry, success) at the state-machine level —
// the UI-level retry guard (never re-running the mutation itself) is
// implemented in the calling view/modal, but the underlying state
// transitions they rely on are exercised here.
// ---------------------------------------------------------------------

test('Scenario C (persistence failure): failed is not safe to overwrite, and a subsequent retry-success reconciles cleanly', () => {
  const machine = createSaveStateMachine();
  machine.markDirty('c1');
  machine.setSaveState('c1', 'saving');

  const error = new Error('network down');
  machine.setSaveState('c1', 'failed', error);
  assert.equal(machine.getSaveState('c1').error, error);
  assert.equal(machine.canApplyIncomingServerState('c1'), false, 'a failed save must not accept a stale snapshot either — the local mutation is still the only copy that exists');

  // Retry: caller re-attempts the same save, no re-mutation.
  machine.setSaveState('c1', 'saving');
  const reconciled = machine.setSaveState('c1', 'saved');
  assert.equal(reconciled, null);
  assert.equal(machine.canApplyIncomingServerState('c1'), true);
});

test('Scenario B (rapid re-entrant calls): repeated markDirty() calls before a save starts collapse to one dirty state, not a growing queue', () => {
  const machine = createSaveStateMachine();
  const seen = [];
  machine.onChange((classroomId, state) => seen.push(state.status));

  machine.markDirty('c1');
  machine.markDirty('c1');
  machine.markDirty('c1');

  // Three rapid "clicks" before any save started produce three
  // transitions, but the resulting status is still just one thing —
  // 'dirty' — not three distinct queued saves. (The caller-side guard
  // against literally re-running the mutation a second/third time
  // lives in the UI handler, e.g. LearningManagementView's
  // onCreateUnit/onCreateConcept — this asserts the state machine's
  // own contribution: no matter how many times markDirty() fires, the
  // status never becomes anything other than 'dirty' until a real
  // save transitions it.)
  assert.deepEqual(seen, ['dirty', 'dirty', 'dirty']);
  assert.equal(machine.getSaveState('c1').status, 'dirty');
});
