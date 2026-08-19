import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClassroom } from '../../js/models/Classroom.js';
import * as learningProgrammeService from '../../js/services/learningProgrammeService.js';
import * as programmeSessionService from '../../js/services/programmeSessionService.js';
import { buildEnglishLiteracyCircleConfiguration } from '../../js/config/englishLiteracyCircleDefaults.js';

function makeClassroomWithProgramme() {
  const classroom = createClassroom({ id: 'classroom-1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
  const programme = learningProgrammeService.createNewLearningProgramme(classroom, {
    name: 'English Literacy Circle',
    configuration: buildEnglishLiteracyCircleConfiguration(),
  });
  learningProgrammeService.addMembership(programme, 'student-1');
  learningProgrammeService.addMembership(programme, 'student-2');
  return { classroom, programme };
}

// ---------------------------------------------------------------------
// Session creation / referenced-programme validation
// ---------------------------------------------------------------------

test('ensureProgrammeExists: throws for an unknown programmeId', () => {
  const classroom = createClassroom({ id: 'classroom-1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
  assert.throws(() => programmeSessionService.ensureProgrammeExists(classroom, 'does-not-exist'), /no Learning Programme/);
});

test('ensureProgrammeExists: returns the programme when it exists', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const found = programmeSessionService.ensureProgrammeExists(classroom, programme.id);
  assert.equal(found.id, programme.id);
});

test('buildNewSession: creates a session referencing a real programme', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id, date: '2026-08-19', title: "Today's Circle" });

  assert.equal(session.programmeId, programme.id);
  assert.equal(session.date, '2026-08-19');
  assert.equal(session.title, "Today's Circle");
});

test('buildNewSession: refuses to create a session for a programme that does not exist', () => {
  const classroom = createClassroom({ id: 'classroom-1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
  assert.throws(() => programmeSessionService.buildNewSession(classroom, { programmeId: 'ghost-programme' }), /no Learning Programme/);
});

test('buildNewSession: rejects a missing programmeId', () => {
  const classroom = createClassroom({ id: 'classroom-1', schoolName: 'Test School', gradeSection: 'Grade 8A' });
  assert.throws(() => programmeSessionService.buildNewSession(classroom, {}), /programmeId is required/);
});

test('multiple sessions for one programme are independent objects with distinct ids', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const sessionOne = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id, date: '2026-08-18' });
  const sessionTwo = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id, date: '2026-08-19' });

  assert.notEqual(sessionOne.id, sessionTwo.id);
  assert.equal(sessionOne.programmeId, sessionTwo.programmeId);
});

// ---------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------

test('recordAttendance: adds an attendance entry for a real member', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });

  programmeSessionService.recordAttendance(programme, session, { studentId: 'student-1', status: 'present' });

  assert.equal(session.attendance.length, 1);
  assert.equal(session.attendance[0].status, 'present');
});

test('recordAttendance: recording again for the same student replaces, never duplicates', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });

  programmeSessionService.recordAttendance(programme, session, { studentId: 'student-1', status: 'present' });
  programmeSessionService.recordAttendance(programme, session, { studentId: 'student-1', status: 'absent' });

  assert.equal(session.attendance.length, 1);
  assert.equal(session.attendance[0].status, 'absent');
});

test('recordAttendance: refuses to record for a student with no membership in this programme', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });

  assert.throws(
    () => programmeSessionService.recordAttendance(programme, session, { studentId: 'never-a-member', status: 'present' }),
    /no membership record/
  );
});

test('recordAttendance: still allowed for a student who has since left the programme', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  learningProgrammeService.markMembershipLeft(programme, 'student-1');
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });

  // A past occurrence during their membership should remain recordable/reviewable
  assert.doesNotThrow(() => programmeSessionService.recordAttendance(programme, session, { studentId: 'student-1', status: 'present' }));
});

// ---------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------

