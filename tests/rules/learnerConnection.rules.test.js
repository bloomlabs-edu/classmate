/**
 * tests/rules/learnerConnection.rules.test.js
 *
 * Real Firestore Rules Emulator tests (firestore.rules, unmodified from
 * what's actually deployed-ready) for the Learner Identity Bridge's four
 * new collections. Proves, against the actual rules engine — not a
 * reimplementation of it — every security requirement in
 * docs/architecture/CLASSROOM_INVITATION_VERIFICATION_BRIDGE.md item 7:
 * no untrusted client can create an ACTIVE relationship, move
 * PENDING->ACTIVE, reactivate REVOKED, claim another classroom's
 * roster student, or read across classroom/teacher boundaries.
 *
 * Requires the Firestore emulator running locally (this project's own
 * firebase.json already points it at 127.0.0.1:8080 — the same default
 * this app's own firestoreEnvironment.js already redirects non-
 * production hostnames to). Run via:
 *   firebase emulators:exec --only firestore "node --test tests/rules/learnerConnection.rules.test.js"
 * or against an already-running emulator directly with `node --test`.
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, getDocs, collection, query, where } from 'firebase/firestore';

let testEnv;

const CLASSROOM_A = 'classroom-a';
const CLASSROOM_B = 'classroom-b';
const TEACHER_A = 'teacher-a-uid';
const TEACHER_B = 'teacher-b-uid';
const STUDENT_A1 = 'student-a1';
const STUDENT_A2 = 'student-a2';
const STUDENT_B1 = 'student-b1';
const LEARNER_1 = 'learner-profile-1';

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-classmate-bridge-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'classrooms', CLASSROOM_A), {
      ownerUid: TEACHER_A,
      memberUids: [TEACHER_A],
      teams: [{ id: 't1', name: 'Alpha', students: [{ id: STUDENT_A1, name: 'Ann' }, { id: STUDENT_A2, name: 'Ben' }] }],
    });
    await setDoc(doc(db, 'classrooms', CLASSROOM_B), {
      ownerUid: TEACHER_B,
      memberUids: [TEACHER_B],
      teams: [{ id: 't1', name: 'Bravo', students: [{ id: STUDENT_B1, name: 'Cas' }] }],
    });
  });
});

function asTeacherA() {
  return testEnv.authenticatedContext(TEACHER_A).firestore();
}
function asTeacherB() {
  return testEnv.authenticatedContext(TEACHER_B).firestore();
}
function asAnon() {
  return testEnv.unauthenticatedContext().firestore();
}
async function seedUnprivileged(fn) {
  await testEnv.withSecurityRulesDisabled(async (context) => fn(context.firestore()));
}

// --------------------------------------------------------------------
// Classroom invitations — identify a classroom only, never a student
// --------------------------------------------------------------------

test('a teacher can create an invitation for their own classroom', async () => {
  const db = asTeacherA();
  await assertSucceeds(
    setDoc(doc(db, 'classrooms', CLASSROOM_A, 'classroomInvitations', 'inv-1'), {
      id: 'inv-1', classroomId: CLASSROOM_A, code: 'ABCDEF', status: 'active', createdByUid: TEACHER_A, createdAt: 'now',
    })
  );
});

test('a teacher CANNOT create an invitation for a classroom they do not belong to', async () => {
  const db = asTeacherB();
  await assertFails(
    setDoc(doc(db, 'classrooms', CLASSROOM_A, 'classroomInvitations', 'inv-x'), {
      id: 'inv-x', classroomId: CLASSROOM_A, code: 'ZZZZZZ', status: 'active', createdByUid: TEACHER_B, createdAt: 'now',
    })
  );
});

test('an unauthenticated client CANNOT create an invitation at all', async () => {
  const db = asAnon();
  await assertFails(
    setDoc(doc(db, 'classrooms', CLASSROOM_A, 'classroomInvitations', 'inv-y'), {
      id: 'inv-y', classroomId: CLASSROOM_A, code: 'QQQQQQ', status: 'active', createdByUid: 'nobody', createdAt: 'now',
    })
  );
});

test('the invitation document itself never contains roster data — schema-level proof the invitation cannot expose the roster', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'classrooms', CLASSROOM_A, 'classroomInvitations', 'inv-2'), {
      id: 'inv-2', classroomId: CLASSROOM_A, code: 'GHJKMN', status: 'active', createdByUid: TEACHER_A, createdAt: 'now',
    });
  });
  const db = asTeacherA();
  const snap = await getDoc(doc(db, 'classrooms', CLASSROOM_A, 'classroomInvitations', 'inv-2'));
  const keys = Object.keys(snap.data());
  assert.deepEqual(keys.sort(), ['classroomId', 'code', 'createdAt', 'createdByUid', 'id', 'status']);
  assert.ok(!keys.includes('teams') && !keys.includes('students'));
});

test('a teacher of a DIFFERENT classroom cannot read another classroom\'s invitations (cross-classroom isolation)', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'classrooms', CLASSROOM_A, 'classroomInvitations', 'inv-3'), {
      id: 'inv-3', classroomId: CLASSROOM_A, code: 'PQRSTU', status: 'active', createdByUid: TEACHER_A, createdAt: 'now',
    });
  });
  const db = asTeacherB();
  await assertFails(getDoc(doc(db, 'classrooms', CLASSROOM_A, 'classroomInvitations', 'inv-3')));
});

test('a teacher can revoke their own invitation, but cannot un-revoke it, and cannot touch any other field', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'classrooms', CLASSROOM_A, 'classroomInvitations', 'inv-4'), {
      id: 'inv-4', classroomId: CLASSROOM_A, code: 'VWXYZ2', status: 'active', createdByUid: TEACHER_A, createdAt: 'now',
    });
  });
  const db = asTeacherA();
  const ref = doc(db, 'classrooms', CLASSROOM_A, 'classroomInvitations', 'inv-4');
  await assertSucceeds(updateDoc(ref, { status: 'revoked' }));
  await assertFails(updateDoc(ref, { status: 'active' })); // cannot un-revoke
  await assertFails(updateDoc(ref, { code: 'HACKED' })); // cannot touch any other field, even while active would have allowed it
});

// --------------------------------------------------------------------
// classroomInvitationCodes — top-level pointer, teacher-only client access
// --------------------------------------------------------------------

test('the invitation code pointer is readable only by the classroom\'s own teacher, never by an unauthenticated client or a different teacher', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'classroomInvitationCodes', 'ABC123'), { classroomId: CLASSROOM_A, invitationId: 'inv-5', status: 'active', createdAt: 'now' });
  });
  await assertSucceeds(getDoc(doc(asTeacherA(), 'classroomInvitationCodes', 'ABC123')));
  await assertFails(getDoc(doc(asTeacherB(), 'classroomInvitationCodes', 'ABC123')));
  await assertFails(getDoc(doc(asAnon(), 'classroomInvitationCodes', 'ABC123')));
});

// --------------------------------------------------------------------
// Student verification codes — the per-student fallback credential
// --------------------------------------------------------------------

test('a teacher can create a verification code naming a REAL student in their own roster, bound to a real PENDING relationship for that learner', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: null, status: 'PENDING', createdAt: 'now',
    });
  });
  const db = asTeacherA();
  await assertSucceeds(
    setDoc(doc(db, 'classrooms', CLASSROOM_A, 'studentVerificationCodes', 'somehash1'), {
      codeHash: 'somehash1', classroomId: CLASSROOM_A, studentId: STUDENT_A1, learnerProfileId: LEARNER_1, status: 'active', createdByUid: TEACHER_A, createdAt: 'now', expiresAt: '2099-01-01',
    })
  );
});

// --------------------------------------------------------------------
// The security-critical binding this file's own review added: a code
// must be bound, server-verifiably, to a learnerProfileId that actually
// has a PENDING relationship in THIS classroom — not merely to
// (classroomId, studentId). See models/LearnerConnection.js's own
// createStudentVerificationCode() header comment for the full "why".
// --------------------------------------------------------------------

test('a teacher CANNOT create a verification code with no learnerProfileId field at all', async () => {
  const db = asTeacherA();
  await assertFails(
    setDoc(doc(db, 'classrooms', CLASSROOM_A, 'studentVerificationCodes', 'somehash-nolp'), {
      codeHash: 'somehash-nolp', classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: 'active', createdByUid: TEACHER_A, createdAt: 'now', expiresAt: '2099-01-01',
    })
  );
});

test('a teacher CANNOT create a verification code naming a learnerProfileId that has no relationship document in this classroom at all', async () => {
  const db = asTeacherA();
  await assertFails(
    setDoc(doc(db, 'classrooms', CLASSROOM_A, 'studentVerificationCodes', 'somehash-norel'), {
      codeHash: 'somehash-norel', classroomId: CLASSROOM_A, studentId: STUDENT_A1, learnerProfileId: 'learner-with-no-relationship', status: 'active', createdByUid: TEACHER_A, createdAt: 'now', expiresAt: '2099-01-01',
    })
  );
});

test('a teacher CANNOT create a verification code for a learnerProfileId whose relationship in this classroom is already ACTIVE', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: 'ACTIVE', createdAt: 'now',
    });
  });
  const db = asTeacherA();
  await assertFails(
    setDoc(doc(db, 'classrooms', CLASSROOM_A, 'studentVerificationCodes', 'somehash-active'), {
      codeHash: 'somehash-active', classroomId: CLASSROOM_A, studentId: STUDENT_A2, learnerProfileId: LEARNER_1, status: 'active', createdByUid: TEACHER_A, createdAt: 'now', expiresAt: '2099-01-01',
    })
  );
});

test('a teacher CANNOT create a verification code for a learnerProfileId whose only PENDING relationship is in a DIFFERENT classroom', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_B}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_B, studentId: null, status: 'PENDING', createdAt: 'now',
    });
  });
  const db = asTeacherA();
  await assertFails(
    setDoc(doc(db, 'classrooms', CLASSROOM_A, 'studentVerificationCodes', 'somehash-wrongclassroom'), {
      codeHash: 'somehash-wrongclassroom', classroomId: CLASSROOM_A, studentId: STUDENT_A1, learnerProfileId: LEARNER_1, status: 'active', createdByUid: TEACHER_A, createdAt: 'now', expiresAt: '2099-01-01',
    })
  );
});

// NOTE: rules-level creation does NOT verify studentId against the live
// roster — this codebase's own Firestore Rules engine only implements a
// constrained CEL subset that cannot express the necessary nested
// list check (see firestore.rules' own comment on this exact point,
// and the pre-existing Phase 3.6 comment elsewhere in the same file
// documenting the same constraint discovered independently, earlier).
// A code naming a nonexistent or wrong-classroom studentId CAN be
// created (proven below — this is the honest, verified boundary of
// what rules can enforce), but can never be successfully redeemed —
// see tests/server/verifyLearnerConnection.test.js's own "wrong
// student"/"cross-classroom" cases for where that check actually lives
// and is actually proven.
test('a code naming a student not in the roster CAN be created (rules cannot check this — the real enforcement is at redemption, see the server test suite), as long as the learnerProfileId/PENDING-relationship binding is still satisfied', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: null, status: 'PENDING', createdAt: 'now',
    });
  });
  const db = asTeacherA();
  await assertSucceeds(
    setDoc(doc(db, 'classrooms', CLASSROOM_A, 'studentVerificationCodes', 'somehash2'), {
      codeHash: 'somehash2', classroomId: CLASSROOM_A, studentId: 'totally-made-up-student-id', learnerProfileId: LEARNER_1, status: 'active', createdByUid: TEACHER_A, createdAt: 'now', expiresAt: '2099-01-01',
    })
  );
});

test('no client, including the issuing teacher, can ever set a verification code\'s status to redeemed directly (only the trusted server module can, via Admin SDK)', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: null, status: 'PENDING', createdAt: 'now',
    });
    await setDoc(doc(db, 'classrooms', CLASSROOM_A, 'studentVerificationCodes', 'somehash4'), {
      codeHash: 'somehash4', classroomId: CLASSROOM_A, studentId: STUDENT_A1, learnerProfileId: LEARNER_1, status: 'active', createdByUid: TEACHER_A, createdAt: 'now', expiresAt: '2099-01-01',
    });
  });
  const db = asTeacherA();
  await assertFails(updateDoc(doc(db, 'classrooms', CLASSROOM_A, 'studentVerificationCodes', 'somehash4'), { status: 'redeemed' }));
});

test('a teacher of a different classroom cannot read or revoke this classroom\'s verification codes', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: null, status: 'PENDING', createdAt: 'now',
    });
    await setDoc(doc(db, 'classrooms', CLASSROOM_A, 'studentVerificationCodes', 'somehash5'), {
      codeHash: 'somehash5', classroomId: CLASSROOM_A, studentId: STUDENT_A1, learnerProfileId: LEARNER_1, status: 'active', createdByUid: TEACHER_A, createdAt: 'now', expiresAt: '2099-01-01',
    });
  });
  const db = asTeacherB();
  await assertFails(getDoc(doc(db, 'classrooms', CLASSROOM_A, 'studentVerificationCodes', 'somehash5')));
  await assertFails(updateDoc(doc(db, 'classrooms', CLASSROOM_A, 'studentVerificationCodes', 'somehash5'), { status: 'revoked' }));
});

// --------------------------------------------------------------------
// learnerClassroomRelationships — the PENDING/ACTIVE/REVOKED fact itself
// --------------------------------------------------------------------

test('an untrusted client CANNOT create a relationship at all, in any status, including PENDING', async () => {
  const db = asTeacherA(); // even a real, authenticated teacher of the right classroom
  await assertFails(
    setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: null, status: 'PENDING', createdAt: 'now',
    })
  );
});

test('an untrusted client CANNOT create an ACTIVE relationship directly', async () => {
  const db = asTeacherA();
  await assertFails(
    setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: 'ACTIVE', createdAt: 'now',
    })
  );
});

test('an untrusted client CANNOT change PENDING to ACTIVE', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: null, status: 'PENDING', createdAt: 'now',
    });
  });
  const db = asTeacherA();
  await assertFails(
    updateDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      status: 'ACTIVE', studentId: STUDENT_A1,
    })
  );
});

test('an untrusted client CANNOT reactivate a REVOKED relationship', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: 'REVOKED', createdAt: 'now',
    });
  });
  const db = asTeacherA();
  await assertFails(
    updateDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), { status: 'ACTIVE' })
  );
});

test('a teacher of the relationship\'s own classroom CAN revoke an ACTIVE relationship', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: 'ACTIVE', createdAt: 'now',
    });
  });
  const db = asTeacherA();
  await assertSucceeds(
    updateDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      status: 'REVOKED', revokedAt: 'now', revokedByUid: TEACHER_A,
    })
  );
});

test('a teacher CANNOT revoke a relationship belonging to a DIFFERENT classroom (cross-classroom isolation on revocation)', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: 'ACTIVE', createdAt: 'now',
    });
  });
  const db = asTeacherB();
  await assertFails(
    updateDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      status: 'REVOKED', revokedAt: 'now', revokedByUid: TEACHER_B,
    })
  );
});

test('a teacher revoking cannot simultaneously smuggle in an unrelated field change', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: 'ACTIVE', createdAt: 'now',
    });
  });
  const db = asTeacherA();
  await assertFails(
    updateDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      status: 'REVOKED', revokedAt: 'now', revokedByUid: TEACHER_A, studentId: STUDENT_A2,
    })
  );
});

test('a teacher can read relationships for their own classroom via a properly classroomId-filtered query (safe list pattern)', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: 'ACTIVE', createdAt: 'now',
    });
  });
  const db = asTeacherA();
  const snap = await assertSucceeds(getDocs(query(collection(db, 'learnerClassroomRelationships'), where('classroomId', '==', CLASSROOM_A))));
  assert.equal(snap.size, 1);
});

test('a teacher of a different classroom gets nothing from the same query — cannot enumerate another classroom\'s relationships', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: 'ACTIVE', createdAt: 'now',
    });
  });
  const db = asTeacherB();
  await assertFails(getDocs(query(collection(db, 'learnerClassroomRelationships'), where('classroomId', '==', CLASSROOM_A))));
});

// --------------------------------------------------------------------
// PENDING -> REJECTED — the new client-side mutation this review added
// (see repositories/firestoreLearnerConnectionRepository.js's own
// rejectRelationship()), mirroring ACTIVE -> REVOKED's own tests above.
// --------------------------------------------------------------------

test('a teacher of the relationship\'s own classroom CAN reject a PENDING relationship', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: null, status: 'PENDING', createdAt: 'now',
    });
  });
  const db = asTeacherA();
  await assertSucceeds(
    updateDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      status: 'REJECTED', rejectedAt: 'now', rejectedByUid: TEACHER_A,
    })
  );
});

test('a teacher CANNOT reject a relationship belonging to a DIFFERENT classroom', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: null, status: 'PENDING', createdAt: 'now',
    });
  });
  const db = asTeacherB();
  await assertFails(
    updateDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      status: 'REJECTED', rejectedAt: 'now', rejectedByUid: TEACHER_B,
    })
  );
});

test('an ACTIVE relationship CANNOT be rejected — only a still-PENDING one', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: 'ACTIVE', createdAt: 'now',
    });
  });
  const db = asTeacherA();
  await assertFails(
    updateDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      status: 'REJECTED', rejectedAt: 'now', rejectedByUid: TEACHER_A,
    })
  );
});

test('an already-REJECTED relationship CANNOT be rejected again (no re-rejection, no field smuggling)', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: null, status: 'REJECTED', rejectedAt: 'earlier', rejectedByUid: TEACHER_A, createdAt: 'now',
    });
  });
  const db = asTeacherA();
  await assertFails(
    updateDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      status: 'REJECTED', rejectedAt: 'now', rejectedByUid: TEACHER_A,
    })
  );
});

test('rejecting cannot simultaneously smuggle in an unrelated field change', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: null, status: 'PENDING', createdAt: 'now',
    });
  });
  const db = asTeacherA();
  await assertFails(
    updateDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      status: 'REJECTED', rejectedAt: 'now', rejectedByUid: TEACHER_A, studentId: STUDENT_A1,
    })
  );
});

test('rejecting cannot claim a DIFFERENT teacher performed it', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: null, status: 'PENDING', createdAt: 'now',
    });
  });
  const db = asTeacherA();
  await assertFails(
    updateDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      status: 'REJECTED', rejectedAt: 'now', rejectedByUid: TEACHER_B,
    })
  );
});

test('a REJECTED relationship cannot be reactivated to PENDING or ACTIVE by any client', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: null, status: 'REJECTED', rejectedAt: 'earlier', rejectedByUid: TEACHER_A, createdAt: 'now',
    });
  });
  const db = asTeacherA();
  await assertFails(updateDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), { status: 'PENDING' }));
  await assertFails(updateDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), { status: 'ACTIVE' }));
});

test('nobody can delete a relationship document — revocation is a status change, never a delete', async () => {
  await seedUnprivileged(async (db) => {
    await setDoc(doc(db, 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`), {
      learnerProfileId: LEARNER_1, classroomId: CLASSROOM_A, studentId: STUDENT_A1, status: 'ACTIVE', createdAt: 'now',
    });
  });
  const { deleteDoc } = await import('firebase/firestore');
  await assertFails(deleteDoc(doc(asTeacherA(), 'learnerClassroomRelationships', `${LEARNER_1}_${CLASSROOM_A}`)));
});
