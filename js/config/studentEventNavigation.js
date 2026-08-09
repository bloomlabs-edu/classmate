/**
 * config/studentEventNavigation.js
 *
 * The permanent pattern connecting a clickable StudentEvent to its own
 * dedicated detail screen — established by Assessment Results, the
 * first implementation of it, and meant to be the only place a future
 * clickable event type (Learning Hub recommendations, Homework,
 * Assignments, Teacher Announcements, Attendance, Certificates,
 * Classroom Notices, ...) is ever registered.
 *
 * A plain mapping from `event.type` to a function that builds that
 * event's own route path from its own `payload` — nothing more. Adding
 * a new clickable event type going forward means exactly three things,
 * matching what Assessment Results itself required: one new entry
 * here; one new route-dispatch branch in main.js's
 * renderStudentPortalMain(); and one new function in
 * services/studentPortalDataService.js that resolves that event's own
 * id into the current student's own view of it, read fresh from the
 * live classroom every time — never from the event itself, which only
 * ever carries a pointer. Nothing about
 * ui/student-portal/views/StudentJourneyView.js's own card rendering
 * needs to change shape to support any of this.
 *
 * An event type with no entry here is correctly non-interactive — its
 * card renders as a plain notification, exactly as every event type
 * did before this feature existed, and exactly as any future
 * publisher's cards will if a detail screen is never built for it.
 */

/**
 * Each entry: `buildRoute(payload)` returns this event's own detail
 * path; `ctaLabel` is the exact call-to-action text shown on its card
 * ("View Results", "View Homework", "View Announcement", ...) — kept
 * here, per type, rather than hardcoded generically in
 * StudentJourneyView.js, since a future event type's natural label
 * won't all be the same word.
 */
export const STUDENT_EVENT_DETAIL_ROUTES = {
  assessment_published: {
    buildRoute: (payload) => `/student/assessment-results/${payload.assessmentId}`,
    ctaLabel: 'View Results',
  },
  // Added for the Class Feed's own "Share with my class" -> "View
  // Goal" link (see StudentGoalTrackerView.js's own onShareGoal()) —
  // there's no per-goal detail screen, so this correctly points back
  // to the Goals list itself, the same granularity this feature
  // already has everywhere else.
  goal_completed: {
    buildRoute: () => '/student/goals',
    ctaLabel: 'View Goal',
  },
};

/** Returns { path, ctaLabel } for this event's own detail screen, or null if this event type has no dedicated screen (see this file's own header comment). */
export function getEventDetailRoute(event) {
  const entry = STUDENT_EVENT_DETAIL_ROUTES[event.type];
  if (!entry) return null;
  return { path: entry.buildRoute(event.payload), ctaLabel: entry.ctaLabel };
}
