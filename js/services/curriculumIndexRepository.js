/**
 * services/curriculumIndexRepository.js
 *
 * Two-Phase Curriculum Import redesign. Storage only, for exactly one
 * domain object: a Curriculum Index — curriculum metadata and a list
 * of Units (number, title, printed page). No PDF, no concepts, no
 * textbook edition information, ever. This is what makes a Curriculum
 * Index reusable across multiple textbook editions: it has nothing in
 * it that's specific to any one printing.
 *
 * The Curriculum Index is the author's own working artifact — it
 * tracks a teacher's own progress (Units confirmed, Textbook
 * attached, Concepts extracted) and nothing about moderation. Once a
 * teacher submits it, services/curriculumSubmissionsService.js's own
 * record becomes the moderation artifact and owns that entirely
 * (pending_review / published / rejected, whatever comes later) — a
 * Curriculum Index never learns or stores its own moderation outcome;
 * see services/curriculumPublishService.js's getDraftDisplayStatus()
 * for how the two are looked up together without either one needing
 * to know about the other's internals. Keeping this split intact is
 * why `status` below only ever describes the author's own progress,
 * never a review outcome.
 *
 * services/curriculumIndexSession.js is the only orchestrator that
 * calls this file. Every other Phase 1 concern — extracting units
 * from a PDF or pasted text, letting a teacher rename/reorder/delete/
 * add units — happens in that orchestrator or in
 * services/curriculumReviewService.js (reused as-is; its unit
 * mutation functions only ever touch `id`/`title`/array position, so
 * they work identically here even though a Curriculum Index's units
 * carry different extra fields than a Textbook's do).
 *
 * A CurriculumIndex record:
 *   {
 *     id,
 *     status: 'draft' | 'units_confirmed' | 'textbook_attached'
 *           | 'concepts_in_progress' | 'concepts_complete',
 *     createdAt, updatedAt,
 *     curriculum: { name, board, grade, subject },
 *     parts: [{ id, name }],
 *     units: [{ id, number, title, printedPage, partId }],
 *   }
 *
 * Parts and Units, Hybrid Model: a Part (History, Geography, ... —
 * or just "General" for a subject with no real subdivisions, like
 * Science) is a first-class entity with its own identity, stored
 * once, not repeated per-unit — this is where a Part's own future
 * metadata (an icon, a colour, an order, estimated teaching periods)
 * would live. Units stay a flat array, referencing their Part by
 * `partId` rather than being nested inside it — this is what lets
 * services/curriculumReviewService.js's existing unit mutation
 * functions (reused as-is; see its own header comment) continue
 * operating on one flat array exactly as they already did, with only
 * one small addition (a same-`partId` guard on reordering, so moving
 * a unit up/down can never cross into a different Part's sequence).
 * A unit's own `number` is only ever meaningful *within* its Part —
 * "History Unit 3" and "Geography Unit 3" are two different units
 * that both happen to be numbered 3, not a collision; `id` remains
 * each unit's true, globally unique identity, exactly as it already
 * was before Parts existed at all.
 *
 * Metadata ownership, per the agreed domain model: name, board,
 * grade, and subject are stable across editions and live here.
 * Publisher, language, academic year, and version label belong to a
 * specific printing and will live on the Textbook record instead
 * (Milestone 2) — not duplicated here.
 *
 * A separate IndexedDB database from the older combined-draft store
 * (services/draftCurriculumService.js), not a new object store
 * grafted onto it — keeping each repository's own schema and version
 * history fully independent, per "repositories should manage storage
 * only" and "services should remain loosely coupled."
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';
import { migrateCurriculumIndex } from './curriculumIndexMigrationService.js';

const DB_NAME = 'classmate-curriculum-index';
const DB_VERSION = 1;
const STORE_NAME = 'curriculumIndices';

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

/** Starts a brand-new Curriculum Index — Phase 1, right after a teacher provides curriculum metadata. */
export async function createIndex({ curriculum }) {
  const now = getCurrentIsoDate();
  const index = {
    id: generateId(),
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    curriculum,
    parts: [],
    units: [],
  };
  // Deliberately runs the real migration pipeline here rather than
  // simply stamping `schemaVersion: LATEST_SCHEMA_VERSION` — a caller
  // could construct `curriculum` without every field the latest
  // schema actually requires (subjectId, say), and blindly claiming
  // "latest" without verifying that would create a document that
  // silently doesn't conform despite saying it does. Running it
  // through migrateCurriculumIndex() guarantees the document really
  // is current, the same way getIndex()/listIndexes() guarantee it
  // for existing documents, rather than trusting the caller.
  migrateCurriculumIndex(index);
  await runRequest('readwrite', (store) => store.put(index));
  return index;
}

/** Persists whatever the caller's current in-memory Curriculum Index looks like right now. */
export async function saveIndex(index) {
  index.updatedAt = getCurrentIsoDate();
  await runRequest('readwrite', (store) => store.put(index));
  return index;
}

export async function getIndex(indexId) {
  const result = await runRequest('readonly', (store) => store.get(indexId));
  if (!result) return null;
  if (migrateCurriculumIndex(result)) {
    await saveIndex(result);
  }
  return result;
}

/** Every saved Curriculum Index, most recently updated first — for a future "choose which curriculum to attach a textbook to" screen (Milestone 2). */
export async function listIndexes() {
  const all = await runRequest('readonly', (store) => store.getAll());
  const sorted = all.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  // Runs every document through the full versioned migration pipeline
  // — see services/curriculumIndexMigrationService.js's own header
  // comment. Idempotent: a document already at LATEST_SCHEMA_VERSION
  // runs zero migration steps, so this costs nothing once every
  // document has been migrated once.
  for (const index of sorted) {
    if (migrateCurriculumIndex(index)) {
      await saveIndex(index);
    }
  }

  return sorted;
}

export async function deleteIndex(indexId) {
  await runRequest('readwrite', (store) => store.delete(indexId));
}
