/**
 * config/memberRoles.js
 *
 * The roles a Classroom member can hold, and what each role is allowed
 * to do. Backed by real Google-authenticated membership for OWNER,
 * TEACHER, and VIEWER (see services/memberService.js and
 * models/Classroom.js's `members` map).
 *
 * STUDENT and PARENT are added here as provider-agnostic role
 * *identifiers* only — reserving the vocabulary a future membership
 * entry would use (`classroom.members[uid] = { role: 'student', ... }`,
 * via the same memberService.addMember() teachers already use today),
 * not an authentication mechanism. No code path currently assigns
 * either role to a real uid, and neither has any permission yet: real
 * enforcement is intentionally deferred until student/parent
 * authentication is approved (see the Student Onboarding design
 * discussion — blocked pending AI Working Committee review of Google
 * Sign-In, profile photos, and DPDP Act children's-data handling for
 * minors). When that's approved, plugging in a real identity means
 * populating this same `members` map through the same addMember() call
 * — no new membership mechanism to invent.
 *
 * PROGRAM_MANAGER and HEAD_MASTER (Phase 6, PM/HM architectural prep)
 * were originally added as reserved, unassigned placeholders — the same
 * reason STUDENT/PARENT were: so the vocabulary a future manager-lens
 * membership entry would use already existed, without pretending the
 * underlying feature existed too. That Phase 6 investigation found real,
 * unresolved gaps a role name alone doesn't touch: `schoolName` is still
 * free-text with no verified School entity to scope a manager's real
 * authority against, and Firestore's `classrooms` collection still
 * denies `list` entirely, so there is still no way for a PM/HM to
 * discover or be granted access across many classrooms without an
 * individual `memberUids` entry on each one — same as a co-teacher.
 *
 * Programme Manager Weekly Plan Review (the first real PROGRAM_MANAGER
 * capability) deliberately reuses that exact same mechanism rather than
 * inventing a new one: a PM is granted access to one specific fellow's
 * classroom by being added as a real `classroom.members[pmUid] = {
 * role: 'program_manager' }` entry, through the exact same
 * memberService.addMember() call every other role already uses — see
 * that Phase 6 comment above, which anticipated this precisely. This is
 * a real, if operationally manual, V1 answer (one classroom at a time,
 * no bulk/programme-wide grant) — no School/Programme hierarchy was
 * built to automate it, per explicit scope direction. HEAD_MASTER
 * remains the exact same zero-permission placeholder it always was —
 * nothing in this change touches it.
 */

export const MEMBER_ROLES = Object.freeze({
  OWNER: 'owner',
  TEACHER: 'teacher',
  VIEWER: 'viewer',
  STUDENT: 'student', // provider-agnostic placeholder — see file header
  PARENT: 'parent', // provider-agnostic placeholder — see file header
  PROGRAM_MANAGER: 'program_manager', // reserved placeholder — see file header
  HEAD_MASTER: 'head_master', // reserved placeholder — see file header
});

export const PERMISSIONS = Object.freeze({
  AWARD_POINTS: 'award_points',
  UNDO: 'undo',
  RESET_SESSION: 'reset_session',
  IMPORT_ROSTER: 'import_roster',
  EDIT_STUDENTS: 'edit_students',
  EDIT_GROUPS: 'edit_groups',
  MARK_ATTENDANCE: 'mark_attendance', // future — attendance isn't built yet
  CREATE_LEARNING_ACTIVITY: 'create_learning_activity',
  INVITE_TEACHER: 'invite_teacher',
  REMOVE_TEACHER: 'remove_teacher',
  TRANSFER_OWNERSHIP: 'transfer_ownership', // future
  DELETE_CLASSROOM: 'delete_classroom',
  // Lesson Planning & Review — granted to every classroom TEACHER, and
  // (Programme Manager Weekly Plan Review) to PROGRAM_MANAGER too. Both
  // are still exactly "same-classroom member" in scope — see
  // services/lessonPlanReviewService.js's own canReviewLessonPlan()/
  // canApproveLessonPlan(), which resolve a role from
  // classroom.members[uid] no differently for either role. A PM's
  // "which classrooms" scope comes entirely from which classrooms they
  // were actually added to (this file's own PROGRAM_MANAGER comment
  // above) — not a distinct permission shape from a co-teacher's.
  REVIEW_LESSON_PLAN: 'review_lesson_plan',
  APPROVE_LESSON_PLAN: 'approve_lesson_plan',
});

export const ROLE_PERMISSIONS = Object.freeze({
  [MEMBER_ROLES.OWNER]: Object.freeze([
    PERMISSIONS.AWARD_POINTS,
    PERMISSIONS.UNDO,
    PERMISSIONS.RESET_SESSION,
    PERMISSIONS.IMPORT_ROSTER,
    PERMISSIONS.EDIT_STUDENTS,
    PERMISSIONS.EDIT_GROUPS,
    PERMISSIONS.MARK_ATTENDANCE,
    PERMISSIONS.CREATE_LEARNING_ACTIVITY,
    PERMISSIONS.INVITE_TEACHER,
    PERMISSIONS.REMOVE_TEACHER,
    PERMISSIONS.TRANSFER_OWNERSHIP,
    PERMISSIONS.DELETE_CLASSROOM,
    PERMISSIONS.REVIEW_LESSON_PLAN,
    PERMISSIONS.APPROVE_LESSON_PLAN,
  ]),
  [MEMBER_ROLES.TEACHER]: Object.freeze([
    PERMISSIONS.AWARD_POINTS,
    PERMISSIONS.UNDO,
    PERMISSIONS.RESET_SESSION,
    PERMISSIONS.IMPORT_ROSTER,
    PERMISSIONS.EDIT_STUDENTS,
    PERMISSIONS.EDIT_GROUPS,
    PERMISSIONS.MARK_ATTENDANCE,
    PERMISSIONS.CREATE_LEARNING_ACTIVITY,
    PERMISSIONS.REVIEW_LESSON_PLAN,
    PERMISSIONS.APPROVE_LESSON_PLAN,
  ]),
  [MEMBER_ROLES.VIEWER]: Object.freeze([]),
  // STUDENT/PARENT stay intentionally empty — see file header; real
  // permissions for either are a decision for when authentication is
  // approved, not something to guess at now.
  [MEMBER_ROLES.STUDENT]: Object.freeze([]),
  [MEMBER_ROLES.PARENT]: Object.freeze([]),
  // PROGRAM_MANAGER: exactly the two permissions Weekly Plan Review
  // needs, nothing else — no AWARD_POINTS, no EDIT_STUDENTS, no
  // INVITE_TEACHER, etc. A PM added to a classroom this way gains no
  // classroom-management capability at all, only the ability to review/
  // approve LessonPlans, identical in shape to a TEACHER's own grant of
  // the same two permissions above.
  [MEMBER_ROLES.PROGRAM_MANAGER]: Object.freeze([
    PERMISSIONS.REVIEW_LESSON_PLAN,
    PERMISSIONS.APPROVE_LESSON_PLAN,
  ]),
  // HEAD_MASTER stays intentionally empty — untouched by this change.
  [MEMBER_ROLES.HEAD_MASTER]: Object.freeze([]),
});
