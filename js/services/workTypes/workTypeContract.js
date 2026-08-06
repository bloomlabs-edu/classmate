/**
 * services/workTypes/workTypeContract.js
 *
 * The frozen Work Type interface — documented here once, referenced
 * by every Work Type rather than restated in each file.
 *
 * A Work Type is a plain object exposing exactly two capabilities,
 * nothing else:
 *
 *   getActiveWork(classroom) -> WorkItem[]
 *   getStartActions(classroom) -> WorkItem[]
 *
 * WorkItem = { title, subtitle, count, navigateTo }
 *   - title, subtitle: plain strings, already phrased for display —
 *     the Dashboard never assembles domain-specific wording itself.
 *   - count: a number, or undefined when there's nothing to count
 *     (a "Start New" action has no count).
 *   - navigateTo: a plain route path STRING (e.g.
 *     "/classroom/{id}/work-requests/{requestId}"), never a callback
 *     function. The Dashboard shell calls router.navigate(item.navigateTo)
 *     itself, generically, for every Work Type — a Work Type never
 *     calls router.navigate, never imports router.js, and never knows
 *     the Dashboard exists.
 *
 * A Work Type NEVER:
 *   - renders UI, creates DOM, or returns HTML
 *   - accepts a container argument
 *   - exposes a third capability (no getRecommendations(), no
 *     render(), no anything else) — see this project's own
 *     architecture review for why a third capability is deferred
 *     until at least two real, independently-motivated
 *     implementations demonstrate it's a genuine, shared shape, not
 *     before
 *   - reaches into Firestore or a repository directly, and never
 *     re-implements business logic that already lives in a domain
 *     service — a Work Type composes existing services
 *     (workRequestService, goalService, assessmentService,
 *     learningActivityService); it does not decide anything those
 *     services don't already decide
 *
 * A Work Type may return zero, one, or many items from either
 * capability — the Dashboard always aggregates with
 * `WORK_TYPES.flatMap(type => type.getActiveWork(classroom))`, never
 * assuming exactly one item per type.
 *
 * If a future Dashboard branch ever reads
 * `if (item.type === 'notebook') { ... }`, uniform presentation has
 * already broken down in practice — the fix is correcting that
 * Work Type's own output shape, not adding a branch.
 */
