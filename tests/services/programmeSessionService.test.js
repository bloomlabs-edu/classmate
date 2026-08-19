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

test('buildNewSession: rejects an invalid date string', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  assert.throws(
    () => programmeSessionService.buildNewSession(classroom, { programmeId: programme.id, date: 'not-a-real-date' }),
    /date must be a valid date string/
  );
});

test('multiple sessions for one programme are independent objects with distinct ids', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const sessionOne = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id, date: '2026-08-18' });
  const sessionTwo = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id, date: '2026-08-19' });

  assert.notEqual(sessionOne.id, sessionTwo.id);
  assert.equal(sessionOne.programmeId, sessionTwo.programmeId);
});

// ---------------------------------------------------------------------
// PHASE 1.6 — Issue 4: archived programmes cannot start new sessions,
// but historical sessions remain readable and unchanged.
// ---------------------------------------------------------------------

test('ensureProgrammeCanStartNewSession: throws for an archived programme', () => {
  const { programme } = makeClassroomWithProgramme();
  learningProgrammeService.archiveProgramme(programme);

  assert.throws(() => programmeSessionService.ensureProgrammeCanStartNewSession(programme), /is archived/);
});

test('ensureProgrammeCanStartNewSession: does not throw for an active programme', () => {
  const { programme } = makeClassroomWithProgramme();
  assert.doesNotThrow(() => programmeSessionService.ensureProgrammeCanStartNewSession(programme));
});

test('buildNewSession: refuses to create a new session for an archived programme', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  learningProgrammeService.archiveProgramme(programme);

  assert.throws(() => programmeSessionService.buildNewSession(classroom, { programmeId: programme.id }), /is archived/);
});

test('archiving a programme does not alter any field on an already-built historical session (historical sessions remain readable/unchanged)', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id, date: '2026-08-01', title: 'Before archiving' });
  programmeSessionService.recordAttendance(programme, session, { studentId: 'student-1', status: 'present' });
  const snapshotBefore = JSON.parse(JSON.stringify(session));

  learningProgrammeService.archiveProgramme(programme);

  assert.deepEqual(session, snapshotBefore, 'a pre-existing session must be byte-for-byte unchanged by archiving its own programme');
  // Still fully readable/interpretable — nothing about the session's own shape depends on programme.status.
  assert.equal(session.attendance['student-1'].status, 'present');
});

// ---------------------------------------------------------------------
// Attendance — now a student-keyed map (Phase 1.6 concurrency hardening)
// ---------------------------------------------------------------------

test('recordAttendance: adds an attendance entry keyed by studentId', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });

  programmeSessionService.recordAttendance(programme, session, { studentId: 'student-1', status: 'present' });

  assert.equal(Object.keys(session.attendance).length, 1);
  assert.equal(session.attendance['student-1'].status, 'present');
});

test('recordAttendance: recording again for the same student replaces, never duplicates', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });

  programmeSessionService.recordAttendance(programme, session, { studentId: 'student-1', status: 'present' });
  programmeSessionService.recordAttendance(programme, session, { studentId: 'student-1', status: 'absent' });

  assert.equal(Object.keys(session.attendance).length, 1);
  assert.equal(session.attendance['student-1'].status, 'absent');
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

  assert.doesNotThrow(() => programmeSessionService.recordAttendance(programme, session, { studentId: 'student-1', status: 'present' }));
});

test('CONCURRENCY: recording attendance for one student never touches another student\'s existing attendance entry, in memory', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });

  programmeSessionService.recordAttendance(programme, session, { studentId: 'student-1', status: 'present' });
  const studentOneSnapshotBefore = JSON.parse(JSON.stringify(session.attendance['student-1']));

  programmeSessionService.recordAttendance(programme, session, { studentId: 'student-2', status: 'absent' });

  assert.deepEqual(session.attendance['student-1'], studentOneSnapshotBefore, "student-1's own attendance entry must be untouched by student-2's own update");
  assert.equal(session.attendance['student-2'].status, 'absent');
});

