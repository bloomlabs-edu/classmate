/**
 * tests/config/timetableReadOnlyRoleDerivation.test.js
 *
 * The one piece of the new Timetable read-only mode that IS testable
 * without a DOM: the role check main.js's own `timetable` route
 * handler uses to decide whether to pass `readOnly: true` into
 * ui/views/TimetableView.js —
 *   classroom.members?.[currentUser?.uid]?.role === MEMBER_ROLES.PROGRAM_MANAGER
 * — built entirely from the EXISTING, already-tested role mechanism
 * (config/memberRoles.js, services/memberService.js), never a new
 * authorization system. This confirms the specific business rule this
 * feature depends on: a Program Manager viewing a classroom's
 * Timetable resolves to read-only; an Owner/Teacher does not, and
 * remains fully editable exactly as before this change.
 *
 * NOTE ON WHAT THIS FILE DOES NOT COVER: ui/views/TimetableView.js
 * itself (the actual read-only rendering — omitted buttons, the
 * central runAction() guard, etc.) cannot be imported or rendered by
 * this repo's Node test runner at all — it transitively imports
 * services/plannerRepository.js / services/scheduledEventRepository.js
 * / services/weeklyPlanSubmissionRepository.js, each of which imports
 * the real Firestore SDK from a remote https:// URL Node's module
 * resolver cannot fetch (the identical, pre-existing constraint
 * models/Lesson.js's own header comment documents for
 * services/timetableLessonService.js, and the reason
 * ui/views/timetableExamSpanning.js was extracted out of
 * TimetableView.js in the first place — see that file's own header
 * comment). No test in this repo renders TimetableView.js today, for
 * any of its pre-existing behavior either. That gating was instead
 * verified by direct code inspection (see the implementation report
 * for the full file:line audit of every mutation entry point) and
 * still needs a real manual/browser QA pass — see the same report's
 * "Manual QA" section.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEMBER_ROLES } from '../../js/config/memberRoles.js';
import { createClassroom } from '../../js/models/Classroom.js';
import { addMember, getRole } from '../../js/services/memberService.js';

/** The exact expression main.js's own `timetable` route handler evaluates. */
function isReadOnlyTimetableViewer(classroom, uid) {
  return classroom.members?.[uid]?.role === MEMBER_ROLES.PROGRAM_MANAGER;
}

test('a Program Manager viewing a classroom resolves to read-only', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
  addMember(classroom, 'pm-uid', MEMBER_ROLES.PROGRAM_MANAGER, 'A Program Manager');

  assert.equal(getRole(classroom, 'pm-uid'), 'program_manager');
  assert.equal(isReadOnlyTimetableViewer(classroom, 'pm-uid'), true);
});

test('the Fellow (owner) viewing their own classroom is NOT read-only — unchanged, fully editable', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
  addMember(classroom, 'owner-uid', MEMBER_ROLES.OWNER, 'The Owner');

  assert.equal(isReadOnlyTimetableViewer(classroom, 'owner-uid'), false);
});

test('a co-teacher (TEACHER role) viewing the classroom is NOT read-only — unchanged, fully editable', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
  addMember(classroom, 'teacher-uid', MEMBER_ROLES.TEACHER, 'A Co-Teacher');

  assert.equal(isReadOnlyTimetableViewer(classroom, 'teacher-uid'), false);
});

test('a VIEWER-role member is NOT specifically read-only under this rule (VIEWER already has zero mutation permissions via canPerformAsUid, a separate, pre-existing boundary this feature does not change)', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
  addMember(classroom, 'viewer-uid', MEMBER_ROLES.VIEWER, 'A Viewer');

  assert.equal(isReadOnlyTimetableViewer(classroom, 'viewer-uid'), false);
});

test('a non-member (unknown uid) is NOT matched by this rule — absence of membership is a different, pre-existing Firestore-rules boundary, not this feature\'s concern', () => {
  const classroom = createClassroom({ id: 'c1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
  assert.equal(isReadOnlyTimetableViewer(classroom, 'stranger-uid'), false);
});
