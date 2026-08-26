/**
 * firebase-rules-verification/studentConceptRecords.rules.verify.js
 *
 * Real, executable Firestore Rules Unit Tests for the new
 * classrooms/{classroomId}/studentConceptRecords/{recordId} rule
 * (Phase N — the StudentConceptRecord storage migration). Same
 * conventions as the other *.rules.verify.js files in this directory:
 * reads the REAL ../firestore.rules, synthetic-only fixture data,
 * seeded fresh per test.
 *
 * recordId here is `${uid}_${conceptId}` — keyed on the writing
 * device's own real auth uid, not studentId — matching
 * repositories/firestoreStudentConceptRecordsRepository.js's own
 * buildRecordId() exactly. See that file's own header comment for why:
 * a studentId-keyed id would be predictable in advance (roster student
 * ids and concept ids are both readable) and squattable by a hostile
 * device, permanently locking the real student out. Test 3b below
 * exercises this directly.
 */

import { before, after, beforeEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection } from 'firebase/firestore';

const PROJECT_ID = 'classmate-concept-records-rules-verification';

function recordPath(classroomId, recordId) {
  return `classrooms/${classroomId}/studentConceptRecords/${recordId}`;
}

function buildRecordId(uid, conceptId) {
  return `${uid}_${conceptId}`;
}

const STUDENT_A_UID = 'student-device-uid-A';
const STUDENT_B_UID = 'student-device-uid-B';

function recordFor(studentId, conceptId, uid, overrides = {}) {
  return {
    classroomId: 'classroom-test',
    studentId,
    conceptId,
    uid,
    understanding: 'confident',
    notebook: 'not_required',
    helpRequested: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
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

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'classrooms', 'classroom-test'), {
      ownerUid: 'teacher-uid-test',
      memberUids: ['teacher-uid-test'],
    });
  });
});

test('1. student creates own concept record -> ALLOW', async () => {
  const db = testEnv.authenticatedContext(STUDENT_A_UID).firestore();
  await assertSucceeds(
    setDoc(doc(db, recordPath('classroom-test', buildRecordId(STUDENT_A_UID, 'concept-1'))), recordFor('student-A', 'concept-1', STUDENT_A_UID))
  );
});

test('2. student updates own concept record (understanding only) -> ALLOW', async () => {
  const recordId = buildRecordId(STUDENT_A_UID, 'concept-1');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), recordPath('classroom-test', recordId)), recordFor('student-A', 'concept-1', STUDENT_A_UID));
  });
  const db = testEnv.authenticatedContext(STUDENT_A_UID).firestore();
  await assertSucceeds(
    updateDoc(doc(db, recordPath('classroom-test', recordId)), { understanding: 'can_teach', updatedAt: '2026-01-02T00:00:00.000Z' })
  );
});

test('3. student A cannot create a record impersonating device B\'s own uid -> DENY', async () => {
  const db = testEnv.authenticatedContext(STUDENT_A_UID).firestore();
  await assertFails(
    setDoc(doc(db, recordPath('classroom-test', buildRecordId(STUDENT_B_UID, 'concept-1'))), recordFor('student-B', 'concept-1', STUDENT_B_UID))
  );
});

test('3b. squatting-prevention: device A creating a record under an arbitrary studentId label never blocks the real student B\'s own later record for the same concept', async () => {
  // Device A creates a record for concept-1, mislabeling studentId as
  // "student-B" — allowed, since studentId is a trusted-at-face-value
  // display field (matching studentGoals/feedPosts precedent), but it
  // is keyed under A's OWN uid, never B's.
  const dbA = testEnv.authenticatedContext(STUDENT_A_UID).firestore();
  await assertSucceeds(
    setDoc(doc(dbA, recordPath('classroom-test', buildRecordId(STUDENT_A_UID, 'concept-1'))), recordFor('student-B', 'concept-1', STUDENT_A_UID))
  );

  // The REAL device B can still create its own, completely separate
  // record for the exact same concept — proving A's mislabeled record
  // never squatted B's own id.
  const dbB = testEnv.authenticatedContext(STUDENT_B_UID).firestore();
  await assertSucceeds(
    setDoc(doc(dbB, recordPath('classroom-test', buildRecordId(STUDENT_B_UID, 'concept-1'))), recordFor('student-B', 'concept-1', STUDENT_B_UID))
  );
});

