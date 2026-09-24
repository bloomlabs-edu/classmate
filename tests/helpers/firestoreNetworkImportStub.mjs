/**
 * tests/helpers/firestoreNetworkImportStub.mjs
 *
 * A Node --import loader (module.register hook), test-only. Several
 * services this app ships to the browser import the Firestore SDK
 * directly from its CDN URL (e.g. 'https://www.gstatic.com/firebasejs/
 * 10.14.1/firebase-firestore.js') — correct for a browser's native
 * ESM loader, but Node's own ESM loader has no built-in way to fetch a
 * real https: specifier, which is why no test anywhere in this repo
 * has ever been able to import services/assessmentService.js (it
 * transitively imports services/studentEventService.js ->
 * repositories/firestoreStudentEventReadStateRepository.js -> this
 * exact CDN URL) — a pre-existing gap, not something introduced by
 * whichever feature happens to need it stubbed first.
 *
 * Intercepts ONLY 'https://www.gstatic.com/firebasejs/...' specifiers
 * and resolves them to a tiny in-memory stub module exporting harmless
 * no-op versions of the handful of Firestore functions this codebase's
 * repositories actually import (doc, getDoc, setDoc, getDocs,
 * deleteDoc, onSnapshot, arrayUnion, collection, query, where,
 * getFirestore, etc.) — enough for a test to import the real service
 * file without ever actually touching Firestore. Nothing here talks
 * to a real project or emulator; any repository function that's
 * actually CALLED (not just imported) by a test using this stub would
 * get back inert stub values, so this is only appropriate for tests
 * that exercise the pure/synchronous parts of a service, never
 * Firestore read/write behavior itself (that belongs in a real
 * emulator-backed test instead).
 */

