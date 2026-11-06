/**
 * ui/components/NotebookStatusSummary.js
 *
 * Renders the four canonical notebook-status counts (Awaiting
 * Submission / Awaiting Review / Needs Correction / Reviewed, plus
 * WorkRequest's own `absent` when present) as real, keyboard-operable
 * `<button>` stat cards — activating one expands an inline list of the
 * exact notebooks/checkpoints contributing to that count, each with
 * its own due date. Built on services/notebookStatusService.js's own
 * merged `{ summary, items }` shape — shared by the teacher-facing
 * Student Profile Notebooks tab and the student-facing Notebook view,
 * so the two screens are structurally incapable of disagreeing: there
 * is exactly one place this status-count rendering logic lives, reading
 * exactly one merged data source.
 */

const STATUS_CARDS = [
  { key: 'awaitingSubmission', label: 'Awaiting Submission' },
  { key: 'awaitingReview', label: 'Awaiting Review' },
  { key: 'needsCorrection', label: 'Needs Correction' },
  { key: 'reviewed', label: 'Reviewed' },
];

function formatDueDate(dueDate) {
  return dueDate ? `Due ${dueDate}` : 'No due date';
}

/**
 * `container` is cleared and owned entirely by this function.
 * `emptyMessage` customizes the text shown when an opened status has
 * no contributing items (shouldn't normally happen — a status with
 * count 0 simply isn't shown as having anything to open — but a stale
 * render between a mutation and its next refresh could still reach
 * this, so it's handled rather than left blank).
 */
export function renderNotebookStatusSummary(container, { summary, items }, { emptyMessage = 'Nothing in this status right now.' } = {}) {
  container.innerHTML = '';
  container.classList.add('notebook-status-summary');

  const cards = [...STATUS_CARDS];
  if (summary.absent > 0) cards.push({ key: 'absent', label: 'Absent' });

  const statsRow = document.createElement('div');
  statsRow.className = 'profile-overview notebook-status-summary__row';

  const detailPanel = document.createElement('div');
  detailPanel.className = 'notebook-status-summary__detail';
  detailPanel.hidden = true;

  let openKey = null;

  function renderDetail(key, label) {
    detailPanel.innerHTML = '';
    const list = items[key] || [];

    const heading = document.createElement('h3');
    heading.className = 'notebook-status-summary__detail-heading';
    heading.textContent = label;
    detailPanel.appendChild(heading);

    if (list.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'notebook-status-summary__detail-empty';
      empty.textContent = emptyMessage;
      detailPanel.appendChild(empty);
      return;
    }

    const ul = document.createElement('ul');
    ul.className = 'notebook-status-summary__detail-list';
    list.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'notebook-status-summary__detail-item';

      const titleEl = document.createElement('span');
      titleEl.className = 'notebook-status-summary__detail-title';
      titleEl.textContent = item.title;
      li.appendChild(titleEl);

      const dueEl = document.createElement('span');
      dueEl.className = 'notebook-status-summary__detail-due';
      dueEl.textContent = formatDueDate(item.dueDate);
      li.appendChild(dueEl);

      ul.appendChild(li);
    });
    detailPanel.appendChild(ul);
  }

  cards.forEach(({ key, label }) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'profile-stat-card notebook-status-summary__card';
    card.setAttribute('aria-expanded', 'false');
    card.setAttribute('aria-label', `${label}: ${summary[key] || 0}. Activate to see which notebooks contribute to this count.`);

    const labelEl = document.createElement('span');
    labelEl.className = 'profile-stat-card__label';
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.className = 'profile-stat-card__value';
    valueEl.textContent = String(summary[key] || 0);

    card.append(labelEl, valueEl);

    card.addEventListener('click', () => {
      const wasOpen = openKey === key;
      statsRow.querySelectorAll('.notebook-status-summary__card').forEach((el) => el.setAttribute('aria-expanded', 'false'));
      if (wasOpen) {
        openKey = null;
        detailPanel.hidden = true;
        return;
      }
      openKey = key;
      card.setAttribute('aria-expanded', 'true');
      renderDetail(key, label);
      detailPanel.hidden = false;
    });

    statsRow.appendChild(card);
  });

  container.append(statsRow, detailPanel);
}
