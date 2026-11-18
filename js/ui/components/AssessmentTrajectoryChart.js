/**
 * ui/components/AssessmentTrajectoryChart.js
 *
 * One Subject's own exam-score trajectory — the Student Growth
 * Dashboard's Academic Growth tab (see
 * ui/views/StudentProfileView.js's own renderAcademicsTab()). A
 * single series (one Subject at a time, selected elsewhere), so no
 * legend is needed — the section heading already names what's
 * plotted, same "a legend is always present for >=2 series, none for
 * one" rule this app's other chart already follows (see
 * ui/views/AdminDashboardView.js's own createActivityChartSection()
 * header comment).
 *
 * Built on THAT file's own real-SVG-DOM convention
 * (document.createElementNS, native <title> per-point tooltips, an
 * explicit "View as table" accessible twin) rather than
 * ui/components/WeeklyNetPointsGraph.js's innerHTML-string line/area
 * convention — deliberately: every point here carries a real
 * comparability caveat (this Subject's own maximumMarks/passMarkPercent
 * can differ from one Assessment to the next, per
 * services/studentProgressService.js's own getAcademicTrajectoryForStudent()
 * doc comment), and that caveat needs to be inspectable per point —
 * a rich tooltip and an accessible table fallback, neither of which
 * WeeklyNetPointsGraph has a precedent for (fixed 5-point Mon-Fri
 * shape, no per-point tooltip, no table).
 *
 * Dot/line colour reuses this app's own existing Red/Yellow/Green
 * performance tokens (--color-success/--color-warning/--color-danger
 * — the same ones css/styles.css already paints
 * .gradebook-cell--high/mid/low with) rather than inventing a new
 * palette, so this chart visually agrees with the Gradebook teachers
 * already use for the exact same data.
 */

import { getPerformanceBucketLabel } from '../../config/assessmentMarksColorConfig.js';
import { formatDate } from '../../utils/dateHelpers.js';

