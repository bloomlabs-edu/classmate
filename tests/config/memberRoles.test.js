import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEMBER_ROLES, PERMISSIONS, ROLE_PERMISSIONS } from '../../js/config/memberRoles.js';
import { canPerform, canPerformAsUid, listPermissionsForRole } from '../../js/services/permissionService.js';
import { createClassroom } from '../../js/models/Classroom.js';
import { addMember, getRole } from '../../js/services/memberService.js';
import { getRolesSummary, roleLabel } from '../../js/services/personalHubService.js';

// ---------------------------------------------------------------------
// Phase 6 introduced PROGRAM_MANAGER / HEAD_MASTER as reserved,
// zero-permission role placeholders, mirroring STUDENT/PARENT (see
// config/memberRoles.js's own header comment). Programme Manager Weekly
// Plan Review is the first real PROGRAM_MANAGER capability:
// REVIEW_LESSON_PLAN/APPROVE_LESSON_PLAN only, nothing else — these
// tests confirm that grant is exact (no classroom-management permission
// leaks in) and that HEAD_MASTER remains completely untouched, still
// exactly the empty placeholder it always was.
// ---------------------------------------------------------------------

test('MEMBER_ROLES: existing roles are unchanged', () => {
  assert.equal(MEMBER_ROLES.OWNER, 'owner');
  assert.equal(MEMBER_ROLES.TEACHER, 'teacher');
  assert.equal(MEMBER_ROLES.VIEWER, 'viewer');
  assert.equal(MEMBER_ROLES.STUDENT, 'student');
  assert.equal(MEMBER_ROLES.PARENT, 'parent');
});

test('MEMBER_ROLES: PROGRAM_MANAGER and HEAD_MASTER are reserved with the expected string values', () => {
  assert.equal(MEMBER_ROLES.PROGRAM_MANAGER, 'program_manager');
  assert.equal(MEMBER_ROLES.HEAD_MASTER, 'head_master');
});

test('ROLE_PERMISSIONS: HEAD_MASTER grants zero permissions, matching STUDENT/PARENT — untouched by Programme Manager Weekly Plan Review', () => {
  assert.deepEqual(ROLE_PERMISSIONS[MEMBER_ROLES.HEAD_MASTER], []);
  assert.deepEqual(ROLE_PERMISSIONS[MEMBER_ROLES.STUDENT], []);
  assert.deepEqual(ROLE_PERMISSIONS[MEMBER_ROLES.PARENT], []);
});

test('ROLE_PERMISSIONS: PROGRAM_MANAGER grants EXACTLY REVIEW_LESSON_PLAN + APPROVE_LESSON_PLAN — no classroom-management permission of any kind', () => {
  assert.deepEqual(ROLE_PERMISSIONS[MEMBER_ROLES.PROGRAM_MANAGER], [
    PERMISSIONS.REVIEW_LESSON_PLAN,
    PERMISSIONS.APPROVE_LESSON_PLAN,
  ]);
  const unrelatedPermissions = Object.values(PERMISSIONS).filter(
    (permission) => permission !== PERMISSIONS.REVIEW_LESSON_PLAN && permission !== PERMISSIONS.APPROVE_LESSON_PLAN
  );
  unrelatedPermissions.forEach((permission) => {
    assert.equal(canPerform(MEMBER_ROLES.PROGRAM_MANAGER, permission), false);
  });
});

test('ROLE_PERMISSIONS: existing roles keep their exact existing permission sets, plus the Lesson Planning & Review additions', () => {
  assert.deepEqual(ROLE_PERMISSIONS[MEMBER_ROLES.OWNER], [
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
  ]);
  assert.deepEqual(ROLE_PERMISSIONS[MEMBER_ROLES.TEACHER], [
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
  ]);
  assert.deepEqual(ROLE_PERMISSIONS[MEMBER_ROLES.VIEWER], []);
});

