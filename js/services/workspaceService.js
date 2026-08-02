/**
 * services/workspaceService.js
 *
 * Orchestrates the Workspace: loading every classroom a teacher belongs
 * to from Firestore in real time, creating/updating/deleting them, and
 * migrating existing data forward exactly once per account. This is the
 * module the UI/router layer talks to for anything workspace- or
 * classroom-level — it never touches Firestore directly, only the
 * repository contract (see repositories/classroomRepository.js).
 *
 * Architecture: UI -> workspaceService (here) -> repository -> Firestore.
 *
 * SHARED CLASSROOMS (this phase): a teacher's classrooms are no longer
 * "their own collection" — each classroom is one shared document any
 * member can read/write, and a teacher's *list* of accessible classrooms
 * is a separate pointer collection (users/{uid}/classroomRefs). So this
 * file now runs a "listener of listeners":
 *   1. One live listener on the teacher's classroomRefs (which
 *      classrooms am I a member of right now?).
 *   2. As that list changes, open or close one live listener per
 *      classroom document referenced — never more than the teacher
 *      actually belongs to, never a duplicate of the same document.
 * Every mutation still updates the in-memory copy immediately (instant
 * UI), then fires an async, incremental write for just the one
 * classroom that changed.
 */

import { LEGACY_STORAGE_KEY } from '../config/appConfig.js';
import { localStorageAdapter } from '../storage/localStorageAdapter.js';
import { firestoreClassroomRepository as repository } from '../repositories/firestoreClassroomRepository.js';
import * as classroomService from './classroomService.js';
import * as memberService from './memberService.js';
import { MEMBER_ROLES } from '../config/memberRoles.js';
import { logPersistenceEvent } from './persistenceLogger.js';
import * as workspaceCoordinator from './workspaceCoordinator.js';

let onChangeCallback = null;
let unsubscribeRefs = null;
const classroomSubscriptions = new Map(); // classroomId -> unsubscribe fn

// Every currently in-flight classroom write, tracked so sign-out can
// wait for all of them to actually settle (success or failure) before
// tearing down the session — see flushPendingSaves() below. Without
// this, save() being fire-and-forget (by design, for instant UI —
// see persistClassroom()'s own comment) meant nothing anywhere ever
// waited for a write to truly finish before a teacher could sign out
// mid-write, a real, reproducible-in-principle gap this closes
// directly rather than papering over with a UI warning.
const pendingSaves = new Set();

/**
 * Temporary explicit-Save workflow state — per explicit product
 * decision, while classroom persistence (especially Subjects) is
 * being stabilized. Deliberately separate from the fire-and-forget
 * autosave path above (persistClassroom/save()), which stays exactly
 * as it was for anything not yet routed through markDirty()/
 * saveExplicitly() below.
 *
 * Per classroom id: { status: 'clean' | 'dirty' | 'saving' | 'saved' | 'failed', error }.
 * 'clean' (the default, for any classroom id never seen here) means
 * no local mutation has happened yet this session that hasn't been
 * explicitly saved — not "we've confirmed nothing changed," just "we
 * have no reason to believe anything did."
 */
const saveStates = new Map();
let saveStateChangeCallback = null;

/**
 * The latest incoming Firestore snapshot for a classroom that arrived
 * while it wasn't safe to apply (see canApplyIncomingServerState()
 * below) — only ever the newest one; an older deferred snapshot is
 * simply replaced, never queued, since only the most current server
 * state is ever worth reconciling.
 */
const pendingSnapshots = new Map(); // classroomId -> deferred classroom data

function getDefaultSaveState() {
  return { status: 'clean', error: null };
}

/**
 * Whether a classroom's own working copy is safe to overwrite with an
 * incoming server snapshot right now — a named policy decision, not a
 * raw status check inlined at each call site, specifically so a
 * future condition (a modal dialog editing this classroom, inline
 * editing, a drag operation in progress) can extend this one decision
 * point later without changing anything about how snapshots actually
 * flow through this file.
 *
 * Today: 'clean' or 'saved'. Deliberately not *only* 'clean' —
 * saveExplicitly() leaves a classroom's status at 'saved' indefinitely
 * (so "\u2713 Changes saved" keeps showing until the next edit, not
 * just for an instant); treating only 'clean' as safe would defer
 * every snapshot forever after the very first successful save,
 * including that save's own echo back from the server. Both 'clean'
 * and 'saved' represent the same real thing this function actually
 * cares about: no known discrepancy between the working copy and the
 * server right now.
 */
