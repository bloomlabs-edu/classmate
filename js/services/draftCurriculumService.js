/**
 * services/draftCurriculumService.js
 *
 * The only file in this app that touches IndexedDB, and the only file
 * anywhere that touches storage for the whole Curriculum Import
 * Pipeline. Every other service in this pipeline
 * (pdfExtractionService, unitExtractionService, anchorDetectionService,
 * unitSegmentationService, conceptExtractionService,
 * curriculumReviewService) operates purely on the in-memory
 * DraftCurriculum object this file hands back — none of them know
 * this file, or IndexedDB, exists. ui/services/curriculumImportSession.js
 * is the only other thing that calls into this file directly.
 *
 * IndexedDB, not localStorage (the pattern every other persisted
 * service in this app uses — see e.g.
 * services/curriculumSubmissionsService.js), because a Draft
 * Curriculum has to hold the actual uploaded PDF file, not just
 * strings: localStorage can only store text, and re-deriving a PDF's
 * contents without the original file is not something any later stage
 * of this pipeline can do. This also happens to be this app's first
 * genuinely offline-capable persisted data, which lines up with
 * ClassMate's own longer-term direction, not just a storage
 * technicality.
 *
 * A DraftCurriculum:
 *   {
 *     id, createdAt, updatedAt,
 *     status: 'draft' | 'submitted' | 'changes_requested',
 *     submissionId: string | null,   // set once Stage 8 fires; a draft
 *                                    // never learns its own moderation
 *                                    // outcome — see
 *                                    // services/curriculumPublishService.js's
 *                                    // getDraftDisplayStatus(), which
 *                                    // derives that by looking up this
 *                                    // id against
 *                                    // services/curriculumSubmissionsService.js
 *                                    // instead. This file only ever
 *                                    // reads/writes the three status
 *                                    // values above — never
 *                                    // "published," "pending_review,"
 *                                    // or anything else moderation-
 *                                    // related.
 *     metadata: { curriculumName, board, academicYear, gradeName, subjectName, language, publisher },
 *     pdfFile: Blob,                 // the actual uploaded file
 *     pdfFileName: string,           // display only
 *     totalPageCount: number | null,
 *     units: [{
 *       id, number, title,
 *       tocPage: number | null,      // printed page — shown to the teacher
 *       pdfPage: number | null,      // physical PDF page — internal only, never shown
 *       pdfEndPage: number | null,
 *       anchorCandidates: number[] | null,
 *       concepts: [{ id, title }],
 *       status: 'anchor_confirmed' | 'anchor_needs_review'
 *             | 'concepts_pending' | 'concepts_extracted' | 'concepts_reviewed',
 *     }],
 *   }
 *
 * listDrafts() deliberately returns lightweight summaries, not full
 * records — a "Resume a Draft" screen listing several in-progress
 * curricula shouldn't need to load every one's whole PDF Blob into
 * memory just to show a name and a progress count.
 */

import { generateId } from '../utils/idGenerator.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

const DB_NAME = 'classmate-curriculum-import';
const DB_VERSION = 1;
const STORE_NAME = 'draftCurricula';

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

/**
 * Starts a brand-new Draft Curriculum — Stage 1, right after a
 * teacher provides metadata and a PDF. Every unit-level and
 * moderation field starts empty; nothing about this draft's structure
 * is known yet.
 */
export async function createDraft({ metadata, pdfFile, pdfFileName }) {
  const now = getCurrentIsoDate();
  const draft = {
    id: generateId(),
    status: 'draft',
    submissionId: null,
    createdAt: now,
    updatedAt: now,
    metadata,
    pdfFile,
    pdfFileName,
    totalPageCount: null,
    units: [],
  };
  await runRequest('readwrite', (store) => store.put(draft));
  return draft;
}

/**
 * Persists whatever the caller's current in-memory draft object looks
 * like right now — called after every meaningful step (Table of
 * Contents detected, an anchor resolved, a unit's concepts approved,
 * a rename, ...), which is what actually makes the pipeline resumable
 * across a closed browser rather than just resumable within one
 * session's memory.
 */
export async function saveDraft(draft) {
  draft.updatedAt = getCurrentIsoDate();
  await runRequest('readwrite', (store) => store.put(draft));
  return draft;
}

/** Loads one full draft, including its PDF Blob — for actually resuming work on it. */
export async function getDraft(draftId) {
  const result = await runRequest('readonly', (store) => store.get(draftId));
  return result || null;
}

/**
 * Lightweight summaries only, most recently updated first — for a
 * "Resume a Draft" list. Deliberately omits `pdfFile` (the Blob) and
 * each unit's own concepts — a teacher choosing which draft to resume
 * needs a name and a progress count, not the full record.
 */
export async function listDrafts() {
  const all = await runRequest('readonly', (store) => store.getAll());
  return all
    .map((draft) => ({
      id: draft.id,
      status: draft.status,
      curriculumName: draft.metadata.curriculumName,
      updatedAt: draft.updatedAt,
      totalUnitsCount: draft.units.length,
      reviewedUnitsCount: draft.units.filter((unit) => unit.status === 'concepts_reviewed').length,
    }))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function deleteDraft(draftId) {
  await runRequest('readwrite', (store) => store.delete(draftId));
}