test('4. student cannot update another device\'s own record -> DENY', async () => {
  const recordId = buildRecordId(STUDENT_B_UID, 'concept-1');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), recordPath('classroom-test', recordId)), recordFor('student-B', 'concept-1', STUDENT_B_UID));
  });
  const db = testEnv.authenticatedContext(STUDENT_A_UID).firestore();
  await assertFails(updateDoc(doc(db, recordPath('classroom-test', recordId)), { understanding: 'can_teach' }));
});

test('5. student cannot change uid on their own existing record -> DENY', async () => {
  const recordId = buildRecordId(STUDENT_A_UID, 'concept-1');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), recordPath('classroom-test', recordId)), recordFor('student-A', 'concept-1', STUDENT_A_UID));
  });
  const db = testEnv.authenticatedContext(STUDENT_A_UID).firestore();
  await assertFails(updateDoc(doc(db, recordPath('classroom-test', recordId)), { uid: STUDENT_B_UID }));
});

test('6. student cannot change studentId on their own existing record -> DENY', async () => {
  const recordId = buildRecordId(STUDENT_A_UID, 'concept-1');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), recordPath('classroom-test', recordId)), recordFor('student-A', 'concept-1', STUDENT_A_UID));
  });
  const db = testEnv.authenticatedContext(STUDENT_A_UID).firestore();
  await assertFails(updateDoc(doc(db, recordPath('classroom-test', recordId)), { studentId: 'student-B' }));
});

test('7. student cannot change conceptId on their own existing record -> DENY', async () => {
  const recordId = buildRecordId(STUDENT_A_UID, 'concept-1');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), recordPath('classroom-test', recordId)), recordFor('student-A', 'concept-1', STUDENT_A_UID));
  });
  const db = testEnv.authenticatedContext(STUDENT_A_UID).firestore();
  await assertFails(updateDoc(doc(db, recordPath('classroom-test', recordId)), { conceptId: 'concept-2' }));
});

test('8. student cannot change classroomId on their own existing record -> DENY', async () => {
  const recordId = buildRecordId(STUDENT_A_UID, 'concept-1');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), recordPath('classroom-test', recordId)), recordFor('student-A', 'concept-1', STUDENT_A_UID));
  });
  const db = testEnv.authenticatedContext(STUDENT_A_UID).firestore();
  await assertFails(updateDoc(doc(db, recordPath('classroom-test', recordId)), { classroomId: 'some-other-classroom' }));
});

test('9. student cannot change notebook on their own existing record -> DENY', async () => {
  const recordId = buildRecordId(STUDENT_A_UID, 'concept-1');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), recordPath('classroom-test', recordId)), recordFor('student-A', 'concept-1', STUDENT_A_UID));
  });
  const db = testEnv.authenticatedContext(STUDENT_A_UID).firestore();
  await assertFails(updateDoc(doc(db, recordPath('classroom-test', recordId)), { notebook: 'submitted' }));
});

test('10. student cannot modify classroom configuration (the classrooms/{id} update rule itself is unbroadened) -> DENY', async () => {
  const db = testEnv.authenticatedContext(STUDENT_A_UID).firestore();
  await assertFails(updateDoc(doc(db, 'classrooms', 'classroom-test'), { gradeSection: 'Hacked' }));
});

test('11. teacher (classroom member) can read any student\'s concept record -> ALLOW', async () => {
  const recordId = buildRecordId(STUDENT_A_UID, 'concept-1');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), recordPath('classroom-test', recordId)), recordFor('student-A', 'concept-1', STUDENT_A_UID));
  });
  const db = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertSucceeds(getDoc(doc(db, recordPath('classroom-test', recordId))));
});

test('12. a non-member, non-owning identity cannot read a student\'s concept record -> DENY', async () => {
  const recordId = buildRecordId(STUDENT_A_UID, 'concept-1');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), recordPath('classroom-test', recordId)), recordFor('student-A', 'concept-1', STUDENT_A_UID));
  });
  const db = testEnv.authenticatedContext(STUDENT_B_UID).firestore();
  await assertFails(getDoc(doc(db, recordPath('classroom-test', recordId))));
});

