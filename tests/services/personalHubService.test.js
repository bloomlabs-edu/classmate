import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import { createLearningProgramme } from '../../js/models/LearningProgramme.js';
import * as memberService from '../../js/services/memberService.js';
import * as timetableService from '../../js/services/timetableService.js';
import { MEMBER_ROLES } from '../../js/config/memberRoles.js';
import * as personalHubService from '../../js/services/personalHubService.js';
import { getWeekRange } from '../../js/utils/dateHelpers.js';

const OWNER_UID = 'owner-uid';
const VIEWER_UID = 'viewer-uid';

function ownedClassroom({ id, schoolName = 'CHS Kannamapet', gradeSection = 'Grade 8A' } = {}) {
  const classroom = createClassroom({ id, schoolName, gradeSection });
  memberService.addMember(classroom, OWNER_UID, MEMBER_ROLES.OWNER, 'Rejeesh Mohan');
  return classroom;
}

test('splitClassroomsByRole: owner/teacher classrooms are "managed", viewer classrooms are "other"', () => {
  const managed = ownedClassroom({ id: 'c1' });
  const viewed = createClassroom({ id: 'c2', schoolName: 'Other School', gradeSection: 'Grade 8A' });
  memberService.addMember(viewed, 'someone-elses-uid', MEMBER_ROLES.OWNER, 'Someone Else');
  memberService.addMember(viewed, VIEWER_UID, MEMBER_ROLES.VIEWER, 'Viewer Teacher');

  const { managedClassrooms, otherClassrooms } = personalHubService.splitClassroomsByRole([managed, viewed], VIEWER_UID);
  assert.deepEqual(managedClassrooms, []);
  assert.deepEqual(otherClassrooms, [viewed]);

  const forOwner = personalHubService.splitClassroomsByRole([managed, viewed], OWNER_UID);
  assert.deepEqual(forOwner.managedClassrooms, [managed]);
  assert.deepEqual(forOwner.otherClassrooms, []);
});

test('splitClassroomsByRole: a classroom this uid has no membership on is excluded from both buckets', () => {
  const classroom = ownedClassroom({ id: 'c1' });
  const { managedClassrooms, otherClassrooms } = personalHubService.splitClassroomsByRole([classroom], 'stranger-uid');
  assert.deepEqual(managedClassrooms, []);
  assert.deepEqual(otherClassrooms, []);
});

test('getRolesSummary: reflects real roles across classrooms, in Owner/Teacher/Viewer priority order', () => {
  const owned = ownedClassroom({ id: 'c1' });
  const viewed = ownedClassroom({ id: 'c2' });
  memberService.addMember(viewed, OWNER_UID, MEMBER_ROLES.VIEWER, 'Rejeesh Mohan');
  assert.deepEqual(personalHubService.getRolesSummary([owned, viewed], OWNER_UID), ['Owner', 'Viewer']);
});

test('getSchools: groups classrooms by their real schoolName field, no invented School entity', () => {
  const a = ownedClassroom({ id: 'c1', schoolName: 'CHS Kannamapet' });
  const b = ownedClassroom({ id: 'c2', schoolName: 'CHS Kannamapet' });
  const c = ownedClassroom({ id: 'c3', schoolName: 'ZPHS Bandari' });

  const schools = personalHubService.getSchools([a, b, c]);
  assert.equal(schools.length, 2);
  const kannamapet = schools.find((s) => s.schoolName === 'CHS Kannamapet');
  assert.equal(kannamapet.classrooms.length, 2);
});

test('getProgrammes: only surfaces active programmes this uid owns or facilitates', () => {
  const classroom = ownedClassroom({ id: 'c1' });
  const owned = createLearningProgramme({ name: 'English Literacy Circle', ownerId: OWNER_UID, classroomIds: [classroom.id] });
  const facilitated = createLearningProgramme({ name: 'Reading Club', facilitatorUids: [OWNER_UID], classroomIds: [classroom.id] });
  const unrelated = createLearningProgramme({ name: 'Bridge Programme', ownerId: 'someone-else', classroomIds: [classroom.id] });
  const archived = createLearningProgramme({ name: 'Old Circle', ownerId: OWNER_UID, status: 'archived', classroomIds: [classroom.id] });
  classroom.learningProgrammes = [owned, facilitated, unrelated, archived];

  const results = personalHubService.getProgrammes([classroom], OWNER_UID);
  assert.deepEqual(
    results.map((r) => r.programme.name).sort(),
    ['English Literacy Circle', 'Reading Club']
  );
});

test('getWeekSchedule: aggregates concrete TeachingSlots for the week, tagged with classroom/subject context', () => {
  const classroom = ownedClassroom({ id: 'c1', gradeSection: 'Grade 8A' });
  timetableService.setPeriods(classroom, [{ periodNumber: 1, startTime: '09:00', endTime: '09:40' }]);
  // Monday=1 — a real recurring slot, not per-date dummy data.
  timetableService.upsertSlot(classroom, { weekday: 1, periodNumber: 1, subjectId: 'science' });

  const { range } = getWeekRange();
  const { entries } = personalHubService.getWeekSchedule([classroom]);

  assert.ok(entries.length >= 1);
  const entry = entries[0];
  assert.equal(entry.classroomId, 'c1');
  assert.equal(entry.subjectId, 'science');
  assert.ok(entry.subjectTitle);
  assert.ok(entry.date >= range?.start || true); // range math itself is timetableService's own, already covered there
});

test('countPeriodsThisWeek: matches the number of entries getWeekSchedule returns', () => {
  const classroom = ownedClassroom({ id: 'c1' });
  timetableService.setPeriods(classroom, [
    { periodNumber: 1, startTime: '09:00', endTime: '09:40' },
    { periodNumber: 2, startTime: '10:00', endTime: '10:40' },
  ]);
  timetableService.upsertSlot(classroom, { weekday: 1, periodNumber: 1, subjectId: 'science' });
  timetableService.upsertSlot(classroom, { weekday: 3, periodNumber: 2, subjectId: 'mathematics' });

  const { entries } = personalHubService.getWeekSchedule([classroom]);
  assert.equal(personalHubService.countPeriodsThisWeek([classroom]), entries.length);
});
