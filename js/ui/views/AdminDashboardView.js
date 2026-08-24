/**
 * ui/views/AdminDashboardView.js
 *
 * Private usage-analytics dashboard for ClassMate's own admin — not a
 * teacher-facing feature. main.js already gates the #/admin route on a
 * real `admins/{uid}` Firestore check (adminAnalyticsService.checkIsAdmin())
 * before this view is ever rendered; this file re-checks the SAME thing
 * independently, on its own current user, before firing off the
 * analyticsEvents query — so a future change to main.js's own routing
 * logic can never accidentally expose this screen's data. If that check
 * fails, this renders nothing but a plain "not found" message; the KPI
 * shell is never built and then hidden.
 *
 * The actual security boundary is firestore.rules (analyticsEvents is
 * unreadable by anyone without an admins/{uid} document) — everything
 * in this file is a UX convenience on top of that, never a substitute
 * for it.
 *
 * Chart built per this project's dataviz method: a single-series bar
 * chart needs no legend (the title names the one series), sequential
 * color (one hue — this app's own --color-primary, not a new palette),
 * thin capped bars with a 2px surface gap, recessive hairline
 * gridlines, and a per-bar hover/focus tooltip. A "View as table"
 * toggle is the chart's own accessible twin, per the same method.
 */

import { createBackButton } from '../components/BackButton.js';
import { getCurrentUser } from '../../services/authService.js';
import * as adminAnalyticsService from '../../services/adminAnalyticsService.js';

const RANGE_OPTIONS = [
  { key: 'today', label: 'Today', days: 0 },
  { key: '7d', label: 'Last 7 days', days: 6 },
  { key: '30d', label: 'Last 30 days', days: 29 },
];

const KPI_TILES = [
  { key: 'totalTeachers', label: 'Total teachers', footnote: 'all time' },
  { key: 'totalStudents', label: 'Total students', footnote: 'all time, approx.' },
  { key: 'activeTeachers', label: 'Active teachers', footnote: null },
  { key: 'activeStudents', label: 'Active students', footnote: 'approx.' },
  { key: 'classesCreated', label: 'Classes created', footnote: null },
  { key: 'classSessionsConducted', label: 'Class sessions conducted', footnote: null },
  { key: 'lessonsOpened', label: 'Lessons opened', footnote: null },
  { key: 'assessmentsCompleted', label: 'Assessments completed', footnote: null },
  { key: 'pointsAwarded', label: 'Points awarded', footnote: null },
  { key: 'pointsDeducted', label: 'Points deducted', footnote: null },
];

function sinceDateFor(rangeKey) {
  const option = RANGE_OPTIONS.find((o) => o.key === rangeKey);
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - option.days);
  return since;
}

