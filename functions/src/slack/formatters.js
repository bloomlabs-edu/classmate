/**
 * functions/src/slack/formatters.js
 *
 * Turns a WeeklyPlanSubmission status transition into the one Slack
 * message a teacher actually sees — the ONLY place in this feature
 * that decides what text/fields reach Slack. Enforces the content
 * allow-list from
 * docs/architecture/SLACK_IDENTITY_LINKING_COMMITTEE_REVIEW.md §6 by
 * construction: this function's own parameters are the entire allow-
 * list (classroom label, week label, status, a review link) — there is
 * no path for a caller to hand it a raw Lesson/Student/Classroom object
 * it might reach further into.
 *
 * Pure — no Firestore, no Slack API calls — so every message variant is
 * directly unit-testable (tests/functions/slack/formatters.test.js).
 */

const STATUS_COPY = {
  submitted: {
    heading: 'Weekly Plan submitted',
    body: 'Your weekly plan is ready for review.',
    buttonText: 'Review Plan',
    emoji: '📚',
  },
  changes_requested: {
    heading: 'Weekly Plan',
    body: '⚠️ Your plan needs attention.',
    buttonText: 'Review Changes',
    emoji: '📚',
  },
  approved: {
    heading: 'Weekly Plan approved',
    body: '',
    buttonText: 'View Plan',
    emoji: '✅',
  },
};

/** "21–27 Sep" from a Monday `weekStartDate` ("YYYY-MM-DD") — the week is always Monday through Sunday, matching utils/dateHelpers.js's own getMondayStartOfWeek() convention across the rest of this app. */
export function formatWeekLabel(weekStartDate) {
  const start = new Date(`${weekStartDate}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);

  const dayFormatter = new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: 'UTC' });
  const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

  const startDay = dayFormatter.format(start);
  const endDay = dayFormatter.format(end);
  const endMonth = monthFormatter.format(end);

  // Only prefix the start day with its own month if the week actually crosses a month boundary.
  const startMonth = monthFormatter.format(start);
  const startLabel = startMonth === endMonth ? startDay : `${startDay} ${startMonth}`;

  return `${startLabel}–${endDay} ${endMonth}`;
}

/**
 * @param {object} params
 * @param {'submitted'|'changes_requested'|'approved'} params.status
 * @param {string} params.classroomLabel - display name only (e.g. "Grade 8B") — never a raw classroom object
 * @param {string} params.weekStartDate - "YYYY-MM-DD", the Monday of the week
 * @param {string} params.reviewUrl - an existing ClassMate deep link, verified by the caller
 * @returns {{ text: string, blocks: object[] }}
 */
export function buildWeeklyPlanSubmissionMessage({ status, classroomLabel, weekStartDate, reviewUrl }) {
  const copy = STATUS_COPY[status];
  if (!copy) throw new Error(`buildWeeklyPlanSubmissionMessage: unsupported status "${status}".`);

  const weekLabel = formatWeekLabel(weekStartDate);
  const contextLine = `${classroomLabel} · Week of ${weekLabel}`;
  const text = `${copy.emoji} ClassMate — ${copy.heading}\n${contextLine}${copy.body ? `\n${copy.body}` : ''}`;

  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${copy.emoji} *ClassMate — ${copy.heading}*\n${contextLine}${copy.body ? `\n${copy.body}` : ''}` },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: copy.buttonText, emoji: true },
          url: reviewUrl,
        },
      ],
    },
  ];

  return { text, blocks };
}
