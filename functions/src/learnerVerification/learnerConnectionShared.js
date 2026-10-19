/**
 * functions/src/learnerVerification/learnerConnectionShared.js
 *
 * Deliberate duplicate of the pure data-shape constants/helpers this
 * module needs from js/models/LearnerConnection.js (RELATIONSHIP_STATUS,
 * CODE_STATUS, buildRelationshipId, findTrustedAutomaticMatch) — NOT a
 * re-export, because js/models/LearnerConnection.js lives outside
 * functions/, and Cloud Functions only packages the functions/
 * directory itself at deploy time (see verifyLearnerConnection.js's own
 * header comment, and functions/index.js's header comment for the
 * packaging failure this duplication fixes).
 *
 * Same duplication pattern already established in this codebase for
 * exactly this reason — see js/utils/hashUtils.js /
 * functions/src/learnerVerification/hashUtils.js, kept in sync via a
 * cross-environment test. This file's parity with
 * js/models/LearnerConnection.js is asserted the same way — see
 * tests/functions/learnerConnectionShared.test.js. If these two files
 * ever disagree, js/models/LearnerConnection.js is the source of truth;
 * update this file to match, never the other way around.
 *
 * generateClassroomInvitationCode, generateStudentVerificationCode,
 * createClassroomInvitation, and createStudentVerificationCode are
 * deliberately NOT duplicated here — they are only ever called from
 * client/teacher-authoring code, never from this server-side
 * verification path.
 */

export const RELATIONSHIP_STATUS = Object.freeze({
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
  REJECTED: 'REJECTED',
});

export const CODE_STATUS = Object.freeze({
  ACTIVE: 'active',
  REDEEMED: 'redeemed',
  REVOKED: 'revoked',
});

export function buildRelationshipId(learnerProfileId, classroomId) {
  return `${learnerProfileId}_${classroomId}`;
}

export function findTrustedAutomaticMatch(/* { learnerProfileId, classroomId } */) {
  return null;
}
