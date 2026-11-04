/**
 * services/learningHubActivityService.js
 *
 * Read-only access to Learning Hub's `externalActivities` collection —
 * the Student-Facing External Activities feature's one data source.
 * Learning Hub is the source of truth for this data; ClassMate never
 * writes to this collection, never creates a ClassMate-side Activity/
 * LearningActivity/Result to mirror it, and never caches it to
 * Firestore on the ClassMate side — every read goes straight through
 * to Learning Hub's own `externalActivities/{id}` documents, exactly
 * as Learning Hub's own Phase 1 implementation defined them:
 *   { title, description, provider, url, subject, grade,
 *     conceptIds: [string], status: "draft"|"published"|"archived",
 *     authorId, authorName, createdAt, updatedAt, publishedAt, archivedAt }
 * (see learning-hub's app/repository/external-activity-contribution-
 * service.js / external-activity-service.js, and firestore.rules'
 * externalActivities match block, commit 76f057d on that repo's
 * feature/external-activities branch — not yet deployed there; see
 * this file's own getLearningHubFirestore() caller for how that's
 * handled safely either way).
 *
 * Every function here resolves — NEVER rejects — on any failure
 * (network error, Learning Hub not yet deployed, malformed document,
 * etc.), matching the exact never-throw contract every other
 * student-facing read in this app already uses (see
 * services/resourceService.js's own getStudentVisibleResources()) —
 * a caller never needs a try/catch of its own for "Learning Hub is
 * unreachable."
 */

import { collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getLearningHubFirestore } from './learningHubFirebaseApp.js';

/**
 * Defense in depth: Learning Hub's own firestore.rules already reject
 * a non-https:// url at write time (see that repo's own
 * isValidHttpsUrl()/rules regex) — this is the exact same check,
 * re-applied here so a malformed document that somehow reached
 * "published" status (a rules bug, a manual Console edit, a future
 * regression on the Learning Hub side) can never be rendered as a
 * clickable link or passed to window.open() from inside ClassMate.
 */
function isValidHttpsUrl(url) {
  return typeof url === 'string' && /^https:\/\/.+/.test(url.trim());
}

function mapDoc(doc) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    title: data.title || '',
    description: data.description || '',
    provider: data.provider || 'other',
    url: data.url || '',
    subject: data.subject || '',
    grade: typeof data.grade === 'number' ? data.grade : null,
    conceptIds: Array.isArray(data.conceptIds) ? data.conceptIds : [],
  };
}

// conceptId -> Promise<Array<ExternalActivity>>, deduplicating/caching
// per concept for the lifetime of this module (a page load) — a
// student may revisit the same concept's Concept Detail screen several
// times in one session (Previous/Next concept nav, swipe) without a
// fresh Firestore query each time. Cleared only by reloading the page;
// there is no mutation path on the ClassMate side that could make a
// cached result stale within one session (ClassMate never writes to
// this collection).
const activitiesByConceptIdCache = new Map();

/**
 * Published External Activities for one Learning Hub conceptId — the
 * opaque id already stored at
 * classroomConcept.learningHubConcept.conceptId (models/LearningConcept.js).
 * Never draft/unpublished/archived (enforced server-side by Learning
 * Hub's own rules — `allow read: if resource.data.status == 'published'`
 * — this client-side query only ever ASKS for published, it is not the
 * thing actually enforcing it). Resolves [] for a missing/blank
 * conceptId, an unreachable Learning Hub project, or any other error —
 * never rejects.
 */
export function listPublishedActivitiesForConcept(conceptId) {
  if (!conceptId) return Promise.resolve([]);
  if (activitiesByConceptIdCache.has(conceptId)) return activitiesByConceptIdCache.get(conceptId);

  const resultPromise = (async () => {
    try {
      const firestore = getLearningHubFirestore();
      const snapshot = await getDocs(
        query(
          collection(firestore, 'externalActivities'),
          where('status', '==', 'published'),
          where('conceptIds', 'array-contains', conceptId)
        )
      );
      return snapshot.docs.map(mapDoc).filter((activity) => isValidHttpsUrl(activity.url));
    } catch (error) {
      console.error('[learningHubActivityService] listPublishedActivitiesForConcept() failed — Learning Hub may be unreachable:', error);
      return [];
    }
  })();

  activitiesByConceptIdCache.set(conceptId, resultPromise);
  return resultPromise;
}