export function renderAdminDashboardView(container, { onBack }) {
  container.innerHTML = '';

  const user = getCurrentUser();
  let rangeKey = '7d';
  let showTable = false;

  const wrapper = document.createElement('div');
  wrapper.className = 'admin-dashboard';
  container.appendChild(wrapper);

  function renderNotAuthorized() {
    wrapper.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'admin-dashboard__header';
    header.appendChild(createBackButton(onBack));
    wrapper.appendChild(header);

    const message = document.createElement('p');
    message.className = 'admin-dashboard__intro';
    message.textContent = 'Not found.';
    wrapper.appendChild(message);
  }

  function renderLoading() {
    wrapper.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'admin-dashboard__header';
    header.appendChild(createBackButton(onBack));
    const title = document.createElement('h1');
    title.className = 'admin-dashboard__title';
    title.textContent = 'Admin Dashboard';
    header.appendChild(title);
    wrapper.appendChild(header);

    const loading = document.createElement('p');
    loading.className = 'admin-dashboard__intro';
    loading.textContent = 'Loading usage data…';
    wrapper.appendChild(loading);
  }

  async function loadAndRenderStats() {
    const stats = await adminAnalyticsService.getDashboardStats(sinceDateFor(rangeKey));
    renderDashboard(stats);
  }

  function renderDashboard(stats) {
    wrapper.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'admin-dashboard__header';
    header.appendChild(createBackButton(onBack));
    const title = document.createElement('h1');
    title.className = 'admin-dashboard__title';
    title.textContent = 'Admin Dashboard';
    header.appendChild(title);
    const badge = document.createElement('span');
    badge.className = 'admin-dashboard__badge';
    badge.textContent = 'Private — not visible to teachers';
    header.appendChild(badge);
    wrapper.appendChild(header);

    // Filters sit in one row, above everything they scope, and every
    // KPI/chart re-renders against the same slice — the only exceptions
    // are Total teachers/Total students, each labeled "all time" above,
    // since a cumulative total isn't a function of the selected range.
    const filterRow = document.createElement('div');
    filterRow.className = 'toggle-group admin-dashboard__range';
    RANGE_OPTIONS.forEach((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'toggle-group__button' + (option.key === rangeKey ? ' toggle-group__button--active' : '');
      button.textContent = option.label;
      button.addEventListener('click', () => {
        if (rangeKey === option.key) return;
        rangeKey = option.key;
        renderLoading();
        loadAndRenderStats();
      });
      filterRow.appendChild(button);
    });
    wrapper.appendChild(filterRow);

    const grid = document.createElement('div');
    grid.className = 'admin-dashboard__tile-grid';
    KPI_TILES.forEach((tile) => grid.appendChild(createStatTile(tile.label, stats[tile.key], tile.footnote)));
    wrapper.appendChild(grid);

    wrapper.appendChild(createActivityChartSection(stats.chartSeries, showTable, (nextShowTable) => {
      showTable = nextShowTable;
      renderDashboard(stats);
    }));

    const footnote = document.createElement('p');
    footnote.className = 'admin-dashboard__footnote';
    footnote.textContent =
      'Student counts are approximate — the most recent roster size seen at the time of a tracked class action, summed across classrooms with recent activity. No individual student or teacher data is shown here.';
    wrapper.appendChild(footnote);
  }

  adminAnalyticsService.checkIsAdmin(user?.uid).then((isAdmin) => {
    if (!isAdmin) {
      renderNotAuthorized();
      return;
    }
    renderLoading();
    loadAndRenderStats();
  });
}

function createStatTile(label, value, footnote) {
  const tile = document.createElement('div');
  tile.className = 'admin-dashboard__tile';

  const valueEl = document.createElement('span');
  valueEl.className = 'admin-dashboard__tile-value';
  valueEl.textContent = (value ?? 0).toLocaleString();
  tile.appendChild(valueEl);

  const labelEl = document.createElement('span');
  labelEl.className = 'admin-dashboard__tile-label';
  labelEl.textContent = label;
  tile.appendChild(labelEl);

  if (footnote) {
    const footnoteEl = document.createElement('span');
    footnoteEl.className = 'admin-dashboard__tile-footnote';
    footnoteEl.textContent = footnote;
    tile.appendChild(footnoteEl);
  }

  return tile;
}

/**
 * A hand-rolled inline-SVG bar chart — this project's router.js
 * documents a deliberate "vanilla only, no library" constraint, so no
 * charting dependency is introduced. One series (daily event count),
 * so no legend is needed; the section heading names what's plotted.
 */
function createActivityChartSection(series, showTable, onToggleTable) {
  const section = document.createElement('div');
  section.className = 'admin-dashboard__chart-card';

  const chartHeader = document.createElement('div');
  chartHeader.className = 'admin-dashboard__chart-header';
  const heading = document.createElement('h2');
  heading.className = 'admin-dashboard__chart-heading';
  heading.textContent = 'Activity over time';
  chartHeader.appendChild(heading);

  const tableToggle = document.createElement('button');
  tableToggle.type = 'button';
  tableToggle.className = 'btn btn--text';
  tableToggle.textContent = showTable ? 'View as chart' : 'View as table';
  tableToggle.addEventListener('click', () => onToggleTable(!showTable));
  chartHeader.appendChild(tableToggle);

  section.appendChild(chartHeader);

  if (series.every((day) => day.count === 0)) {
    const empty = document.createElement('p');
    empty.className = 'admin-dashboard__intro';
    empty.textContent = 'No activity recorded in this range yet.';
    section.appendChild(empty);
    return section;
  }

  section.appendChild(showTable ? createActivityTable(series) : createActivityBarChart(series));
  return section;
}

