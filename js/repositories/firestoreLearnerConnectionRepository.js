/**
 * repositories/firestoreLearnerConnectionRepository.js
 *
 * The ONLY file that knows the Firestore path shapes for the Learner
 * Identity Bridge's teacher-facing collections — see
 * docs/architecture/CLASSROOM_INVITATION_VERIFICATION_BRIDGE.md for the
 * full design and models/LearnerConnection.js for the data shapes.
 *
 * Every function here runs from the TEACHER's own already-authenticated
 * ClassMate session (the same default-app Firestore instance every other
 * teacher-facing repository in this app already uses) — never from a
 * student device, never from Learning Hub. Learning Hub never calls any
 * of this directly; it only ever reaches this bridge through the
 * trusted server module (server/learnerVerification/), which uses the
 * Admin SDK and is not subject to the rules this file's writes are
 * gated by.
 *
 * Deliberately does NOT implement code redemption/verification — that
 * requires computing a hash, which this client-side module could do,
 * but the ACTUAL security-critical check (does this hash correspond to
 * a real, active, unexpired code, atomically redeemed exactly once)
 * must happen in a trusted server context, never a client one. See
 * server/learnerVerification/verifyLearnerConnection.js.
 */

import {
  getFirestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  getDocs,
  query,
  where,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFirebaseApp } from '../services/firebaseApp.js';
import { generateId } from '../utils/idGenerator.js';
import { sha256Hex } from '../utils/hashUtils.js';
import {
  createClassroomInvitation,
  generateClassroomInvitationCode,
  createStudentVerificationCode,
  generateStudentVerificationCode,
  STUDENT_VERIFICATION_CODE_LIFETIME_MS,
  CODE_STATUS,
} from '../models/LearnerConnection.js';
import { getCurrentIsoDate } from '../utils/dateHelpers.js';

function db() {
  return getFirestore(getFirebaseApp());
}

function invitationDoc(classroomId, invitationId) {
  return doc(db(), 'classrooms', classroomId, 'classroomInvitations', invitationId);
}

function invitationCodeDoc(code) {
  return doc(db(), 'classroomInvitationCodes', code);
}

function invitationsCollection(classroomId) {
  return collection(db(), 'classrooms', classroomId, 'classroomInvitations');
}

function verificationCodeDoc(classroomId, codeHash) {
  return doc(db(), 'classrooms', classroomId, 'studentVerificationCodes', codeHash);
}

function verificationCodesCollection(classroomId) {
  return collection(db(), 'classrooms', classroomId, 'studentVerificationCodes');
}

function relationshipsCollection() {
  return collection(db(), 'learnerClassroomRelationships');
}

/**
 * Creates a fresh classroom-wide invitation. Two documents are written
 * (not one): the invitation record itself (teacher-owned, classroom-
 * scoped) and a top-level code->classroomId pointer, the same
 * two-collection shape this app already uses for
 * joinCodes/studentJoinCodes — see firestore.rules' own comment on
 * this block for why the pointer isn't publicly readable the way those
 * older ones are.
 *
 * Returns the raw, human-shareable code — this is the ONLY thing a
 * teacher ever needs to hand out; nothing about a specific student is
 * involved.
 */
export async function createClassroomInvitationForClassroom(classroomId, teacherUid) {
  const invitationId = generateId();
  const code = generateClassroomInvitationCode();
  const createdAt = getCurrentIsoDate();

  const invitation = createClassroomInvitation({
    id: invitationId,
    classroomId,
    code,
    createdByUid: teacherUid,
    createdAt,
  });

  await setDoc(invitationDoc(classroomId, invitationId), invitation);
  await setDoc(invitationCodeDoc(code), { classroomId, invitationId, status: 'active', createdAt });

  return { invitationId, code };
}

export async function revokeClassroomInvitation(classroomId, invitationId, code) {
  await updateDoc(invitationDoc(classroomId, invitationId), { status: 'revoked' });
  await updateDoc(invitationCodeDoc(code), { status: 'revoked' });
}

export async function listClassroomInvitations(classroomId) {
  const snapshot = await getDocs(invitationsCollection(classroomId));
  return snapshot.docs.map((docSnapshot) => docSnapshot.data());
}

