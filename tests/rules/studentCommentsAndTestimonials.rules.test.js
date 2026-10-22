/**
 * tests/rules/studentCommentsAndTestimonials.rules.test.js
 *
 * Independent verification pass (not written by the implementing agent)
 * for the Recognition/Comments/Testimonials firestore.rules additions.
 * Proves, against the REAL rules file and a real Firestore Rules
 * Emulator (never production): a non-member can never read a private
 * comment or an unpublished testimonial; a classroom teacher can; and
 * once published==true, even a non-member/anonymous-ish authenticated
 * identity CAN read the testimonial (matching this codebase's existing
 * feedPosts trust model) but still can never read the private comment
 * collection, regardless of publish state.
 *
 * Requires the Firestore emulator running locally:
 *   firebase emulators:exec --only firestore "node --test tests/rules/studentCommentsAndTestimonials.rules.test.js"
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc } from 'firebase/firestore';

let testEnv;

const TEACHER = 'teacher-uid';
const OUTSIDER = 'outsider-uid'; // authenticated, but NOT in this classroom's memberUids — stands in for a student's own per-slot identity, which is never added to memberUids

const CLASSROOM_ID = 'classroom-1';

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-classmate-comments-test',
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
    await setDoc(doc(db, `classrooms/${CLASSROOM_ID}`), {
      memberUids: [TEACHER],
    });
  });
});

function asTeacher() {
  return testEnv.authenticatedContext(TEACHER).firestore();
}
function asOutsider() {
  return testEnv.authenticatedContext(OUTSIDER).firestore();
}

async function seedComment(overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `classrooms/${CLASSROOM_ID}/studentComments/comment-1`), {
      id: 'comment-1',
      classroomId: CLASSROOM_ID,
      studentId: 'student-1',
      workItemRef: null,
      text: 'Private note about student-1',
      createdByUid: TEACHER,
      createdAt: '2026-10-22T00:00:00.000Z',
      ...overrides,
    });
  });
}

async function seedTestimonial(overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `classrooms/${CLASSROOM_ID}/testimonials/testimonial-1`), {
      id: 'testimonial-1',
      classroomId: CLASSROOM_ID,
      studentId: 'student-1',
      sourceCommentId: 'comment-1',
      text: 'Published testimonial text',
      workItemLabel: null,
      published: false,
      publishedByUid: TEACHER,
      publishedAt: '2026-10-22T00:00:00.000Z',
      updatedAt: null,
      ...overrides,
    });
  });
}

test('studentComments: a classroom teacher (member) CAN read a private comment', async () => {
  await seedComment();
  await assertSucceeds(getDoc(doc(asTeacher(), `classrooms/${CLASSROOM_ID}/studentComments/comment-1`)));
});

test('studentComments: a non-member authenticated identity can NEVER read a private comment', async () => {
  await seedComment();
  await assertFails(getDoc(doc(asOutsider(), `classrooms/${CLASSROOM_ID}/studentComments/comment-1`)));
});

test('testimonials: a non-member can NEVER read an unpublished testimonial', async () => {
  await seedTestimonial({ published: false });
  await assertFails(getDoc(doc(asOutsider(), `classrooms/${CLASSROOM_ID}/testimonials/testimonial-1`)));
});

test('testimonials: a non-member CAN read a PUBLISHED testimonial (matches existing feedPosts trust model)', async () => {
  await seedTestimonial({ published: true });
  await assertSucceeds(getDoc(doc(asOutsider(), `classrooms/${CLASSROOM_ID}/testimonials/testimonial-1`)));
});

test('testimonials: publishing never grants read access to the underlying private comment', async () => {
  await seedComment();
  await seedTestimonial({ published: true });
  await assertFails(getDoc(doc(asOutsider(), `classrooms/${CLASSROOM_ID}/studentComments/comment-1`)));
});

test('testimonials: update is restricted to flipping published/updatedAt only — text can never be silently rewritten', async () => {
  await seedTestimonial({ published: true });
  await assertFails(
    updateDoc(doc(asTeacher(), `classrooms/${CLASSROOM_ID}/testimonials/testimonial-1`), {
      text: 'Rewritten text, not what the teacher actually published',
    })
  );
  await assertSucceeds(
    updateDoc(doc(asTeacher(), `classrooms/${CLASSROOM_ID}/testimonials/testimonial-1`), {
      published: false,
      updatedAt: '2026-10-23T00:00:00.000Z',
    })
  );
});

test('testimonials: create is rejected if it carries any field beyond the public allowlist', async () => {
  await assertFails(
    setDoc(doc(asTeacher(), `classrooms/${CLASSROOM_ID}/testimonials/testimonial-2`), {
      id: 'testimonial-2',
      classroomId: CLASSROOM_ID,
      studentId: 'student-1',
      sourceCommentId: 'comment-1',
      text: 'Testimonial text',
      workItemLabel: null,
      published: true,
      publishedByUid: TEACHER,
      publishedAt: '2026-10-22T00:00:00.000Z',
      updatedAt: null,
      createdByUid: TEACHER, // not on the allowlist — a private-comment-shaped field leaking in
    })
  );
});

test('studentComments: delete is always rejected (append-only, matches Participation History convention)', async () => {
  await seedComment();
  const { deleteDoc } = await import('firebase/firestore');
  await assertFails(deleteDoc(doc(asTeacher(), `classrooms/${CLASSROOM_ID}/studentComments/comment-1`)));
});
