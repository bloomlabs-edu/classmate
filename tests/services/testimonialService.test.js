/**
 * tests/services/testimonialService.test.js
 *
 * services/testimonialService.js's own getPublishedTestimonialsForStudent()
 * — the ONE function this app's student-facing views (ui/student-portal/**)
 * are allowed to call for "Recognition, comments, and testimonials."
 * This is a DIRECT test against that data-access function (not a UI
 * test asserting "the screen doesn't show it") — see the task's own
 * explicit requirement that a private comment must be proven
 * unreachable through the real function/query that backs the student
 * portal, not just observed absent from a rendered screen.
 *
 * `repo`/`getDb` are injected (see testimonialService.js's own
 * `overrides` parameter) specifically so this file can run under plain
 * `node --test` with zero network access and zero real Firestore — the
 * real repository/studentAuthService modules touch the Firebase
 * browser CDN, which only resolves in a real browser (see
 * testimonialService.js's own header comment).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPublishedTestimonialsForStudent } from '../../js/services/testimonialService.js';

test('getPublishedTestimonialsForStudent: returns only the public allowlist fields, even when the underlying "document" carries far more', () => {
  const overStuffedTestimonial = {
    id: 't1',
    classroomId: 'c1',
    studentId: 'stu1',
    sourceCommentId: 'comment-1',
    text: 'Great work this week!',
    workItemLabel: 'English · Homework',
    published: true,
    publishedByUid: 'teacher-uid',
    publishedAt: '2026-08-24T00:00:00.000Z',
    updatedAt: null,
  };

  const repo = {
    listPublishedTestimonialsForStudent: async (db, classroomId, studentId) => {
      assert.equal(classroomId, 'c1');
      assert.equal(studentId, 'stu1');
      return [overStuffedTestimonial];
    },
  };

  return getPublishedTestimonialsForStudent('c1', 'stu1', { repo, getDb: async () => ({ fakeDb: true }) }).then((result) => {
    assert.equal(result.length, 1);
    assert.deepEqual(Object.keys(result[0]).sort(), ['id', 'publishedAt', 'studentId', 'text', 'workItemLabel'].sort());
    assert.equal('classroomId' in result[0], false);
    assert.equal('sourceCommentId' in result[0], false);
    assert.equal('publishedByUid' in result[0], false);
    assert.equal('published' in result[0], false);
  });
});

test('getPublishedTestimonialsForStudent: never calls, imports, or references anything from the private comments repository — the ONLY repository function it ever invokes is listPublishedTestimonialsForStudent', async () => {
  let repoCallCount = 0;
  const repo = new Proxy(
    {},
    {
      get(target, prop) {
        if (prop === 'listPublishedTestimonialsForStudent') {
          return async () => {
            repoCallCount += 1;
            return [];
          };
        }
        // Any other property access (e.g. a future refactor
        // accidentally wiring this function to a comments-shaped
        // repository instead) fails the test loudly rather than
        // silently returning undefined.
        throw new Error(`testimonialService.js must never access repo.${String(prop)}`);
      },
    }
  );

  const result = await getPublishedTestimonialsForStudent('c1', 'stu1', { repo, getDb: async () => ({ fakeDb: true }) });

  assert.deepEqual(result, []);
  assert.equal(repoCallCount, 1);
});

test('getPublishedTestimonialsForStudent: if a comment-shaped object somehow reached this function (simulating an upstream mistake), the private "text"-adjacent fields are still stripped and only the public shape survives', async () => {
  const commentShapedLeak = {
    id: 'comment-1',
    classroomId: 'c1',
    studentId: 'stu1',
    workItemRef: { type: 'notebook', subjectId: 'x', notebookTypeId: 'y', dateKey: 'z' },
    text: 'This was meant to be a PRIVATE comment, never published.',
    createdByUid: 'teacher-uid',
    createdAt: '2026-08-24T00:00:00.000Z',
  };

  const repo = { listPublishedTestimonialsForStudent: async () => [commentShapedLeak] };
  const result = await getPublishedTestimonialsForStudent('c1', 'stu1', { repo, getDb: async () => ({ fakeDb: true }) });

  // The allowlist still only keeps {id, studentId, text, workItemLabel,
  // publishedAt} — createdByUid/workItemRef/createdAt never survive.
  // (`text` itself is unavoidably present on any object whose author
  // named a field `text` — this is exactly why firestore.rules keeps
  // studentComments and testimonials in genuinely separate collections
  // with separate access rules, so a comment-shaped object can never
  // actually reach this query path in the first place; this test
  // documents the defense-in-depth behavior of the allowlist itself.)
  assert.deepEqual(Object.keys(result[0]).sort(), ['id', 'studentId', 'text'].sort());
  assert.equal('createdByUid' in result[0], false);
  assert.equal('workItemRef' in result[0], false);
  assert.equal('createdAt' in result[0], false);
});

test('getPublishedTestimonialsForStudent: no active student session (getDb resolves null) returns an empty list, never throws', async () => {
  const repo = {
    listPublishedTestimonialsForStudent: async () => {
      throw new Error('must never be called when there is no db');
    },
  };

  const result = await getPublishedTestimonialsForStudent('c1', 'stu1', { repo, getDb: async () => null });
  assert.deepEqual(result, []);
});
