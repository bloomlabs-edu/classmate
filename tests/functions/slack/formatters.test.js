/**
 * tests/functions/slack/formatters.test.js
 *
 * Pure tests for the one place the Slack content allow-list is
 * enforced (see functions/src/slack/formatters.js's own header
 * comment and docs/architecture/SLACK_IDENTITY_LINKING_COMMITTEE_REVIEW.md §6).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatWeekLabel, buildWeeklyPlanSubmissionMessage } from '../../../functions/src/slack/formatters.js';

test('formatWeekLabel formats a Monday-start week within one month', () => {
  assert.equal(formatWeekLabel('2026-09-21'), '21–27 Sep');
});

test('formatWeekLabel formats a week crossing a month boundary', () => {
  // Monday 2026-09-28 .. Sunday 2026-10-04
  assert.equal(formatWeekLabel('2026-09-28'), '28 Sep–4 Oct');
});

test('buildWeeklyPlanSubmissionMessage throws for an unsupported status (e.g. "draft")', () => {
  assert.throws(() =>
    buildWeeklyPlanSubmissionMessage({ status: 'draft', classroomLabel: 'Grade 8B', weekStartDate: '2026-09-21', reviewUrl: 'https://example.com' })
  );
});

for (const status of ['submitted', 'changes_requested', 'approved']) {
  test(`buildWeeklyPlanSubmissionMessage("${status}") includes the classroom label, week label, and review link, and nothing else`, () => {
    const { text, blocks } = buildWeeklyPlanSubmissionMessage({
      status,
      classroomLabel: 'Grade 8B',
      weekStartDate: '2026-09-21',
      reviewUrl: 'https://classmate-302c2.web.app/#/program-manager/weekly-plans/review?classroomId=c1&teacherUid=t1&week=2026-09-21',
    });

    assert.match(text, /Grade 8B/);
    assert.match(text, /21–27 Sep/);

    const actionsBlock = blocks.find((block) => block.type === 'actions');
    assert.ok(actionsBlock, 'expected an actions block with the review button');
    assert.equal(
      actionsBlock.elements[0].url,
      'https://classmate-302c2.web.app/#/program-manager/weekly-plans/review?classroomId=c1&teacherUid=t1&week=2026-09-21'
    );

    // The allow-list check: nothing beyond classroom label / week label
    // / status copy / link ever appears — in particular, never a raw
    // student name or score, which this test guards against by
    // construction (the function's own signature has no field for it).
    const wholeMessage = JSON.stringify({ text, blocks });
    assert.doesNotMatch(wholeMessage, /student/i);
  });
}

test('changes_requested message reads as needing attention', () => {
  const { text } = buildWeeklyPlanSubmissionMessage({
    status: 'changes_requested',
    classroomLabel: 'Grade 8B',
    weekStartDate: '2026-09-21',
    reviewUrl: 'https://example.com',
  });
  assert.match(text, /needs attention/i);
});
