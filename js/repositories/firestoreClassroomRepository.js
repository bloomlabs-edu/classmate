/**
 * repositories/firestoreClassroomRepository.js
 *
 * The concrete ClassroomRepository implementation backed by Firestore.
 * This is the *only* file in the app that imports the Firestore SDK or
 * knows the document path shapes:
 *   classrooms/{classroomId}                  — one shared document per classroom
 *   users/{uid}/classroomRefs/{classroomId}    — a lightweight pointer, not a copy
 *   users/{uid}                                — per-account flags (migration),
 *                                                 `recentNotebooks` (Continue Working —
 *                                                 see services/continueWorkingService.js),
 *                                                 and `fcmTokens` (browser push registration —
 *                                                 see services/pushNotificationService.js);
 *                                                 personal to the teacher, never the classroom
 *   teachers/{uid}/classrooms/{classroomId}    — legacy, pre-sharing location (read/delete only, for migration)
 *
 * services/workspaceService.js talks to this only through the
 * ClassroomRepository contract, never to Firestore APIs directly.
 *
 * Uses the SDK's default, in-memory-only cache (no persistentLocalCache())
 * — see the comment on `_getDb()` below for why: this app's own
 * IndexedDB-persisted cache was found to get stuck reporting a real,
 * existing document as nonexistent, with no way to recover short of
 * a user clearing that device's storage. Offline writes still queue
 * and sync automatically once reconnected, for the duration of a
 * single page session; nothing is persisted across a reload or app
 * restart.
 */

import {
  initializeFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  onSnapshot,
  getDocs,
  writeBatch,
  runTransaction,
  arrayUnion,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';
import { ClassroomRepository } from './classroomRepository.js';

/**
 * TEMPORARY DIAGNOSTIC — walks an entire object tree and returns the
 * full property path of every value that is exactly `undefined`
 * (e.g. "learningRecord.subjects[2].linkedCurriculumIndexId"), not
 * just the first one Firestore's own error happens to name — along
 * with the actual parent object each one was found on, so the
 * surrounding context is visible too, not just an address string.
 * Called immediately before setDoc() in saveClassroom() below, purely
 * to identify where an undefined value actually originates in the
 * real, live classroom object — this does not strip or replace
 * anything; the object passed to setDoc() is completely untouched by
 * this function. Remove once the source is identified and a real fix
 * is decided on.
 */
function findAllUndefinedPaths(value, path = '', parent = null, results = []) {
  if (value === undefined) {
    results.push({ path: path || '(root)', parent });
    return results;
  }
  if (value === null || typeof value !== 'object') {
    return results;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findAllUndefinedPaths(item, `${path}[${index}]`, value, results));
  } else {
    Object.keys(value).forEach((key) => {
      const childPath = path ? `${path}.${key}` : key;
      findAllUndefinedPaths(value[key], childPath, value, results);
    });
  }
  return results;
}

/**
 * A true, static text snapshot of an object — unlike passing an
 * object reference straight to console.error/console.log (which
 * Chrome inspects lazily: expanding it later shows the object's state
 * *at expansion time*, not at logging time, which is exactly the kind
 * of thing that can quietly mislead when debugging something
 * asynchronous). JSON.stringify's own replacer function runs on every
 * value, including undefined ones, before JSON.stringify decides to
 * drop them — converting undefined to a visible marker string here
 * means it survives into the final text instead of disappearing the
 * way plain JSON.stringify(classroom) would.
 */
function serializeWithVisibleUndefined(value) {
  return JSON.stringify(value, (key, val) => (val === undefined ? '<<<UNDEFINED>>>' : val), 2);
}

class FirestoreClassroomRepository extends ClassroomRepository {
  constructor() {
    super();
    this.db = null;
  }

  _getDb() {
    if (!this.db) {
      // Deliberately no persistentLocalCache()/persistentMultipleTabManager()
      // here — this app's own persisted IndexedDB cache was found to get
      // stuck reporting a real, existing document as nonexistent (via
      // getDocFromCache, getDocFromServer, AND getDoc alike) after a
      // failed/rolled-back batch write, with no way to recover short of
      // clearing that device's storage — confirmed directly: a
      // completely fresh Firestore instance with the SDK's default,
      // in-memory-only cache read the exact same document correctly.
      // Plain initializeFirestore(app, {}) uses that same default
      // (memoryLocalCache), so nothing on disk can ever get stuck this
      // way again. Trade-off, explicit: offline reads/writes no longer
      // survive a page reload or app restart (in-memory only, cleared
      // each fresh load); still fully supports being offline for the
      // duration of a single session before reconnecting. Multi-tab
      // usage is unaffected in the other direction — each tab simply
      // gets its own independent in-memory cache, with no shared
      // IndexedDB lock left to contend over at all.
      this.db = initializeFirestore(getFirebaseApp(), {});
    }
    return this.db;
  }

