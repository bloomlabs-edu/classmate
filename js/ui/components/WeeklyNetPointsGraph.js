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
 */

export function createWeeklyNetPointsSection(weeklyNetPoints) {
  const section = document.createElement('div');
  section.className = 'student-journey__section';

  const title = document.createElement('h2');
  title.className = 'student-journey__section-title';
  title.textContent = 'This Week';
  section.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'weekly-net-graph__subtitle';
  subtitle.textContent = 'How your points moved this week';
  section.appendChild(subtitle);

  section.appendChild(createWeeklyNetGraphSvg(weeklyNetPoints));

  return section;
}

function createWeeklyNetGraphSvg(weeklyNetPoints) {
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
    <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Weekly net point movement, Monday through Friday">
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