// Covers every named export this codebase's own repositories/services
// currently import from any 'https://www.gstatic.com/firebasejs/.../
// firebase-{firestore,auth,app,messaging}.js' URL (firestore, auth,
// app init, and messaging — all served from the same gstatic prefix,
// so one stub module answers for all of them). Deliberately generous
// rather than an exact per-file enumeration: this is test-only
// infrastructure whose only job is letting a module graph finish
// loading, not exercising real Firestore/Auth/Messaging behavior.
const STUB_MODULE_SOURCE = `
  const noop = () => {};
  const stubRef = (...parts) => ({ __stubRef: true, path: parts.join('/') });

  // Test-only escape hatch: a real onSnapshot() never calls back (see
  // onSnapshot() below) — nobody importing this stub through the normal
  // Firestore SDK surface needs it to. But a test exercising the ACTUAL
  // sequencing between two independent listeners (e.g.
  // services/workspaceService.test.js verifying its own
  // classroomRefs-arrives-before-classroom-doc-arrives race) needs a way
  // to fire a specific listener's callback on demand. Importing this
  // exact same 'https://www.gstatic.com/.../firebase-firestore.js'
  // specifier a second time (from the test file itself) resolves, via
  // this loader's own resolve() below, to this identical singleton
  // module instance — so a test can reach these three exports directly,
  // keyed by the same ref.path stubRef() above already produces.
  const __snapshotListeners = new Map(); // path -> { onNext, onError }
  export function __triggerSnapshot(path, snapshotLike) {
    __snapshotListeners.get(path)?.onNext(snapshotLike);
  }
  export function __triggerSnapshotError(path, error) {
    __snapshotListeners.get(path)?.onError?.(error);
  }
  export function __resetSnapshotListeners() {
    __snapshotListeners.clear();
  }

  // --- firebase-app.js ---
  export function initializeApp() { return { __stubApp: true }; }
  export function getApp() { return { __stubApp: true }; }
  export function getApps() { return []; }

  // --- firebase-firestore.js ---
  export function getFirestore() { return { __stubFirestore: true }; }
  export function initializeFirestore() { return { __stubFirestore: true }; }
  export function connectFirestoreEmulator() {}
  export function collection(...args) { return stubRef(...args); }
  export function collectionGroup(...args) { return stubRef(...args); }
  export function doc(...args) { return stubRef(...args); }
  export function query(ref) { return ref; }
  export function where() { return { __stubWhere: true }; }
  export function orderBy() { return { __stubOrderBy: true }; }
  export function limit() { return { __stubLimit: true }; }
  export function startAfter() { return { __stubStartAfter: true }; }
  export function startAt() { return { __stubStartAt: true }; }
  export function endAt() { return { __stubEndAt: true }; }
  export function endBefore() { return { __stubEndBefore: true }; }
  export function documentId() { return '__stubDocumentId'; }
  export async function getDoc() { return { exists: () => false, data: () => undefined, id: 'stub' }; }
  export async function getDocFromCache() { return { exists: () => false, data: () => undefined, id: 'stub' }; }
  export async function getDocs() { return { docs: [], forEach: noop, empty: true, size: 0 }; }
  export async function setDoc() { return undefined; }
  export async function updateDoc() { return undefined; }
  export async function addDoc() { return stubRef('generated'); }
  export async function deleteDoc() { return undefined; }
  export function onSnapshot(ref, ...callbacks) {
    // Real Firestore accepts either onSnapshot(ref, onNext, onError) or
    // onSnapshot(ref, { next, error }) — this codebase's repositories
    // only ever use the two-callback form (see
    // repositories/firestoreClassroomRepository.js), so that's the only
    // shape stored here.
    const [onNext, onError] = callbacks;
    if (ref?.path) __snapshotListeners.set(ref.path, { onNext, onError });
    return () => { if (ref?.path) __snapshotListeners.delete(ref.path); };
  }
  export function arrayUnion(...values) { return { __stubArrayUnion: values }; }
  export function arrayRemove(...values) { return { __stubArrayRemove: values }; }
  export function increment(n) { return { __stubIncrement: n }; }
  export function deleteField() { return { __stubDeleteField: true }; }
  export function serverTimestamp() { return { __stubServerTimestamp: true }; }
  export function writeBatch() { return { set: noop, update: noop, delete: noop, commit: async () => undefined }; }
  export function runTransaction(_db, updateFn) { return updateFn({ get: async () => ({ exists: () => false, data: () => undefined }), set: noop, update: noop, delete: noop }); }
  export function enableIndexedDbPersistence() { return Promise.resolve(); }
  export function enableNetwork() { return Promise.resolve(); }
  export function disableNetwork() { return Promise.resolve(); }
  export function waitForPendingWrites() { return Promise.resolve(); }
  export function terminate() { return Promise.resolve(); }
  export class Timestamp {
    static now() { return { __stubTimestamp: true, toDate: () => new Date() }; }
    static fromDate(date) { return { __stubTimestamp: true, toDate: () => date }; }
  }

  // --- firebase-auth.js ---
  export function getAuth() { return { __stubAuth: true, currentUser: null }; }
  export function GoogleAuthProvider() { return { __stubProvider: true }; }
  export async function signInWithPopup() { return { user: null }; }
  export async function signInAnonymously() { return { user: null }; }
  export async function signOut() { return undefined; }
  export function onAuthStateChanged(_auth, callback) { callback(null); return noop; }
  export async function setPersistence() { return undefined; }
  export const browserLocalPersistence = { __stubPersistence: true };
  export function connectAuthEmulator() {}

  // --- firebase-messaging.js ---
  export function getMessaging() { return { __stubMessaging: true }; }
  export async function getToken() { return null; }
  export async function deleteToken() { return true; }
  export async function isSupported() { return false; }
`;

const GSTATIC_FIREBASE_PREFIX = 'https://www.gstatic.com/firebasejs/';
const STUB_URL = 'firebase-sdk-stub:gstatic-firebase';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(GSTATIC_FIREBASE_PREFIX)) {
    return { url: STUB_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url === STUB_URL) {
    return { format: 'module', source: STUB_MODULE_SOURCE, shortCircuit: true };
  }
  return nextLoad(url, context);
}
