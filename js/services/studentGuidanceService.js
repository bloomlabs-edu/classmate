/**
 * services/studentGuidanceService.js
 *
 * The "brief, constructive guidance" Workstream 1 requires on a
 * student's own profile — deliberately a tiny, dependency-free pure
 * function (see tests/services/studentGuidanceService.test.js, which
 * imports it directly under plain node:test — ui/student-portal/views/StudentProfileView.js
 * itself can't be imported that way, since its own dependency chain
 * transitively pulls in browser-only Firebase SDK imports).
 *
 * Deliberately built only from numbers already shown elsewhere on the
 * profile — never a fabricated "X points to your next bucket" claim:
 * bucket assignment is a teacher's own manual judgment call
 * (services/bucketService.js's own assignBucket()), not a score
 * threshold, so implying one here would misrepresent how buckets
 * actually work.
 */

export function buildGuidanceMessage(profile, notebookStatus) {
  if (profile.negativePoints > 0) {
    return `You have ${profile.negativePoints} negative point${profile.negativePoints === 1 ? '' : 's'} right now — every star you earn from here helps bring your Net Score back up.`;
  }
  if (notebookStatus.summary.awaitingSubmission > 0) {
    return `You have ${notebookStatus.summary.awaitingSubmission} notebook${notebookStatus.summary.awaitingSubmission === 1 ? '' : 's'} waiting on your submission — see the Notebooks section below.`;
  }
  return "You're all caught up — keep up the great work!";
}
