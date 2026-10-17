/**
 * models/LearnerConnection.js
 *
 * The Learner Identity Bridge's own data shapes — see
 * docs/architecture/CLASSROOM_INVITATION_VERIFICATION_BRIDGE.md for the
 * full design. Four distinct things, deliberately never merged into one
 * (per that doc's own "four identifiers, never conflated" rule):
 *
 *   ClassroomInvitation      — identifies a classroom only, never a student.
 *   StudentVerificationCode  — the one-time, student-specific fallback
 *                              credential (raw code never persisted; see
 *                              buildVerificationCodeHash() below).
 *   LearnerClassroomRelationship — the PENDING/ACTIVE/REVOKED fact this
 *                              whole bridge exists to establish.
 *   learnerProfileId          — always treated as an OPAQUE string this
 *                              file (and everything downstream of it)
 *                              never interprets, parses, or derives
 *                              meaning from. It is Learning Hub's own
 *                              identifier, handed to ClassMate as a bare
 *                              reference — exactly the same "reference,
 *                              never embed" convention this app already
 *                              uses for every other cross-collection id.
 *
 * This file has zero Firestore/network imports — every function here is
 * pure, so the shapes and the (documented-empty) automatic-match logic
 * are directly unit-testable, matching this project's own established
 * "extract pure logic" convention (see services/achievementEngine.js's
 * own header comment for the same reasoning applied elsewhere).
 */

import { generateJoinCode } from '../utils/idGenerator.js';

export const RELATIONSHIP_STATUS = Object.freeze({
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
  // A teacher's explicit "this isn't one of my students" decision on a
  // still-PENDING relationship — see rejectRelationship() in
  // repositories/firestoreLearnerConnectionRepository.js and the
  // PENDING -> REJECTED branch in firestore.rules. Deliberately a
  // distinct terminal state from REVOKED: REVOKED always means "this
  // was ACTIVE and no longer should be" (an established link being
  // withdrawn); REJECTED means a link was never established at all. A
  // REJECTED relationship follows the same "no path back without
  // starting over" rule REVOKED does (§5 of the architecture doc) — a
  // learner who was rejected in error must submit a fresh connection
  // request, never reactivate the rejected one.
  REJECTED: 'REJECTED',
});

export const CODE_STATUS = Object.freeze({
  ACTIVE: 'active',
  REDEEMED: 'redeemed',
  REVOKED: 'revoked',
});

/** The deterministic composite id every rule and lookup in this bridge relies on — see the architecture doc's own "doc id is the identity being checked" principle, generalized from MembershipLink. */
export function buildRelationshipId(learnerProfileId, classroomId) {
  return `${learnerProfileId}_${classroomId}`;
}

/**
 * A classroom-wide invitation — reuses utils/idGenerator.js's own
 * generateJoinCode() purely as a code-FORMAT utility (6 chars, no
 * visually-ambiguous characters) — this is not a reuse of the old
 * Student Mode identity system in any way; it never touches
 * studentDeviceService.js, studentAuthService.js, or
 * classroomStudentJoinCode. A fresh, separate code, for a fresh,
 * separate purpose.
 *
 * Deliberately NOT a high-entropy secret: per the architecture brief,
 * this identifies a classroom only and "is shareable with the whole
 * class" — its own document (see repositories/
 * firestoreLearnerConnectionRepository.js) carries nothing beyond a
 * classroomId/invitationId pointer, so guessing it costs an attacker
 * nothing they couldn't already get from the classroom's own existing
 * (equally non-secret) student join code.
 */
export function generateClassroomInvitationCode() {
  return generateJoinCode();
}

export function createClassroomInvitation({ id, classroomId, code, createdByUid, createdAt }) {
  return {
    id,
    classroomId,
    code,
    status: CODE_STATUS.ACTIVE,
    createdByUid,
    createdAt,
  };
}

/**
 * A real CSPRNG-backed credential, unlike generateClassroomInvitationCode()
 * above — this one IS a security boundary (architecture doc item 4: the
 * fallback that actually binds a Learning Hub learner to one specific
 * roster student), so it needs real entropy, not the classroom
 * invitation's plain "hard to guess, not meant to be secret" format.
 *
 * 10 characters from a 32-symbol alphabet (Crockford-style, excludes
 * visually ambiguous 0/O/1/I/L) = log2(32) * 10 = 50 bits. Sized for a
 * credential a teacher reads aloud or writes on a slip of paper (must
 * stay human-typeable) rather than one delivered via QR code (see the
 * security review's own 256-bit design for that different, higher-
 * entropy, machine-delivered case) — appropriate specifically because
 * this credential is additionally single-use, expiring, and scoped to
 * one classroom's own roster (§ security requirements), not relying on
 * entropy alone the way an unscoped bearer token would have to.
 */
