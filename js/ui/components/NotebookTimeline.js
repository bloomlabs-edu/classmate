/**
 * ui/components/NotebookTimeline.js
 *
 * A single student's day-by-day symbol strip for one month (✅ 🟡 ❌ ⏰
 * 🚫 •) — read-only. Used both stacked per-roster-student in
 * ui/views/NotebookTimelineView.js and as a single instance in the
 * Student Profile's Notebooks tab. Purely props-driven: the caller
 * (a view) does the day-by-day lookup via services/notebookService.js
 * and symbol derivation via config/notebookStatuses.js, and hands this
 * component a plain array — no service calls happen in here.
 */

export function createNotebookTimelineElement({ days, label, onLabelClick }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'notebook-timeline-row';

  if (label) {
    let labelEl;
    if (onLabelClick) {
      labelEl = document.createElement('button');
      labelEl.type = 'button';
      labelEl.className = 'notebook-timeline-row__label student-name-link';
      labelEl.addEventListener('click', onLabelClick);
    } else {
      labelEl = document.createElement('span');
      labelEl.className = 'notebook-timeline-row__label';
    }
    labelEl.textContent = label;
    wrapper.appendChild(labelEl);
  }

  const strip = document.createElement('div');
  strip.className = 'notebook-timeline';

  days.forEach(({ dateKey, symbol, statusLabel }) => {
    const dayEl = document.createElement('span');
    dayEl.className = 'notebook-timeline__day';
    dayEl.textContent = symbol;
    dayEl.title = `${dateKey} \u00b7 ${statusLabel}`;
    strip.appendChild(dayEl);
  });

  wrapper.appendChild(strip);
  return wrapper;
}
