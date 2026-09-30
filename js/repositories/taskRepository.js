/**
 * repositories/taskRepository.js
 *
 * Isolates Firestore access for "My Work" Tasks —
 * `users/{uid}/tasks/{taskId}` (see models/Task.js's own header comment
 * for why this lives under the same already-established per-uid
 * storage location services/workspaceService.js's own `classroomRefs`
 * subcollection already uses, never a new kind of scoping). A Task
 * belongs to exactly one uid; there is no cross-user query here at all,
 * unlike every classroom-scoped repository in this app.
 *
 * A plain module, not a class — same reasoning
 * repositories/chapterPlanRepository.js's own header comment already
 * gives: this app only reaches for the class/abstract-contract pattern
 * when multiple storage providers genuinely need to be swappable, and
 * Task has exactly one implementation.
 *
 * Deliberately calls getFirestore(), not initializeFirestore() — same
 * convention every other repository in this app already follows.
 *
 * Only save/get-one/get-all-for-user/delete are implemented — the exact
 * operations Phase 1's domain foundation actually needs, no speculative
 * query methods (e.g. "get all Tasks due today") for a Today/This Week
 * view that doesn't exist yet; a future UI phase filters the one full
 * list this already returns, the same "one query, filter client-side"
 * convention repositories/chapterPlanRepository.js's own
 * getChapterPlansForClassroom() already documents.
 */

import { getFirestore, collection, doc, getDoc, setDoc, deleteDoc, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';

let db = null;

function getDb() {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

function tasksCollectionRef(uid) {
  return collection(getDb(), 'users', uid, 'tasks');
}

/** Persists one Task (create or update) — a single small write, not a rewrite of every Task this user owns. */
export async function saveTask(uid, task) {
  const ref = doc(tasksCollectionRef(uid), task.id);
  await setDoc(ref, { ...task });
  return task;
}

/** One Task by its own id, or null. */
export async function getTaskById(uid, taskId) {
  const snapshot = await getDoc(doc(tasksCollectionRef(uid), taskId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

/** Every Task this uid owns, in one query — plain one-time fetch, not a live listener, matching chapterPlanRepository.js's own "simple and explicit over cached and synchronized" convention. Callers filter this same full list by status/priority/dueDate/workspace themselves. */
export async function getTasksForUser(uid) {
  const snapshot = await getDocs(tasksCollectionRef(uid));
  return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
}

/** Permanently removes a Task document — a user's own explicit "delete" action (distinct from archiving, which is a status change on the same document, never a delete). */
export async function deleteTask(uid, taskId) {
  await deleteDoc(doc(tasksCollectionRef(uid), taskId));
}
