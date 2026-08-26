/**
 * repositories/classroomRepository.js
 *
 * Defines the contract every classroom repository must implement.
 * services/workspaceService.js depends on this shape, never on Firebase
 * directly, so a future storage provider (or a second one, for tests)
 * can be swapped in by implementing this same contract.
 *
 * As of this phase, classrooms are shared documents at
 * classrooms/{classroomId} rather than nested under a single owner's
 * uid — a teacher's list of accessible classrooms is now a separate,
 * lightweight pointer collection (users/{uid}/classroomRefs), since
 * Firestore can't query "which documents have my uid as a member".
 */

export class ClassroomRepository {
  /** Subscribes to the classroom pointers this uid can access. Returns an unsubscribe function. */
  // eslint-disable-next-line no-unused-vars
  subscribeToClassroomRefs(uid, onChange, onError) {
    throw new Error('ClassroomRepository.subscribeToClassroomRefs() must be implemented by a subclass');
  }

  /** Subscribes to one shared classroom document by id. onChange(null) means it no longer exists (or access was lost). */
  // eslint-disable-next-line no-unused-vars
  subscribeToClassroom(classroomId, onChange, onError) {
    throw new Error('ClassroomRepository.subscribeToClassroom() must be implemented by a subclass');
  }

  /** Atomically creates the classroom document and the owner's classroomRefs pointer. */
  // eslint-disable-next-line no-unused-vars
  async createClassroomWithOwner(classroom, ownerUid) {
    throw new Error('ClassroomRepository.createClassroomWithOwner() must be implemented by a subclass');
  }

  /** Upserts a single classroom document — an incremental write, not a whole-workspace rewrite. */
  // eslint-disable-next-line no-unused-vars
  async saveClassroom(classroom) {
    throw new Error('ClassroomRepository.saveClassroom() must be implemented by a subclass');
  }

  /** Atomically deletes the classroom document and every member's classroomRefs pointer. */
  // eslint-disable-next-line no-unused-vars
  async deleteClassroom(classroomId, memberUids) {
    throw new Error('ClassroomRepository.deleteClassroom() must be implemented by a subclass');
  }

  /**
   * Migration-only: attempts to claim "run the shared-classrooms
   * migration for this account" so two devices signing in around the
   * same time don't both run it. Returns true if this call won the
   * claim, false if it was already claimed.
   */
  // eslint-disable-next-line no-unused-vars
  async claimMigration(uid) {
    throw new Error('ClassroomRepository.claimMigration() must be implemented by a subclass');
  }

  /** Migration-only: one-time read of a teacher's pre-sharing classrooms (Sprint 5's location). */
  // eslint-disable-next-line no-unused-vars
  async getLegacyClassroomsOnce(uid) {
    throw new Error('ClassroomRepository.getLegacyClassroomsOnce() must be implemented by a subclass');
  }

  /** Migration-only: removes one classroom from the pre-sharing location once it's been migrated. */
  // eslint-disable-next-line no-unused-vars
  async deleteLegacyClassroom(uid, classroomId) {
    throw new Error('ClassroomRepository.deleteLegacyClassroom() must be implemented by a subclass');
  }

  /**
   * Continue Working (see services/continueWorkingService.js): records
   * that this uid just opened a notebook, keeping only their most recent
   * few. Deliberately scoped to the teacher's own `users/{uid}` document
   * — never the classroom — since "recently opened" is personal, not
   * something every teacher on a shared classroom should see reflected
   * back at them from someone else's activity.
   */
  // eslint-disable-next-line no-unused-vars
  async recordRecentNotebook(uid, entry) {
    throw new Error('ClassroomRepository.recordRecentNotebook() must be implemented by a subclass');
  }

  /** Subscribes to this uid's recently-opened-notebooks list. Returns an unsubscribe function. */
  // eslint-disable-next-line no-unused-vars
  subscribeToRecentNotebooks(uid, onChange, onError) {
    throw new Error('ClassroomRepository.subscribeToRecentNotebooks() must be implemented by a subclass');
  }

  /**
   * One-time read of this uid's recently-opened-notebooks list — used by
   * the Dashboard's Continue Working widget, which renders once per
   * visit rather than staying live-subscribed (see
   * services/continueWorkingService.js's getRecentOnce() for why: this
   * app has no view-unmount hook yet to safely tear down a
   * view-scoped subscription, so a one-time read is the honest choice
   * until that exists).
   */
  // eslint-disable-next-line no-unused-vars
  async getRecentNotebooksOnce(uid) {
    throw new Error('ClassroomRepository.getRecentNotebooksOnce() must be implemented by a subclass');
  }