test('buildAttendancePatch: produces a minimal, single-student Firestore field-path patch', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });
  programmeSessionService.recordAttendance(programme, session, { studentId: 'student-1', status: 'present' });

  const patch = programmeSessionService.buildAttendancePatch(session, 'student-1');

  assert.deepEqual(Object.keys(patch).sort(), ['attendance.student-1', 'updatedAt'].sort());
  assert.deepEqual(patch['attendance.student-1'], session.attendance['student-1']);
});

test('buildAttendancePatch: never references any other student\'s own data', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });
  programmeSessionService.recordAttendance(programme, session, { studentId: 'student-1', status: 'present' });
  programmeSessionService.recordAttendance(programme, session, { studentId: 'student-2', status: 'absent' });

  const patch = programmeSessionService.buildAttendancePatch(session, 'student-1');

  assert.ok(!('attendance.student-2' in patch));
  assert.ok(!JSON.stringify(patch).includes('absent'), "student-2's own status must not leak into student-1's own patch");
});

// ---------------------------------------------------------------------
// Goals — now a two-level student-then-category-keyed map
// ---------------------------------------------------------------------

test('recordGoal: adds a new goal entry keyed by studentId then categoryId, defaults outcome to null', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });
  const categoryId = programme.configuration.goalFramework.categories.find((c) => c.name === 'Reading').id;

  programmeSessionService.recordGoal(programme, session, { studentId: 'student-1', categoryId, text: 'Read two pages', source: 'suggested' });

  assert.equal(session.goals['student-1'][categoryId].text, 'Read two pages');
  assert.equal(session.goals['student-1'][categoryId].source, 'suggested');
  assert.equal(session.goals['student-1'][categoryId].outcome, null);
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

  assert.equal(Object.keys(session.goals['student-1']).length, 1);
  assert.equal(session.goals['student-1'][categoryId].text, 'Final goal');
});

test('MULTIPLE GOALS PER STUDENT: a student may have more than one goal in the same session, one per category', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });
  const readingId = programme.configuration.goalFramework.categories.find((c) => c.name === 'Reading').id;
  const speakingId = programme.configuration.goalFramework.categories.find((c) => c.name === 'Speaking').id;

  programmeSessionService.recordGoal(programme, session, { studentId: 'student-1', categoryId: readingId, text: 'Read two pages' });
  programmeSessionService.recordGoal(programme, session, { studentId: 'student-1', categoryId: speakingId, text: 'Speak with a partner' });

  assert.equal(Object.keys(session.goals['student-1']).length, 2, 'a single student can have goals in two different categories in the same session');
  assert.equal(session.goals['student-1'][readingId].text, 'Read two pages');
  assert.equal(session.goals['student-1'][speakingId].text, 'Speak with a partner');
});

test('recordGoal: a new session never inherits a prior session\'s own goal — tomorrow\'s goal is a fresh entry', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const categoryId = programme.configuration.goalFramework.categories[0].id;

  const sessionOne = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id, date: '2026-08-18' });
  programmeSessionService.recordGoal(programme, sessionOne, { studentId: 'student-1', categoryId, text: 'Read two pages' });

  const sessionTwo = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id, date: '2026-08-19' });

  assert.deepEqual(sessionTwo.goals, {}, 'a freshly built session must start with no goals of its own');
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

test('CONCURRENCY: recording a goal for one student never touches another student\'s existing goals, in memory', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });
  const categoryId = programme.configuration.goalFramework.categories[0].id;

  programmeSessionService.recordGoal(programme, session, { studentId: 'student-1', categoryId, text: "Student 1's goal" });
  const studentOneSnapshotBefore = JSON.parse(JSON.stringify(session.goals['student-1']));

  programmeSessionService.recordGoal(programme, session, { studentId: 'student-2', categoryId, text: "Student 2's goal" });

  assert.deepEqual(session.goals['student-1'], studentOneSnapshotBefore, "student-1's own goals must be untouched by student-2's own update");
});

