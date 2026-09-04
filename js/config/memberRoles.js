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
 * are the exact same kind of reserved, unassigned placeholder — added
 * for the same reason STUDENT/PARENT were: so the vocabulary a future
 * manager-lens membership entry would use already exists, without
 * pretending the underlying feature exists too. No code path anywhere
 * assigns either role to a real uid, and both have zero permissions
 * below. Deliberately NOT enough to build a manager lens on its own —
 * this repo's own Phase 6 investigation found real, unresolved gaps a
 * role name alone doesn't touch: `schoolName` is still free-text with
 * no verified School entity to scope a manager's real authority
 * against, and Firestore's `classrooms` collection still denies `list`
 * entirely, so there is still no way for a PM/HM to discover or be
 * granted access across many classrooms without an individual
 * `memberUids` entry on each one — same as a co-teacher today. Adding
 * these two keys only means: if/when a real membership entry needs
 * `role: 'program_manager'` or `role: 'head_master'`, it can be
 * created through the exact same addMember() call already used for
 * every other role, with no new membership mechanism to invent, and no
 * existing permission check needs to change shape to accommodate it
 * (see ROLE_PERMISSIONS below — both intentionally empty, exactly like
 * STUDENT/PARENT).
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
  // Lesson Planning & Review — deliberately granted to every classroom
  // TEACHER, not a distinct "reviewer" role: V1's own scope decision is
  // that a reviewer must be a co-teacher of the SAME classroom (no
  // School/Programme entity exists yet to ground a cross-classroom
  // PM/HM scope in — see this file's own PROGRAM_MANAGER/HEAD_MASTER
  // comment above for the identical gap). Any co-teacher reviewing a
  // colleague's plan is a real, if imperfect, V1 answer; a true
  // manager-lens reviewer role is future work, not guessed at here.
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
  // All four intentionally empty — see file header. Real permissions for
  // STUDENT/PARENT are a decision for when authentication is approved;
  // real permissions for PROGRAM_MANAGER/HEAD_MASTER are a decision for
  // when the manager lens itself is actually built. Neither is something
  // to guess at now.
  [MEMBER_ROLES.STUDENT]: Object.freeze([]),
  [MEMBER_ROLES.PARENT]: Object.freeze([]),
  [MEMBER_ROLES.PROGRAM_MANAGER]: Object.freeze([]),
  [MEMBER_ROLES.HEAD_MASTER]: Object.freeze([]),
});