test('permissionService.canPerform: a head_master member can perform no permission at all, for any permission (still true — untouched)', () => {
  Object.values(PERMISSIONS).forEach((permission) => {
    assert.equal(canPerform(MEMBER_ROLES.HEAD_MASTER, permission), false);
  });
});

test('permissionService.listPermissionsForRole: HEAD_MASTER still returns empty; PROGRAM_MANAGER now returns exactly the two review permissions', () => {
  assert.deepEqual(listPermissionsForRole(MEMBER_ROLES.HEAD_MASTER), []);
  assert.deepEqual(listPermissionsForRole(MEMBER_ROLES.PROGRAM_MANAGER), [
    PERMISSIONS.REVIEW_LESSON_PLAN,
    PERMISSIONS.APPROVE_LESSON_PLAN,
  ]);
});

test('permissionService.canPerformAsUid: a real classroom member added with the program_manager role can review/approve LessonPlans, and nothing else', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
  addMember(classroom, 'pm-uid', MEMBER_ROLES.PROGRAM_MANAGER, 'A Program Manager');

  assert.equal(getRole(classroom, 'pm-uid'), 'program_manager');
  assert.equal(canPerformAsUid(classroom, 'pm-uid', PERMISSIONS.REVIEW_LESSON_PLAN), true);
  assert.equal(canPerformAsUid(classroom, 'pm-uid', PERMISSIONS.APPROVE_LESSON_PLAN), true);
  const unrelatedPermissions = Object.values(PERMISSIONS).filter(
    (permission) => permission !== PERMISSIONS.REVIEW_LESSON_PLAN && permission !== PERMISSIONS.APPROVE_LESSON_PLAN
  );
  unrelatedPermissions.forEach((permission) => {
    assert.equal(canPerformAsUid(classroom, 'pm-uid', permission), false);
  });
});

test('addMember: adding a program_manager/head_master member never disturbs an existing owner/teacher on the same classroom', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
  addMember(classroom, 'owner-uid', MEMBER_ROLES.OWNER, 'The Owner');
  addMember(classroom, 'teacher-uid', MEMBER_ROLES.TEACHER, 'A Teacher');
  addMember(classroom, 'hm-uid', MEMBER_ROLES.HEAD_MASTER, 'A Head Master');

  assert.equal(getRole(classroom, 'owner-uid'), 'owner');
  assert.equal(getRole(classroom, 'teacher-uid'), 'teacher');
  assert.equal(getRole(classroom, 'hm-uid'), 'head_master');
  assert.equal(canPerformAsUid(classroom, 'owner-uid', PERMISSIONS.DELETE_CLASSROOM), true);
  assert.equal(canPerformAsUid(classroom, 'teacher-uid', PERMISSIONS.AWARD_POINTS), true);
  assert.equal(canPerformAsUid(classroom, 'hm-uid', PERMISSIONS.AWARD_POINTS), false);
});

test('personalHubService.roleLabel: an unrecognized/reserved role (program_manager, head_master) safely falls back to "Teacher", the same as it always has for anything not Owner/Viewer', () => {
  // This is the exact, pre-existing fallback behavior this function has
  // always had for STUDENT/PARENT too — confirming the new roles don't
  // change this function's behavior or need it to change.
  assert.equal(roleLabel(MEMBER_ROLES.PROGRAM_MANAGER), 'Teacher');
  assert.equal(roleLabel(MEMBER_ROLES.HEAD_MASTER), 'Teacher');
  assert.equal(roleLabel(MEMBER_ROLES.OWNER), 'Owner');
  assert.equal(roleLabel(MEMBER_ROLES.VIEWER), 'Viewer');
});

test('personalHubService.getRolesSummary: a classroom membership held only via program_manager/head_master never surfaces in the Owner/Teacher/Viewer summary — the new roles are invisible to this existing aggregation, unchanged', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
  addMember(classroom, 'pm-uid', MEMBER_ROLES.PROGRAM_MANAGER, 'A Program Manager');

  assert.deepEqual(getRolesSummary([classroom], 'pm-uid'), []);
});