test('recordGoal: adds a new goal entry, defaults outcome to null', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });
  const categoryId = programme.configuration.goalFramework.categories.find((c) => c.name === 'Reading').id;

  programmeSessionService.recordGoal(programme, session, { studentId: 'student-1', categoryId, text: 'Read two pages', source: 'suggested' });

  assert.equal(session.goals.length, 1);
  assert.equal(session.goals[0].text, 'Read two pages');
  assert.equal(session.goals[0].source, 'suggested');
  assert.equal(session.goals[0].outcome, null);
});

test('recordGoal: rejects an invalid source', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });
  const categoryId = programme.configuration.goalFramework.categories[0].id;

  assert.throws(
    () => programmeSessionService.recordGoal(programme, session, { studentId: 'student-1', categoryId, text: 'x', source: 'teacher_assigned' }),
    /Invalid goal source/
  );
});

test('recordGoal: rejects an invalid outcome', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });
  const categoryId = programme.configuration.goalFramework.categories[0].id;

  assert.throws(
    () => programmeSessionService.recordGoal(programme, session, { studentId: 'student-1', categoryId, text: 'x', outcome: 'failed' }),
    /Invalid goal outcome/
  );
});

test('recordGoal: outcome is never a failure-oriented state — only completed/partially_completed/try_again are valid', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });
  const categoryId = programme.configuration.goalFramework.categories[0].id;

  for (const outcome of ['completed', 'partially_completed', 'try_again']) {
    assert.doesNotThrow(() =>
      programmeSessionService.recordGoal(programme, session, { studentId: 'student-1', categoryId, text: 'x', outcome })
    );
  }
});

test('recordGoal: a second goal for the same student+category in the same session replaces, never duplicates', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });
  const categoryId = programme.configuration.goalFramework.categories[0].id;

  programmeSessionService.recordGoal(programme, session, { studentId: 'student-1', categoryId, text: 'First draft' });
  programmeSessionService.recordGoal(programme, session, { studentId: 'student-1', categoryId, text: 'Final goal' });

  assert.equal(session.goals.length, 1);
  assert.equal(session.goals[0].text, 'Final goal');
});

test('recordGoal: a new session never inherits a prior session\'s own goal — tomorrow\'s goal is a fresh entry', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const categoryId = programme.configuration.goalFramework.categories[0].id;

  const sessionOne = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id, date: '2026-08-18' });
  programmeSessionService.recordGoal(programme, sessionOne, { studentId: 'student-1', categoryId, text: 'Read two pages' });

  const sessionTwo = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id, date: '2026-08-19' });

  assert.equal(sessionTwo.goals.length, 0, 'a freshly built session must start with no goals of its own');
});

test('recordGoalOutcome: sets outcome/reflection without touching text or source', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });
  const categoryId = programme.configuration.goalFramework.categories[0].id;
  programmeSessionService.recordGoal(programme, session, { studentId: 'student-1', categoryId, text: 'Read two pages', source: 'suggested' });

  const goal = programmeSessionService.recordGoalOutcome(session, { studentId: 'student-1', categoryId, outcome: 'completed', reflection: 'Went well' });

  assert.equal(goal.outcome, 'completed');
  assert.equal(goal.reflection, 'Went well');
  assert.equal(goal.text, 'Read two pages');
  assert.equal(goal.source, 'suggested');
});

test('recordGoalOutcome: no-op when no matching goal exists yet', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });

  const result = programmeSessionService.recordGoalOutcome(session, { studentId: 'student-1', categoryId: 'no-such-category', outcome: 'completed' });
  assert.equal(result, null);
});

// ---------------------------------------------------------------------
// Historical stability — configuration changes must never mutate history
// ---------------------------------------------------------------------

test('changing goal-framework suggestions after the fact does not mutate an already-recorded session goal', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const readingCategory = programme.configuration.goalFramework.categories.find((c) => c.name === 'Reading');
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });

  programmeSessionService.recordGoal(programme, session, {
    studentId: 'student-1',
    categoryId: readingCategory.id,
    text: 'Read two pages',
    source: 'suggested',
  });

  // Teacher later changes the programme's own suggested goals entirely.
  learningProgrammeService.updateProgrammeConfiguration(programme, {
    configuration: { goalFramework: { categories: [{ name: 'Reading', suggestedGoals: ['Completely different suggestion'] }] } },
  });

  // The already-recorded session goal's own text must be untouched.
  assert.equal(session.goals[0].text, 'Read two pages');
  assert.equal(session.goals[0].source, 'suggested');
});

