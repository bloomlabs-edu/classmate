/**
 * repositories/identity/StudentLinkRepository.js
 *
 * The persistence contract behind linking a Google (or future
 * Microsoft/SSO/OTP) account to one or more students. A production
 * implementation would back this with the Firestore collections
 * documented below; LocalStudentLinkRepository.js backs it with
 * localStorage/in-memory storage instead — genuinely generic over any
 * real classroom's real students, not tied to any fixed roster. It
 * exists so this whole architecture works fully today, against real
 * classroom data, without needing Firestore-backed PIN/token storage
 * (still pending the AI Working Committee's consent review) to be
 * built first.
 *
 * Proposed Firestore model for a future production implementation
 * (not built this phase — documented here so the interface shape
 * below is designed against something real, not invented in a vacuum):
 *
 *   identityLinks/{providerUserId}
 *     { provider: 'google', studentRefs: [{ classroomId, studentId }],
 *       lastSelectedStudentId, linkedAt }
 *   — the actual account-to-student mapping, keyed by provider user id
 *     (not classroom or student id) so lookups on sign-in are a single
 *     document read. `provider` is stored per-link so a future
 *     Microsoft/SSO/OTP provider can write into the same collection
 *     without a schema change.
 *
 *   A student's PIN lives ON the existing student object inside its
 *   classroom document (student.portalPin, student.portalPinGeneratedAt)
 *   — reusing the classroom/team/student model that already exists,
 *   rather than a parallel top-level `students` collection, per Bloom
 *   Labs' stated "reuse existing Firestore data" philosophy.
 *
 *   invitationTokens/{token}
 *     { classroomId, studentId, expiresAt, used, createdAt }
 *   — single-use, expiring invitation links, in their own small
 *     collection (the same reasoning as the co-teacher join-code
 *     collection built earlier: a token needs to be resolvable by an
 *     unlinked visitor, which full classroom documents can't safely
 *     allow — see that feature's own CHANGELOG entry).
 */

export class StudentLinkRepository {
  /** Every student this provider user is currently linked to — [{ classroomId, studentId, studentName }]. */
  // eslint-disable-next-line no-unused-vars
  async getLinkedStudents(providerUserId) {
    throw new Error('StudentLinkRepository.getLinkedStudents() must be implemented by a subclass');
  }

  /** Whether ANY parent account is currently linked to this specific student — powers Student Access's "which parents have already connected?" status view, the reverse direction of getLinkedStudents(). */
  // eslint-disable-next-line no-unused-vars
  async isStudentLinked(classroomId, studentId) {
    throw new Error('StudentLinkRepository.isStudentLinked() must be implemented by a subclass');
  }

  /** Whether any invitation token has ever been generated for this classroom — used by setupStateService.js's hasSentInvitation signal, independent of whether the invitation was actually redeemed. */
  // eslint-disable-next-line no-unused-vars
  async hasAnyInvitationForClassroom(classroomId) {
    throw new Error('StudentLinkRepository.hasAnyInvitationForClassroom() must be implemented by a subclass');
  }

  /** Resolves a PIN to the student it belongs to (or null if invalid/unknown), without linking anything yet — linking is a separate, explicit step below. */
  // eslint-disable-next-line no-unused-vars
  async resolvePin(pin) {
    throw new Error('StudentLinkRepository.resolvePin() must be implemented by a subclass');
  }

  /** Links providerUserId to the given student, and clears that student's PIN — a PIN is a one-time linking token, not a reusable password (see ConsentProvider.js's sibling doc comment on this same "placeholder vs load-bearing" distinction). */
  // eslint-disable-next-line no-unused-vars
  async linkStudent(providerUserId, studentRef) {
    throw new Error('StudentLinkRepository.linkStudent() must be implemented by a subclass');
  }

  /** Resolves an invitation token to the student it points to, or null if invalid, expired, or already used. Does not consume it — see redeemInvitationToken(). */
  // eslint-disable-next-line no-unused-vars
  async resolveInvitationToken(token) {
    throw new Error('StudentLinkRepository.resolveInvitationToken() must be implemented by a subclass');
  }

  /** Links providerUserId to the token's student AND marks the token used, atomically — a token must never be redeemable twice. */
  // eslint-disable-next-line no-unused-vars
  async redeemInvitationToken(providerUserId, token) {
    throw new Error('StudentLinkRepository.redeemInvitationToken() must be implemented by a subclass');
  }

  // eslint-disable-next-line no-unused-vars
  async setLastSelectedStudent(providerUserId, studentRef) {
    throw new Error('StudentLinkRepository.setLastSelectedStudent() must be implemented by a subclass');
  }

  /** Returns the last-selected student ref, or null if none recorded yet (e.g. a first-time link with only one student). */
  // eslint-disable-next-line no-unused-vars
  async getLastSelectedStudent(providerUserId) {
    throw new Error('StudentLinkRepository.getLastSelectedStudent() must be implemented by a subclass');
  }

  // --- Teacher-side operations (called from Classroom Tracker, not the Student Portal) ---

  /** Generates a fresh PIN for a student, overwriting any existing one — teachers never choose or type a PIN themselves. studentName is stored alongside so resolvePin() can return it later without this repository needing any independent knowledge of who students are. */
  // eslint-disable-next-line no-unused-vars
  async generatePin(classroomId, studentId, studentName) {
    throw new Error('StudentLinkRepository.generatePin() must be implemented by a subclass');
  }

  /** Creates a single-use invitation token for a student, expiring after expiryDays. Returns the token string. studentName is stored alongside for the same reason as generatePin() above. */
  // eslint-disable-next-line no-unused-vars
  async generateInvitationToken(classroomId, studentId, studentName, expiryDays) {
    throw new Error('StudentLinkRepository.generateInvitationToken() must be implemented by a subclass');
  }
}