  _classroomDoc(classroomId) {
    return doc(this._getDb(), 'classrooms', classroomId);
  }

  _classroomRefDoc(uid, classroomId) {
    return doc(this._getDb(), 'users', uid, 'classroomRefs', classroomId);
  }

  /**
   * A small, separate lookup collection — joinCodes/{code} -> { classroomId }
   * — deliberately NOT a query against `classrooms` itself. Current
   * security rules only let a member read a classroom document; a
   * co-teacher trying to join isn't a member yet, so they can't query
   * `classrooms` at all. This tiny mapping document reveals only an
   * opaque classroom id for a given code, nothing about the
   * classroom's actual content, so it can safely have much more
   * permissive read rules than the classroom document itself (see
   * firestore.rules — this needs its own rule added, proposed
   * alongside this code, not assumed to already be permitted).
   */
  _joinCodeDoc(code) {
    return doc(this._getDb(), 'joinCodes', code);
  }

  /**
   * A separate collection from joinCodes above, not just a different
   * key prefix in the same one — this needs its own, more permissive
   * read rule (any unauthenticated visitor resolving a student code)
   * than joinCodes needs today (only used from an already-signed-in
   * teacher session), and keeping them physically separate is what
   * makes writing that narrower rule straightforward. See
   * firestore.rules — this needs its own rule added, same as
   * joinCodes did, not assumed to already be permitted.
   */
  _studentJoinCodeDoc(code) {
    return doc(this._getDb(), 'studentJoinCodes', code);
  }

  _classroomRefsCollection(uid) {
    return collection(this._getDb(), 'users', uid, 'classroomRefs');
  }

  _userDoc(uid) {
    return doc(this._getDb(), 'users', uid);
  }

  _legacyClassroomsCollection(uid) {
    return collection(this._getDb(), 'teachers', uid, 'classrooms');
  }

  _legacyClassroomDoc(uid, classroomId) {
    return doc(this._getDb(), 'teachers', uid, 'classrooms', classroomId);
  }

  subscribeToClassroomRefs(uid, onChange, onError) {
    return onSnapshot(
      this._classroomRefsCollection(uid),
      (snapshot) => onChange(snapshot.docs.map((docSnapshot) => ({ classroomId: docSnapshot.id, ...docSnapshot.data() }))),
      (error) => onError?.(error)
    );
  }

  subscribeToClassroom(classroomId, onChange, onError) {
    return onSnapshot(
      this._classroomDoc(classroomId),
      (docSnapshot) => onChange(docSnapshot.exists() ? docSnapshot.data() : null),
      (error) => onError?.(error)
    );
  }

  async createClassroomWithOwner(classroom, ownerUid) {
    const batch = writeBatch(this._getDb());
    batch.set(this._classroomDoc(classroom.id), classroom);
    batch.set(this._classroomRefDoc(ownerUid, classroom.id), {
      role: classroom.members[ownerUid].role,
      joinedAt: classroom.members[ownerUid].joinedAt,
    });
    await batch.commit();
  }

  /** Populates the small public lookup used by "Join a Classroom" — called once, when a join code is first generated (see classroomService.ensureJoinCode()). */
  async createJoinCodeMapping(code, classroomId) {
    await setDoc(this._joinCodeDoc(code), { classroomId });
  }

  /** Returns the classroomId a join code points to, or null if the code doesn't exist. */
  async getClassroomIdByJoinCode(code) {
    const docSnapshot = await getDoc(this._joinCodeDoc(code));
    return docSnapshot.exists() ? docSnapshot.data().classroomId : null;
  }

  /** Same as createJoinCodeMapping(), for the separate student-facing code (see classroomService.ensureStudentJoinCode()). */
  async createStudentJoinCodeMapping(code, classroomId) {
    await setDoc(this._studentJoinCodeDoc(code), { classroomId });
  }

  /** Resolves a student join code to a classroomId, or null if the code doesn't exist. */
  async getClassroomIdByStudentJoinCode(code) {
    const docSnapshot = await getDoc(this._studentJoinCodeDoc(code));
    return docSnapshot.exists() ? docSnapshot.data().classroomId : null;
  }

  /**
   * The actual "join" write — deliberately a narrow, additive-only
   * update (this uid's own member entry, plus arrayUnion so it can
   * never clobber another teacher's concurrent join) rather than a
   * full classroom overwrite. This narrowness is exactly what makes a
   * safe Firestore rule for it possible: the rule only needs to permit
   * "a non-member may add exactly their own uid," not "a non-member may
   * write anything" — see firestore.rules for the proposed addition
   * this specific shape enables.
   */
  async addSelfAsTeacher(classroomId, uid, memberInfo) {
    await setDoc(
      this._classroomDoc(classroomId),
      {
        members: { [uid]: memberInfo },
        memberUids: arrayUnion(uid),
      },
      { merge: true }
    );
    await setDoc(this._classroomRefDoc(uid, classroomId), {
      role: memberInfo.role,
      joinedAt: memberInfo.joinedAt,
    });
  }