test('buildGoalPatch: produces a minimal, single-student single-category Firestore field-path patch', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });
  const categoryId = programme.configuration.goalFramework.categories[0].id;
  programmeSessionService.recordGoal(programme, session, { studentId: 'student-1', categoryId, text: 'Read two pages' });

  const patch = programmeSessionService.buildGoalPatch(session, 'student-1', categoryId);

  assert.deepEqual(Object.keys(patch).sort(), [`goals.student-1.${categoryId}`, 'updatedAt'].sort());
  assert.deepEqual(patch[`goals.student-1.${categoryId}`], session.goals['student-1'][categoryId]);
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
  assert.equal(session.goals['student-1'][readingCategory.id].text, 'Read two pages');
  assert.equal(session.goals['student-1'][readingCategory.id].source, 'suggested');
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

  programmeSessionService.setComponentInstance(newSession, 'reading-fluency', { wpm: 42 });

  assert.deepEqual(oldSession.componentInstances, {});
  assert.deepEqual(newSession.componentInstances['reading-fluency'], { wpm: 42 });
});

test('buildComponentInstancePatch: produces a minimal, single-component Firestore field-path patch', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });
  programmeSessionService.setComponentInstance(session, 'reading-fluency', { wpm: 42 });

  const patch = programmeSessionService.buildComponentInstancePatch(session, 'reading-fluency');

  assert.deepEqual(Object.keys(patch).sort(), ['componentInstances.reading-fluency', 'updatedAt'].sort());
});

// ---------------------------------------------------------------------
// PHASE 2A — pickSessionForDate: the pure decision behind "do not
// accidentally create multiple sessions on the same day."
// ---------------------------------------------------------------------

test('pickSessionForDate: returns null for an empty list', () => {
  assert.equal(programmeSessionService.pickSessionForDate([], '2026-08-19'), null);
});

test('pickSessionForDate: returns null when no session matches the date', () => {
  const sessions = [{ id: 's1', date: '2026-08-18' }, { id: 's2', date: '2026-08-17' }];
  assert.equal(programmeSessionService.pickSessionForDate(sessions, '2026-08-19'), null);
});

test('pickSessionForDate: returns the one session matching the date', () => {
  const sessions = [{ id: 's1', date: '2026-08-18' }, { id: 's2', date: '2026-08-19' }];
  const found = programmeSessionService.pickSessionForDate(sessions, '2026-08-19');
  assert.equal(found.id, 's2');
});

test('pickSessionForDate: does not match a session from a different date, even a day off', () => {
  const sessions = [{ id: 's1', date: '2026-08-20' }];
  assert.equal(programmeSessionService.pickSessionForDate(sessions, '2026-08-19'), null);
});

test('pickSessionForDate: returns the first match if more than one session shares a date (should never legitimately happen, but must not throw)', () => {
  const sessions = [{ id: 's1', date: '2026-08-19' }, { id: 's2', date: '2026-08-19' }];
  const found = programmeSessionService.pickSessionForDate(sessions, '2026-08-19');
  assert.equal(found.id, 's1');
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

  assert.equal(session.goals['student-1'][categoryId].reflection, 'I could read faster');
  assert.equal(session.teacherObservations['student-1'][0].note, 'Needed less prompting');
  assert.notEqual(session.goals['student-1'][categoryId].reflection, session.teacherObservations['student-1'][0].note);
});

test('recordTeacherObservation: a student may have more than one observation in the same session', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });

  programmeSessionService.recordTeacherObservation(programme, session, { studentId: 'student-1', note: 'First note' });
  programmeSessionService.recordTeacherObservation(programme, session, { studentId: 'student-1', note: 'Second note' });

  assert.equal(session.teacherObservations['student-1'].length, 2);
  assert.equal(session.teacherObservations['student-1'][0].note, 'First note');
  assert.equal(session.teacherObservations['student-1'][1].note, 'Second note');
});

test('CONCURRENCY: recording a teacher observation for one student never touches another student\'s existing observations, in memory', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });

  programmeSessionService.recordTeacherObservation(programme, session, { studentId: 'student-1', note: "Student 1's note" });
  const studentOneSnapshotBefore = JSON.parse(JSON.stringify(session.teacherObservations['student-1']));

  programmeSessionService.recordTeacherObservation(programme, session, { studentId: 'student-2', note: "Student 2's note" });

  assert.deepEqual(session.teacherObservations['student-1'], studentOneSnapshotBefore, "student-1's own observations must be untouched by student-2's own update");
});