const VERIFICATION_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const VERIFICATION_CODE_LENGTH = 10;

export function generateStudentVerificationCode() {
  const bytes = new Uint8Array(VERIFICATION_CODE_LENGTH);
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : globalThis.crypto;
  cryptoObj.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < VERIFICATION_CODE_LENGTH; i++) {
    code += VERIFICATION_CODE_ALPHABET[bytes[i] % VERIFICATION_CODE_ALPHABET.length];
  }
  return code;
}

/** Default lifetime for a student verification code — longer than the security review's 15-minute cross-project bridge token, deliberately: this credential is handed to a family by a teacher (in person, on a note home) and redeemed at the family's own pace, an asynchronous pattern the architecture brief's own item 4 explicitly allows ("shared Google accounts, ambiguous learner identity" implies some real-world delay before redemption), not the interactive "scan now" case the other token was sized for. */
export const STUDENT_VERIFICATION_CODE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * `learnerProfileId` — added per the CRITICAL FIRST STEP security
 * review for the teacher-facing pending-request review workflow
 * (ui/views/ConnectLearningHubView.js): without this field, a
 * verification code was bound only to (classroomId, studentId), NOT to
 * the specific PENDING `learnerClassroomRelationships` record a
 * teacher was actually reviewing when they generated it. That gap
 * meant ANY learnerProfileId with a non-ACTIVE relationship in this
 * classroom (trivially created by presenting the classroom's own
 * shareable invitation code) could redeem a code generated "for" a
 * different, specific pending request and become bound to that
 * studentId instead — a real mis-binding, not merely a theoretical
 * one, given a classroom can legitimately have more than one
 * simultaneous PENDING request (see the architecture doc's own
 * "multiple pending requests are never merged" requirement). Binding
 * the code to the exact learnerProfileId the teacher was reviewing,
 * enforced both at creation (firestore.rules — the relationship must
 * exist and be PENDING for this classroom) and at redemption
 * (server/learnerVerification/verifyLearnerConnection.js — the
 * redeeming learnerProfileId must match), closes this without
 * weakening the existing anti-oracle/roster-recheck guarantees.
 */
export function createStudentVerificationCode({ codeHash, classroomId, studentId, learnerProfileId, createdByUid, createdAt, expiresAt }) {
  return {
    codeHash,
    classroomId,
    studentId,
    learnerProfileId,
    status: CODE_STATUS.ACTIVE,
    createdByUid,
    createdAt,
    expiresAt,
  };
}

export function createPendingRelationship({ learnerProfileId, classroomId, invitationCode, createdAt }) {
  return {
    learnerProfileId,
    classroomId,
    studentId: null,
    status: RELATIONSHIP_STATUS.PENDING,
    invitationCode,
    createdAt,
  };
}

/**
 * THE DOCUMENTED, DELIBERATE ANSWER to "does a trusted automatic match
 * exist?" (architecture brief item 8) — always returns null today. This
 * is not a placeholder for a TODO; it is the correct, evidence-based
 * answer given the current ClassMate architecture, and this function
 * exists specifically so that fact is asserted in code (and covered by
 * a real test — see tests/models/learnerConnection.test.js) rather than
 * silently assumed or, worse, quietly "solved" with an unsafe name/email
 * match.
 *
 * Why no trusted signal exists today, traced directly (see
 * docs/architecture/STUDENT_PROFILE_ARCHITECTURE_AUDIT.md §3.9,
 * §14 for the full trace this summarizes):
 *   - models/Student.js has no email, no auth uid, no Google identity
 *     field of any kind — a roster student is a name + a random id,
 *     nothing a Learning Hub Firebase UID could ever be compared
 *     against.
 *   - The one place ClassMate DOES verify a real uid<->studentId
 *     binding today (MembershipLink) is self-attested at creation and
 *     explicitly scoped to Learning Circle access, not general identity
 *     — its own doc comment says not to treat it as identity proof.
 *   - `studentAuthLinks` (the one mechanism that WOULD have provided
 *     this) has no supporting Firestore rule at all — it is inert.
 *
 * If a future, genuinely trusted signal is ever added (per the
 * architecture doc's own explicit instruction not to invent one now),
 * this is the one function that should change — every caller already
 * treats a null result as "fall back to the verification code," so no
 * caller needs to change when this one day does return something real.
 */
export function findTrustedAutomaticMatch(/* { learnerProfileId, classroomId } */) {
  return null;
}