test('changing programme configuration in general does not alter any field on an existing session', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id, title: 'Original title' });
  const snapshotBefore = JSON.parse(JSON.stringify(session));

  learningProgrammeService.updateProgrammeConfiguration(programme, { name: 'English Literacy Circle (renamed)', description: 'updated' });

  assert.deepEqual(session, snapshotBefore, 'the session object must be byte-for-byte unchanged by a programme config edit');
});

test('a new component added to programme configuration does not create an empty historical record on a past session', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const pastSession = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id, date: '2026-08-01' });

  // Session predates the extension entirely.
  assert.deepEqual(pastSession.componentInstances, {});

  // Teacher adds a new extension component to the programme after the fact.
  learningProgrammeService.updateProgrammeConfiguration(programme, {
    configuration: { extensions: [{ id: 'reading-fluency', type: 'numeric_tracker', label: 'Reading Fluency' }] },
  });

  // The past session must still have no entry for it — absence means it never happened for that occurrence.
  assert.deepEqual(pastSession.componentInstances, {});
  assert.ok(!('reading-fluency' in pastSession.componentInstances));
});

test('setComponentInstance only ever adds an entry for a session it is explicitly called on, never retroactively', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const oldSession = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id, date: '2026-08-01' });
  const newSession = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id, date: '2026-08-19' });

  programmeSessionService.setComponentInstance(newSession, 'reading-fluency', { studentId: 'student-1', wpm: 42 });

  assert.deepEqual(oldSession.componentInstances, {});
  assert.deepEqual(newSession.componentInstances['reading-fluency'], { studentId: 'student-1', wpm: 42 });
});

// ---------------------------------------------------------------------
// Activities / teacher observations
// ---------------------------------------------------------------------

test('recordActivity: appends, never deduplicates', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });

  programmeSessionService.recordActivity(session, { name: 'Guided Reading' });
  programmeSessionService.recordActivity(session, { name: 'Guided Reading' });

  assert.equal(session.activities.length, 2);
});

test('recordTeacherObservation: refuses an observation for a non-member', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });

  assert.throws(
    () => programmeSessionService.recordTeacherObservation(programme, session, { studentId: 'never-a-member', note: 'x' }),
    /no membership record/
  );
});

test('recordTeacherObservation: teacher observation stays structurally separate from student goal reflection', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });
  const categoryId = programme.configuration.goalFramework.categories[0].id;

  programmeSessionService.recordGoal(programme, session, { studentId: 'student-1', categoryId, text: 'Read two pages', reflection: 'I could read faster' });
  programmeSessionService.recordTeacherObservation(programme, session, { studentId: 'student-1', note: 'Needed less prompting' });

  assert.equal(session.goals[0].reflection, 'I could read faster');
  assert.equal(session.teacherObservations[0].note, 'Needed less prompting');
  assert.notEqual(session.goals[0].reflection, session.teacherObservations[0].note);
});

// ---------------------------------------------------------------------
// Student identity is never duplicated into programme data
// ---------------------------------------------------------------------

test('a student\'s classroom identity is never duplicated into programme session data — only studentId references appear', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });
  const categoryId = programme.configuration.goalFramework.categories[0].id;

  programmeSessionService.recordAttendance(programme, session, { studentId: 'student-1', status: 'present' });
  programmeSessionService.recordGoal(programme, session, { studentId: 'student-1', categoryId, text: 'x' });
  programmeSessionService.recordTeacherObservation(programme, session, { studentId: 'student-1', note: 'x' });

  assert.deepEqual(Object.keys(session.attendance[0]).sort(), ['recordedAt', 'status', 'studentId'].sort());
  assert.ok(!('name' in session.attendance[0]));
  assert.ok(!('name' in session.goals[0]));
  assert.ok(!('name' in session.teacherObservations[0]));
});