test('buildTeacherObservationPatch: produces a minimal, single-student Firestore field-path patch', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });
  programmeSessionService.recordTeacherObservation(programme, session, { studentId: 'student-1', note: 'x' });

  const patch = programmeSessionService.buildTeacherObservationPatch(session, 'student-1');

  assert.deepEqual(Object.keys(patch).sort(), ['teacherObservations.student-1', 'updatedAt'].sort());
  assert.deepEqual(patch['teacherObservations.student-1'], session.teacherObservations['student-1']);
});

// ---------------------------------------------------------------------
// Student identity is never duplicated into programme data
// ---------------------------------------------------------------------

test('a student\'s classroom identity is never duplicated into programme session data — only studentId map keys appear, never a copied field', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });
  const categoryId = programme.configuration.goalFramework.categories[0].id;

  programmeSessionService.recordAttendance(programme, session, { studentId: 'student-1', status: 'present' });
  programmeSessionService.recordGoal(programme, session, { studentId: 'student-1', categoryId, text: 'x' });
  programmeSessionService.recordTeacherObservation(programme, session, { studentId: 'student-1', note: 'x' });

  assert.deepEqual(Object.keys(session.attendance['student-1']).sort(), ['recordedAt', 'status']);
  assert.deepEqual(Object.keys(session.goals['student-1'][categoryId]).sort(), ['outcome', 'reflection', 'source', 'text']);
  assert.ok(!('name' in session.attendance['student-1']));
  assert.ok(!('studentId' in session.attendance['student-1']), 'studentId is the map key, never duplicated inside the value');
  assert.ok(!('name' in session.goals['student-1'][categoryId]));
  assert.ok(!('name' in session.teacherObservations['student-1'][0]));
});

// ---------------------------------------------------------------------
// Membership behaviour during sessions (Issue 5) — deliberately NOT a
// participant-roster snapshot; see models/ProgrammeSession.js's own
// header comment and learningProgrammeService.wasStudentMemberOn()'s
// own header comment for why.
// ---------------------------------------------------------------------

test('MEMBERSHIP: wasStudentMemberOn is true for a date within an active membership span', () => {
  const { programme } = makeClassroomWithProgramme();
  assert.equal(learningProgrammeService.wasStudentMemberOn(programme, 'student-1', '2026-08-19'), true);
});

test('MEMBERSHIP: wasStudentMemberOn is false for a student who never joined', () => {
  const { programme } = makeClassroomWithProgramme();
  assert.equal(learningProgrammeService.wasStudentMemberOn(programme, 'never-a-member', '2026-08-19'), false);
});

test('MEMBERSHIP: wasStudentMemberOn remains true for a date before a student left', () => {
  const { programme } = makeClassroomWithProgramme();
  const membership = learningProgrammeService.getActiveMembership(programme, 'student-1');
  membership.joinedAt = '2026-08-01T00:00:00.000Z';
  learningProgrammeService.markMembershipLeft(programme, 'student-1', '2026-08-10T00:00:00.000Z');

  assert.equal(learningProgrammeService.wasStudentMemberOn(programme, 'student-1', '2026-08-05'), true, 'still a member on a date within their own membership span');
  assert.equal(learningProgrammeService.wasStudentMemberOn(programme, 'student-1', '2026-08-15'), false, 'no longer a member on a date after they left');
});

test('MEMBERSHIP: a historical session referencing a now-departed student remains fully interpretable', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id, date: '2026-08-05' });
  programmeSessionService.recordAttendance(programme, session, { studentId: 'student-1', status: 'present' });

  learningProgrammeService.markMembershipLeft(programme, 'student-1');

  // The session's own record is completely untouched by the later membership change.
  assert.equal(session.attendance['student-1'].status, 'present');
  // And membership history itself still proves they were genuinely a member once.
  assert.equal(learningProgrammeService.getMembershipsForStudent(programme, 'student-1').length, 1);
});

