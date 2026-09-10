/**
 * ui/components/WeeklyNetPointsGraph.js
 *
 * "This Week" — a compact, zero-baseline visualization of real,
 * existing per-day net point values (see
 * services/studentProgressService.js's own getWeeklyNetPoints(), the
 * one shared, canonical function every caller of this component uses
 * — no new calculation, no interpretation happens here or there).
 *
 * Extracted from ui/student-portal/views/StudentJourneyView.js, where
 * this graph first shipped, so the Personal Profile, the Teacher
 * Portal's student profile, and the Student Portal's public profile
 * can all render the exact same graph — same shape, same rendering
 * code — rather than three screens each rebuilding their own copy of
 * this SVG. This component takes plain data
 * ({ dayLabel, value }[], already computed by the caller) and has no
 * idea which of those three screens is showing it, or whose data it
 * is.
 *
 * Deliberately shows ONLY the raw shape of the week — crests above
 * zero, troughs below — never a label describing whether a day was
 * "good" or "bad": the platform principle this graph follows exactly
 * is that software preserves and presents evidence, it does not
 * author meaning from that evidence. The only text on screen is the
 * heading, a one-line subtitle, each day's own single-letter initial,
 * and each point's own real, signed value — no legend, no streak.
 *
 * `subtitle` is an explicit parameter, not a hardcoded string — the
 * default ("How your points moved this week") is only correct for a
 * student viewing their own profile. Confirmed directly, the same
 * mistake already fixed once for event copy
 * (services/studentEventService.js's own getEventCopyForViewer()):
 * this component now renders in three genuinely different viewer
 * contexts, and "your points" is only true for one of them. The
 * Teacher Portal and the public (peer) profile must each pass their
 * own neutral wording explicitly.
 *
 * `nav` (optional, default null) turns on week-by-week history
 * browsing — Class Mode's Student Profile (Teacher Portal) is
 * currently the only caller that passes it; the Student Portal's own
 * three call sites (StudentJourneyView.js, its own StudentProfileView.js,
 * StudentPublicProfileView.js) all still call this with two arguments,
 * so they keep rendering byte-for-byte what they always have — the
 * hardcoded "This Week" title, no Prev/Next controls, no swipe, no
 * entry animation. When `nav` IS given, it is
 * `{ weekLabel, onPrevious, onNext, canGoPrevious, canGoNext }`: this
 * component only ever renders those plain facts and calls back
 * on Prev/Next/swipe — it never computes which week is "previous,"
 * "next," or how far back history goes (see
 * services/studentProgressService.js's own getEarliestActivityWeekStart()
 * and utils/dateHelpers.js's own getWeekLabel(), the caller's job).
 */
export function createWeeklyNetPointsSection(weeklyNetPoints, subtitle = 'How your points moved this week', nav = null) {
  const section = document.createElement('div');
  section.className = 'student-journey__section';

  if (nav) {
    section.appendChild(createWeekNavHeader(nav));
  } else {
    const title = document.createElement('h2');
    title.className = 'student-journey__section-title';
    title.textContent = 'This Week';
    section.appendChild(title);
  }

  const subtitleEl = document.createElement('p');
  subtitleEl.className = 'weekly-net-graph__subtitle';
  subtitleEl.textContent = subtitle;
  section.appendChild(subtitleEl);

  const graph = createWeeklyNetGraphSvg(weeklyNetPoints, nav ? nav.weekLabel : undefined);
  if (nav) {
    // The whole section is torn down and freshly rebuilt on every week
    // change (ui/views/StudentProfileView.js's existing full-rerender
    // pattern — see e.g. ui/views/TrackerView.js's own identical
    // "freshly created, so the CSS animation just plays on mount, no
    // cleanup needed" convention already established for the row
    // highlight pulse). This class name is what
    // css/styles.css hooks its subtle entry animation to; the reduced
    // motion media query there disables it for anyone who's asked for
    // that. Only added when nav is active — the three unchanged
    // Student Portal call sites never gain this animation.
    graph.classList.add('weekly-net-graph--nav-enter');
    attachSwipeNavigation(graph, nav);
  }
  section.appendChild(graph);

  return section;
}

const SWIPE_THRESHOLD_PX = 60;
const MOVE_CANCEL_THRESHOLD_PX = 10;

/**
 * Prev [week label] Next — a lightweight header row replacing the
 * plain "This Week" heading when navigation is active. `weekLabel`
 * keeps the exact same heading class/typography ('This Week' /
 * 'Last Week' / a date range), so this reads as the same heading with
 * two small buttons added, not a redesign. The heading itself is
 * `aria-live="polite"` so assistive tech announces the new week label
 * whenever Prev/Next/swipe changes it — the whole section is
 * recreated on every change (see createWeeklyNetPointsSection() above),
 * so there is no separate "update text" step to wire up.
 */
