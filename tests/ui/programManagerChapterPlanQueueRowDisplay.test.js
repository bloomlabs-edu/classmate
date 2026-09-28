import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getChapterPlanQueueRowDisplay } from '../../js/ui/views/ProgramManagerChapterPlanQueueRowDisplay.js';

function entry(overrides = {}) {
  return {
    chapterPlanId: 'plan-1',
    classroomId: 'classroom-a',
    createdByUid: 'fellow-1',
    teacherDisplayName: 'Anu',
    subjectId: 'science',
    chapterName: 'Plant Kingdom',
    gradeLabel: 'Grade 8A',
    termId: 'Term 1',
    status: 'submitted',
    submissionLabel: 'Submitted',
    updatedAt: '2026-09-28T00:00:00.000Z',
    ...overrides,
  };
}

function classroom(overrides = {}) {
  return { id: 'classroom-a', name: 'Grade 8A - Science', ...overrides };
}

test('a queue row shows author, classroom, subject, grade, term, chapter, status — all from the index entry, no canonical fetch needed', () => {
  const display = getChapterPlanQueueRowDisplay(entry(), classroom());
  assert.equal(display.authorName, 'Anu');
  assert.equal(display.chapterName, 'Plant Kingdom');
  assert.equal(display.statusLabel, 'Submitted');
  assert.equal(display.meta, 'Grade 8A - Science · Science · Grade 8A · Term 1');
  assert.ok(display.submittedDateLabel);
});

test('a resubmitted entry shows "Resubmitted" via submissionLabel, never a second status model', () => {
  const display = getChapterPlanQueueRowDisplay(entry({ submissionLabel: 'Resubmitted' }), classroom());
  assert.equal(display.statusLabel, 'Resubmitted');
});

test('missing classroom (not yet loaded) falls back to a clear placeholder, never throws', () => {
  const display = getChapterPlanQueueRowDisplay(entry(), null);
  assert.ok(display.meta.startsWith('A classroom'));
});

test('missing teacherDisplayName falls back to a clear placeholder', () => {
  const display = getChapterPlanQueueRowDisplay(entry({ teacherDisplayName: null }), classroom());
  assert.equal(display.authorName, 'A teacher');
});

test('meta line omits grade/term when absent, never shows an empty segment', () => {
  const display = getChapterPlanQueueRowDisplay(entry({ gradeLabel: null, termId: null }), classroom());
  assert.equal(display.meta, 'Grade 8A - Science · Science');
});

test('an untitled chapter falls back to a clear placeholder', () => {
  const display = getChapterPlanQueueRowDisplay(entry({ chapterName: '' }), classroom());
  assert.equal(display.chapterName, 'Untitled Chapter Plan');
});
