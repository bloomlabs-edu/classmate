/**
 * services/classroomSaveStateMachine.js
 *
 * The per-classroom dirty/save-state bookkeeping that used to live
 * directly inside services/workspaceService.js (markDirty(),
 * canApplyIncomingServerState(), setSaveState(), and the "defer an
 * incoming snapshot while it's unsafe to apply, reconcile it once
 * it's safe again" logic). Pulled out into its own module, with zero
 * imports of its own, for exactly one reason: workspaceService.js's
 * own top-level import of repositories/firestoreClassroomRepository.js
 * (which imports the Firestore SDK from a bare `https:` specifier)
 * makes workspaceService.js itself impossible to import under a plain
 * `node --test` run — this is the one piece of that file's logic
 * genuinely worth unit-testing on its own (see
 * tests/services/classroomSaveStateMachine.test.js), so it needed a
 * home that doesn't drag Firestore in just to exercise it.
 *
 * workspaceService.js is still the only real caller, and still owns
 * every Firebase-touching consequence of a transition (persisting via
 * saveExplicitly()/persistClassroom(), applying a reconciled snapshot
 * via classroomService.upsertClassroom()) — this file only ever
 * tracks status and decides *whether* a given snapshot is safe to
 * apply right now, never what applying one actually does. Not a
 * second synchronization mechanism: workspaceService.js's own
 * exported markDirty()/canApplyIncomingServerState()/etc. simply
 * delegate to an instance of this created here.
 *
 * `createSaveStateMachine()` returns a fresh, isolated instance
 * (rather than this module holding one shared Map itself) so tests
 * can create their own without needing to reset shared state between
 * cases — workspaceService.js creates exactly one instance, at module
 * scope, for the app's own lifetime.
 */

export function createSaveStateMachine() {
  // Per classroom id: { status: 'clean' | 'dirty' | 'saving' | 'saved' | 'failed', error }.
  // 'clean' (the default, for any classroom id never seen here) means
  // no local mutation has happened yet this session that hasn't been
  // reconciled with the server — not "we've confirmed nothing
  // changed," just "we have no reason to believe anything did."
  const saveStates = new Map();

  // The latest incoming snapshot for a classroom that arrived while it
  // wasn't safe to apply (see canApplyIncomingServerState() below) —
  // only ever the newest one; an older deferred snapshot is simply
  // replaced, never queued, since only the most current server state
  // is ever worth reconciling.
  const pendingSnapshots = new Map();

  let changeCallback = null;

  function getDefaultSaveState() {
    return { status: 'clean', error: null };
  }

  function getSaveState(classroomId) {
    return saveStates.get(classroomId) || getDefaultSaveState();
  }

  /**
   * Whether a classroom's own working copy is safe to overwrite with
   * an incoming server snapshot right now. Today: 'clean' or 'saved'.
   * Deliberately not *only* 'clean' — a classroom sits at 'saved'
   * indefinitely after a successful save (so a "✓ Changes saved"
   * indicator keeps showing until the next edit, not just for an
   * instant); treating only 'clean' as safe would defer every
   * snapshot forever after the very first successful save, including
   * that save's own echo back from the server. Both 'clean' and
   * 'saved' represent the same real thing this function cares about:
   * no known discrepancy between the working copy and the server
   * right now.
   */
  function canApplyIncomingServerState(classroomId) {
    const status = getSaveState(classroomId).status;
    return status === 'clean' || status === 'saved';
  }

  /**
   * Records a transition and reconciles this classroom's own deferred
   * snapshot, if any and if this transition just made it safe to
   * apply (see canApplyIncomingServerState() above) — that's the only
   * thing that can move a classroom from unsafe to safe. Returns the
   * deferred classroom data to apply now, or null if there was
   * nothing deferred or it's still not safe.
   */
  function setSaveState(classroomId, status, error = null) {
    saveStates.set(classroomId, { status, error });
    changeCallback?.(classroomId, { status, error });
    return reconcilePendingSnapshot(classroomId);
  }

  /**
   * Marks a classroom dirty so an incoming snapshot can't overwrite
   * it until it's saved again. Never downgrades an in-progress save's
   * own 'saving' status — a mutation that happens to land mid-write
   * doesn't un-start that write, it just means there will be more to
   * save once this one settles.
   */
  function markDirty(classroomId) {
    if (getSaveState(classroomId).status === 'saving') return;
    setSaveState(classroomId, 'dirty');
  }

  function isAnySaveInProgress() {
    return Array.from(saveStates.values()).some((state) => state.status === 'saving');
  }

  /** The one active subscriber to every transition here — matches this app's own "one workspace UI showing at a time" convention. */
  function onChange(callback) {
    changeCallback = callback;
  }

  /**
   * Call when a fresh snapshot for a classroom arrives. Returns the
   * classroom data to apply immediately if it's currently safe to, or
   * null if it had to be deferred instead (not discarded — see
   * setSaveState() above for where a deferred snapshot later
   * surfaces, once safe).
   */
  function receiveSnapshot(classroomId, classroomData) {
    if (canApplyIncomingServerState(classroomId)) return classroomData;
    pendingSnapshots.set(classroomId, classroomData);
    return null;
  }

  function reconcilePendingSnapshot(classroomId) {
    if (!pendingSnapshots.has(classroomId)) return null;
    if (!canApplyIncomingServerState(classroomId)) return null;
    const pending = pendingSnapshots.get(classroomId);
    pendingSnapshots.delete(classroomId);
    return pending;
  }

  function hasPendingSnapshot(classroomId) {
    return pendingSnapshots.has(classroomId);
  }

  function clearClassroom(classroomId) {
    saveStates.delete(classroomId);
    pendingSnapshots.delete(classroomId);
  }

  return {
    getSaveState,
    canApplyIncomingServerState,
    setSaveState,
    markDirty,
    isAnySaveInProgress,
    onChange,
    receiveSnapshot,
    hasPendingSnapshot,
    clearClassroom,
  };
}