// A trajectory point's own `date` is assessment.date (a plain
// YYYY-MM-DD key) when set, but falls back to assessment.createdAt
// (a full ISO timestamp) when an Assessment was never given an exam
// date — formatDate() (new Date(...) under the hood) handles both
// shapes correctly, unlike formatDateKey()'s own strict YYYY-MM-DD-only
// parsing, which would mis-split a full timestamp.
function formatTrajectoryDate(date) {
  return date ? formatDate(date) : '—';
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * `points` — this one Subject's own ordered (oldest first) point
 * array, exactly as services/studentProgressService.js's
 * getSubjectTrajectory()/getAcademicTrajectoryForStudent() return it:
 * [{ assessmentId, assessmentTitle, date, marks, maximumMarks,
 *    percent, passMarkPercent, bucketKey }]
 * `showTable`/`onToggleTable` — the chart/table toggle's own state,
 * owned by the caller (same convention AdminDashboardView's own
 * createActivityChartSection() already uses) — this component is a
 * pure function of its props, no internal state of its own.
 */
export function createAssessmentTrajectorySection(points, showTable, onToggleTable) {
  const section = document.createElement('div');
  section.className = 'assessment-trajectory-chart';

  const header = document.createElement('div');
  header.className = 'assessment-trajectory-chart__header';

  const heading = document.createElement('h3');
  heading.className = 'assessment-trajectory-chart__heading';
  heading.textContent = 'Trajectory';
  header.appendChild(heading);

  const tableToggle = document.createElement('button');
  tableToggle.type = 'button';
  tableToggle.className = 'btn btn--text';
  tableToggle.textContent = showTable ? 'View as chart' : 'View as table';
  tableToggle.addEventListener('click', () => onToggleTable(!showTable));
  header.appendChild(tableToggle);

  section.appendChild(header);
  section.appendChild(showTable ? createTrajectoryTable(points) : createTrajectorySvg(points));
  return section;
}

function createTrajectoryTable(points) {
  // A horizontal-scroll wrapper, not a fixed width — on a narrow
  // phone the 5-column table scrolls within itself rather than
  // squeezing columns unreadably or overflowing the page.
  const scrollWrap = document.createElement('div');
  scrollWrap.className = 'assessment-trajectory-chart__table-scroll';

  const table = document.createElement('table');
  table.className = 'assessment-trajectory-chart__table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['Date', 'Assessment', 'Marks', '%', 'Bucket'].forEach((text) => {
    const th = document.createElement('th');
    th.textContent = text;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  points.forEach((point) => {
    const row = document.createElement('tr');
    const dateCell = document.createElement('td');
    dateCell.textContent = formatTrajectoryDate(point.date);
    const assessmentCell = document.createElement('td');
    assessmentCell.textContent = point.assessmentTitle;
    const marksCell = document.createElement('td');
    marksCell.textContent = `${point.marks}/${point.maximumMarks}`;
    const percentCell = document.createElement('td');
    percentCell.textContent = `${point.percent}%`;
    const bucketCell = document.createElement('td');
    bucketCell.textContent = getPerformanceBucketLabel(point.bucketKey);
    row.append(dateCell, assessmentCell, marksCell, percentCell, bucketCell);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  scrollWrap.appendChild(table);
  return scrollWrap;
}

function createTrajectorySvg(points) {
  const width = 640;
  const height = 220;
  const paddingLeft = 40;
  const paddingBottom = 28;
  const paddingTop = 12;
  const paddingRight = 8;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const wrap = document.createElement('div');
  wrap.className = 'assessment-trajectory-chart__wrap';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Exam score trajectory for this Subject, shown as a percentage over time');
  svg.classList.add('assessment-trajectory-chart__svg');

  // Fixed 0-100% axis — percentage is always comparable across
  // Assessments (unlike raw marks), so a fixed scale is both correct
  // and simpler than AdminDashboardView's own dynamic niceCeiling().
  const gridSteps = 4; // 0/25/50/75/100
  for (let i = 0; i <= gridSteps; i += 1) {
    const y = paddingTop + (plotHeight * i) / gridSteps;
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(paddingLeft));
    line.setAttribute('x2', String(width - paddingRight));
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    line.setAttribute('class', 'assessment-trajectory-chart__gridline');
    svg.appendChild(line);

    const tickValue = 100 - (100 * i) / gridSteps;
    const tick = document.createElementNS(SVG_NS, 'text');
    tick.setAttribute('x', String(paddingLeft - 8));
    tick.setAttribute('y', String(y + 4));
    tick.setAttribute('text-anchor', 'end');
    tick.setAttribute('class', 'assessment-trajectory-chart__tick');
    tick.textContent = `${tickValue}%`;
    svg.appendChild(tick);
  }

  // One evenly-spaced slot per point, in order — the same "position
  // by index, not by literal date distance" approach
  // AdminDashboardView's own bar chart already uses, which also
  // naturally accommodates Assessments spaced irregularly in time.
  const slotWidth = points.length > 1 ? plotWidth / (points.length - 1) : 0;
  const xForIndex = (index) => (points.length > 1 ? paddingLeft + index * slotWidth : paddingLeft + plotWidth / 2);
  const yForPercent = (percent) => paddingTop + plotHeight - (Math.min(Math.max(percent, 0), 100) / 100) * plotHeight;

  // The connecting line — only drawn with 2+ points; a single point
  // has nothing to connect to (never attempt a line through one dot).
  if (points.length > 1) {
    const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${xForIndex(index)} ${yForPercent(point.percent)}`).join(' ');
    const line = document.createElementNS(SVG_NS, 'path');
    line.setAttribute('d', linePath);
    line.setAttribute('class', 'assessment-trajectory-chart__line');
    line.setAttribute('fill', 'none');
    svg.appendChild(line);
  }

  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  points.forEach((point, index) => {
    const x = xForIndex(index);
    const y = yForPercent(point.percent);

    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', String(x));
    dot.setAttribute('cy', String(y));
    dot.setAttribute('r', '5');
    dot.setAttribute('class', `assessment-trajectory-chart__dot assessment-trajectory-chart__dot--${point.bucketKey || 'none'}`);
    dot.setAttribute('tabindex', '0');
    dot.setAttribute('role', 'img');
    const bucketLabel = getPerformanceBucketLabel(point.bucketKey);
    const ariaLabel = `${point.assessmentTitle}, ${formatTrajectoryDate(point.date)}: ${point.marks} of ${point.maximumMarks} (${point.percent}%, ${bucketLabel}, Pass Mark ${point.passMarkPercent}%)`;
    dot.setAttribute('aria-label', ariaLabel);

    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = ariaLabel;
    dot.appendChild(title);

    svg.appendChild(dot);

    // Sparse x-axis labels — every point would collide for a
    // multi-year class history, matching AdminDashboardView's own
    // "label selectively" convention.
    if (index % labelEvery === 0 || index === points.length - 1) {
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', String(x));
      label.setAttribute('y', String(height - 6));
      label.setAttribute('text-anchor', index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle');
      label.setAttribute('class', 'assessment-trajectory-chart__tick');
      label.textContent = point.date ? formatTrajectoryDate(point.date) : point.assessmentTitle;
      svg.appendChild(label);
    }
  });

  wrap.appendChild(svg);
  return wrap;
}
