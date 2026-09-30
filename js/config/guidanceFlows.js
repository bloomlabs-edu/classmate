/**
 * config/guidanceFlows.js
 *
 * Declarative definitions for the Guidance/Coachmark system (see
 * services/guidanceEngine.js for the logic that consumes these, and
 * ui/components/GuidanceOverlay.js for the rendering). A plain data
 * file, same role as config/accentColorConfig.js/notificationCategories.js
 * — no behavior lives here.
 *
 * Each flow is scoped to exactly one route (`routeName`, matching
 * ui/router.js's own route.name values) — a flow never spans a
 * navigation in this version. Multi-route guided tours are a real,
 * harder problem (surviving a hashchange + async re-render mid-flow)
 * that this first version deliberately doesn't take on.
 *
 * `version` is the flow's own completed-version number, tracked
 * per-flow (not globally) in users/{uid}.guidanceCompleted[flowId] —
 * see services/guidancePreferenceService.js. Bumping a flow's version
 * here replays ONLY that flow for every existing user; every other
 * flow's own completed state is untouched. Start at 1, never 0 — 0
 * would be indistinguishable from "field never set" (see
 * guidanceEngine.js's own isFlowComplete()).
 *
 * `targetSelector` is queried fresh, immediately before that step is
 * shown (see GuidanceOverlay.js) — never cached, since routes fully
 * rebuild their container's innerHTML on every navigation/snapshot
 * update. A step whose selector matches nothing in the live DOM is
 * skipped, never shown pointing at nothing (see guidanceEngine.js's
 * own resolveNextStep()).
 */

export const GUIDANCE_FLOWS = {
  myWork: {
    id: 'myWork',
    version: 1,
    routeName: 'home',
    steps: [
      {
        targetSelector: '.hub-today-tasks',
        title: 'My Work lives here',
        body: 'Anything due today shows up right on your dashboard — even before you’ve added a single task. "Open My Work" always takes you to your full list.',
      },
    ],
  },
};

/**
 * One flow at most per route, by design — the Help control (see
 * UserBar.js) replays whatever single flow is registered for the
 * CURRENT route, with no flow picker/menu needed for this version.
 */
export function getFlowForRoute(routeName) {
  return Object.values(GUIDANCE_FLOWS).find((flow) => flow.routeName === routeName) || null;
}

export function getFlow(flowId) {
  return GUIDANCE_FLOWS[flowId] || null;
}
