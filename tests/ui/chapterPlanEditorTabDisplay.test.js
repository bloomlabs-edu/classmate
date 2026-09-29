import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInitialChapterPlanTab, CHAPTER_PLAN_EDITOR_TABS } from '../../js/ui/views/ChapterPlanEditorTabDisplay.js';

test('resolveInitialChapterPlanTab: "weeks" resolves to the Weeks tab', () => {
  assert.equal(resolveInitialChapterPlanTab('weeks'), CHAPTER_PLAN_EDITOR_TABS.WEEKS);
});

test('resolveInitialChapterPlanTab: "lessons" resolves to the Lessons tab', () => {
  assert.equal(resolveInitialChapterPlanTab('lessons'), CHAPTER_PLAN_EDITOR_TABS.LESSONS);
});

test('resolveInitialChapterPlanTab: no tab param (undefined) defaults to Chapter — the existing default must not regress', () => {
  assert.equal(resolveInitialChapterPlanTab(undefined), CHAPTER_PLAN_EDITOR_TABS.CHAPTER);
});

test('resolveInitialChapterPlanTab: an empty string or an unrecognized value both default to Chapter', () => {
  assert.equal(resolveInitialChapterPlanTab(''), CHAPTER_PLAN_EDITOR_TABS.CHAPTER);
  assert.equal(resolveInitialChapterPlanTab('lesson-plans'), CHAPTER_PLAN_EDITOR_TABS.CHAPTER);
  assert.equal(resolveInitialChapterPlanTab('chapter'), CHAPTER_PLAN_EDITOR_TABS.CHAPTER);
});
