/**
 * ui/views/NotebookTrackerView.js
 *
 * The classroom-level Notebook landing page — a pure launcher now,
 * per explicit product decision: "Notebook Type → Checkpoints"
 * directly, with the old "Notebook Type → Notebook Check →
 * Checkpoints" middle layer removed from this workflow entirely.
 *
 * The old "Notebook Check" card grid (fed by
 * services/workTypes/NotebookWorkType.js's own getActiveWork()/
 * getStartActions(), leading to ui/views/WorkRequestCreateView.js —
 * a genuinely different flow from Checkpoints) and the separate
 * "Checkpoints" text-link list are both gone from this page, replaced
 * by one unified grid of Notebook Type cards
 * (createNotebookTypeCard() below) — each one a plain, clickable
 * destination straight to its own real Checkpoints screen
 * (ui/views/NotebookCheckpointsView.js, via the exact, unmodified
 * notebookCheckpoints route in ui/router.js). Neither
 * NotebookWorkType.js nor WorkRequestCreateView.js was touched at
 * all — "starting a new notebook check" still exists as a real
 * capability, it's simply no longer surfaced on this specific
 * landing page.
 *
 * "⚙ Configure Notebook Types" is deliberately phrased as a doorway
 * out, not an action that belongs to this screen — per the frozen
 * Operational Work / Configuration boundary, this tracker is
 * operational; adding a new Subject/Notebook Type is configuration,
 * and the link should read as "you are about to leave this space,"
 * not as "this is one more thing this screen does." Visually
 * lightweight and set apart from the card grid by explicit product
 * decision — configuration should recede, not compete with real
 * operational work for attention. It links straight to the existing
 * Settings → Notebooks screen; nothing here duplicates that screen's
 * own creation form.
 */

import * as workRequestService from '../../services/workRequestService.js';
import * as notebookConfigService from '../../services/notebookConfigService.js';
import { getClassroomStudents } from '../../services/assessmentService.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { createBackButton } from '../components/BackButton.js';

export function renderNotebookTrackerView(container, { classroom, onBack, onNavigate, onOpenNotebookConfiguration }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'activities-view';

  const header = document.createElement('header');
  header.className = 'tracker-header';
  const backButton = createBackButton(onBack);
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = 'Notebook Tracker';
  header.append(backButton, title);
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'wizard-step-content notebook-tracker__content';

  const needsAttention = workRequestService.getStudentsNeedingAttention(classroom);
  if (needsAttention.length > 0) {
    content.appendChild(renderNeedsAttentionSection(needsAttention, classroom, onNavigate));
  }

  const configuredNotebooks = listConfiguredNotebooks(classroom);
  if (configuredNotebooks.length === 0) {
    content.appendChild(createEmptyStateElement({ message: 'No subjects or notebook types configured yet.' }));
  } else {
    const grid = document.createElement('div');
    grid.className = 'operational-work-grid';
    configuredNotebooks.forEach(({ subject, notebookType }) => {
      grid.appendChild(createNotebookTypeCard(subject, notebookType, classroom, onNavigate));
    });
    content.appendChild(grid);
  }

  content.appendChild(createConfigureNotebookTypesLink(onOpenNotebookConfiguration));

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

/**
 * Classroom-wide "who needs attention" — the one genuine teacher-side
 * gap identified before implementing anything else: per-student
 * history already existed (workRequestService.getStudentSummary()),
 * but only ever visible one student at a time via their own profile.
 * This surfaces the pattern directly, without a teacher needing to
 * already suspect a specific student. Each row links straight to
 * that exact, already-existing drill-down (StudentProfileView's own
 * 'notebooks' tab) — no new destination invented.
 */
/** Every configured Subject x Notebook Type combination — the same enumeration NotebookWorkType.js's own getStartActions() already does internally, reused directly here since this section needs the same list for a genuinely different purpose (a permanent destination, not a start-action). */
function listConfiguredNotebooks(classroom) {
  const notebooks = [];
  notebookConfigService.listSubjects(classroom).forEach((subject) => {
    notebookConfigService.listNotebookTypes(classroom, subject.id).forEach((notebookType) => {
      notebooks.push({ subject, notebookType });
    });
  });
  return notebooks;
}

/**
 * A selectable destination, not an operational status card — per
 * explicit product decision, this is deliberately simpler than
 * ui/components/OperationalWorkCard.js (no status line, no separate
 * button; the whole card is the click target), matching the "choose
 * a notebook, see its checkpoints" mental model directly. Navigates
 * straight to the exact, unmodified Checkpoints route
 * (ui/router.js's own notebookCheckpoints route,
 * ui/views/NotebookCheckpointsView.js) — no new routing, no new
 * model.
 */
function createNotebookTypeCard(subject, notebookType, classroom, onNavigate) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'notebook-tracker__type-card';
  card.addEventListener('click', () =>
    onNavigate(`/classroom/${classroom.id}/notebooks/${subject.id}/${notebookType.id}/checkpoints`)
  );

  const icon = document.createElement('span');
  icon.className = 'notebook-tracker__type-card-icon';
  icon.textContent = '\ud83d\udcd3';
  icon.setAttribute('aria-hidden', 'true');
  card.appendChild(icon);

  const title = document.createElement('span');
  title.className = 'notebook-tracker__type-card-title';
  title.textContent = `${subject.name} \u00b7 ${notebookType.name}`;
  card.appendChild(title);

  return card;
}

function renderNeedsAttentionSection(needsAttention, classroom, onNavigate) {
  const section = document.createElement('div');
  section.className = 'notebook-tracker__attention';

  const heading = document.createElement('p');
  heading.className = 'notebook-tracker__attention-heading';
  heading.textContent = '\u26a0\ufe0f Needs Attention';
  section.appendChild(heading);

  const students = getClassroomStudents(classroom);
  const list = document.createElement('div');
  list.className = 'notebook-tracker__attention-list';

  needsAttention.forEach(({ studentId, count }) => {
    const student = students.find((s) => s.id === studentId);
    if (!student) return; // a student who has since left the roster — nothing meaningful to show

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'notebook-tracker__attention-row';
    const name = document.createElement('span');
    name.textContent = student.name;
    const badge = document.createElement('span');
    badge.className = 'notebook-tracker__attention-badge';
    badge.textContent = `${count} issue${count === 1 ? '' : 's'}`;
    row.append(name, badge);
    row.addEventListener('click', () => onNavigate(`/classroom/${classroom.id}/student/${studentId}/notebooks`));
    list.appendChild(row);
  });

  section.appendChild(list);
  return section;
}

/**
 * Deliberately styled and worded as a doorway out of this operational
 * screen, not an action this screen performs — see this file's own
 * header comment for why "⚙ Configure" rather than "+ Add" is the
 * correct grammar here.
 */
function createConfigureNotebookTypesLink(onOpenNotebookConfiguration) {
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'notebook-tracker__configure-link';
  link.textContent = '\u2699 Configure Notebook Types';
  link.addEventListener('click', () => onOpenNotebookConfiguration());
  return link;
}
