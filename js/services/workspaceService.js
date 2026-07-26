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

let onChangeCallback = null;
let unsubscribeRefs = null;
const classroomSubscriptions = new Map(); // classroomId -> unsubscribe fn

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

  const unsubscribe = repository.subscribeToClassroom(
    classroomId,
    (classroomData) => {
      if (classroomData) {
        classroomService.upsertClassroom(classroomData);
      } else {
        // The document is gone, or this teacher lost access to it.
        classroomService.removeClassroomFromMemory(classroomId);
      }
      onChangeCallback?.();
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
}

function unsubscribeFromAllClassrooms() {
  classroomSubscriptions.forEach((unsubscribe) => unsubscribe());
  classroomSubscriptions.clear();
}

function persistClassroom(classroom) {
  if (!classroom) return;
  repository.saveClassroom(classroom).catch((error) => {
    console.error('[workspaceService] Failed to save classroom:', error);
  });
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
