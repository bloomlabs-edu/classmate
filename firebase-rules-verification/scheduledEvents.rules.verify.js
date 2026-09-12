/**
 * firebase-rules-verification/scheduledEvents.rules.verify.js
 *
 * Real, executable Firestore Rules Unit Tests for
 * classrooms/{classroomId}/scheduledEvents/{eventId} (Timetable/School
 * Calendar feature — models/ScheduledEvent.js). Mirrors
 * lessonPlans.rules.verify.js / lessons' own rule shape closely: member-
 * scoped create/update, cross-classroom denial, plus the one genuine
 * difference from Lessons — member-scoped DELETE (an exam really can be
 * deleted, unlike a Lesson).
 */

import { before, after, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'classmate-scheduledevents-rules-verification';

function eventPath(classroomId, eventId) {
  return `classrooms/${classroomId}/scheduledEvents/${eventId}`;
}

function examEvent(overrides = {}) {
  return {
    id: 'event-1',
    classroomId: 'classroom-test',
    date: '2026-09-15',
    startTime: '09:00',
    endTime: '10:30',
    eventType: 'exam',
    title: 'Term 1 Science Examination',
    subjectId: 'science',
    gradeLabel: 'Grade 8A',
    room: '204',
    invigilatorUid: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('../firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

after(async () => {
  await testEnv?.cleanup();
});

async function seedClassroom(members) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'classrooms', 'classroom-test'), {
      ownerUid: Object.keys(members)[0],
      memberUids: Object.keys(members),
      members,
    });
  });
}

async function seedEvent(data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), eventPath('classroom-test', 'event-1')), data);
  });
}

const TWO_TEACHERS = {
  'teacher-1': { role: 'teacher', displayName: 'Teacher One' },
  'teacher-2': { role: 'teacher', displayName: 'Teacher Two' },
};

beforeEach(async () => {
  await testEnv.clearFirestore();
});

test('1. unauthenticated read/write -> DENY', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedEvent(examEvent());
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, eventPath('classroom-test', 'event-1'))));
  await assertFails(setDoc(doc(db, eventPath('classroom-test', 'event-2')), examEvent({ id: 'event-2' })));
});

test('2. any authenticated user may read (Lesson-content-level sensitivity, not classroom-membership-gated)', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedEvent(examEvent());
  const db = testEnv.authenticatedContext('outsider-uid').firestore();
  await assertSucceeds(getDoc(doc(db, eventPath('classroom-test', 'event-1'))));
});

test('3. a classroom member creates a new exam -> ALLOW', async () => {
  await seedClassroom(TWO_TEACHERS);
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertSucceeds(setDoc(doc(db, eventPath('classroom-test', 'event-1')), examEvent()));
});

test('4. a non-member (not a member of this classroom at all) cannot create an exam here -> DENY', async () => {
  await seedClassroom(TWO_TEACHERS);
  const db = testEnv.authenticatedContext('outsider-uid').firestore();
  await assertFails(setDoc(doc(db, eventPath('classroom-test', 'event-1')), examEvent()));
});

test('5. a member of a DIFFERENT classroom cannot create/update/delete an event here -> DENY (cross-classroom denial)', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedEvent(examEvent());
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'classrooms', 'other-classroom'), {
      ownerUid: 'other-teacher',
      memberUids: ['other-teacher'],
      members: { 'other-teacher': { role: 'teacher', displayName: 'Other Teacher' } },
    });
  });
  const db = testEnv.authenticatedContext('other-teacher').firestore();
  await assertFails(updateDoc(doc(db, eventPath('classroom-test', 'event-1')), { room: '999' }));
  await assertFails(deleteDoc(doc(db, eventPath('classroom-test', 'event-1'))));
});

test('6. a classroom member updates an existing exam (e.g. changing the room) -> ALLOW', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedEvent(examEvent());
  const db = testEnv.authenticatedContext('teacher-2').firestore();
  await assertSucceeds(updateDoc(doc(db, eventPath('classroom-test', 'event-1')), { room: '305', updatedAt: '2026-09-05T00:00:00.000Z' }));
});

test('7. a classroom member deletes an exam -> ALLOW (unlike Lessons, an event is genuinely deletable)', async () => {
  await seedClassroom(TWO_TEACHERS);
  await seedEvent(examEvent());
  const db = testEnv.authenticatedContext('teacher-1').firestore();
  await assertSucceeds(deleteDoc(doc(db, eventPath('classroom-test', 'event-1'))));
});
