/**
 * repositories/knowledgeRelationshipRepository.js
 *
 * Isolates Firestore access for KnowledgeRelationships (see
 * models/KnowledgeRelationship.js) — a DELIBERATELY SEPARATE, TOP-LEVEL
 * `knowledgeRelationships/{relationshipId}` collection, same "shared,
 * global, not one classroom's own data" reasoning as
 * repositories/knowledgeConceptRepository.js.
 *
 * Phase K1 scope: the minimum CRUD only, same reasoning as
 * knowledgeConceptRepository.js — no "relationships for this Concept"
 * query yet, since no caller exists for one this phase.
 */

import { getFirestore, collection, doc, getDoc, setDoc, deleteDoc, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';

let db = null;

function getDb() {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

function knowledgeRelationshipsCollectionRef() {
  return collection(getDb(), 'knowledgeRelationships');
}

/** Persists one KnowledgeRelationship (create or update) — a single small write. */
export async function saveKnowledgeRelationship(relationship) {
  const ref = doc(knowledgeRelationshipsCollectionRef(), relationship.id);
  await setDoc(ref, { ...relationship });
  return relationship;
}

/** One KnowledgeRelationship by its own id, or null. */
export async function getKnowledgeRelationshipById(relationshipId) {
  const snapshot = await getDoc(doc(knowledgeRelationshipsCollectionRef(), relationshipId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

/** Every KnowledgeRelationship, in one query — plain one-time fetch, not a live listener. */
export async function getAllKnowledgeRelationships() {
  const snapshot = await getDocs(knowledgeRelationshipsCollectionRef());
  return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
}

/** Permanently removes a KnowledgeRelationship document (enforced by firestore.rules, not here). */
export async function deleteKnowledgeRelationship(relationshipId) {
  await deleteDoc(doc(knowledgeRelationshipsCollectionRef(), relationshipId));
}
