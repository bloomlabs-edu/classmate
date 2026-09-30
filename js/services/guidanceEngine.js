/**
 * services/guidanceEngine.js
 *
 * Pure decision logic for the Guidance/Coachmark system — no DOM, no
 * Firestore, no timers. Given a flow's config (config/guidanceFlows.js),
 * the caller's own knowledge of what this uid has already completed,
 * and a way to check whether a given step's target currently exists in
 * the live DOM, this decides what to show next. Kept pure specifically
 * so it's unit-testable in isolation, the same way
 * ui/views/MyWorkTaskDisplay.js is tested independent of its own DOM-
 * rendering sibling (ui/views/MyWorkView.js) —
 * ui/components/GuidanceOverlay.js is the only caller that actually
 * touches the DOM or persistence layer.
 */

/**
 * `completedMap` is the raw users/{uid}.guidanceCompleted value (or
 * {}/null if nothing has ever been saved) — { [flowId]: completedVersion }.
 * A flow only counts as complete once the SAVED version is >= this
 * flow's CURRENT config version; bumping a flow's version in
 * guidanceFlows.js is what makes an already-completed flow
 * "incomplete" again for every existing user, without touching any
 * other flow's own entry in the same map.
 */
export function isFlowComplete(flow, completedMap) {
  const savedVersion = completedMap?.[flow.id];
  return typeof savedVersion === 'number' && savedVersion >= flow.version;
}

/**
 * Finds the first step at or after `fromIndex` whose target is
 * actually present right now, per the caller-supplied
 * `isTargetPresent(selector)` check (see GuidanceOverlay.js's own
 * document.querySelector call). Returns null once no remaining step
 * has a present target — the caller's job at that point is to end the
 * flow WITHOUT marking it complete (see GuidanceOverlay.js), so it's
 * retried the next time this route renders with the real element
 * present, rather than being permanently skipped.
 */
export function resolveNextStep(flow, fromIndex, isTargetPresent) {
  for (let index = fromIndex; index < flow.steps.length; index += 1) {
    const step = flow.steps[index];
    if (isTargetPresent(step.targetSelector)) {
      return { index, step };
    }
  }
  return null;
}

/** Whether `index` is the last step this flow can still show — i.e. no later step has a present target either. Used to decide whether a step's action button reads "Next" or "Done". */
export function isLastResolvableStep(flow, index, isTargetPresent) {
  return resolveNextStep(flow, index + 1, isTargetPresent) === null;
}