export function canApplyIncomingServerState(classroomId) {
  const status = getSaveState(classroomId).status;
  return status === 'clean' || status === 'saved';
}

function setSaveState(classroomId, status, error = null) {
  const previousStatus = getSaveState(classroomId).status;
  logPersistenceEvent(`Save state transition: ${previousStatus} \u2192 ${status}`, { classroomId });
  saveStates.set(classroomId, { status, error });
  saveStateChangeCallback?.(classroomId, { status, error });
  maybeReconcilePendingSnapshot(classroomId);
}

/**
 * Applies a classroom's own latest deferred snapshot, if one exists
 * and it's now safe to (see canApplyIncomingServerState()). Called
 * after every save-state transition here, since that's the only thing
 * in this file today that can move a classroom from unsafe to safe —
 * a future lock condition living elsewhere would call this same
 * function once it releases, rather than this file needing to know
 * that lock exists at all.
 */
function maybeReconcilePendingSnapshot(classroomId) {
  if (!pendingSnapshots.has(classroomId)) return;
  if (!canApplyIncomingServerState(classroomId)) return;
  const pending = pendingSnapshots.get(classroomId);
  pendingSnapshots.delete(classroomId);
  applyIncomingSnapshot(classroomId, pending);
}

/**
 * The one place an incoming server snapshot actually lands in this
 * app's in-memory state — used both for a snapshot applied
 * immediately (see subscribeToClassroom() below) and a previously
 * deferred one applied once safe (see maybeReconcilePendingSnapshot()
 * above). Updates the canonical in-memory classroom, then hands off
 * to whichever active workspace is showing it (see
 * services/workspaceCoordinator.js) — falling back to this file's own
 * onChangeCallback (today's renderRoute()-triggering path) only when
 * nobody is actively viewing this classroom right now.
 */
function applyIncomingSnapshot(classroomId, classroomData) {
  classroomService.upsertClassroom(classroomData);
  if (!workspaceCoordinator.notifyActiveWorkspace(classroomId, classroomData)) {
    onChangeCallback?.();
  }
}

/** The one active subscriber to save-state changes — matches this file's own existing single-callback convention (see onChangeCallback above) for the same reason: one workspace UI showing at a time. */
export function onSaveStateChange(callback) {
  saveStateChangeCallback = callback;
}

export function getSaveState(classroomId) {
  return saveStates.get(classroomId) || getDefaultSaveState();
}

/**
 * Call after any in-place classroom mutation that should go through
 * the explicit-Save workflow instead of autosaving immediately (see
 * ui/views/LearningManagementView.js's own onAddSubject/
 * onRemoveSubject/etc. for which mutations this applies to today).
 * Never downgrades an in-progress save's own 'saving' status — a
 * mutation that happens to land mid-write doesn't un-start that write,
 * it just means there will be more to save the next time Save Changes
 * is clicked.
 */
export function markDirty(classroomId) {
  logPersistenceEvent('markDirty() called', { classroomId });
  if (getSaveState(classroomId).status === 'saving') return;
  setSaveState(classroomId, 'dirty');
}

/** True while any classroom's explicit save is currently in flight — the gate services/authService.js's caller (see main.js's handleSignOut) checks before letting sign-out proceed uninterrupted. */
export function isAnySaveInProgress() {
  return Array.from(saveStates.values()).some((state) => state.status === 'saving');
}

/**
 * The explicit "Save Changes" action — genuinely awaited by its
 * caller, unlike save()'s own fire-and-forget shape above. Sets
 * 'saving' immediately, logs every stage (see
 * services/persistenceLogger.js), and resolves only once the real
 * write has actually settled — this is the one function in this file
 * a caller can rely on to mean "this classroom's current in-memory
 * state is now durably on the server" when it resolves successfully.
 * Rethrows on failure so the caller's own UI can show "Save failed" —
 * this workflow's entire purpose is never silently swallowing a
 * failed write the way the old autosave path could.
 */
