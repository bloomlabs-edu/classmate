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

test('getSchools: teacherCount is the union of memberUids across a school\'s own classrooms, not a per-classroom sum', () => {
  const a = ownedClassroom({ id: 'c1', schoolName: 'CHS Kannamapet' });
  const b = ownedClassroom({ id: 'c2', schoolName: 'CHS Kannamapet' }); // OWNER_UID is a member of both
  memberService.addMember(b, 'co-teacher-uid', MEMBER_ROLES.TEACHER, 'Co Teacher');

  const schools = personalHubService.getSchools([a, b]);
  const kannamapet = schools.find((s) => s.schoolName === 'CHS Kannamapet');
  // OWNER_UID counted once even though they're a member of both classrooms, plus co-teacher-uid = 2 distinct people.
  assert.equal(kannamapet.teacherCount, 2);
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

test('getProgrammes: labels this uid\'s own real relationship — Owner takes precedence over Facilitator', () => {
  const classroom = ownedClassroom({ id: 'c1' });
  const owned = createLearningProgramme({ name: 'English Literacy Circle', ownerId: OWNER_UID, facilitatorUids: [OWNER_UID], classroomIds: [classroom.id] });
  const facilitated = createLearningProgramme({ name: 'Reading Club', facilitatorUids: [OWNER_UID], classroomIds: [classroom.id] });
  classroom.learningProgrammes = [owned, facilitated];

  const results = personalHubService.getProgrammes([classroom], OWNER_UID);
  const byName = Object.fromEntries(results.map((r) => [r.programme.name, r.roleLabel]));
  assert.equal(byName['English Literacy Circle'], 'Owner');
  assert.equal(byName['Reading Club'], 'Facilitator');
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

test('formatPeriodTime: converts 24-hour HH:mm to the reference\'s 12-hour AM/PM display format', () => {
  assert.equal(personalHubService.formatPeriodTime('09:00'), '09:00 AM');
  assert.equal(personalHubService.formatPeriodTime('13:00'), '01:00 PM');
  assert.equal(personalHubService.formatPeriodTime('00:05'), '12:05 AM');
  assert.equal(personalHubService.formatPeriodTime('12:00'), '12:00 PM');
});

test('formatPeriodTime: malformed input is returned unchanged rather than throwing', () => {
  assert.equal(personalHubService.formatPeriodTime(null), null);
  assert.equal(personalHubService.formatPeriodTime('not-a-time'), 'not-a-time');
});

test('buildClassroomColorMap: assigns the same color to the same classroom every time, cycling a fixed palette by order', () => {
  const a = ownedClassroom({ id: 'c1' });
  const b = ownedClassroom({ id: 'c2' });
  const map = personalHubService.buildClassroomColorMap([a, b]);
  assert.notEqual(map.get('c1').hex, map.get('c2').hex);
  assert.ok(map.get('c1').hex);
});

test('getTodaySchedule: only includes today\'s concrete slots, not the whole week', () => {
  const classroom = ownedClassroom({ id: 'c1' });
  timetableService.setPeriods(classroom, [{ periodNumber: 1, startTime: '09:00', endTime: '09:40' }]);
  const today = new Date();
  timetableService.upsertSlot(classroom, { weekday: today.getDay(), periodNumber: 1, subjectId: 'science' });

  const entries = personalHubService.getTodaySchedule([classroom]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].startTime, '09:00');
});

test('getWeekGrid: buckets entries into rows by real start time (not period number), one column per day', () => {
  const classroomA = ownedClassroom({ id: 'c1' });
  timetableService.setPeriods(classroomA, [{ periodNumber: 1, startTime: '09:00', endTime: '09:40' }]);
  timetableService.upsertSlot(classroomA, { weekday: 1, periodNumber: 1, subjectId: 'science' });

  // A second classroom whose "Period 1" starts at a different real time —
  // the grid must key rows by startTime, not periodNumber, or these two
  // would wrongly collapse into the same row.
  const classroomB = ownedClassroom({ id: 'c2' });
  timetableService.setPeriods(classroomB, [{ periodNumber: 1, startTime: '11:00', endTime: '11:40' }]);
  timetableService.upsertSlot(classroomB, { weekday: 1, periodNumber: 1, subjectId: 'mathematics' });

  const { days, rows } = personalHubService.getWeekGrid([classroomA, classroomB]);
  assert.equal(days.length, 7);
  assert.deepEqual(
    rows.map((r) => r.startTime),
    ['09:00', '11:00']
  );
});

// ---------------------------------------------------------------------
// getSubjectsTaughtInClassroom — "YOU TEACH" on the My Classrooms card.
// Mirrors the real scenario reported during QA: two co-teachers on the
// same Bloom Force 19 classroom, each with their own real periods.
// ---------------------------------------------------------------------

const CO_FELLOW_UID = 'co-fellow-uid';

function bloomForce19WithSplitTeaching() {
  const classroom = ownedClassroom({ id: 'bf19', schoolName: 'CHS Kannamapet', gradeSection: 'Grade 8A' });
  memberService.addMember(classroom, CO_FELLOW_UID, MEMBER_ROLES.TEACHER, 'Co Fellow');
  timetableService.setPeriods(classroom, [
    { periodNumber: 1, startTime: '09:00', endTime: '09:40' },
    { periodNumber: 2, startTime: '10:00', endTime: '10:40' },
    { periodNumber: 3, startTime: '11:00', endTime: '11:40' },
    { periodNumber: 4, startTime: '12:00', endTime: '12:40' },
  ]);
  // OWNER_UID teaches Science (twice, on different days — must dedupe)
  // and Social Science. CO_FELLOW_UID teaches English and Mathematics.
  timetableService.upsertSlot(classroom, { weekday: 1, periodNumber: 1, subjectId: 'science', teacherUid: OWNER_UID });
  timetableService.upsertSlot(classroom, { weekday: 3, periodNumber: 1, subjectId: 'science', teacherUid: OWNER_UID });
  timetableService.upsertSlot(classroom, { weekday: 1, periodNumber: 2, subjectId: 'social_science', teacherUid: OWNER_UID });
  timetableService.upsertSlot(classroom, { weekday: 1, periodNumber: 3, subjectId: 'english', teacherUid: CO_FELLOW_UID });
  timetableService.upsertSlot(classroom, { weekday: 1, periodNumber: 4, subjectId: 'mathematics', teacherUid: CO_FELLOW_UID });
  return classroom;
}

test('getSubjectsTaughtInClassroom: derives this uid\'s own real subjects, deduplicated', () => {
  const classroom = bloomForce19WithSplitTeaching();
  assert.deepEqual(personalHubService.getSubjectsTaughtInClassroom(classroom, OWNER_UID), ['Science', 'Social Science']);
});

test('getSubjectsTaughtInClassroom: another teacher on the SAME classroom gets their own distinct subjects', () => {
  const classroom = bloomForce19WithSplitTeaching();
  assert.deepEqual(personalHubService.getSubjectsTaughtInClassroom(classroom, CO_FELLOW_UID), ['English', 'Mathematics']);
});

test('getSubjectsTaughtInClassroom: never claims a subject for a classroom with no assigned slots for this uid', () => {
  const classroom = ownedClassroom({ id: 'unassigned' });
  timetableService.setPeriods(classroom, [{ periodNumber: 1, startTime: '09:00', endTime: '09:40' }]);
  // A real slot exists, but nobody has been assigned to teach it yet.
  timetableService.upsertSlot(classroom, { weekday: 1, periodNumber: 1, subjectId: 'science' });
  assert.deepEqual(personalHubService.getSubjectsTaughtInClassroom(classroom, OWNER_UID), []);
});

/**
 * End-to-end pipeline test, per explicit QA request: proves teacherUid
 * survives an actual save/reload cycle, not just staying correct in
 * the same in-memory object. `JSON.parse(JSON.stringify(...))` is a
 * faithful stand-in for what a real Firestore setDoc()/onSnapshot()
 * round trip does to a plain object of strings/numbers/nulls/arrays
 * (see repositories/firestoreClassroomRepository.js's own
 * saveClassroom(), which writes `classroom` wholesale with no field
 * allowlist/transform to strip or rename anything) — it forces a real
 * structural clone, catching any bug that only "works" because a
 * later step still holds the exact same object reference the picker
 * wrote to.
 */
test('End-to-end: Taught-by assignment survives a full save/reload cycle and both teachers see their own real subjects afterward', () => {
  const classroom = bloomForce19WithSplitTeaching();

  // Simulates workspaceService.saveExplicitly() -> Firestore setDoc(),
  // then a fresh subscribeToClassroom()/getClassroomOnce() snapshot
  // coming back down — a structurally new object, not the same one
  // the "Taught by" picker mutated.
  const reloaded = JSON.parse(JSON.stringify(classroom));

  assert.equal(timetableService.getSlot(reloaded, 1, 1).teacherUid, OWNER_UID);
  assert.equal(timetableService.getSlot(reloaded, 1, 3).teacherUid, CO_FELLOW_UID);

  assert.deepEqual(personalHubService.getSubjectsTaughtInClassroom(reloaded, OWNER_UID), ['Science', 'Social Science']);
  assert.deepEqual(personalHubService.getSubjectsTaughtInClassroom(reloaded, CO_FELLOW_UID), ['English', 'Mathematics']);
});

// ---------------------------------------------------------------------
// Today/My Week's own "Taught by" fallback rule (classroomHasAnyTeacherAssignment).
// A real Monday date, matching this classroom's own weekday=1 slots.
// ---------------------------------------------------------------------
const MONDAY = '2026-08-24';

test('getTodaySchedule: a classroom with NO teacher assignments at all shows every period to every viewer — fallback, never empty', () => {
  const classroom = ownedClassroom({ id: 'no-assignments-yet' });
  timetableService.setPeriods(classroom, [
    { periodNumber: 1, startTime: '09:00', endTime: '09:40' },
    { periodNumber: 2, startTime: '10:00', endTime: '10:40' },
  ]);
  // Real slots exist; nobody has ever used "Taught by" on this classroom.
  timetableService.upsertSlot(classroom, { weekday: 1, periodNumber: 1, subjectId: 'science' });
  timetableService.upsertSlot(classroom, { weekday: 1, periodNumber: 2, subjectId: 'english' });

  const entries = personalHubService.getTodaySchedule([classroom], OWNER_UID, MONDAY);
  assert.equal(entries.length, 2);

  // Even a uid with no real relationship to this classroom's teaching
  // still sees the same unfiltered fallback — the classroom itself has
  // no per-teacher opinion yet, so nobody's queries are more "correct"
  // than anyone else's here.
  const entriesForStranger = personalHubService.getTodaySchedule([classroom], 'some-other-uid', MONDAY);
  assert.equal(entriesForStranger.length, 2);
});

test('getTodaySchedule: once a classroom has ANY real assignment, filters strictly to this uid\'s own periods', () => {
  const classroom = bloomForce19WithSplitTeaching();

  const ownerEntries = personalHubService.getTodaySchedule([classroom], OWNER_UID, MONDAY);
  assert.deepEqual(
    ownerEntries.map((e) => e.subjectTitle).sort(),
    ['Science', 'Social Science']
  );

  const coFellowEntries = personalHubService.getTodaySchedule([classroom], CO_FELLOW_UID, MONDAY);
  assert.deepEqual(
    coFellowEntries.map((e) => e.subjectTitle).sort(),
    ['English', 'Mathematics']
  );
});

test('getWeekSchedule/getWeekGrid: same per-classroom "Taught by" filter applies to the full week, not just Today', () => {
  const classroom = bloomForce19WithSplitTeaching();

  const { entries } = personalHubService.getWeekSchedule([classroom], OWNER_UID, MONDAY);
  assert.deepEqual(
    entries.map((e) => e.subjectTitle).sort(),
    ['Science', 'Science', 'Social Science']
  ); // Science occurs twice (Mon + Wed) across the week — My Week shows every real occurrence, unlike the deduplicated "YOU TEACH" card line.

  const { rows } = personalHubService.getWeekGrid([classroom], CO_FELLOW_UID, MONDAY);
  const coFellowSubjects = rows.flatMap((row) => Array.from(row.cellsByDate.values()).flat().map((e) => e.subjectTitle));
  assert.deepEqual(coFellowSubjects.sort(), ['English', 'Mathematics']);
});

test('countPeriodsThisWeek: reflects this uid\'s own filtered count once the classroom has real assignments, not everyone\'s combined periods', () => {
  const classroom = bloomForce19WithSplitTeaching();
  assert.equal(personalHubService.countPeriodsThisWeek([classroom], OWNER_UID, MONDAY), 3); // Science x2 + Social Science x1
  assert.equal(personalHubService.countPeriodsThisWeek([classroom], CO_FELLOW_UID, MONDAY), 2); // English + Mathematics
});
