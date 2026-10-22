/**
 * tests/services/testimonialBuilder.test.js
 *
 * services/testimonialBuilder.js — the pure, Firestore-free logic
 * shared by the teacher-facing publish action (commentService.js) and
 * the student-facing reader (testimonialService.js). Both of this
 * file's exports are directly unit-testable with no mocking since
 * neither imports anything Firestore-related.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestimonialFromComment, selectPublicTestimonialFields, PUBLIC_TESTIMONIAL_FIELDS } from '../../js/services/testimonialBuilder.js';

function sampleComment(overrides = {}) {
  return {
    id: 'comment-1',
    classroomId: 'c1',
    studentId: 'stu1',
    workItemRef: { type: 'notebook', subjectId: 'subj-eng', notebookTypeId: 'type-hw', dateKey: '2026-08-24' },
    text: 'Worked very carefully today.',
    createdByUid: 'teacher-uid-should-never-appear-on-a-testimonial',
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedByUid: null,
    updatedAt: null,
    ...overrides,
  };
}

test('buildTestimonialFromComment: copies text/studentId and stamps publish metadata', () => {
  const testimonial = buildTestimonialFromComment(sampleComment(), { actingUid: 'teacher-1', workItemLabel: 'English · Homework · 24 Aug' });

  assert.equal(testimonial.text, 'Worked very carefully today.');
  assert.equal(testimonial.studentId, 'stu1');
  assert.equal(testimonial.classroomId, 'c1');
  assert.equal(testimonial.sourceCommentId, 'comment-1');
  assert.equal(testimonial.workItemLabel, 'English · Homework · 24 Aug');
  assert.equal(testimonial.published, true);
  assert.equal(testimonial.publishedByUid, 'teacher-1');
});

test('buildTestimonialFromComment: never carries forward the comment\'s own internal fields (createdByUid, workItemRef, updatedByUid) — it does not spread the comment object', () => {
  const testimonial = buildTestimonialFromComment(sampleComment(), { actingUid: 'teacher-1' });

  assert.equal('createdByUid' in testimonial, false);
  assert.equal('workItemRef' in testimonial, false);
  assert.equal('updatedByUid' in testimonial, false);
  assert.equal('createdAt' in testimonial, false);
});

test('buildTestimonialFromComment: even if the source comment is maliciously/accidentally over-stuffed with extra private fields, none of them reach the testimonial', () => {
  const poisoned = sampleComment({
    contactPhoneNumber: '9999999999', // the exact category this app must never store/propagate
    privateInternalNote: 'this must never reach a student',
  });

  const testimonial = buildTestimonialFromComment(poisoned, { actingUid: 'teacher-1' });

  assert.equal('contactPhoneNumber' in testimonial, false);
  assert.equal('privateInternalNote' in testimonial, false);
});

test('selectPublicTestimonialFields: keeps only the public allowlist', () => {
  const raw = {
    id: 't1',
    classroomId: 'c1',
    studentId: 'stu1',
    sourceCommentId: 'comment-1',
    text: 'Great work!',
    workItemLabel: 'English · Homework',
    published: true,
    publishedByUid: 'teacher-1',
    publishedAt: '2026-08-24T00:00:00.000Z',
    updatedAt: null,
  };

  const safe = selectPublicTestimonialFields(raw);

  assert.deepEqual(Object.keys(safe).sort(), ['id', 'publishedAt', 'studentId', 'text', 'workItemLabel'].sort());
  assert.equal(safe.text, 'Great work!');
  assert.equal('classroomId' in safe, false);
  assert.equal('sourceCommentId' in safe, false);
  assert.equal('publishedByUid' in safe, false);
  assert.equal('published' in safe, false);
});

test('selectPublicTestimonialFields: strips any unexpected/extra field, even one that looks like private comment data', () => {
  const raw = {
    id: 't1',
    studentId: 'stu1',
    text: 'Great work!',
    workItemLabel: null,
    publishedAt: '2026-08-24T00:00:00.000Z',
    // Simulates a hypothetical future bug upstream that accidentally
    // merged a private comment's own fields onto a testimonial-shaped
    // object before it reached this function.
    privateCommentText: 'this is the private note and must never be shown to a student',
    createdByUid: 'teacher-uid',
  };

  const safe = selectPublicTestimonialFields(raw);

  assert.equal('privateCommentText' in safe, false);
  assert.equal('createdByUid' in safe, false);
  assert.deepEqual(Object.keys(safe).sort(), PUBLIC_TESTIMONIAL_FIELDS.filter((key) => key in raw).sort());
});
