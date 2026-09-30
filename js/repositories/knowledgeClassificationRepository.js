/**
 * repositories/knowledgeClassificationRepository.js
 *
 * Isolates Firestore access for KnowledgeClassifications (see
 * models/KnowledgeClassification.js) — a DELIBERATELY SEPARATE,
 * TOP-LEVEL `knowledgeClassifications/{classificationId}` collection,
 * same "shared, global, not one classroom's own data" reasoning as
 * repositories/knowledgeConceptRepository.js. Categories live inline on
 * this same document (see the model's own header comment) — there is
 * no separate categories collection/subcollection to touch here.
 *
 * Phase K1 scope: the minimum CRUD only, same reasoning as
 * knowledgeConceptRepository.js.
 */

import { getFirestore, collection, doc, getDoc, setDoc, deleteDoc, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';

let db = null;

function getDb() {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

function knowledgeClassificationsCollectionRef() {
  return collection(getDb(), 'knowledgeClassifications');
}

/** Persists one KnowledgeClassification (create or update, including its inline `categories[]`) — a single small write. */
export async function saveKnowledgeClassification(classification) {
  const ref = doc(knowledgeClassificationsCollectionRef(), classification.id);
  await setDoc(ref, { ...classification });
  return classification;
}

/** One KnowledgeClassification by its own id, or null. */
export async function getKnowledgeClassificationById(classificationId) {
  const snapshot = await getDoc(doc(knowledgeClassificationsCollectionRef(), classificationId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

/** Every KnowledgeClassification, in one query — plain one-time fetch, not a live listener. */
export async function getAllKnowledgeClassifications() {
  const snapshot = await getDocs(knowledgeClassificationsCollectionRef());
  return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
}

/** Permanently removes a KnowledgeClassification document (enforced by firestore.rules, not here). */
export async function deleteKnowledgeClassification(classificationId) {
  await deleteDoc(doc(knowledgeClassificationsCollectionRef(), classificationId));
}
