/**
 * functions/src/slack/weeklyPlanTransition.js
 *
 * Pure decision logic for functions/src/slack/onWeeklyPlanSubmissionWrite.js:
 * given a WeeklyPlanSubmission document's state before and after one
 * Firestore write, decide whether a Slack DM is warranted and, if so,
 * which one.
 *
 * `NOTIFIABLE_STATUSES` intentionally duplicates the three (of four)
 * values in models/WeeklyPlanSubmission.js's own
 * WEEKLY_PLAN_SUBMISSION_STATUS as plain strings, rather than
 * importing that module directly. functions/ is deployed as its own,
 * separate package (see functions/package.json) — everything it
 * imports today stays within functions/ itself (the one existing
 * exception, functions/src/verifyLearnerConnectionEndpoint.js reaching
 * into ../../server/, is explicitly called out in that file's own
 * header comment as belonging to a feature that has never actually been
 * deployed, i.e. this repo has not yet solved cross-directory bundling
 * for a real deploy). Keeping this Slack feature self-contained under
 * functions/src/slack/ avoids depending on that unresolved question.
 * If the source enum's string values ever change, this file's own test
 * (tests/functions/slack/weeklyPlanTransition.test.js) is what would
 * need updating alongside it.
 *
 * DRAFT is deliberately excluded — WeeklyPlanSubmission's DRAFT state
 * is not "ready for anyone's attention" (see that model's own header
 * comment), so it never produces a Slack message.
 */

const NOTIFIABLE_STATUSES = new Set(['submitted', 'changes_requested', 'approved']);

/**
 * @param {object|null} before - the document's data before this write (`null` if the write created it)
 * @param {object|null} after - the document's data after this write (`null` if the write deleted it)
 * @returns {string|null} the new status to notify about, or `null` if this write doesn't warrant a Slack message — either the new status isn't one of the three notifiable ones, or the status didn't actually change (an unrelated field on the same document was written).
 */
export function detectNotifiableTransition(before, after) {
  if (!after || !NOTIFIABLE_STATUSES.has(after.status)) return null;
  const beforeStatus = before?.status ?? null;
  if (beforeStatus === after.status) return null;
  return after.status;
}
