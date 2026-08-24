/**
 * models/MembershipLink.js
 *
 * PHASE 1 — Membership Identity Foundation.
 *
 * One student device's own attestation that a specific per-slot
 * Firebase Auth uid corresponds to a specific studentId's active
 * membership in a specific Learning Programme. Lives at:
 *
 *   classrooms/{classroomId}/learningProgrammes/{programmeId}/membershipLinks/{uid}
 *
 * The document ID IS the uid — deliberately, not a separate `uid`
 * field inside the document. This is what lets a security rule
 * resolve "does the caller's own uid correspond to an active member
 * of this programme" via a single, concrete get() keyed directly by
 * request.auth.uid — never a query, never a search over a list of
 * documents, and therefore never subject to Firestore's own
 * documented "cannot prove a rule holds for every possible result of
 * a list operation" limitation (see firestore.rules' own comment on
 * this collection, and the security audit this Phase was authorized
 * from, for the full reasoning).
 *
 * `programmeId` is NOT a field on this document — it's already the
 * document's own path segment. Storing it again as a field would
 * only create a second, forgeable place a client could claim a
 * different programme than the one this document actually lives
 * under; the path itself is the only place that value may ever come
 * from.
 *
 * Immutable once created (see firestore.rules: `allow update: if
 * false`) — a device's own link is never edited, matching every
 * other append-only/immutable-record convention already established
 * in this app (ProgrammeMembership, StudentGoalTracker's own
 * completions, etc.). A student getting a new device/clearing their
 * browser produces a brand-new uid and therefore a brand-new,
 * separate MembershipLink document — never a rewrite of an old one.
 *
 * Per this Phase's own explicit "do not describe this as
 * cryptographic proof of real-world student identity" instruction:
 * this document establishes exactly one thing — this specific uid
 * has, at some point, self-attested a specific claimed studentId,
 * and that claim was verified (at the moment of creation, by the
 * security rule) against a real, active ProgrammeMembership record.
 * It inherits the same trust ceiling the rest of the Student Portal
 * already operates at (self-attested roster selection, no verified
 * real-world identity) — not something stronger.
 */

export function createMembershipLink({ studentId, joinedAt, status = 'active' } = {}) {
  return {
    studentId,
    joinedAt,
    status,
  };
}
