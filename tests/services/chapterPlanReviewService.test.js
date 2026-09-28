import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTER_PLAN_STATUS } from '../../js/models/ChapterPlan.js';
import * as chapterPlanService from '../../js/services/chapterPlanService.js';
import * as chapterPlanReviewService from '../../js/services/chapterPlanReviewService.js';

const FELLOW = 'fellow-1';
const PM = 'pm-1';
const OUTSIDER = 'outsider-1';

function classroomWith(...members) {
  const memberMap = {};
  members.forEach(({ uid, role }) => {
    memberMap[uid] = { role, displayName: uid };
  });
  return { id: 'classroom-a', members: memberMap };
}

function draft() {
  return chapterPlanService.createChapterPlanDraft({
    actingUid: FELLOW,
    classroomId: 'classroom-a',
    teacherUid: FELLOW,
    gradeLabel: 'Grade 8A',
    subjectId: 'science',
    curriculumUnitId: 'unit-local-17',
    linkedCurriculumUnitId: 'curriculum-index-unit-17',
    chapterName: 'Plant Kingdom',
  });
}

function classroom() {
  return classroomWith({ uid: FELLOW, role: 'teacher' }, { uid: PM, role: 'program_manager' }, { uid: OUTSIDER, role: 'viewer' });
}

// ---------------------------------------------------------------------
// isChapterPlanEditable
// ---------------------------------------------------------------------

test('isChapterPlanEditable: true for draft and changes_requested, false for submitted and approved', () => {
  const plan = draft();
  assert.equal(chapterPlanReviewService.isChapterPlanEditable(plan), true);

  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  assert.equal(chapterPlanReviewService.isChapterPlanEditable(plan), false);

  chapterPlanReviewService.requestChapterPlanChanges(classroom(), plan, { byUid: PM, comments: [{ sectionKey: 'purpose', text: 'more detail please' }] });
  assert.equal(chapterPlanReviewService.isChapterPlanEditable(plan), true);

  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  chapterPlanReviewService.approveChapterPlan(classroom(), plan, { byUid: PM });
  assert.equal(chapterPlanReviewService.isChapterPlanEditable(plan), false);
});

// ---------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------

test('submitChapterPlan: DRAFT -> SUBMITTED, appends exactly one review-history round', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  assert.equal(plan.status, CHAPTER_PLAN_STATUS.SUBMITTED);
  assert.equal(plan.reviewHistory.length, 1);
  assert.equal(plan.reviewHistory[0].status, CHAPTER_PLAN_STATUS.SUBMITTED);
  assert.equal(plan.reviewHistory[0].byUid, FELLOW);
});

test('submitChapterPlan does not require any content field to be filled in — never gated on completeness', () => {
  const plan = draft();
  assert.doesNotThrow(() => chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW }));
  assert.equal(plan.status, CHAPTER_PLAN_STATUS.SUBMITTED);
});

test('submitChapterPlan rejects an invalid starting status (e.g. already SUBMITTED, or APPROVED)', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  assert.throws(() => chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW }), /Cannot submit for review/);
});

test('requestChapterPlanChanges: SUBMITTED -> CHANGES_REQUESTED, requires at least one comment', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  assert.throws(() => chapterPlanReviewService.requestChapterPlanChanges(classroom(), plan, { byUid: PM, comments: [] }), /at least one comment/);

  chapterPlanReviewService.requestChapterPlanChanges(classroom(), plan, { byUid: PM, comments: [{ sectionKey: 'purpose', text: 'Add essential questions.' }] });
  assert.equal(plan.status, CHAPTER_PLAN_STATUS.CHANGES_REQUESTED);
  assert.equal(plan.reviewerUid, PM);
  assert.equal(plan.activeComments.length, 1);
  assert.equal(plan.activeComments[0].text, 'Add essential questions.');
});

test('resubmission (CHANGES_REQUESTED -> SUBMITTED) closes the prior round\'s open comments and clears activeComments', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  chapterPlanReviewService.requestChapterPlanChanges(classroom(), plan, { byUid: PM, comments: [{ sectionKey: 'purpose', text: 'Add essential questions.' }] });
  assert.equal(plan.activeComments.length, 1);
  assert.equal(plan.activeComments[0].resolvedAt, null);

  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  assert.equal(plan.status, CHAPTER_PLAN_STATUS.SUBMITTED);
  assert.equal(plan.activeComments.length, 0);
  // The round-1 history entry's own comment is a frozen COPY made at
  // creation time (before closeCurrentRound ever runs) — it never
  // reflects the later resolvedAt stamp applied to the separate
  // activeComments array object, by design (see
  // models/ChapterPlan.js's own append-only reviewHistory doc comment).
  assert.equal(plan.reviewHistory[1].comments[0].resolvedAt, null);
  assert.equal(plan.reviewHistory.length, 3);
});

test('approveChapterPlan: SUBMITTED -> APPROVED', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  chapterPlanReviewService.approveChapterPlan(classroom(), plan, { byUid: PM });
  assert.equal(plan.status, CHAPTER_PLAN_STATUS.APPROVED);
  assert.equal(plan.reviewerUid, PM);
  assert.equal(plan.activeComments.length, 0);
});