/**
 * Creates a student-specific, one-time verification code (architecture
 * doc item 4) — the raw code is hashed client-side (SHA-256) before
 * anything is written; only the hash is ever persisted, as this
 * document's own id. Returns the raw code so the teacher can hand it to
 * the specific family it names — this is the only time the raw code
 * exists anywhere outside that hand-off.
 *
 * `learnerProfileId` is REQUIRED — the opaque id of the exact PENDING
 * relationship this code is being generated to resolve (i.e. the
 * pending row the teacher just reviewed in
 * ui/views/ConnectLearningHubView.js's roster-picker flow), never
 * optional. firestore.rules' own create rule for this collection
 * additionally requires a PENDING `learnerClassroomRelationships`
 * document to already exist for exactly this (learnerProfileId,
 * classroomId) pair before this write is even accepted — see that
 * rule's own comment for why, and
 * server/learnerVerification/verifyLearnerConnection.js's matching
 * redemption-time check for the other half of this binding.
 */
export async function createStudentVerificationCodeForStudent(classroomId, studentId, teacherUid, learnerProfileId) {
  if (!learnerProfileId) {
    throw new Error('createStudentVerificationCodeForStudent() requires learnerProfileId — a verification code must be bound to the exact pending relationship it resolves.');
  }

  const rawCode = generateStudentVerificationCode();
  const codeHash = await sha256Hex(rawCode);
  const createdAt = getCurrentIsoDate();
  const expiresAt = new Date(Date.now() + STUDENT_VERIFICATION_CODE_LIFETIME_MS).toISOString();

  const record = createStudentVerificationCode({
    codeHash,
    classroomId,
    studentId,
    learnerProfileId,
    createdByUid: teacherUid,
    createdAt,
    expiresAt,
  });

  await setDoc(verificationCodeDoc(classroomId, codeHash), record);

  return { rawCode, codeHash, expiresAt };
}

export async function revokeStudentVerificationCode(classroomId, codeHash) {
  await updateDoc(verificationCodeDoc(classroomId, codeHash), { status: CODE_STATUS.REVOKED });
}

/** Teacher-facing visibility only — never exposes a raw code, since none is ever stored. */
export async function listStudentVerificationCodes(classroomId) {
  const snapshot = await getDocs(verificationCodesCollection(classroomId));
  return snapshot.docs.map((docSnapshot) => docSnapshot.data());
}

/**
 * Teacher-facing read of every learner<->student relationship for this
 * classroom — the "teacher-facing learner representation" ClassMate
 * owns per the architecture doc's own ownership table. Always filtered
 * by `classroomId` in the query itself (never fetched unfiltered) —
 * this is what lets firestore.rules' own per-result `get()` check
 * resolve to a fixed path for every possible matching document, the
 * same safe-list-query shape documented in the architecture contract's
 * own §25/§C.
 */
export async function listRelationshipsForClassroom(classroomId) {
  const snapshot = await getDocs(query(relationshipsCollection(), where('classroomId', '==', classroomId)));
  return snapshot.docs.map((docSnapshot) => docSnapshot.data());
}

/**
 * Revokes an ACTIVE relationship directly from ClassMate's own teacher
 * UI — the one client-side mutation firestore.rules permits on this
 * collection at all (see that rule's own comment: every other
 * transition is Admin-SDK-only, by construction, not merely by
 * convention).
 */
export async function revokeRelationship(relationshipId, teacherUid) {
  await updateDoc(doc(relationshipsCollection(), relationshipId), {
    status: 'REVOKED',
    revokedAt: getCurrentIsoDate(),
    revokedByUid: teacherUid,
  });
}

/**
 * Rejects a still-PENDING relationship — the ClassMate-side teacher
 * decision "this Learning Hub learner's request does not belong to a
 * student in my classroom," mirroring revokeRelationship() above
 * exactly (narrow, single-purpose update; firestore.rules is the real
 * enforcement, not this function's own logic). The ONLY valid starting
 * state is PENDING — firestore.rules' own PENDING -> REJECTED branch
 * rejects this call outright (the Firestore write itself fails) if the
 * relationship is already ACTIVE or already REJECTED, so an ACTIVE
 * relationship can never be silently rejected out from under a learner
 * who already completed verification, and a REJECTED one can't be
 * "re-rejected" to paper over a races. Relationship identity (current
 * status, classroomId) is resolved from the Firestore document itself
 * at rule-evaluation time — this function never trusts a
 * client-supplied status.
 */
export async function rejectRelationship(relationshipId, teacherUid) {
  await updateDoc(doc(relationshipsCollection(), relationshipId), {
    status: 'REJECTED',
    rejectedAt: getCurrentIsoDate(),
    rejectedByUid: teacherUid,
  });
}