  async saveClassroom(classroom) {
    let ref;
    try {
      ref = this._classroomDoc(classroom.id);
    } catch (error) {
      console.error('[firestoreClassroomRepository] saveClassroom() \u2014 doc() reference construction threw:');
      console.error(error);
      console.error(error.name);
      console.error(error.code);
      console.error(error.message);
      console.error(error.stack);
      throw error;
    }
    try {
      // TEMPORARY DIAGNOSTIC (V2) — see findAllUndefinedPaths()'s own
      // comment above. Logs every undefined path found in the real,
      // live classroom object immediately before the real write, the
      // parent object each was found on, and a full static text
      // snapshot of the whole object — does not alter `classroom` or
      // what gets passed to setDoc() in any way.
      console.error('===== TEMPORARY UNDEFINED-FIELD DIAGNOSTIC (V2) — running now, immediately before setDoc() =====');

      const undefinedOccurrences = findAllUndefinedPaths(classroom);
      if (undefinedOccurrences.length > 0) {
        console.error(`[firestoreClassroomRepository] Found ${undefinedOccurrences.length} undefined value(s) in the classroom object:`);
        undefinedOccurrences.forEach(({ path, parent }, index) => {
          console.error(`  (${index + 1}) path:`, path);
          console.error(`  (${index + 1}) parent object:`, parent);
        });
      } else {
        console.error('[firestoreClassroomRepository] No undefined values found anywhere in the classroom object before setDoc() (if setDoc() still throws \u201cinvalid-argument\u201d, the cause is something other than a plain undefined field \u2014 e.g. a function, a Symbol, or a value type Firestore itself cannot serialize).');
      }

      console.error('[firestoreClassroomRepository] Full static snapshot of the classroom object (undefined values shown as <<<UNDEFINED>>>, since plain JSON.stringify would otherwise silently omit them):');
      console.error(serializeWithVisibleUndefined(classroom));

      console.error('===== END TEMPORARY UNDEFINED-FIELD DIAGNOSTIC (V2) =====');

      await setDoc(ref, classroom);
    } catch (error) {
      console.error('[firestoreClassroomRepository] saveClassroom() \u2014 setDoc() itself threw:');
      console.error(error);
      console.error(error.name);
      console.error(error.code);
      console.error(error.message);
      console.error(error.stack);
      throw error;
    }
  }

  /** See classroomRepository.js's own header comment on this method for why it exists as a targeted update rather than routing through saveClassroom(). */
  async appendStudentEvents(classroomId, events) {
    if (!events || events.length === 0) return;
    await updateDoc(this._classroomDoc(classroomId), { studentEvents: arrayUnion(...events) });
  }

  async getClassroomOnce(classroomId) {
    const docSnapshot = await getDoc(this._classroomDoc(classroomId));
    return docSnapshot.exists() ? docSnapshot.data() : null;
  }

  async deleteClassroom(classroomId, memberUids = []) {
    const batch = writeBatch(this._getDb());
    batch.delete(this._classroomDoc(classroomId));
    memberUids.forEach((uid) => {
      batch.delete(this._classroomRefDoc(uid, classroomId));
    });
    await batch.commit();
  }

  _scoreboardArchivesCollection(classroomId) {
    return collection(this._getDb(), 'classrooms', classroomId, 'scoreboardArchives');
  }

  _scoreboardArchiveDoc(classroomId, archiveId) {
    return doc(this._getDb(), 'classrooms', classroomId, 'scoreboardArchives', archiveId);
  }

  /**
   * THE ONE ATOMIC OPERATION this entire feature depends on — see the
   * feature's own requirement that archiving and resetting must
   * never happen only one at a time. A writeBatch (not a
   * runTransaction) is enough here: unlike recordRecentNotebook()
   * above, this never needs to READ anything mid-operation to decide
   * what to write — the archive snapshot and the reset teams array
   * are both fully computed ahead of time by
   * services/scoreboardArchiveService.js, so a batch's own atomic
   * all-or-nothing commit is sufficient and simpler than a
   * transaction. `resetTeams` is the caller's own pre-computed
   * "same teams/students, every score set to 0" array — this
   * repository never decides what "reset" means, only writes what
   * it's given.
   */
  async archiveScoreboardAndReset(classroomId, archive, resetTeams, currentScoringPeriodStartedAt) {
    const batch = writeBatch(this._getDb());
    batch.set(this._scoreboardArchiveDoc(classroomId, archive.id), archive);
    batch.update(this._classroomDoc(classroomId), { teams: resetTeams, currentScoringPeriodStartedAt });
    await batch.commit();
  }

