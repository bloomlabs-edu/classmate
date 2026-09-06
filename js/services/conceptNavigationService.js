/**
 * services/conceptNavigationService.js
 *
 * Pure ordering/boundary/gesture logic for Concept Workspace's
 * Previous/Next Concept navigation (see
 * ui/views/ConceptWorkspaceView.js's own renderConceptWorkspaceView).
 * Deliberately dependency-free — no repository/Firestore import chain
 * at all — so it can be unit-tested directly with `node --test`; the
 * DOM wiring (button clicks, the document keydown listener, the
 * pointer-event swipe listeners) stays in ConceptWorkspaceView.js
 * itself and calls straight into these functions rather than
 * duplicating this logic inline.
 *
 * Ordering is always exactly `unit.concepts` — the same array
 * ui/views/LearningManagementView.js's own Concepts list
 * (renderUnitsOrParts()) renders from, scoped to one Unit at a time.
 * There is no second/invented Concept ordering anywhere in this file.
 */

export function getConceptIndex(unit, conceptId) {
  return unit.concepts.findIndex((candidate) => candidate.id === conceptId);
}

export function getAdjacentConcept(unit, conceptId, offset) {
  const index = getConceptIndex(unit, conceptId);
  if (index === -1) return null;
  return unit.concepts[index + offset] || null;
}

export function getPreviousConcept(unit, conceptId) {
  return getAdjacentConcept(unit, conceptId, -1);
}

export function getNextConcept(unit, conceptId) {
  return getAdjacentConcept(unit, conceptId, 1);
}

/** Keyboard-focus / swipe-start guard — ArrowLeft/Right and swipe gestures must never hijack a real input/textarea/select/button/contenteditable interaction. */
export function isInteractiveElement(element) {
  if (!element) return false;
  if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(element.tagName)) return true;
  return Boolean(element.isContentEditable);
}

/**
 * Decides whether a completed touch gesture counts as a deliberate
 * horizontal swipe, and which direction — or null if it doesn't
 * qualify (too short, or predominantly vertical, i.e. an ordinary
 * scroll). `directionDominanceRatio` is why a vertical scroll with a
 * little sideways drift never gets misread as a swipe: horizontal
 * movement must clearly dominate vertical, not just barely exceed the
 * minimum distance.
 */
export function resolveSwipeDirection(deltaX, deltaY, { minDistance = 60, directionDominanceRatio = 1.5 } = {}) {
  if (Math.abs(deltaX) < minDistance) return null;
  if (Math.abs(deltaX) < Math.abs(deltaY) * directionDominanceRatio) return null;
  return deltaX < 0 ? 'next' : 'previous';
}
