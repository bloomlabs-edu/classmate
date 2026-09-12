/**
 * tests/services/weeklyPlanReviewIndexService.test.js
 *
 * services/weeklyPlanReviewIndexService.js's pure logic — the thin,
 * reference-only cross-classroom discovery index Programme Manager
 * Weekly Plan Review reads from
 * (ui/views/ProgramManagerWeeklyPlansView.js). Firestore-free by
 * design, same "stays directly unit-testable" convention this file's
 * own header comment documents.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLessonPlan, LESSON_PLAN_STATUS, createLessonPlanReviewRound } from '../../js/models/LessonPlan.js';
import { buildReviewIndexEntry, filterEntriesNeedingReview, sortReviewIndexEntries } from '../../js/services/weeklyPlanReviewIndexService.js';

function classroomFixture(overrides = {}) {
  return {
    id: 'classroom-1',
    name: 'Bloom Force 19',
    members: {
      'teacher-1': { role: 'teacher', displayName: 'Rejeesh Mohan' },
      'pm-1': { role: 'program_manager', displayName: 'A Programme Manager' },
    },
    ...overrides,
  };
}

test('buildReviewIndexEntry() contains only reference/discovery fields — never activities, objectives, comments, or reviewHistory', () => {
  const plan = createLessonPlan({
    id: 'plan-1',
    classroomId: 'classroom-1',
    createdByUid: 'teacher-1',
    subjectId: 'subject-1',
    scheduledDate: '2026-09-08',
    status: LESSON_PLAN_STATUS.SUBMITTED,
    activities: [{ id: 'a1', title: 'Should never appear in the index', teacherAction: 'x', studentAction: 'y', differentiation: null }],
    bigQuestion: 'Should never appear in the index either',
    reviewHistory: [createLessonPlanReviewRound({ status: 'submitted', byUid: 'teacher-1' })],
  });

  const entry = buildReviewIndexEntry(classroomFixture(), plan);

  assert.deepEqual(Object.keys(entry).sort(), [
    'classroomId',
    'createdByUid',
    'lessonPlanId',
    'scheduledDate',
    'status',
    'submissionLabel',
    'subjectId',
    'teacherDisplayName',
    'updatedAt',
  ].sort());
  assert.equal(entry.lessonPlanId, 'plan-1');
  assert.equal(entry.classroomId, 'classroom-1');
  assert.equal(entry.createdByUid, 'teacher-1');
  assert.equal(entry.teacherDisplayName, 'Rejeesh Mohan');
  assert.equal(entry.subjectId, 'subject-1');
  assert.equal(entry.scheduledDate, '2026-09-08');
  assert.equal(entry.status, 'submitted');
});

test('buildReviewIndexEntry() submissionLabel is "Submitted" for a first-ever submission', () => {
  const plan = createLessonPlan({
    classroomId: 'classroom-1',
    createdByUid: 'teacher-1',
    status: LESSON_PLAN_STATUS.SUBMITTED,
    reviewHistory: [createLessonPlanReviewRound({ status: 'submitted', byUid: 'teacher-1' })],
  });
  assert.equal(buildReviewIndexEntry(classroomFixture(), plan).submissionLabel, 'Submitted');
});

test('buildReviewIndexEntry() submissionLabel is "Resubmitted" once a prior round asked for changes', () => {
  const plan = createLessonPlan({
    classroomId: 'classroom-1',
    createdByUid: 'teacher-1',
    status: LESSON_PLAN_STATUS.SUBMITTED,
    reviewHistory: [
      createLessonPlanReviewRound({ status: 'submitted', byUid: 'teacher-1' }),
      createLessonPlanReviewRound({ status: 'changes_requested', byUid: 'pm-1', comments: [{ id: 'c1', sectionKey: 'spark', text: 'x' }] }),
      createLessonPlanReviewRound({ status: 'submitted', byUid: 'teacher-1' }),
    ],
  });
  assert.equal(buildReviewIndexEntry(classroomFixture(), plan).submissionLabel, 'Resubmitted');
});

test('buildReviewIndexEntry() falls back to "A teacher" when the author has no display name on this classroom', () => {
  const plan = createLessonPlan({ classroomId: 'classroom-1', createdByUid: 'unknown-uid', status: LESSON_PLAN_STATUS.DRAFT });
  assert.equal(buildReviewIndexEntry(classroomFixture(), plan).teacherDisplayName, 'A teacher');
});

test('filterEntriesNeedingReview() keeps only SUBMITTED entries — DRAFT/CHANGES_REQUESTED/APPROVED are never a Program Manager work item', () => {
  const entries = [
    { lessonPlanId: 'p1', status: 'draft' },
    { lessonPlanId: 'p2', status: 'submitted' },
    { lessonPlanId: 'p3', status: 'changes_requested' },
    { lessonPlanId: 'p4', status: 'approved' },
    { lessonPlanId: 'p5', status: 'submitted' },
  ];
  assert.deepEqual(
    filterEntriesNeedingReview(entries).map((entry) => entry.lessonPlanId),
    ['p2', 'p5']
  );
});

test('sortReviewIndexEntries() orders newest-updated first, matching LessonPlanReviewQueueView.js\'s own existing ordering', () => {
  const entries = [
    { lessonPlanId: 'older', updatedAt: '2026-09-01T00:00:00.000Z' },
    { lessonPlanId: 'newest', updatedAt: '2026-09-10T00:00:00.000Z' },
    { lessonPlanId: 'middle', updatedAt: '2026-09-05T00:00:00.000Z' },
  ];
  assert.deepEqual(
    sortReviewIndexEntries(entries).map((entry) => entry.lessonPlanId),
    ['newest', 'middle', 'older']
  );
});

test('sortReviewIndexEntries() does not mutate the array it was given', () => {
  const entries = [
    { lessonPlanId: 'a', updatedAt: '2026-09-01T00:00:00.000Z' },
    { lessonPlanId: 'b', updatedAt: '2026-09-10T00:00:00.000Z' },
  ];
  const original = [...entries];
  sortReviewIndexEntries(entries);
  assert.deepEqual(entries, original);
});