test('review history is append-only — every transition adds exactly one round, never rewrites a prior one', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  chapterPlanReviewService.requestChapterPlanChanges(classroom(), plan, { byUid: PM, comments: [{ sectionKey: 'purpose', text: 'round 1 feedback' }] });
  const round1Snapshot = { ...plan.reviewHistory[1] };
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  chapterPlanReviewService.approveChapterPlan(classroom(), plan, { byUid: PM });

  assert.equal(plan.reviewHistory.length, 4);
  assert.deepEqual(plan.reviewHistory[1], round1Snapshot);
});

// ---------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------

test('the author cannot approve their own Chapter Plan', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  assert.throws(() => chapterPlanReviewService.approveChapterPlan(classroom(), plan, { byUid: FELLOW }), /Not authorized to approve/);
});

test('the author cannot request changes on their own Chapter Plan', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  assert.throws(
    () => chapterPlanReviewService.requestChapterPlanChanges(classroom(), plan, { byUid: FELLOW, comments: [{ sectionKey: 'purpose', text: 'x' }] }),
    /Not authorized to request changes on/
  );
});

test('a classroom member without REVIEW_CHAPTER_PLAN/APPROVE_CHAPTER_PLAN (a viewer) cannot review or approve', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  assert.throws(() => chapterPlanReviewService.approveChapterPlan(classroom(), plan, { byUid: OUTSIDER }));
  assert.throws(() => chapterPlanReviewService.requestChapterPlanChanges(classroom(), plan, { byUid: OUTSIDER, comments: [{ sectionKey: 'purpose', text: 'x' }] }));
});

test('canReviewChapterPlan/canApproveChapterPlan reflect the same authorization the throwing paths enforce', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  assert.equal(chapterPlanReviewService.canReviewChapterPlan(classroom(), plan, PM), true);
  assert.equal(chapterPlanReviewService.canApproveChapterPlan(classroom(), plan, PM), true);
  assert.equal(chapterPlanReviewService.canReviewChapterPlan(classroom(), plan, FELLOW), false);
  assert.equal(chapterPlanReviewService.canReviewChapterPlan(classroom(), plan, OUTSIDER), false);
});

// ---------------------------------------------------------------------
// Reviewer cannot mutate content through the review service
// ---------------------------------------------------------------------

test('requestChapterPlanChanges/approveChapterPlan never touch purpose/mastery/methods/subjectSpecific/resourceLinks — only status/reviewerUid/reviewHistory/activeComments/updatedAt', () => {
  const plan = draft();
  chapterPlanService.updatePurpose(plan, { whatsWorthLearning: 'original content' });
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  chapterPlanReviewService.requestChapterPlanChanges(classroom(), plan, { byUid: PM, comments: [{ sectionKey: 'purpose', text: 'x' }] });
  assert.equal(plan.purpose.whatsWorthLearning, 'original content');

  // resubmit then approve
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  chapterPlanReviewService.approveChapterPlan(classroom(), plan, { byUid: PM });
  assert.equal(plan.purpose.whatsWorthLearning, 'original content');
});

// ---------------------------------------------------------------------
// getSubmissionLabel / queue helpers
// ---------------------------------------------------------------------

test('getSubmissionLabel: "Submitted" for a first submission, "Resubmitted" after a changes_requested round', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  assert.equal(chapterPlanReviewService.getSubmissionLabel(plan), 'Submitted');

  chapterPlanReviewService.requestChapterPlanChanges(classroom(), plan, { byUid: PM, comments: [{ sectionKey: 'purpose', text: 'x' }] });
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  assert.equal(chapterPlanReviewService.getSubmissionLabel(plan), 'Resubmitted');
});

test('getReviewableChapterPlans: only SUBMITTED plans, excluding the reviewer\'s own', () => {
  const submittedOthers = draft();
  chapterPlanReviewService.submitChapterPlan(submittedOthers, { byUid: FELLOW });

  const draftPlan = chapterPlanService.createChapterPlanDraft({
    actingUid: PM,
    classroomId: 'classroom-a',
    teacherUid: PM,
    gradeLabel: 'Grade 8A',
    subjectId: 'mathematics',
    curriculumUnitId: 'unit-local-2',
    chapterName: 'Algebra',
  });
  chapterPlanReviewService.submitChapterPlan(draftPlan, { byUid: PM });

  const all = [submittedOthers, draftPlan];
  const reviewable = chapterPlanReviewService.getReviewableChapterPlans(all, PM);
  assert.deepEqual(reviewable, [submittedOthers]);
});

test('getChapterPlanForReview: finds a plan by id from an already-fetched list, or null', () => {
  const plan = draft();
  assert.equal(chapterPlanReviewService.getChapterPlanForReview([plan], plan.id), plan);
  assert.equal(chapterPlanReviewService.getChapterPlanForReview([plan], 'no-such-id'), null);
});
