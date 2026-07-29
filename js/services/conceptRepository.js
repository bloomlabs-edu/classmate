/**
 * services/conceptRepository.js
 *
 * Two-Phase Curriculum Import redesign. Establishes the long-term
 * domain boundary for Concepts as first-class entities — explicitly
 * NOT wired into anything during Milestone 1 (Curriculum Index only;
 * no textbook, no concept extraction happens yet). This file exists
 * now so the boundary is real from the start, not bolted on later:
 * Concepts are never embedded inside a Textbook record, and are meant
 * to eventually power features well beyond Curriculum Import itself
 * (worksheets, quizzes, flashcards, AI tutoring, lesson plans,
 * assessments) — see the product-level discussion this milestone's
 * architecture came out of.
 *
 * A Concept record (once Milestone 3 actually creates any):
 *   {
 *     id, curriculumUnitId,       // which Curriculum Index unit this belongs to
 *     textbookId: string | null,  // which Textbook edition it was extracted from, if any
 *     title,
 *     createdAt,
 *   }
 *
 * Deliberately no dedup/merge/reuse-across-editions logic here or
 * anywhere yet — out of scope until a real product decision is made
 * about it (see this project's own architecture discussion for why
 * that's deferred, not forgotten).
 *
 * Same IndexedDB connection pattern as every other repository in this
 * app (see services/curriculumIndexRepository.js), its own separate
 * database and object store — kept minimal on purpose: this file's
 * job right now is to exist, not to do anything yet.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

const DB_NAME = 'classmate-concepts';
const DB_VERSION = 1;
const STORE_NAME = 'concepts';

let dbPromise = null;

function openDatabase() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

function runRequest(mode, useStore) {
  return openDatabase().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        const request = useStore(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}

/** Not called by anything in Milestone 1 — establishing the shape, not the feature. */
export async function createConcept({ curriculumUnitId, textbookId = null, title }) {
  const concept = { id: generateId(), curriculumUnitId, textbookId, title, createdAt: getCurrentIsoDate() };
  await runRequest('readwrite', (store) => store.put(concept));
  return concept;
}

export async function getConceptsForUnit(curriculumUnitId) {
  const all = await runRequest('readonly', (store) => store.getAll());
  return all.filter((concept) => concept.curriculumUnitId === curriculumUnitId);
}

export async function deleteConcept(conceptId) {
  await runRequest('readwrite', (store) => store.delete(conceptId));
}