function createWeekNavHeader(nav) {
  const row = document.createElement('div');
  row.className = 'weekly-net-graph__nav';

  const prevButton = document.createElement('button');
  prevButton.type = 'button';
  prevButton.className = 'weekly-net-graph__nav-button';
  prevButton.setAttribute('aria-label', 'Previous week');
  prevButton.textContent = '‹';
  prevButton.disabled = !nav.canGoPrevious;
  prevButton.addEventListener('click', () => nav.onPrevious());

  const title = document.createElement('h2');
  title.className = 'student-journey__section-title weekly-net-graph__nav-title';
  title.textContent = nav.weekLabel;
  title.setAttribute('aria-live', 'polite');

  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.className = 'weekly-net-graph__nav-button';
  nextButton.setAttribute('aria-label', 'Next week');
  nextButton.textContent = '›';
  nextButton.disabled = !nav.canGoNext;
  nextButton.addEventListener('click', () => nav.onNext());

  row.append(prevButton, title, nextButton);
  return row;
}

/**
 * Swipe left/right on the chart itself to move week-to-week — the same
 * Pointer Events technique ui/components/ClassModeStudentRow.js's own
 * swipe-to-deduct gesture already uses (same threshold, same
 * predominantly-vertical-movement-abandons-the-gesture rule so this
 * never fights the page's own scroll), reused rather than reinvented.
 * Buttons remain the required non-swipe alternative — see this file's
 * own Prev/Next above — this is purely an enhancement layered on top,
 * and respects the exact same canGoPrevious/canGoNext facts the
 * buttons' own disabled state already reflects.
 */
function attachSwipeNavigation(graphEl, { onPrevious, onNext, canGoPrevious, canGoNext }) {
  let startX = 0;
  let startY = 0;
  let trackingPointerId = null;

  graphEl.addEventListener('pointerdown', (event) => {
    if (typeof event.button === 'number' && event.button !== 0) return;
    trackingPointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    try {
      // Without this, dragging past this compact chart's own narrow
      // edges (very easy at swipe-threshold distances) delivers
      // pointerup to whatever element the pointer ends up over
      // instead of graphEl, so this listener would never see it. Same
      // fix ui/components/ClassModeStudentRow.js's own swipe already
      // applies for the identical reason.
      graphEl.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture isn't available in every environment; harmless to skip.
    }
  });

  graphEl.addEventListener('pointermove', (event) => {
    if (event.pointerId !== trackingPointerId) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (Math.abs(deltaY) > MOVE_CANCEL_THRESHOLD_PX && Math.abs(deltaY) > Math.abs(deltaX)) {
      // Predominantly vertical movement -> the page is being scrolled,
      // not the chart swiped. Abandon the gesture entirely.
      trackingPointerId = null;
    }
  });

  graphEl.addEventListener('pointerup', (event) => {
    if (event.pointerId !== trackingPointerId) return;
    trackingPointerId = null;
    const deltaX = event.clientX - startX;
    if (deltaX <= -SWIPE_THRESHOLD_PX && canGoNext) onNext();
    else if (deltaX >= SWIPE_THRESHOLD_PX && canGoPrevious) onPrevious();
  });

  graphEl.addEventListener('pointercancel', () => {
    trackingPointerId = null;
  });
}

function createWeeklyNetGraphSvg(weeklyNetPoints, weekLabel) {
  const width = 320;
  const height = 110;
  const paddingX = 24;
  const paddingTop = 20;
  const paddingBottom = 30;
  const plotWidth = width - paddingX * 2;
  const plotHeight = height - paddingTop - paddingBottom;
  const zeroY = paddingTop + plotHeight / 2;

  const values = weeklyNetPoints.map((d) => d.value);
  const maxAbs = Math.max(5, ...values.map((v) => Math.abs(v)));

  const points = weeklyNetPoints.map((day, index) => {
    const x = paddingX + (plotWidth / (weeklyNetPoints.length - 1)) * index;
    const y = zeroY - (day.value / maxAbs) * (plotHeight / 2);
    return { x, y, ...day };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `M ${points[0].x} ${zeroY} ` + points.map((p) => `L ${p.x} ${p.y}`).join(' ') + ` L ${points[points.length - 1].x} ${zeroY} Z`;

  const svg = document.createElement('div');
  svg.className = 'weekly-net-graph';
  svg.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Weekly net point movement, Monday through Friday${weekLabel ? `, ${weekLabel}` : ''}">
      <line x1="${paddingX}" y1="${zeroY}" x2="${width - paddingX}" y2="${zeroY}" class="weekly-net-graph__zero-line" />
      <path d="${areaPath}" class="weekly-net-graph__area" />
      <path d="${linePath}" class="weekly-net-graph__line" />
      ${points
        .map(
          (p) =>
            `<circle cx="${p.x}" cy="${p.y}" r="3.5" class="weekly-net-graph__dot ${p.value === 0 ? 'weekly-net-graph__dot--zero' : p.value > 0 ? 'weekly-net-graph__dot--positive' : 'weekly-net-graph__dot--negative'}" />`
        )
        .join('')}
      ${points
        .map(
          (p) =>
            `<text x="${p.x}" y="${p.value < 0 ? p.y + 15 : p.y - 9}" class="weekly-net-graph__value-label" text-anchor="middle">${p.value > 0 ? '+' : ''}${p.value}</text>`
        )
        .join('')}
      ${points.map((p) => `<text x="${p.x}" y="${height - 8}" class="weekly-net-graph__day-label" text-anchor="middle">${p.dayLabel[0]}</text>`).join('')}
    </svg>
  `;
  return svg;
}