function createActivityTable(series) {
  const table = document.createElement('table');
  table.className = 'admin-dashboard__table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['Date', 'Events'].forEach((text) => {
    const th = document.createElement('th');
    th.textContent = text;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  series.forEach((day) => {
    const row = document.createElement('tr');
    const dateCell = document.createElement('td');
    dateCell.textContent = day.date;
    const countCell = document.createElement('td');
    countCell.textContent = day.count.toLocaleString();
    row.append(dateCell, countCell);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  return table;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function createActivityBarChart(series) {
  const width = 640;
  const height = 220;
  const paddingLeft = 36;
  const paddingBottom = 24;
  const paddingTop = 12;
  const plotWidth = width - paddingLeft - 8;
  const plotHeight = height - paddingTop - paddingBottom;

  const maxCount = Math.max(...series.map((day) => day.count), 1);
  // Clean, round gridline steps rather than an arbitrary max.
  const gridMax = niceCeiling(maxCount);

  const wrap = document.createElement('div');
  wrap.className = 'admin-dashboard__chart-wrap';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Daily activity count over the selected range');
  svg.classList.add('admin-dashboard__chart-svg');

  // Recessive hairline gridlines — 3 horizontal steps plus the baseline.
  const gridSteps = 3;
  for (let i = 0; i <= gridSteps; i += 1) {
    const y = paddingTop + (plotHeight * i) / gridSteps;
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(paddingLeft));
    line.setAttribute('x2', String(width - 8));
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    line.setAttribute('class', 'admin-dashboard__chart-gridline');
    svg.appendChild(line);

    const tickValue = Math.round(gridMax * (1 - i / gridSteps));
    const tick = document.createElementNS(SVG_NS, 'text');
    tick.setAttribute('x', String(paddingLeft - 8));
    tick.setAttribute('y', String(y + 4));
    tick.setAttribute('text-anchor', 'end');
    tick.setAttribute('class', 'admin-dashboard__chart-tick');
    tick.textContent = tickValue.toLocaleString();
    svg.appendChild(tick);
  }

  const barSlot = plotWidth / series.length;
  const barWidth = Math.max(4, Math.min(24, barSlot - 2));

  series.forEach((day, index) => {
    const barHeight = gridMax === 0 ? 0 : (day.count / gridMax) * plotHeight;
    const x = paddingLeft + index * barSlot + (barSlot - barWidth) / 2;
    const y = paddingTop + plotHeight - barHeight;

    if (barHeight > 0) {
      const bar = document.createElementNS(SVG_NS, 'path');
      bar.setAttribute('d', roundedTopBarPath(x, y, barWidth, barHeight, 4));
      bar.setAttribute('class', 'admin-dashboard__chart-bar');
      bar.setAttribute('tabindex', '0');
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', `${day.date}: ${day.count} events`);

      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${day.date}: ${day.count.toLocaleString()} event${day.count === 1 ? '' : 's'}`;
      bar.appendChild(title);

      svg.appendChild(bar);
    }

    // Sparse x-axis labels — every bar would collide at 30 days; show
    // at most ~6 evenly-spaced dates, matching "label selectively."
    const labelEvery = Math.ceil(series.length / 6);
    if (index % labelEvery === 0) {
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', String(x + barWidth / 2));
      label.setAttribute('y', String(height - 6));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'admin-dashboard__chart-tick');
      label.textContent = formatShortDate(day.date);
      svg.appendChild(label);
    }
  });

  wrap.appendChild(svg);
  return wrap;
}

/**
 * A bar with rounded top corners and a square baseline (per this
 * project's dataviz method: "4px rounded data-end, square at the
 * baseline") — an SVG <rect>'s own `rx` rounds all four corners, so
 * this draws the outline directly instead.
 */
function roundedTopBarPath(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height);
  return [
    `M ${x} ${y + height}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + width - r} ${y}`,
    `Q ${x + width} ${y} ${x + width} ${y + r}`,
    `L ${x + width} ${y + height}`,
    'Z',
  ].join(' ');
}

function niceCeiling(value) {
  if (value <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function formatShortDate(isoDate) {
  const [, month, day] = isoDate.split('-');
  return `${month}/${day}`;
}