test('12b. unauthenticated read/write -> DENY', async () => {
  const recordId = buildRecordId(STUDENT_A_UID, 'concept-1');
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, recordPath('classroom-test', recordId))));
  await assertFails(setDoc(doc(db, recordPath('classroom-test', recordId)), recordFor('student-A', 'concept-1', STUDENT_A_UID)));
});

test('13. delete is always denied, even for the record\'s own owning student or a teacher -> DENY', async () => {
  const recordId = buildRecordId(STUDENT_A_UID, 'concept-1');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), recordPath('classroom-test', recordId)), recordFor('student-A', 'concept-1', STUDENT_A_UID));
  });
  const studentDb = testEnv.authenticatedContext(STUDENT_A_UID).firestore();
  await assertFails(deleteDoc(doc(studentDb, recordPath('classroom-test', recordId))));

  const teacherDb = testEnv.authenticatedContext('teacher-uid-test').firestore();
  await assertFails(deleteDoc(doc(teacherDb, recordPath('classroom-test', recordId))));
});

test('14. deterministic id prevents duplicate records for the same (uid, concept) pair', async () => {
  const recordId = buildRecordId(STUDENT_A_UID, 'concept-1');
  const db = testEnv.authenticatedContext(STUDENT_A_UID).firestore();
  await assertSucceeds(setDoc(doc(db, recordPath('classroom-test', recordId)), recordFor('student-A', 'concept-1', STUDENT_A_UID)));

  // A second "create-shaped" write at the exact same id is evaluated by
  // Firestore as an UPDATE (the document already exists), never a
  // second create — there is no client action that can make two
  // documents exist for the same (uid, conceptId) pair, structurally,
  // not just by convention. A resend of IDENTICAL classroomId/
  // studentId/conceptId/uid values alongside a legitimately-changed
  // understanding is correctly ALLOWED (Firestore's own diff() only
  // reports keys whose VALUE actually changed, so re-sending unchanged
  // values never trips hasOnly()) — the real proof duplication is
  // impossible is that an attempt to ACTUALLY change an identity field
  // this way is denied, exactly like test 6 above.
  await assertFails(
    setDoc(doc(db, recordPath('classroom-test', recordId)), recordFor('student-C', 'concept-1', STUDENT_A_UID, { understanding: 'need_help' }))
  );

  // Confirms exactly one document physically exists at this id.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const snapshot = await getDocs(collection(context.firestore(), 'classrooms', 'classroom-test', 'studentConceptRecords'));
    if (snapshot.docs.length !== 1) {
      throw new Error(`Expected exactly 1 document, found ${snapshot.docs.length}`);
    }
  });
});

test('15. create is denied if notebook/helpRequested are not the real model defaults', async () => {
  const db = testEnv.authenticatedContext(STUDENT_A_UID).firestore();
  await assertFails(
    setDoc(doc(db, recordPath('classroom-test', buildRecordId(STUDENT_A_UID, 'concept-1'))), recordFor('student-A', 'concept-1', STUDENT_A_UID, { notebook: 'submitted' }))
  );
  await assertFails(
    setDoc(doc(db, recordPath('classroom-test', buildRecordId(STUDENT_A_UID, 'concept-2'))), recordFor('student-A', 'concept-2', STUDENT_A_UID, { helpRequested: true }))
  );
});

test('16. create is denied if uid does not match the caller\'s own real auth uid', async () => {
  const db = testEnv.authenticatedContext(STUDENT_A_UID).firestore();
  await assertFails(
    setDoc(doc(db, recordPath('classroom-test', buildRecordId(STUDENT_A_UID, 'concept-1'))), recordFor('student-A', 'concept-1', STUDENT_B_UID))
  );
});

test('17. create is denied if the recordId does not match uid_conceptId', async () => {
  const db = testEnv.authenticatedContext(STUDENT_A_UID).firestore();
  await assertFails(
    setDoc(doc(db, recordPath('classroom-test', 'mismatched-id')), recordFor('student-A', 'concept-1', STUDENT_A_UID))
  );
});
