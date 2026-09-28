import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as chapterPlanService from '../../js/services/chapterPlanService.js';
import * as chapterPlanReviewService from '../../js/services/chapterPlanReviewService.js';
import * as chapterPlanReviewIndexService from '../../js/services/chapterPlanReviewIndexService.js';

const FELLOW = 'fellow-1';
const PM = 'pm-1';

function classroom() {
  return {
    id: 'classroom-a',
    members: {
      [FELLOW]: { role: 'teacher', displayName: 'Fellow A' },
      [PM]: { role: 'program_manager', displayName: 'PM A' },
    },
  };
}

function draft() {
  return chapterPlanService.createChapterPlanDraft({
    actingUid: FELLOW,
    classroomId: 'classroom-a',
    teacherUid: FELLOW,
    gradeLabel: 'Grade 8A',
    subjectId: 'science',
    curriculumUnitId: 'unit-local-17',
    chapterName: 'Plant Kingdom',
  });
}

// ---------------------------------------------------------------------
// buildChapterPlanReviewIndexEntry — reference-only, never a copy
// ---------------------------------------------------------------------

test('buildChapterPlanReviewIndexEntry: reference-only fields, no plan content anywhere in the entry', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });

  const entry = chapterPlanReviewIndexService.buildChapterPlanReviewIndexEntry(classroom(), plan);
  assert.deepEqual(entry, {
    chapterPlanId: plan.id,
    classroomId: 'classroom-a',
    createdByUid: FELLOW,
    teacherDisplayName: 'Fellow A',
    subjectId: 'science',
    chapterName: 'Plant Kingdom',
    gradeLabel: 'Grade 8A',
    termId: null,
    status: 'submitted',
    submissionLabel: 'Submitted',
    updatedAt: plan.updatedAt,
  });
  assert.equal(entry.purpose, undefined);
  assert.equal(entry.reviewHistory, undefined);
  assert.equal(entry.activeComments, undefined);
  assert.equal(entry.resourceLinks, undefined);
});

test('buildChapterPlanReviewIndexEntry: submissionLabel is "Resubmitted" once a changes_requested round exists, reusing chapterPlanReviewService\'s own getSubmissionLabel', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  chapterPlanReviewService.requestChapterPlanChanges(classroom(), plan, { byUid: PM, comments: [{ sectionKey: 'purpose', text: 'x' }] });
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });

  const entry = chapterPlanReviewIndexService.buildChapterPlanReviewIndexEntry(classroom(), plan);
  assert.equal(entry.submissionLabel, 'Resubmitted');
});

// ---------------------------------------------------------------------
// Index state across the full workflow — submission / changes
// requested / resubmission / approval
// ---------------------------------------------------------------------

test('submission creates an index-appropriate SUBMITTED entry', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  const entry = chapterPlanReviewIndexService.buildChapterPlanReviewIndexEntry(classroom(), plan);
  assert.equal(entry.status, 'submitted');
  assert.deepEqual(chapterPlanReviewIndexService.filterChapterPlanEntriesNeedingReview([entry]), [entry]);
});

test('requestChapterPlanChanges updates the index-appropriate entry to CHANGES_REQUESTED, no longer "needing review"', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  chapterPlanReviewService.requestChapterPlanChanges(classroom(), plan, { byUid: PM, comments: [{ sectionKey: 'purpose', text: 'x' }] });
  const entry = chapterPlanReviewIndexService.buildChapterPlanReviewIndexEntry(classroom(), plan);
  assert.equal(entry.status, 'changes_requested');
  assert.deepEqual(chapterPlanReviewIndexService.filterChapterPlanEntriesNeedingReview([entry]), []);
});

test('resubmission updates the index-appropriate entry back to SUBMITTED, "Resubmitted" label', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  chapterPlanReviewService.requestChapterPlanChanges(classroom(), plan, { byUid: PM, comments: [{ sectionKey: 'purpose', text: 'x' }] });
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  const entry = chapterPlanReviewIndexService.buildChapterPlanReviewIndexEntry(classroom(), plan);
  assert.equal(entry.status, 'submitted');
  assert.equal(entry.submissionLabel, 'Resubmitted');
  assert.deepEqual(chapterPlanReviewIndexService.filterChapterPlanEntriesNeedingReview([entry]), [entry]);
});

test('approval updates (never deletes) the index-appropriate entry — an APPROVED plan simply drops out of "needing review", it is not removed', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  chapterPlanReviewService.approveChapterPlan(classroom(), plan, { byUid: PM });
  const entry = chapterPlanReviewIndexService.buildChapterPlanReviewIndexEntry(classroom(), plan);
  assert.equal(entry.status, 'approved');
  assert.deepEqual(chapterPlanReviewIndexService.filterChapterPlanEntriesNeedingReview([entry]), []);
  // The entry itself is still a real, buildable, well-formed object — "updated in place", never a null/removed marker.
  assert.equal(entry.chapterPlanId, plan.id);
});

test('the canonical ChapterPlan remains authoritative: nothing about the index entry\'s own shape can express plan content, so a caller MUST go back to the real plan for anything beyond the queue row', () => {
  const plan = draft();
  chapterPlanService.updatePurpose(plan, { whatsWorthLearning: 'Real content only lives on the plan.' });
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  const entry = chapterPlanReviewIndexService.buildChapterPlanReviewIndexEntry(classroom(), plan);
  assert.equal(JSON.stringify(entry).includes('Real content only lives on the plan.'), false);
});

// ---------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------

test('sortChapterPlanReviewIndexEntries: newest-updated first', () => {
  const older = { chapterPlanId: 'a', updatedAt: '2026-09-01T00:00:00.000Z' };
  const newer = { chapterPlanId: 'b', updatedAt: '2026-09-20T00:00:00.000Z' };
  assert.deepEqual(chapterPlanReviewIndexService.sortChapterPlanReviewIndexEntries([older, newer]), [newer, older]);
});

// ---------------------------------------------------------------------
// Staleness / absence tolerance — the index is a discovery aid only
// ---------------------------------------------------------------------

test('isChapterPlanReviewIndexEntryStale: a missing entry (null/undefined) is always treated as stale', () => {
  const plan = draft();
  assert.equal(chapterPlanReviewIndexService.isChapterPlanReviewIndexEntryStale(null, plan), true);
  assert.equal(chapterPlanReviewIndexService.isChapterPlanReviewIndexEntryStale(undefined, plan), true);
});

test('isChapterPlanReviewIndexEntryStale: a fresh, faithful entry is not stale', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  const entry = chapterPlanReviewIndexService.buildChapterPlanReviewIndexEntry(classroom(), plan);
  assert.equal(chapterPlanReviewIndexService.isChapterPlanReviewIndexEntryStale(entry, plan), false);
});

test('isChapterPlanReviewIndexEntryStale: an entry whose status disagrees with the real plan\'s current status is stale', () => {
  const plan = draft();
  chapterPlanReviewService.submitChapterPlan(plan, { byUid: FELLOW });
  const staleEntry = chapterPlanReviewIndexService.buildChapterPlanReviewIndexEntry(classroom(), plan);
  chapterPlanReviewService.approveChapterPlan(classroom(), plan, { byUid: PM }); // real plan moves on; staleEntry is now behind
  assert.equal(chapterPlanReviewIndexService.isChapterPlanReviewIndexEntryStale(staleEntry, plan), true);
});