  /**
   * Theme preference (Phase 6A — see services/themePreferenceService.js):
   * one-time read of this uid's stored 'light' | 'dark' | 'system'
   * value, or null if never set (a brand-new user).
   */
  // eslint-disable-next-line no-unused-vars
  async getThemePreferenceOnce(uid) {
    throw new Error('ClassroomRepository.getThemePreferenceOnce() must be implemented by a subclass');
  }

  /** Persists a theme preference for this uid. Fire-and-forget from the caller's side — see themePreferenceService.js. */
  // eslint-disable-next-line no-unused-vars
  async setThemePreference(uid, theme) {
    throw new Error('ClassroomRepository.setThemePreference() must be implemented by a subclass');
  }

  /**
   * Accent color preference (see services/accentColorPreferenceService.js)
   * — a new field (accentColor), not a repurposing of the retired
   * theme field above, since "theme" no longer has a clear meaning in
   * this app and reusing its name for a different concept would be
   * confusing later.
   */
  // eslint-disable-next-line no-unused-vars
  async getAccentColorPreferenceOnce(uid) {
    throw new Error('ClassroomRepository.getAccentColorPreferenceOnce() must be implemented by a subclass');
  }

  // eslint-disable-next-line no-unused-vars
  async setAccentColorPreference(uid, colorId) {
    throw new Error('ClassroomRepository.setAccentColorPreference() must be implemented by a subclass');
  }

  /** Populates the small public lookup used by "Join a Classroom" — see services/classroomService.js's ensureJoinCode(). */
  // eslint-disable-next-line no-unused-vars
  async createJoinCodeMapping(code, classroomId) {
    throw new Error('ClassroomRepository.createJoinCodeMapping() must be implemented by a subclass');
  }

  /** Resolves a join code to a classroomId, or null if the code doesn't exist. */
  // eslint-disable-next-line no-unused-vars
  async getClassroomIdByJoinCode(code) {
    throw new Error('ClassroomRepository.getClassroomIdByJoinCode() must be implemented by a subclass');
  }

  /** Same as createJoinCodeMapping(), for the separate student-facing code — see classroomService.js's ensureStudentJoinCode(). A distinct mapping so a student code can never resolve through the co-teacher lookup, or vice versa. */
  // eslint-disable-next-line no-unused-vars
  async createStudentJoinCodeMapping(code, classroomId) {
    throw new Error('ClassroomRepository.createStudentJoinCodeMapping() must be implemented by a subclass');
  }

  /** Resolves a student join code to a classroomId, or null if the code doesn't exist. */
  // eslint-disable-next-line no-unused-vars
  async getClassroomIdByStudentJoinCode(code) {
    throw new Error('ClassroomRepository.getClassroomIdByStudentJoinCode() must be implemented by a subclass');
  }

  /** A narrow, additive-only write adding exactly one uid as a member — see firestoreClassroomRepository.js's implementation for why this shape matters for the security rule it needs. */
  // eslint-disable-next-line no-unused-vars
  async addSelfAsTeacher(classroomId, uid, memberInfo) {
    throw new Error('ClassroomRepository.addSelfAsTeacher() must be implemented by a subclass');
  }

  /** A one-time read of a classroom document — used by services/classSessionService.js's discardSession(), to throw away in-memory-only draft mutations by re-fetching the last-saved server state. Not a subscription. */
  // eslint-disable-next-line no-unused-vars
  async getClassroomOnce(classroomId) {
    throw new Error('ClassroomRepository.getClassroomOnce() must be implemented by a subclass');
  }

  /**
   * Atomically appends one or more StudentEvents to classroom.studentEvents,
   * touching no other field — for a caller (like Class Feed's
   * createPostAsTeacher()) that has no live, already-loaded classroom
   * object it's about to save wholesale via saveClassroom() anyway.
   * Every existing StudentEvent publisher (badges, stars, assessments)
   * instead mutates an in-memory classroom that a broader Class Mode
   * action already owns and persists via a full saveClassroom()
   * overwrite; reusing that same path here would mean reading the
   * whole classroom fresh just to re-save it unchanged except for a
   * few array entries, and would risk silently clobbering any other
   * concurrent edit to that document with a stale full-document
   * write. A targeted arrayUnion() update avoids both problems.
   */
  // eslint-disable-next-line no-unused-vars
  async appendStudentEvents(classroomId, events) {
    throw new Error('ClassroomRepository.appendStudentEvents() must be implemented by a subclass');
  }
}
