/**
 * ui/components/ClassModeStudentRow.js
 *
 * The core Class Mode interaction, built on Pointer Events so the same
 * code handles touch (phone) and mouse (desktop) identically:
 *   - a quick tap awards a star
 *   - a left swipe (or a left mouse-drag on desktop) deducts a point
 *   - a press-and-hold opens Quick Actions
 * A vertical drag is treated as scrolling and abandons the gesture
 * entirely, so this never fights the page's normal scroll.
 *
 * The bucket's soft-pastel-background + coloured-left-border treatment
 * is unchanged from earlier sprints — only the interaction layer is new.
 * A visible "more actions" button is included alongside the gesture
 * surface: long-press is pointer-only, so keyboard and assistive-tech
 * users need an explicit, focusable way to reach Quick Actions too.
 *
 * `nameHighlight` — the optional 'climbing' | 'redemption' | null state
 * from services/performanceStateService.js's own getNameHighlightState(),
 * computed once per student by ui/components/TeamStandingsBoard.js (using
 * the same per-student `{ movement, movementAmount }` shape from
 * services/teamStatisticsService.js's own getTeamLeaderboardWithMovement()
 * for the 'climbing' half of that decision — this component never sees
 * that raw movement data itself, only the already-resolved highlight).
 * Painted as a compact rounded pill behind the name text only (see
 * .student-row__name--climbing/--redemption in styles.css) — deliberately
 * never touching the bucket background, the score, or the stars, so
 * bucket (group), name pill (performance/behaviour), and score (underlying
 * data) stay clearly separate layers rather than merging into one.
 *
 * There used to also be a per-student ranking badge here (▲/▼/→ + how
 * many positions since the period started, e.g. "▼14") next to the star
 * score — removed per explicit product decision (confusing, not needed);
 * nothing replaces it.
 *
 * `onSwipeLeft`/`onLongPress` are both genuinely optional — see
 * ui/components/TeamStandingsBoard.js's own header comment for why:
 * the Student Portal renders this exact same row with only `onTap`
 * wired (opening a public profile), omitting the rest entirely rather
 * than receiving a "student version" with fewer features. When
 * `onLongPress` is absent, the "more actions" button doesn't render at
 * all — there is nothing for it to open. `onTap` itself stays
 * required: every context this row appears in needs at least one
 * meaningful thing to happen on tap.
 *
 * Explicit remove-star button (desktop star-removal gap, 2026-10):
 * swipe-left/left-drag already deducts a point via `onSwipeLeft`, but
 * nothing discoverable triggers it with a mouse on a laptop trackpad —
 * a click-and-drag gesture isn't something a desktop user naturally
 * tries. Rather than inventing a second action, this button calls the
 * exact same `onSwipeLeft` callback the gesture already calls — same
 * rule (services/classModeService.js's own deductPoint(), no clamping,
 * works at positive/zero/negative scores), same toast, same undo
 * stack entry. It renders only when `onSwipeLeft` is itself provided,
 * same "never claim an action that isn't actually wired" rule
 * `onLongPress`'s own "more actions" button already follows — and it
 * lives outside `.student-row__surface` (the gesture's own pointer
 * target), the same structural separation that already lets the
 * "more actions" button coexist with tap/swipe/long-press without
 * ever double-firing; clicking this button cannot also trigger the
 * swipe gesture, by construction, not by an added guard.
 */

import { getBucketRowStyle } from '../../config/bucketConfig.js';
import { getNetPoints } from '../../services/timelineService.js';

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_THRESHOLD_PX = 10;
const SWIPE_THRESHOLD_PX = 60;

