/**
 * repositories/knowledgeClassificationMembershipRepository.js
 *
 * Isolates Firestore access for KnowledgeClassificationMemberships (see
 * models/KnowledgeClassificationMembership.js) — a DELIBERATELY
 * SEPARATE, TOP-LEVEL `knowledgeClassificationMemberships/{membershipId}`
 * collection, same "shared, global, not one classroom's own data"
 * reasoning as repositories/knowledgeConceptRepository.js.
 *
 * Phase K1 scope: the minimum CRUD only, same reasoning as
 * knowledgeConceptRepository.js — no "memberships for this Concept" or
 * "memberships for this Classification" query yet, since no caller
 * exists for either this phase.
 */

import { getFirestore, collection, doc, getDoc, setDoc, deleteDoc, getDocs } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';

let db = null;

function getDb() {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

function knowledgeClassificationMembershipsCollectionRef() {
  return collection(getDb(), 'knowledgeClassificationMemberships');
}

/** Persists one KnowledgeClassificationMembership (create or update) — a single small write. */
export async function saveKnowledgeClassificationMembership(membership) {
  const ref = doc(knowledgeClassificationMembershipsCollectionRef(), membership.id);
  await setDoc(ref, { ...membership });
  return membership;
}

/** One KnowledgeClassificationMembership by its own id, or null. */
export async function getKnowledgeClassificationMembershipById(membershipId) {
  const snapshot = await getDoc(doc(knowledgeClassificationMembershipsCollectionRef(), membershipId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

/** Every KnowledgeClassificationMembership, in one query — plain one-time fetch, not a live listener. */
export async function getAllKnowledgeClassificationMemberships() {
  const snapshot = await getDocs(knowledgeClassificationMembershipsCollectionRef());
  return snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
}

/** Permanently removes a KnowledgeClassificationMembership document (enforced by firestore.rules, not here). */
export async function deleteKnowledgeClassificationMembership(membershipId) {
  await deleteDoc(doc(knowledgeClassificationMembershipsCollectionRef(), membershipId));
}
