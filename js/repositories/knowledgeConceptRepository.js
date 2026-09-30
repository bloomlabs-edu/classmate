/**
 * repositories/knowledgeConceptRepository.js
 *
 * Isolates Firestore access for KnowledgeConcepts (see
 * models/KnowledgeConcept.js) — a DELIBERATELY SEPARATE, TOP-LEVEL
 * `knowledgeConcepts/{conceptId}` collection, never a subcollection of
 * `classrooms`, since a Concept is shared, global knowledge, not one
 * classroom's own data — same "must be discoverable everywhere, owned
 * by no one classroom" reasoning repositories/sparkRepository.js's own
 * header comment already documents for `sparks`.
 *
 * A plain module, not a class — same reasoning as every other
 * repository in this app.
 *
 * Phase K1 scope: the minimum CRUD only. No filtered/discovery query
 * yet (e.g. "concepts sourced from unit X") — no caller exists for one
 * this phase (no UI), so none is spec'd speculatively; a future phase
 * filters the one full list this already returns, the same "one query,
 * filter client-side" convention repositories/taskRepository.js/
 * repositories/chapterPlanRepository.js already document.
 */

import { getFirestore, collection, doc, getDoc, setDoc, deleteDoc, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';

let db = null;

function getDb() {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

function knowledgeConceptsCollectionRef() {
  return collection(getDb(), 'knowledgeConcepts');
}

/** Persists one KnowledgeConcept (create or update) — a single small write. */
export async function saveKnowledgeConcept(concept) {
  const ref = doc(knowledgeConceptsCollectionRef(), concept.id);
  await setDoc(ref, { ...concept });
  return concept;
}

/** One KnowledgeConcept by its own id, or null. */
export async function getKnowledgeConceptById(conceptId) {
  const snapshot = await getDoc(doc(knowledgeConceptsCollectionRef(), conceptId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

/** Every KnowledgeConcept, in one query — plain one-time fetch, not a live listener, matching every other top-level repository's own "simple and explicit over cached and synchronized" convention. */
export async function getAllKnowledgeConcepts() {
  const snapshot = await getDocs(knowledgeConceptsCollectionRef());
  return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
}

/** Permanently removes a KnowledgeConcept document (enforced by firestore.rules, not here). */
export async function deleteKnowledgeConcept(conceptId) {
  await deleteDoc(doc(knowledgeConceptsCollectionRef(), conceptId));
}
