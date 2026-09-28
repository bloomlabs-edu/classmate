import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChapterPlan, CHAPTER_PLAN_STATUS } from '../../js/models/ChapterPlan.js';
import { getChapterPlanRowDisplay } from '../../js/ui/views/ChapterPlanRowDisplay.js';

function plan(overrides = {}) {
  return createChapterPlan({ classroomId: 'c1', teacherUid: 'u1', chapterName: 'Plant Kingdom', gradeLabel: 'Grade 8A', subjectId: 'science', ...overrides });
}

test('a draft plan shows Draft', () => {
  const display = getChapterPlanRowDisplay(plan());
  assert.equal(display.title, 'Plant Kingdom');
  assert.equal(display.statusLabel, 'Draft');
});

test('status displays correctly for every lifecycle status', () => {
  assert.equal(getChapterPlanRowDisplay(plan({ status: CHAPTER_PLAN_STATUS.SUBMITTED })).statusLabel, 'Submitted');
  assert.equal(getChapterPlanRowDisplay(plan({ status: CHAPTER_PLAN_STATUS.CHANGES_REQUESTED })).statusLabel, 'Changes requested');
  assert.equal(getChapterPlanRowDisplay(plan({ status: CHAPTER_PLAN_STATUS.APPROVED })).statusLabel, 'Approved');
});

test('meta line composes subject label, grade, and term, skipping any that are absent', () => {
  const withTerm = getChapterPlanRowDisplay(plan({ termId: 'Term 1' }));
  assert.equal(withTerm.meta, 'Science · Grade 8A · Term 1');

  const withoutTerm = getChapterPlanRowDisplay(plan());
  assert.equal(withoutTerm.meta, 'Science · Grade 8A');
});

test('an untitled plan falls back to a clear placeholder title', () => {
  const display = getChapterPlanRowDisplay(plan({ chapterName: '' }));
  assert.equal(display.title, 'Untitled Chapter Plan');
});

test('subject label comes from chapterPlanTemplateConfig, e.g. mathematics -> "Mathematics"', () => {
  const display = getChapterPlanRowDisplay(plan({ subjectId: 'mathematics' }));
  assert.ok(display.meta.startsWith('Mathematics'));
});
