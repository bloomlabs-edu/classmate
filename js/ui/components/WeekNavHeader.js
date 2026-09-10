/**
 * ui/components/WeekNavHeader.js
 *
 * ‹ [week label] › — the shared Prev/Next week-navigation header,
 * extracted from ui/components/WeeklyNetPointsGraph.js (where this
 * first shipped for the weekly points chart) so
 * ui/views/WeeklyReportsListView.js / WeeklyReportDetailView.js can
 * reuse the exact same header rather than a second, competing
 * week-navigation UI — per the explicit product decision to avoid a
 * completely separate system wherever the existing one already fits.
 *
 * Purely presentational: renders whatever `{ weekLabel, canGoPrevious,
 * canGoNext }` facts it's given and calls back on `onPrevious`/
 * `onNext` — it never computes which week is "previous," "next," or
 * how far back history goes (that's each caller's own service layer:
 * services/studentProgressService.js's own
 * getEarliestActivityWeekStart()/services/weeklyReportService.js's
 * own getEarliestClassroomActivityWeekStart(), plus
 * utils/dateHelpers.js's own getWeekLabel()).
 *
 * `rowClassName`/`buttonClassName`/`titleClassName` are explicit
 * rather than a single prefix, so each caller can reuse its own
 * already-styled classes exactly (WeeklyNetPointsGraph.js keeps using
 * its own `weekly-net-graph__nav*` classes, unchanged, so this
 * extraction causes zero visual difference there) without this
 * component needing to know or care which screen it's rendering in.
 * The heading is `aria-live="polite"` so assistive tech announces the
 * new week label whenever Prev/Next/swipe changes it.
 */
export function createWeekNavHeaderElement({ weekLabel, onPrevious, onNext, canGoPrevious, canGoNext, rowClassName, buttonClassName, titleClassName }) {
  const row = document.createElement('div');
  row.className = rowClassName;

  const prevButton = document.createElement('button');
  prevButton.type = 'button';
  prevButton.className = buttonClassName;
  prevButton.setAttribute('aria-label', 'Previous week');
  prevButton.textContent = '‹';
  prevButton.disabled = !canGoPrevious;
  prevButton.addEventListener('click', () => onPrevious());

  const title = document.createElement('h2');
  title.className = titleClassName;
  title.textContent = weekLabel;
  title.setAttribute('aria-live', 'polite');

  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.className = buttonClassName;
  nextButton.setAttribute('aria-label', 'Next week');
  nextButton.textContent = '›';
  nextButton.disabled = !canGoNext;
  nextButton.addEventListener('click', () => onNext());

  row.append(prevButton, title, nextButton);
  return row;
}
