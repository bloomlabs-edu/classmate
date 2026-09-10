/**
 * utils/swipeNavigation.js
 *
 * Swipe left/right to move between adjacent items (weeks, most likely,
 * but deliberately generic) — the same Pointer Events technique
 * ui/components/ClassModeStudentRow.js's own swipe-to-deduct gesture
 * already uses (same threshold, same predominantly-vertical-movement-
 * abandons-the-gesture rule so this never fights the page's own
 * scroll, same setPointerCapture() so dragging past a compact
 * element's own narrow edges still delivers pointerup to this
 * listener). Extracted from ui/components/WeeklyNetPointsGraph.js
 * (the weekly points chart's own history navigation, where this first
 * shipped) so ui/views/WeeklyReportDetailView.js's own week-by-week
 * Weekly Report can reuse the exact same swipe behavior rather than a
 * second, competing implementation — per the explicit product
 * decision to avoid a completely separate week-navigation system
 * wherever the existing one already fits.
 *
 * Buttons must always remain the required non-swipe alternative
 * wherever this is used — this is purely an enhancement layered on
 * top of whatever Prev/Next controls the caller already renders, and
 * respects the exact same canGoPrevious/canGoNext facts those
 * buttons' own disabled state already reflects.
 *
 * Ignores any pointerdown that starts on a button/link/[role="button"]
 * DESCENDANT of `element` — required once this got reused for
 * ui/views/WeeklyReportDetailView.js, whose swipeable area also
 * contains real clickable rows (student/team standings, recognition
 * card names), unlike the weekly chart this first shipped for (which
 * has no interactive descendants at all). Without this guard, calling
 * setPointerCapture() on `element` for a pointerdown that started on
 * one of those descendants retargets the button's own subsequent
 * click event to `element` instead — confirmed directly while
 * building Weekly Reports: real pointer-driven clicks on a nested
 * button silently stopped working (a JS-level `.click()` call still
 * worked, which is what made this easy to miss at first) the moment
 * swipe was attached to their shared ancestor. Skipping capture
 * entirely for those pointerdowns means a tap/click on any nested
 * button behaves exactly as if this swipe handler weren't attached at
 * all, while swiping from anywhere else in `element` still works.
 */

const SWIPE_THRESHOLD_PX = 60;
const MOVE_CANCEL_THRESHOLD_PX = 10;
const INTERACTIVE_SELECTOR = 'button, a, [role="button"]';

export function attachSwipeNavigation(element, { onPrevious, onNext, canGoPrevious, canGoNext }) {
  let startX = 0;
  let startY = 0;
  let trackingPointerId = null;

  element.addEventListener('pointerdown', (event) => {
    if (typeof event.button === 'number' && event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(INTERACTIVE_SELECTOR)) return;
    trackingPointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture isn't available in every environment; harmless to skip.
    }
  });

  element.addEventListener('pointermove', (event) => {
    if (event.pointerId !== trackingPointerId) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (Math.abs(deltaY) > MOVE_CANCEL_THRESHOLD_PX && Math.abs(deltaY) > Math.abs(deltaX)) {
      // Predominantly vertical movement -> the page is being scrolled,
      // not this element swiped. Abandon the gesture entirely.
      trackingPointerId = null;
    }
  });

  element.addEventListener('pointerup', (event) => {
    if (event.pointerId !== trackingPointerId) return;
    trackingPointerId = null;
    const deltaX = event.clientX - startX;
    if (deltaX <= -SWIPE_THRESHOLD_PX && canGoNext) onNext();
    else if (deltaX >= SWIPE_THRESHOLD_PX && canGoPrevious) onPrevious();
  });

  element.addEventListener('pointercancel', () => {
    trackingPointerId = null;
  });
}