  async listScoreboardArchives(classroomId) {
    const snapshot = await getDocs(this._scoreboardArchivesCollection(classroomId));
    return snapshot.docs.map((docSnapshot) => docSnapshot.data());
  }

  async getScoreboardArchive(classroomId, archiveId) {
    const docSnapshot = await getDoc(this._scoreboardArchiveDoc(classroomId, archiveId));
    return docSnapshot.exists() ? docSnapshot.data() : null;
  }

  async claimMigration(uid) {
    const db = this._getDb();
    const userDocRef = this._userDoc(uid);
    return runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(userDocRef);
      if (snapshot.exists() && snapshot.data().sharedClassroomsMigrated) {
        return false;
      }
      transaction.set(userDocRef, { sharedClassroomsMigrated: true }, { merge: true });
      return true;
    });
  }

  async getLegacyClassroomsOnce(uid) {
    const snapshot = await getDocs(this._legacyClassroomsCollection(uid));
    return snapshot.docs.map((docSnapshot) => docSnapshot.data());
  }

  async deleteLegacyClassroom(uid, classroomId) {
    await deleteDoc(this._legacyClassroomDoc(uid, classroomId));
  }

  /**
   * Prepends a "recently opened" entry to this uid's own users/{uid}
   * document, capped at 5, most-recent-first. Any existing entry for the
   * same classroom+subject+notebookType is removed first, so reopening a
   * notebook moves it back to the top rather than appearing twice.
   * Wrapped in a transaction — without one, two quick opens in a row (or
   * two tabs) could race on read-modify-write and silently drop one.
   */
  async recordRecentNotebook(uid, entry) {
    const db = this._getDb();
    const userDocRef = this._userDoc(uid);

    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(userDocRef);
      const existing = snapshot.exists() ? snapshot.data().recentNotebooks || [] : [];

      const withoutDuplicate = existing.filter(
        (item) =>
          !(
            item.classroomId === entry.classroomId &&
            item.subjectId === entry.subjectId &&
            item.notebookTypeId === entry.notebookTypeId
          )
      );

      const updated = [entry, ...withoutDuplicate].slice(0, 5);
      transaction.set(userDocRef, { recentNotebooks: updated }, { merge: true });
    });
  }

  subscribeToRecentNotebooks(uid, onChange, onError) {
    return onSnapshot(
      this._userDoc(uid),
      (docSnapshot) => onChange(docSnapshot.exists() ? docSnapshot.data().recentNotebooks || [] : []),
      (error) => onError?.(error)
    );
  }

  async getRecentNotebooksOnce(uid) {
    const docSnapshot = await getDoc(this._userDoc(uid));
    return docSnapshot.exists() ? docSnapshot.data().recentNotebooks || [] : [];
  }

  async getThemePreferenceOnce(uid) {
    const docSnapshot = await getDoc(this._userDoc(uid));
    return docSnapshot.exists() ? docSnapshot.data().theme || null : null;
  }

  async setThemePreference(uid, theme) {
    await setDoc(this._userDoc(uid), { theme }, { merge: true });
  }

  async getAccentColorPreferenceOnce(uid) {
    const docSnapshot = await getDoc(this._userDoc(uid));
    return docSnapshot.exists() ? docSnapshot.data().accentColor || null : null;
  }

  async setAccentColorPreference(uid, colorId) {
    await setDoc(this._userDoc(uid), { accentColor: colorId }, { merge: true });
  }

  /**
   * Adds/updates one entry in this teacher's own users/{uid}.fcmTokens
   * map -- keyed by the token itself (not an array), so re-registering
   * the same browser/device just overwrites its own entry instead of
   * accumulating duplicates, and multiple devices can each hold their
   * own entry without clobbering each other. setDoc's own {merge:true}
   * performs a deep merge into the existing fcmTokens map, so sibling
   * tokens (other devices) are left untouched — see
   * services/pushNotificationService.js's own header comment.
   */
  async saveFcmToken(uid, token, metadata) {
    await setDoc(this._userDoc(uid), { fcmTokens: { [token]: metadata } }, { merge: true });
  }

  /** Removes exactly one token entry via Firestore's own dot-notation field path + deleteField() sentinel — never a read-modify-write of the whole fcmTokens map, and never touches any other device's own entry. */
  async removeFcmToken(uid, token) {
    await updateDoc(this._userDoc(uid), { [`fcmTokens.${token}`]: deleteField() });
  }
}

export const firestoreClassroomRepository = new FirestoreClassroomRepository();
