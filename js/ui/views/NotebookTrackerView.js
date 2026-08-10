/**
 * ui/views/NotebookTrackerView.js
 *
 * The classroom-level Notebook landing page — an OPERATIONAL
 * workspace, not a configuration list. Renders directly from
 * services/workTypes/NotebookWorkType.js's own getActiveWork()/
 * getStartActions() — this view contains zero notebook-specific
 * business logic itself; every card's title/subtitle/count/
 * navigateTo already came fully-formed from NotebookWorkType, per the
 * frozen WorkType architecture ("Dashboard owns all presentation...
 * WorkType orchestrates domain services, never duplicates business
 * logic").
 *
 * Redesigned into a card dashboard (ui/components/OperationalWorkCard.js)
 * — a pure presentation-layer change. No service touched, no WorkType
 * interface touched, no new persistence: every card still consumes
 * exactly the same plain { title, subtitle, count, navigateTo } shape
 * that already existed. One real, pre-existing bug fixed along the
 * way: the "start a new check" button used to display item.title
 * itself ("New Homework") as its own button label, instead of a real
 * call-to-action — now correctly reads "Start Notebook Check".
 *
 * The grid (.operational-work-grid) is responsive via CSS alone —
 * 2-3 columns on desktop, 2 on tablet, 1 on mobile — no JS layout
 * logic, matching how every other grid in this app already works.
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

import { NotebookWorkType } from '../../services/workTypes/NotebookWorkType.js';
import * as workRequestService from '../../services/workRequestService.js';
import * as notebookConfigService from '../../services/notebookConfigService.js';
import { getClassroomStudents } from '../../services/assessmentService.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { createBackButton } from '../components/BackButton.js';
import { createOperationalWorkCard } from '../components/OperationalWorkCard.js';

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
  if (configuredNotebooks.length > 0) {
    content.appendChild(renderCheckpointsEntrySection(configuredNotebooks, classroom, onNavigate));
  }

  const activeWork = NotebookWorkType.getActiveWork(classroom);
  const startActions = NotebookWorkType.getStartActions(classroom);

  if (activeWork.length === 0 && startActions.length === 0) {
    content.appendChild(createEmptyStateElement({ message: 'No subjects or notebook types configured yet.' }));
  } else {
    const grid = document.createElement('div');
    grid.className = 'operational-work-grid';

    activeWork.forEach((item) => {
      grid.appendChild(createOperationalWorkCard(item, 'Continue', onNavigate));
    });
    startActions.forEach((item) => {
      grid.appendChild(createOperationalWorkCard(item, 'Start Notebook Check', onNavigate));
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
 * A genuinely separate section from the Active Work / Start Actions
 * grid above — Checkpoints are an always-present destination per
 * Notebook, not "active work awaiting something" or "a new check to
 * start," so this deliberately does not go through
 * NotebookWorkType.js's own frozen getActiveWork()/getStartActions()
 * contract at all.
 */
function renderCheckpointsEntrySection(configuredNotebooks, classroom, onNavigate) {
  const section = document.createElement('div');
  section.className = 'notebook-tracker__checkpoints-entry';

  const heading = document.createElement('p');
  heading.className = 'notebook-tracker__checkpoints-entry-heading';
  heading.textContent = 'Checkpoints';
  section.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'notebook-tracker__checkpoints-entry-list';

  configuredNotebooks.forEach(({ subject, notebookType }) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'notebook-tracker__checkpoints-entry-row';
    row.textContent = `${subject.name} \u00b7 ${notebookType.name} \u2192`;
    row.addEventListener('click', () =>
      onNavigate(`/classroom/${classroom.id}/notebooks/${subject.id}/${notebookType.id}/checkpoints`)
    );
    list.appendChild(row);
  });

  section.appendChild(list);
  return section;
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