export function createClassModeStudentRow(student, { onTap, onSwipeLeft, onLongPress, tapActionLabel = 'award a star', displayScore, nameHighlight }) {
  const style = getBucketRowStyle(student.bucket);

  const item = document.createElement('li');
  item.className = 'student-row';
  item.dataset.studentId = student.id;
  item.style.backgroundColor = style.background;
  item.style.borderLeftColor = style.border;

  const surface = document.createElement('div');
  surface.className = 'student-row__surface';
  surface.setAttribute('role', 'button');
  surface.tabIndex = 0;
  surface.setAttribute('aria-label', buildAriaLabel(student.name, tapActionLabel, { onSwipeLeft, onLongPress }));

  const name = document.createElement('span');
  name.className = 'student-row__name';
  if (nameHighlight) name.classList.add(`student-row__name--${nameHighlight}`);
  name.textContent = student.name;

  const score = document.createElement('span');
  score.className = 'student-row__points';
  // THE ACTUAL FIX (approved Reset Scoreboard design) — the live
  // Class Mode row now displays the current-scoring-period score,
  // passed in explicitly by the caller (TeamCard.js). Falls back to
  // the original all-time getNetPoints(student) if no displayScore is
  // given at all, so this stays fully backward-compatible for any
  // caller that never adopts the new prop.
  score.textContent = `${displayScore ?? getNetPoints(student)} \u2b50`;

  const trailing = document.createElement('span');
  trailing.className = 'student-row__trailing';
  trailing.appendChild(score);

  surface.append(name, trailing);

  item.appendChild(surface);

  if (onSwipeLeft) {
    const removeStarButton = document.createElement('button');
    removeStarButton.type = 'button';
    // .btn--icon-only — the app's own documented circular icon-button
    // tier (2026-10-23 visual fix: a bare glyph with no resting-state
    // chrome read as a stray dash against a whole roster; see this
    // class's own CSS comment in styles.css for the full history).
    removeStarButton.className = 'btn btn--icon-only student-row__remove-star';
    removeStarButton.textContent = '−'; // U+2212 minus sign — still a plain glyph, not an SVG icon, now inside the shared bordered circle every other icon-only action in the app already uses
    removeStarButton.setAttribute('aria-label', `Remove a star from ${student.name}`);
    removeStarButton.title = 'Remove a star';
    removeStarButton.addEventListener('click', (event) => {
      event.stopPropagation();
      onSwipeLeft(student);
    });
    item.appendChild(removeStarButton);
  }

  if (onLongPress) {
    const moreButton = document.createElement('button');
    moreButton.type = 'button';
    moreButton.className = 'student-row__more';
    moreButton.textContent = '\u22ee';
    moreButton.setAttribute('aria-label', `More actions for ${student.name}`);
    moreButton.addEventListener('click', (event) => {
      event.stopPropagation();
      onLongPress(student);
    });
    item.appendChild(moreButton);
  }

  // --- Gesture state ---
  let pointerActive = false;
  let dragging = false;
  let longPressTriggered = false;
  let longPressTimer = null;
  let startX = 0;
  let startY = 0;
  let currentX = 0;

  function clearLongPressTimer() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function resetVisual() {
    surface.style.transform = '';
    surface.classList.remove('student-row__surface--dragging');
  }

  function endGesture() {
    pointerActive = false;
    clearLongPressTimer();

    if (longPressTriggered) {
      resetVisual();
      return;
    }

    const deltaX = currentX - startX;
    if (dragging && deltaX <= -SWIPE_THRESHOLD_PX) {
      onSwipeLeft?.(student);
    } else if (!dragging) {
      onTap(student);
    }

    resetVisual();
  }

  surface.addEventListener('pointerdown', (event) => {
    if (typeof event.button === 'number' && event.button !== 0) return;

    pointerActive = true;
    dragging = false;
    longPressTriggered = false;
    startX = event.clientX;
    startY = event.clientY;
    currentX = startX;

    try {
      surface.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture isn't available in every environment; harmless to skip.
    }

    if (onLongPress) {
      longPressTimer = setTimeout(() => {
        if (!pointerActive) return;
        longPressTriggered = true;
        pointerActive = false;
        resetVisual();
        onLongPress(student);
      }, LONG_PRESS_MS);
    }
  });

  surface.addEventListener('pointermove', (event) => {
    if (!pointerActive || longPressTriggered) return;

    currentX = event.clientX;
    const deltaX = currentX - startX;
    const deltaY = event.clientY - startY;

    if (!dragging) {
      if (Math.abs(deltaX) > MOVE_CANCEL_THRESHOLD_PX || Math.abs(deltaY) > MOVE_CANCEL_THRESHOLD_PX) {
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          dragging = true;
          clearLongPressTimer();
        } else {
          // Predominantly vertical movement -> this is a scroll, not a
          // swipe. Abandon the gesture entirely and let the page scroll.
          pointerActive = false;
          clearLongPressTimer();
          resetVisual();
          return;
        }
      }
    }

    if (dragging) {
      const clamped = Math.min(0, deltaX);
      surface.style.transform = `translateX(${clamped}px)`;
      surface.classList.add('student-row__surface--dragging');
    }
  });

  surface.addEventListener('pointerup', endGesture);
  surface.addEventListener('pointercancel', () => {
    pointerActive = false;
    clearLongPressTimer();
    resetVisual();
  });

  surface.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onTap(student);
    }
  });

  return item;
}

/** Describes only the gestures genuinely available in this context — never claims an action (e.g. "swipe left to deduct a point") that isn't actually wired, since the Student Portal's own row has none of the teacher-only gestures at all. */
function buildAriaLabel(name, tapActionLabel, { onSwipeLeft, onLongPress }) {
  const actions = [`Tap to ${tapActionLabel}`];
  if (onSwipeLeft) actions.push('swipe left to deduct a point');
  if (onLongPress) actions.push('press and hold for more actions');
  return `${name}. ${actions.join(', ')}.`;
}