export async function saveExplicitly(classroom) {
  logPersistenceEvent('Save started', { classroomId: classroom.id });
  setSaveState(classroom.id, 'saving');
  try {
    await repository.saveClassroom(classroom);
    setSaveState(classroom.id, 'saved');
    logPersistenceEvent('Save completed', { classroomId: classroom.id });
  } catch (error) {
    setSaveState(classroom.id, 'failed', error);

    // Raw, unwrapped exception logging — the object-argument form Chrome
    // collapses as "▶ Object" wasn't visible enough on its own; these
    // print directly, no expansion needed. This is workspaceService.js's
    // own saveExplicitly() — the caller of repository.saveClassroom().
    // If the actual throw happened inside doc() or setDoc() themselves,
    // firestoreClassroomRepository.js's own saveClassroom() now logs
    // that distinctly, before this catch ever sees it re-thrown here.
    console.error('[workspaceService] saveExplicitly() caught an error from repository.saveClassroom():');
    console.error(error);
    console.error('error.name:', error?.name);
    console.error('error.code:', error?.code);
    console.error('error.message:', error?.message);
    console.error('error.stack:', error?.stack);

    logPersistenceEvent('Save failed', {
      classroomId: classroom.id,
      errorName: error?.name,
      errorCode: error?.code,
      errorMessage: error?.message,
      errorStack: error?.stack,
    });
    throw error;
  }
}

/**
 * Migrates any classroom that isn't in the shared model yet to
 * classrooms/{id} + a classroomRefs pointer, adding ownership/membership
 * fields but changing nothing else about the classroom's content.
 * Covers whichever earlier location this teacher's data might still be
 * sitting in:
 *   - Sprint 5's per-owner cloud location (teachers/{uid}/classrooms),
 *     checked first; or, only if that's empty,
 *   - this device's pre-Sprint-5 local-only data (localStorage), for
 *     anyone who somehow never opened the app between those updates.
 * Guarded by a Firestore transaction (services/workspaceService.js's
 * repository.claimMigration), not localStorage, so two devices signing
 * in around the same time can't both run this and duplicate the upload.
 */
async function migrateToSharedClassroomsIfNeeded(uid, displayName) {
  const claimed = await repository.claimMigration(uid);
  if (!claimed) return; // already migrated (by this device or another)

  let legacyClassrooms = await repository.getLegacyClassroomsOnce(uid);
  let cameFromLegacyCloud = legacyClassrooms.length > 0;

  if (!cameFromLegacyCloud) {
    const legacyLocalData = localStorageAdapter.get(LEGACY_STORAGE_KEY);
    legacyClassrooms = Array.isArray(legacyLocalData?.classrooms) ? legacyLocalData.classrooms : [];
  }

  for (const legacyClassroom of legacyClassrooms) {
    const migrated = { ...legacyClassroom };
    delete migrated.administrators;
    delete migrated.teachers;
    migrated.ownerUid = uid;
    migrated.members = {};
    migrated.memberUids = [];
    memberService.addMember(migrated, uid, MEMBER_ROLES.OWNER, displayName);

    // eslint-disable-next-line no-await-in-loop
    await repository.createClassroomWithOwner(migrated, uid);
  }

  if (cameFromLegacyCloud) {
    // Clean up the legacy cloud location now that everything found
    // there has a shared home. (Nothing to clean up if the data came
    // from localStorage instead — that key is simply never read again,
    // since this migration is now permanently marked complete for this
    // account via the transaction above.)
    await Promise.all(legacyClassrooms.map((classroom) => repository.deleteLegacyClassroom(uid, classroom.id)));
  }
}

function subscribeToClassroom(classroomId) {
  if (classroomSubscriptions.has(classroomId)) return;

  let hasLoggedLoad = false;

  const unsubscribe = repository.subscribeToClassroom(
    classroomId,
    (classroomData) => {
      if (classroomData) {
        if (!hasLoggedLoad) {
          hasLoggedLoad = true;
          logPersistenceEvent('Classroom loaded', { classroomId });
        }
        if (canApplyIncomingServerState(classroomId)) {
          applyIncomingSnapshot(classroomId, classroomData);
        } else {
          // Not safe to apply right now (unsaved local work — see
          // canApplyIncomingServerState()'s own reasoning) — deferred,
          // not discarded. Only the newest deferred snapshot is ever
          // kept; an older one simply gets replaced here, never
          // queued, since only the most current server state is worth
          // reconciling once it's safe to.
          pendingSnapshots.set(classroomId, classroomData);
        }
      } else {
        // The document is gone, or this teacher lost access to it —
        // applies immediately regardless of save state, unlike a
        // normal update: there is no "local working copy" to protect
        // once the document itself no longer exists for this teacher.
        classroomService.removeClassroomFromMemory(classroomId);
        onChangeCallback?.();
      }
    },
    (error) => {
      console.error(`[workspaceService] Error listening to classroom ${classroomId}:`, error);
    }
  );

  classroomSubscriptions.set(classroomId, unsubscribe);
}

