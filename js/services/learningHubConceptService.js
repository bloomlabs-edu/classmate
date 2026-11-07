/**
 * services/learningHubConceptService.js
 *
 * Read-only access to Learning Hub's OWN `concepts` collection (its
 * RepositoryConcept — see that app's services/concept-service.js),
 * from inside ClassMate — the teacher-facing Learning Hub Concept
 * Mapping picker's one data source (ui/components/
 * LearningHubConceptMappingModal.js). Mirrors
 * services/learningHubActivityService.js's own cross-project-read
 * shape exactly: same getLearningHubFirestore() entry point, same
 * never-throw contract, same collection/field names Learning Hub's own
 * rules and code already establish — nothing here is a second concept
 * model or a guess at field names.
 *
 * A RepositoryConcept, as stored in Firestore (concepts/{conceptId}):
 *   { title, subject, domain, description, status: "published"|"draft" }
 * (see learning-hub/app/repository/concept-service.js's own header
 * comment — same shape, read here instead of re-derived). Only
 * `status == 'published'` is ever readable by this unauthenticated
 * read (Learning Hub's own firestore.rules: `allow read: if
 * resource.data.status == 'published'`) — there is no "my own draft
 * concepts" branch here the way Learning Hub's teacher-facing UI has,
 * because ClassMate's picker only ever needs to REFERENCE an already-
 * published, real concept, never create or browse drafts.
 *
 * Search is client-side, ranked — same tiered approach (title-exact >
 * title-starts-with > title-contains > other-fields) Learning Hub's
 * own RepositoryConcepts.search() already uses, re-implemented here
 * rather than imported because this runs against a different Firebase
 * App/Firestore instance than Learning Hub's own code does; this is
 * the one unavoidable duplication of *logic* (not of the data model or
 * the collection itself) that a genuine cross-project client requires.
 */

import { collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getLearningHubFirestore } from './learningHubFirebaseApp.js';

function mapDoc(doc) {
  const data = doc.data() || {};
  return {
    conceptId: doc.id,
    title: data.title || doc.id,
    subject: data.subject || '',
    domain: data.domain || '',
    description: data.description || '',
  };
}

// Cached for the lifetime of this module (a page load) — the picker is
// typically opened, searched a few times, and closed within one short
// session; re-fetching on every keystroke would mean one Firestore
// round trip per character typed. Cleared only by explicitly reloading
// the page, same "no persisted cache, just avoid redundant reads
// within one session" principle Learning Hub's own catalogue-fetch
// code already applies to its own static JSON fetch.
let cachedPublishedConcepts = null;

/**
 * Every published RepositoryConcept, read once and reused — never
 * rejects; resolves [] (and logs) if Learning Hub is unreachable
 * (network error, project not yet deployed, etc.), so a caller never
 * needs its own try/catch for this specific failure mode.
 */
async function listPublishedConcepts() {
  if (cachedPublishedConcepts) return cachedPublishedConcepts;
  try {
    const firestore = getLearningHubFirestore();
    const snapshot = await getDocs(query(collection(firestore, 'concepts'), where('status', '==', 'published')));
    cachedPublishedConcepts = snapshot.docs.map(mapDoc);
    return cachedPublishedConcepts;
  } catch (error) {
    console.error('[learningHubConceptService] listPublishedConcepts() failed — Learning Hub may be unreachable:', error);
    return [];
  }
}

/**
 * Ranked, case-insensitive search over every published RepositoryConcept
 * — mirrors Learning Hub's own concept-service.js search() tiering
 * exactly (0: exact title match, 1: title starts with, 2: title
 * contains, 3: query only matches subject/domain/description), so a
 * teacher searching from ClassMate sees results ordered the same way
 * they would inside Learning Hub itself. Resolves [] for a blank query
 * (never "every concept," matching that same file's own guard) and
 * never rejects.
 */
export async function searchConcepts(queryText) {
  const q = String(queryText || '').trim().toLowerCase();
  if (!q) return [];

  const concepts = await listPublishedConcepts();

  function titleLower(c) {
    return String(c.title || '').toLowerCase();
  }
  function otherFieldsHaystack(c) {
    return [c.subject, c.domain, c.description].join(' ').toLowerCase();
  }
  function rank(c) {
    const title = titleLower(c);
    if (title === q) return 0;
    if (title.indexOf(q) === 0) return 1;
    if (title.indexOf(q) !== -1) return 2;
    return otherFieldsHaystack(c).indexOf(q) !== -1 ? 3 : -1;
  }

  return concepts
    .map((c) => ({ concept: c, tier: rank(c) }))
    .filter((entry) => entry.tier !== -1)
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const aTitle = titleLower(a.concept);
      const bTitle = titleLower(b.concept);
      return aTitle < bTitle ? -1 : aTitle > bTitle ? 1 : 0;
    })
    .map((entry) => entry.concept);
}