// ---------------------------------------------------------------------
// PHASE 2A VERIFICATION ROUND — regression test for a real bug found
// by code-tracing (no live browser was available to reproduce it
// interactively): ui/views/ProgrammeSessionView.js used to redraw its
// goal/activity/observation sections by re-invoking the whole exported
// render function — including a fresh getSessionById() Firestore
// read — after every single edit, regardless of whether the
// just-attempted save had actually succeeded. Because
// saveSessionPatch() failures are caught and swallowed (by design —
// see that function's own header comment), nothing stopped that
// re-fetch from running on a failed write, silently discarding the
// teacher's own just-made, correct local edit in favor of stale
// server data.
//
// The fix (see ProgrammeSessionView.js's own "redraw()" function and
// its header comment) replaces that Firestore-refetching redraw with
// one that rebuilds only from the already-in-memory `session` object
// — which is safe specifically BECAUSE recordGoal()/recordActivity()/
// recordTeacherObservation() mutate that object SYNCHRONOUSLY, before
// any async persistence is even attempted. This test pins down that
// exact invariant directly: it is the one fact the whole fix depends
// on, and if a future change ever made these functions async (or
// deferred their mutation), this redraw-from-memory strategy would
// silently stop being safe, so this needs its own explicit test, not
// just an inline comment.
// ---------------------------------------------------------------------

test('BUGFIX REGRESSION: recordAttendance mutates the session synchronously, before any persistence is attempted', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });

  // No `await`, no Promise involved at all — recordAttendance() is a
  // plain synchronous function. If a caller's own in-memory `session`
  // reference didn't already reflect the change the instant this
  // call returns, a UI that redraws from that same reference (instead
  // of re-fetching) would be unsafe.
  programmeSessionService.recordAttendance(programme, session, { studentId: 'student-1', status: 'present' });
  assert.equal(session.attendance['student-1'].status, 'present', 'must be reflected in the session object synchronously, with no await needed');
});

test('BUGFIX REGRESSION: recordGoal mutates the session synchronously, before any persistence is attempted', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });
  const categoryId = programme.configuration.goalFramework.categories[0].id;

  programmeSessionService.recordGoal(programme, session, { studentId: 'student-1', categoryId, text: 'Read two pages' });
  assert.equal(session.goals['student-1'][categoryId].text, 'Read two pages', 'must be reflected in the session object synchronously, with no await needed');
});

test('BUGFIX REGRESSION: recordActivity mutates the session synchronously, before any persistence is attempted', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });

  programmeSessionService.recordActivity(session, { name: 'Guided Reading' });
  assert.equal(session.activities.length, 1, 'must be reflected in the session object synchronously, with no await needed');
});

test('BUGFIX REGRESSION: recordTeacherObservation mutates the session synchronously, before any persistence is attempted', () => {
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });

  programmeSessionService.recordTeacherObservation(programme, session, { studentId: 'student-1', note: 'x' });
  assert.equal(session.teacherObservations['student-1'].length, 1, 'must be reflected in the session object synchronously, with no await needed');
});

test('BUGFIX REGRESSION: a build*Patch() call reflects an already-applied local mutation regardless of whether it is ever persisted', () => {
  // Simulates exactly the scenario the bug occurred in: mutate, THEN
  // (conceptually) attempt a save that could fail — the patch itself,
  // and the in-memory session, must already be correct before that
  // save is even attempted, since a UI's own post-edit redraw must be
  // able to rely on this without needing to know whether the save
  // succeeded.
  const { classroom, programme } = makeClassroomWithProgramme();
  const session = programmeSessionService.buildNewSession(classroom, { programmeId: programme.id });

  programmeSessionService.recordAttendance(programme, session, { studentId: 'student-1', status: 'late' });
  const patch = programmeSessionService.buildAttendancePatch(session, 'student-1');

  // The patch is computed from the session's own, already-mutated
  // in-memory state — never from a server round trip.
  assert.equal(patch['attendance.student-1'].status, 'late');
});