function unsubscribeFromClassroom(classroomId) {
  classroomSubscriptions.get(classroomId)?.();
  classroomSubscriptions.delete(classroomId);
  classroomService.removeClassroomFromMemory(classroomId);
  pendingSnapshots.delete(classroomId);
}

function unsubscribeFromAllClassrooms() {
  classroomSubscriptions.forEach((unsubscribe) => unsubscribe());
  classroomSubscriptions.clear();
}

function persistClassroom(classroom) {
  if (!classroom) return;
  const writePromise = repository.saveClassroom(classroom).catch((error) => {
    console.error('[workspaceService] persistClassroom() caught an error from repository.saveClassroom():');
    console.error(error);
    console.error('error.name:', error?.name);
    console.error('error.code:', error?.code);
    console.error('error.message:', error?.message);
    console.error('error.stack:', error?.stack);
    logPersistenceEvent('Autosave failed', {
      classroomId: classroom.id,
      errorName: error?.name,
      errorCode: error?.code,
      errorMessage: error?.message,
      errorStack: error?.stack,
    });
  });
  pendingSaves.add(writePromise);
  writePromise.finally(() => pendingSaves.delete(writePromise));
}

/**
 * Waits for every classroom write currently in flight to actually
 * settle (successfully or not) — call this before signing out (see
 * services/authService.js's signOutUser(), or whatever orchestrates
 * sign-out at the UI layer) so a save triggered moments earlier
 * genuinely finishes reaching the server first, rather than racing an
 * auth-session teardown that could otherwise interrupt or invalidate
 * it mid-flight. A no-op, resolving immediately, when nothing is
 * pending.
 */
export async function flushPendingSaves() {
  await Promise.allSettled(Array.from(pendingSaves));
}

/**
 * Call once per sign-in, with the teacher's uid and display name (their
 * safe profile — see services/authService.js). Runs both migration
 * stages (each a no-op after the first time), then subscribes to their
 * classroomRefs, opening/closing one classroom listener per reference as
 * that list changes. `onChange` fires every time anything in the
 * in-memory classroom list changes — a ref appearing/disappearing, or
 * any classroom document updating, from this device or another — so the
 * caller can re-render without the user ever needing to refresh.
 */
export async function initForUser(uid, displayName, onChange, onError) {
  logPersistenceEvent('workspaceService.initForUser() executing', { uid });
  stopListening();
  onChangeCallback = onChange;

  await migrateToSharedClassroomsIfNeeded(uid, displayName);

  unsubscribeRefs = repository.subscribeToClassroomRefs(
    uid,
    (refs) => {
      const currentIds = new Set(refs.map((ref) => ref.classroomId));

      for (const classroomId of Array.from(classroomSubscriptions.keys())) {
        if (!currentIds.has(classroomId)) unsubscribeFromClassroom(classroomId);
      }
      currentIds.forEach((classroomId) => subscribeToClassroom(classroomId));

      onChangeCallback?.();
    },
    (error) => {
      console.error('[workspaceService] classroomRefs subscription error:', error);
      onError?.(error);
    }
  );
}

/** Call on sign-out. Stops every listener and clears the in-memory workspace. */
export function stopListening() {
  logPersistenceEvent('stopListening() executing', { classroomsCleared: classroomService.listClassrooms().length });
  unsubscribeRefs?.();
  unsubscribeRefs = null;
  unsubscribeFromAllClassrooms();
  onChangeCallback = null;
  classroomService.clearAllClassrooms();
}

export function getState() {
  return { classrooms: classroomService.listClassrooms() };
}

export function getClassroomById(id) {
  return classroomService.getClassroomById(id);
}

/**
 * A direct, one-time Firestore read by classroomId — distinct from
 * getClassroomById() above, which reads from the teacher-side
 * subscription cache (classroomService.listClassrooms()) that a
 * student device never populates. Used by
 * services/studentPortalDataService.js, the same way
 * resolveStudentJoinCode()/markStudentJoinedPortal() already read
 * directly via the repository rather than the cache.
 */
export function getClassroomOnce(classroomId) {
  return repository.getClassroomOnce(classroomId);
}

/** `owner` is the creating teacher's safe profile: { uid, displayName }. */
export function createClassroom(details, owner) {
  const classroom = classroomService.createEmptyClassroom(details, owner);
  repository.createClassroomWithOwner(classroom, owner.uid).catch((error) => {
    console.error('[workspaceService] Failed to create classroom:', error);
  });
  // A real, pre-existing gap found while testing the new student
  // join-code flow: createEmptyClassroom() sets both join codes on
  // the classroom object itself (via ensureJoinCode/
  // ensureStudentJoinCode), but neither code's separate, public
  // lookup mapping was ever actually created here — only via the
  // Settings "Generate Classroom ID" fallback button, which exists
  // for classrooms that predate these features. That meant a code
  // generated the normal way, at creation, could never actually
  // resolve. Both mappings need creating right here, for both codes,
  // the moment a classroom is created.
  createJoinCodeMapping(classroom.classroomJoinCode, classroom.id);
  createStudentJoinCodeMapping(classroom.classroomStudentJoinCode, classroom.id);
  return classroom;
}

export function importRosterIntoClassroom(classroomId, teamsWithStudentNames) {
  const classroom = classroomService.getClassroomById(classroomId);
  if (!classroom) return null;
  classroomService.importRoster(classroom, teamsWithStudentNames);
  persistClassroom(classroom);
  return classroom;
}

export function updateClassroomDetails(id, updates) {
  const classroom = classroomService.updateClassroomDetails(id, updates);
  if (classroom) persistClassroom(classroom);
  return classroom;
}

export function deleteClassroom(id) {
  const classroom = classroomService.getClassroomById(id);
  const memberUids = classroom?.memberUids || [];
  const deleted = classroomService.deleteClassroom(id);
  if (deleted) {
    repository.deleteClassroom(id, memberUids).catch((error) => {
      console.error('[workspaceService] Failed to delete classroom:', error);
    });
  }
  return deleted;
}

/**
 * Call after any in-place mutation to a classroom object obtained via
 * getClassroomById() (adding a team, awarding a star, adding a note,
 * changing a bucket, etc.) to persist the change. Takes the classroom
 * explicitly — a teacher can have many classrooms loaded at once, and
 * we only want to write the one that actually changed, not the whole
 * workspace.
 */
export function save(classroom) {
  persistClassroom(classroom);
}

/**
 * A one-time re-fetch that overwrites the in-memory classroom with
 * whatever is actually saved on the server — used by
 * classSessionService.js's discardSession() to throw away draft
 * mutations that were never written. The normal real-time
 * subscription (subscribeToClassroom above) only fires when the
 * server document changes; since a discarded session never wrote
 * anything, that listener would never naturally re-fire to undo the
 * in-memory drift, so this does the one-time read + overwrite
 * directly instead.
 */
export async function reloadClassroomFromServer(classroomId) {
  const classroomData = await repository.getClassroomOnce(classroomId);
  if (classroomData) {
    classroomService.upsertClassroom(classroomData);
    onChangeCallback?.();
  }
}

/** Fire-and-forget, matching save()'s pattern — called once, alongside saving a classroom that just generated a new join code (see classroomService.ensureJoinCode()). */
export function createJoinCodeMapping(code, classroomId) {
  repository.createJoinCodeMapping(code, classroomId).catch((error) => {
    console.error('[workspaceService] Failed to create join code mapping:', error);
  });
}

/**
 * The "Join a Classroom" action a co-teacher uses, from their own
 * account, instead of an email-based invite (this app has no way to
 * look up another account by email). Resolves the code to a
 * classroom, then adds the caller as a teacher member via a narrow,
 * additive-only write — see firestoreClassroomRepository.js's
 * addSelfAsTeacher() for why that shape matters for the security rule
 * it needs.
 *
 * The newly-joined classroom does not need to be added to local state
 * here: addSelfAsTeacher() writes to this uid's own classroomRefs,
 * which the existing subscribeToClassroomRefs() listener (see
 * initForUser() above) already reacts to — the same mechanism that
 * already makes a newly-created classroom appear on Home.
 */
export async function joinClassroomByCode(code, uid, displayName) {
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) {
    return { success: false, reason: 'empty' };
  }

  const classroomId = await repository.getClassroomIdByJoinCode(normalizedCode);
  if (!classroomId) {
    return { success: false, reason: 'not_found' };
  }

  await repository.addSelfAsTeacher(classroomId, uid, {
    role: MEMBER_ROLES.TEACHER,
    displayName: displayName || 'Teacher',
    joinedAt: new Date().toISOString(),
  });

  return { success: true, classroomId };
}

/** Fire-and-forget, matching createJoinCodeMapping()'s pattern — called once, alongside saving a classroom that just generated a new student join code (see classroomService.ensureStudentJoinCode()). */
export function createStudentJoinCodeMapping(code, classroomId) {
  repository.createStudentJoinCodeMapping(code, classroomId).catch((error) => {
    console.error('[workspaceService] Failed to create student join code mapping:', error);
  });
}

/**
 * Checks a PIN a student (or whoever's holding the device) entered
 * against this classroom's Device Reset PIN — see
 * services/studentDeviceService.js's trusted-device model and
 * models/Classroom.js's doc comment on `deviceResetPin` for the full
 * reasoning. Read-only, so unlike markStudentJoinedPortal() below this
 * doesn't touch the unauthenticated-write permission gap at all — a
 * device already reads this same classroom document to resolve its
 * roster in the first place.
 */
export async function verifyDeviceResetPin(classroomId, enteredPin) {
  const classroom = await repository.getClassroomOnce(classroomId);
  if (!classroom || !classroom.deviceResetPin) return false;
  return String(enteredPin).trim() === String(classroom.deviceResetPin).trim();
}

/**
 * Resolves a student join code to the classroom it belongs to —
 * read-only, and deliberately not the same operation as
 * joinClassroomByCode() above: no membership is added, no account is
 * involved, nothing is written. Returns the classroom (so the caller
 * can show its real roster) or null if the code doesn't match
 * anything. This is genuinely new, additive surface — it doesn't
 * touch identity/studentIdentityService.js or any PIN/consent
 * machinery at all.
 */
export async function resolveStudentJoinCode(code) {
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) return null;

  const classroomId = await repository.getClassroomIdByStudentJoinCode(normalizedCode);
  if (!classroomId) return null;

  return repository.getClassroomOnce(classroomId);
}

/**
 * The one shared, teacher-visible write in this whole flow: marks a
 * specific student as having opened the Portal at least once. This is
 * what lets Student Access show anything at all — without it, a
 * device tapping a name would only ever update its own local storage,
 * invisible to the teacher. Deliberately a narrow flag, not an
 * account or a session record.
 *
 * Deliberately fault-tolerant: a student device has no Firebase Auth
 * at all (see studentDeviceService.js), and the current, correctly
 * restrictive Firestore rules reject this write for exactly that
 * reason — there is no safe rule that can permit an unauthenticated
 * client to mutate one nested field without also permitting it to
 * mutate anything else in the document (see firestore.rules' own
 * comment on this same limitation). Rather than block a student's own
 * access to the Portal on a teacher-facing indicator succeeding, a
 * failure here is caught and logged, not thrown — the student still
 * proceeds. The proper fix (restructuring this flag to a top-level
 * field a rule CAN safely permit) is tracked separately, not solved
 * by making this call block the student experience in the meantime.
 */
export async function markStudentJoinedPortal(classroomId, studentId) {
  try {
    const classroom = await repository.getClassroomOnce(classroomId);
    if (!classroom) return;
    const student = classroom.teams.flatMap((team) => team.students).find((s) => s.id === studentId);
    if (!student || student.hasJoinedPortal) return;
    student.hasJoinedPortal = true;
    await repository.saveClassroom(classroom);
  } catch (error) {
    console.warn('[workspaceService] markStudentJoinedPortal failed (non-blocking, student proceeds regardless):', error);
  }
}
