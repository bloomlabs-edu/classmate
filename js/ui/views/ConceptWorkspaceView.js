/**
 * ui/views/ConceptWorkspaceView.js
 *
 * The Concept Workspace, opened by clicking a concept in
 * ui/views/LearningRecordView.js's Lessons level — the permanent home
 * for every concept-related feature (see
 * docs/UNIFIED_PLATFORM_ARCHITECTURE.md). Nothing else in the app
 * should grow a second "click a concept, see its stuff" surface.
 *
 * Self-contained, same pattern as LearningRecordView.js: no router, no
 * URL, local tab/mode state in a closure, re-renders itself into
 * whatever container it's handed. The only thing it's given is
 * `onBack`.
 *
 * Reuses, never duplicates:
 *   - The Learning Record tab is the *same* taught/not-taught control
 *     (learningRecordTeacherService.setConceptTaughtStatus) as the
 *     Lessons-level list already uses — factored into one shared
 *     function (createTaughtToggle, below) so there is exactly one
 *     taught-toggle implementation in the codebase, not two.
 *   - Student Progress reads the same
 *     learningRecordService.getStudentConceptRecord() per-student data
 *     Phase 1 already built services for, using the same
 *     config/learningRecordConfig.js labels — no new analytics, no new
 *     computation.
 *   - Resources is real CRUD — create/rename/delete/reorder/status —
 *     through services/resourceService.js, with a Resource Details
 *     view giving each resource its own page (icon, type, status,
 *     created date, and a disabled "Open Editor" action) rather than
 *     everything crammed onto a list row. No editor, no upload, no
 *     content fields yet: see resourceService.js's own doc comment
 *     for exactly where a future per-type editor attaches.
 */

import * as workspaceService from '../../services/workspaceService.js';
import * as learningRecordService from '../../services/learningRecordService.js';
import * as learningRecordTeacherService from '../../services/learningRecordTeacherService.js';
import * as resourceService from '../../services/resourceService.js';
import { getUnderstandingLabel, getNotebookStatusLabel } from '../../config/learningRecordConfig.js';
import {
  RESOURCE_TYPE_KEYS,
  RESOURCE_STATUS_KEYS,
  getResourceTypeLabel,
  getResourceTypeIcon,
  getResourceStatusLabel,
} from '../../config/resourceTypeConfig.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { createIcon } from '../components/Icon.js';
import { createBackButton } from '../components/BackButton.js';
import { renderReadingEditorView } from './ReadingEditorView.js';
import { renderReadingViewerView } from './ReadingViewerView.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'learning-record', label: 'Learning Record' },
  { id: 'resources', label: 'Resources' },
  { id: 'student-progress', label: 'Student Progress' },
];

export function renderConceptWorkspaceView(container, { classroom, subject, unit, concept, onBack, initialResourceId = null }) {
  // Defaults to Overview/list, same as always — unless opened via the
  // Dashboard's "Continue Working" resource shortcut
  // (ui/views/DashboardView.js), in which case initialResourceId jumps
  // straight to that resource's own Details tab. Either way, once
  // rendered, the workspace behaves identically — this only changes
  // where it lands, not how it works.
  let activeTab = initialResourceId ? 'resources' : 'overview';

  // Resources' own sub-navigation, local to this closure like
  // activeTab — 'list' (the normal card grid), 'choose-type' (pick a
  // type after tapping + Add Resource), 'name-new' (immediate naming
  // for the type just chosen, before anything is created), or
  // 'details' (one resource's own page). pendingType/selectedResourceId
  // only ever matter alongside their corresponding mode.
  let resourceMode = initialResourceId ? 'details' : 'list';
  let pendingType = null;
  let selectedResourceId = initialResourceId;

  function rerender() {
    renderWorkspace(container, classroom, subject, unit, concept, activeTab, { resourceMode, pendingType, selectedResourceId }, {
      onBack,
      onSelectTab: (tabId) => {
        activeTab = tabId;
        resourceMode = 'list'; // switching tabs away and back always returns to the plain list
        pendingType = null;
        selectedResourceId = null;
        rerender();
      },
      onStartAddResource: () => {
        resourceMode = 'choose-type';
        rerender();
      },
      onChooseResourceType: (type) => {
        pendingType = type;
        resourceMode = 'name-new';
        rerender();
      },
      onCreateResource: (title) => {
        const resource = resourceService.createResourceOnConcept(concept, { title, type: pendingType });
        workspaceService.save(classroom);
        pendingType = null;
        selectedResourceId = resource.id;
        resourceMode = 'details'; // land on the new resource's own page, not back on the list
        rerender();
      },
      onSelectResource: (resourceId) => {
        selectedResourceId = resourceId;
        resourceMode = 'details';
        rerender();
      },
      onBackToResourceList: () => {
        resourceMode = 'list';
        pendingType = null;
        selectedResourceId = null;
        rerender();
      },
      rerender,
    });
  }

  rerender();
}

function renderWorkspace(container, classroom, subject, unit, concept, activeTab, resourceState, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'concept-workspace';

  // Header
  const header = document.createElement('header');
  header.className = 'concept-workspace__header';

  const backButton = createBackButton(handlers.onBack);
  header.appendChild(backButton);

  const breadcrumb = document.createElement('p');
  breadcrumb.className = 'concept-workspace__breadcrumb';
  breadcrumb.textContent = `${subject.title} \u203a ${unit.title}`;
  header.appendChild(breadcrumb);

  const title = document.createElement('h1');
  title.className = 'concept-workspace__title';
  title.textContent = concept.title;
  header.appendChild(title);

  wrapper.appendChild(header);

  // Tab bar
  const tabBar = document.createElement('div');
  tabBar.className = 'toggle-group concept-workspace__tab-bar';
  TABS.forEach((tab) => {
    const tabButton = document.createElement('button');
    tabButton.type = 'button';
    tabButton.className = 'toggle-group__button' + (tab.id === activeTab ? ' toggle-group__button--active' : '');
    tabButton.textContent = tab.label;
    tabButton.addEventListener('click', () => handlers.onSelectTab(tab.id));
    tabBar.appendChild(tabButton);
  });
  wrapper.appendChild(tabBar);

  // Tab content
  const content = document.createElement('div');
  content.className = 'concept-workspace__content';

  if (activeTab === 'learning-record') {
    content.appendChild(renderLearningRecordTab(classroom, concept, handlers));
  } else if (activeTab === 'resources') {
    content.appendChild(renderResourcesTab(container, classroom, concept, resourceState, handlers));
  } else if (activeTab === 'student-progress') {
    content.appendChild(renderStudentProgressTab(classroom, concept));
  } else {
    content.appendChild(renderOverviewTab(classroom, concept));
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

// ---- Overview ---------------------------------------------------------

function renderOverviewTab(classroom, concept) {
  const section = document.createElement('div');
  section.className = 'concept-workspace__section';

  const allStudents = classroom.teams.flatMap((team) => team.students);
  const records = allStudents.map((student) => learningRecordService.getStudentConceptRecord(student, concept.id));

  // "Needing help" = the explicit helpRequested flag a student sets
  // themselves (see models/StudentConceptRecord.js) — the literal
  // signal this field exists to carry, not inferred from
  // understanding='need_help', which is a separate, independent field
  // a student could set without ever tapping "request help."
  const needingHelpCount = records.filter((record) => record.helpRequested).length;

  // "Mastered" = understanding === 'can_teach', the top tier of
  // config/learningRecordConfig.js's UNDERSTANDING_KEYS — the
  // strongest self-reported signal available, matching "mastered"
  // more precisely than the middle "understand" tier.
  const masteredCount = records.filter((record) => record.understanding === 'can_teach').length;

  // Real data now that Resource CRUD exists (see
  // services/resourceService.js) — this was a hardcoded 0 before that
  // system existed; per this project's "never fabricate placeholder
  // data" principle, it had to become real the moment it could be.
  const resourceCount = resourceService.getResources(concept).length;

  const isTaught = concept.status === 'taught';

  const statusRow = document.createElement('div');
  statusRow.className = 'concept-workspace__status-row';
  const statusBadge = document.createElement('span');
  statusBadge.className = 'learning-record-taught-toggle' + (isTaught ? ' learning-record-taught-toggle--taught' : '');
  statusBadge.textContent = isTaught ? '\u2713 Taught' : '\u25cb Not Taught';
  statusRow.appendChild(statusBadge);
  section.appendChild(statusRow);

  const statsGrid = document.createElement('div');
  statsGrid.className = 'concept-workspace__stats-grid';
  statsGrid.append(
    createStatCard('Resources Attached', resourceCount),
    createStatCard('Students Needing Help', needingHelpCount),
    createStatCard('Students Who Mastered This', masteredCount)
  );
  section.appendChild(statsGrid);

  return section;
}

function createStatCard(label, value) {
  const card = document.createElement('div');
  card.className = 'concept-workspace__stat-card';

  const valueEl = document.createElement('p');
  valueEl.className = 'concept-workspace__stat-value';
  valueEl.textContent = String(value);

  const labelEl = document.createElement('p');
  labelEl.className = 'concept-workspace__stat-label';
  labelEl.textContent = label;

  card.append(valueEl, labelEl);
  return card;
}

// ---- Learning Record ----------------------------------------------------

/**
 * The exact same taught/not-taught control as the Lessons-level list
 * in LearningRecordView.js — see createTaughtToggle() below, the one
 * shared implementation both places call.
 */
function renderLearningRecordTab(classroom, concept, handlers) {
  const section = document.createElement('div');
  section.className = 'concept-workspace__section';

  const intro = document.createElement('p');
  intro.className = 'concept-workspace__tab-intro';
  intro.textContent = 'Mark whether this concept has been taught to the class yet.';
  section.appendChild(intro);

  section.appendChild(
    createTaughtToggle(classroom, concept, () => {
      workspaceService.save(classroom);
      handlers.rerender();
    })
  );

  return section;
}

/**
 * Shared by both the Concept Workspace (this file) and the Lessons
 * level (LearningRecordView.js) — kept here since the workspace is
 * meant to become the permanent home for concept-level features, and
 * LearningRecordView.js's own row is a thin caller of this same
 * function. There is exactly one taught-toggle implementation.
 */
export function createTaughtToggle(classroom, concept, onChanged) {
  const isTaught = concept.status === 'taught';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'learning-record-taught-toggle' + (isTaught ? ' learning-record-taught-toggle--taught' : '');
  toggle.textContent = isTaught ? '\u2713 Taught' : '\u25cb Not Taught';
  toggle.addEventListener('click', () => {
    learningRecordTeacherService.setConceptTaughtStatus(classroom, concept.id, isTaught ? 'not_taught' : 'taught');
    onChanged();
  });
  return toggle;
}

// ---- Resources ----------------------------------------------------

/**
 * Real CRUD — create (with immediate naming, via the type-picker and
 * naming step below), rename, delete, reorder, and status
 * (Draft/Published/Archived). Resources render as cards in a grid, not
 * plain rows — icon, title, type, status badge — and clicking a card
 * opens that resource's own Details page rather than editing it inline
 * from the list, so a resource reads as a real object with its own
 * identity, not just a row of metadata. No editor, no upload, no
 * content fields: Resource Details' "Open Editor" button is present
 * but disabled, marking exactly where a future per-type editor will
 * attach (see services/resourceService.js's doc comment) without
 * pretending that editor exists yet.
 */
function renderResourcesTab(container, classroom, concept, resourceState, handlers) {
  const { resourceMode, pendingType, selectedResourceId } = resourceState;

  if (resourceMode === 'choose-type') {
    return renderChooseResourceTypeView(handlers);
  }
  if (resourceMode === 'name-new') {
    return renderNameNewResourceView(pendingType, handlers);
  }
  if (resourceMode === 'details') {
    const resource = resourceService.getResourceById(concept, selectedResourceId);
    // The resource this page was opened for no longer exists (deleted
    // from another tab/device) — fall back to the list rather than
    // rendering a details page with nothing to show, same "handle the
    // gone-missing case explicitly" reasoning used elsewhere in this
    // app rather than letting it render broken.
    if (!resource) return renderResourceListView(classroom, concept, handlers);
    return renderResourceDetailsView(container, classroom, concept, resource, handlers);
  }
  return renderResourceListView(classroom, concept, handlers);
}

function renderResourceListView(classroom, concept, handlers) {
  const section = document.createElement('div');
  section.className = 'concept-workspace__section';

  const resources = resourceService.getResources(concept);

  if (resources.length === 0) {
    section.appendChild(createEmptyStateElement({ message: 'No resources yet.' }));
  } else {
    const grid = document.createElement('div');
    grid.className = 'concept-workspace__resource-grid';

    resources.forEach((resource, index) => {
      grid.appendChild(createResourceCard(classroom, concept, resource, index, resources.length, handlers));
    });

    section.appendChild(grid);
  }

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'btn btn--primary';
  addButton.textContent = '+ Add Resource';
  addButton.addEventListener('click', handlers.onStartAddResource);
  section.appendChild(addButton);

  return section;
}

function createResourceCard(classroom, concept, resource, index, total, handlers) {
  const card = document.createElement('div');
  card.className = 'concept-workspace__resource-card';

  const reorderColumn = document.createElement('div');
  reorderColumn.className = 'concept-workspace__resource-reorder';

  const upButton = document.createElement('button');
  upButton.type = 'button';
  upButton.className = 'concept-workspace__resource-reorder-button';
  upButton.textContent = '\u25b2';
  upButton.setAttribute('aria-label', `Move ${resource.title} up`);
  upButton.disabled = index === 0;
  upButton.addEventListener('click', (event) => {
    event.stopPropagation();
    resourceService.moveResourceUp(concept, resource.id);
    workspaceService.save(classroom);
    handlers.rerender();
  });

  const downButton = document.createElement('button');
  downButton.type = 'button';
  downButton.className = 'concept-workspace__resource-reorder-button';
  downButton.textContent = '\u25bc';
  downButton.setAttribute('aria-label', `Move ${resource.title} down`);
  downButton.disabled = index === total - 1;
  downButton.addEventListener('click', (event) => {
    event.stopPropagation();
    resourceService.moveResourceDown(concept, resource.id);
    workspaceService.save(classroom);
    handlers.rerender();
  });

  reorderColumn.append(upButton, downButton);
  card.appendChild(reorderColumn);

  // The card's main body is its own button so the whole card (not
  // just the title) opens Resource Details — the reorder arrows above
  // stop their own click from bubbling into this, so they don't
  // accidentally open the details page too.
  const body = document.createElement('button');
  body.type = 'button';
  body.className = 'concept-workspace__resource-card-body';
  body.addEventListener('click', () => handlers.onSelectResource(resource.id));

  const iconWrap = document.createElement('span');
  iconWrap.className = 'concept-workspace__resource-card-icon';
  iconWrap.appendChild(createIcon(getResourceTypeIcon(resource.type), { size: 22 }));
  body.appendChild(iconWrap);

  const textWrap = document.createElement('span');
  textWrap.className = 'concept-workspace__resource-card-text';

  const titleEl = document.createElement('span');
  titleEl.className = 'concept-workspace__resource-card-title';
  titleEl.textContent = resource.title;
  textWrap.appendChild(titleEl);

  const metaEl = document.createElement('span');
  metaEl.className = 'concept-workspace__resource-card-meta';
  metaEl.textContent = getResourceTypeLabel(resource.type);
  textWrap.appendChild(metaEl);

  body.appendChild(textWrap);

  const statusBadge = document.createElement('span');
  const status = resource.status || 'draft'; // older resources saved before status existed default to Draft
  statusBadge.className = `concept-workspace__resource-status-badge concept-workspace__resource-status-badge--${status}`;
  statusBadge.textContent = getResourceStatusLabel(status);
  body.appendChild(statusBadge);

  card.appendChild(body);
  return card;
}

function renderChooseResourceTypeView(handlers) {
  const section = document.createElement('div');
  section.className = 'concept-workspace__section';

  const backButton = createBackButton(handlers.onBackToResourceList);
  section.appendChild(backButton);

  const heading = document.createElement('p');
  heading.className = 'concept-workspace__tab-intro';
  heading.textContent = 'Choose Resource Type';
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'concept-workspace__resource-type-grid';

  RESOURCE_TYPE_KEYS.forEach((type) => {
    const typeButton = document.createElement('button');
    typeButton.type = 'button';
    typeButton.className = 'concept-workspace__resource-type-option';
    typeButton.appendChild(createIcon(getResourceTypeIcon(type), { size: 20 }));
    const label = document.createElement('span');
    label.textContent = getResourceTypeLabel(type);
    typeButton.appendChild(label);
    typeButton.addEventListener('click', () => handlers.onChooseResourceType(type));
    grid.appendChild(typeButton);
  });

  section.appendChild(grid);
  return section;
}

/**
 * Immediate naming — the resource is not created until this step
 * completes. A teacher who backs out here leaves nothing behind, not
 * an untitled draft object floating in the list.
 */
function renderNameNewResourceView(pendingType, handlers) {
  const section = document.createElement('div');
  section.className = 'concept-workspace__section';

  const backButton = createBackButton(handlers.onBackToResourceList);
  section.appendChild(backButton);

  const heading = document.createElement('p');
  heading.className = 'concept-workspace__tab-intro';
  const typeLabel = getResourceTypeLabel(pendingType);
  heading.appendChild(createIcon(getResourceTypeIcon(pendingType), { size: 18 }));
  heading.append(` Name your ${typeLabel}`);
  section.appendChild(heading);

  const form = document.createElement('div');
  form.className = 'concept-workspace__name-new-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = typeLabel;
  input.placeholder = `e.g. ${typeLabel}: Introduction`;

  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'btn btn--primary';
  createButton.textContent = 'Create';
  createButton.addEventListener('click', () => {
    const title = input.value.trim();
    if (!title) return;
    handlers.onCreateResource(title);
  });

  form.append(input, createButton);
  section.appendChild(form);

  // Autofocus and pre-select so a teacher can just start typing to
  // replace the suggested default, or press Create to accept it as-is.
  input.focus();

  return section;
}

/**
 * A resource's own page — icon, editable title, type (fixed at
 * creation, not editable — changing what a resource *is* isn't a
 * rename, it's effectively a different resource), a status control,
 * created date, and the disabled "Open Editor" extension point. This
 * is what "make resources feel complete as objects" means concretely:
 * a resource has a real home, not just a row in a list.
 */
function renderResourceDetailsView(container, classroom, concept, resource, handlers) {
  const section = document.createElement('div');
  section.className = 'concept-workspace__section';

  const backButton = createBackButton(handlers.onBackToResourceList);
  section.appendChild(backButton);

  const detailsCard = document.createElement('div');
  detailsCard.className = 'concept-workspace__resource-details-card';

  const iconRow = document.createElement('div');
  iconRow.className = 'concept-workspace__resource-details-icon';
  iconRow.appendChild(createIcon(getResourceTypeIcon(resource.type), { size: 32 }));
  detailsCard.appendChild(iconRow);

  const titleInput = createResourceRenameInput(resource.title, (newTitle) => {
    resourceService.renameResource(concept, resource.id, newTitle);
    workspaceService.save(classroom);
  });
  titleInput.classList.add('concept-workspace__resource-details-title-input');
  detailsCard.appendChild(titleInput);

  const typeLine = document.createElement('p');
  typeLine.className = 'concept-workspace__resource-details-meta';
  typeLine.textContent = `Type: ${getResourceTypeLabel(resource.type)}`;
  detailsCard.appendChild(typeLine);

  const createdLine = document.createElement('p');
  createdLine.className = 'concept-workspace__resource-details-meta';
  createdLine.textContent = `Created: ${formatDate(resource.createdAt)}`;
  detailsCard.appendChild(createdLine);

  const statusLabel = document.createElement('p');
  statusLabel.className = 'concept-workspace__tab-intro';
  statusLabel.textContent = 'Status';
  detailsCard.appendChild(statusLabel);

  const statusGroup = document.createElement('div');
  statusGroup.className = 'toggle-group';
  const currentStatus = resource.status || 'draft';
  RESOURCE_STATUS_KEYS.forEach((status) => {
    const statusButton = document.createElement('button');
    statusButton.type = 'button';
    statusButton.className = 'toggle-group__button' + (status === currentStatus ? ' toggle-group__button--active' : '');
    statusButton.textContent = getResourceStatusLabel(status);
    statusButton.addEventListener('click', () => {
      resourceService.setResourceStatus(concept, resource.id, status);
      workspaceService.save(classroom);
      handlers.rerender();
    });
    statusGroup.appendChild(statusButton);
  });
  detailsCard.appendChild(statusGroup);

  // The extension point future editors attach to — see this file's
  // header comment and resourceService.js's doc comment. Reading is
  // the first type with a real editor (see ReadingEditorView.js);
  // every other type stays disabled until it gets its own the same
  // way.
  const hasEditor = resource.type === 'reading';

  const openEditorButton = document.createElement('button');
  openEditorButton.type = 'button';
  openEditorButton.className = 'btn btn--primary concept-workspace__resource-open-editor-button';
  openEditorButton.textContent = 'Open Editor';
  openEditorButton.disabled = !hasEditor;
  if (!hasEditor) openEditorButton.title = 'Coming soon';
  if (hasEditor) {
    openEditorButton.addEventListener('click', () => {
      renderReadingEditorView(container, {
        classroom,
        resource,
        onBack: handlers.rerender,
      });
    });
  }
  detailsCard.appendChild(openEditorButton);

  // A teacher's own check of what a student will eventually see —
  // reuses the exact same read-only screen a student will one day
  // reach through their own navigation (see ReadingViewerView.js's
  // doc comment on that gap). Only shown for a type with real content
  // to preview.
  if (hasEditor) {
    const previewButton = document.createElement('button');
    previewButton.type = 'button';
    previewButton.className = 'btn btn--ghost';
    previewButton.textContent = 'Preview (Read-Only)';
    previewButton.addEventListener('click', () => {
      renderReadingViewerView(container, {
        resource,
        onBack: handlers.rerender,
      });
    });
    detailsCard.appendChild(previewButton);
  }

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'btn btn--text btn--danger-text';
  deleteButton.textContent = 'Delete Resource';
  deleteButton.addEventListener('click', () => {
    if (!window.confirm(`Delete "${resource.title}"?`)) return;
    resourceService.deleteResource(concept, resource.id);
    workspaceService.save(classroom);
    handlers.onBackToResourceList();
  });
  detailsCard.appendChild(deleteButton);

  section.appendChild(detailsCard);
  return section;
}

function formatDate(isoString) {
  if (!isoString) return 'Unknown';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function createResourceRenameInput(value, onRename) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'concept-workspace__resource-name-input';
  input.value = value;
  input.addEventListener('change', () => {
    const newValue = input.value.trim();
    if (!newValue) {
      input.value = value;
      return;
    }
    onRename(newValue);
  });
  return input;
}

// ---- Student Progress ----------------------------------------------------

/**
 * Reuses Learning Record's existing per-student data verbatim — no
 * new analytics, no new computation. This is simply the first UI
 * surface for data services/learningRecordService.js and
 * models/StudentConceptRecord.js have had since Phase 1, with nothing
 * to show it until now.
 */
function renderStudentProgressTab(classroom, concept) {
  const section = document.createElement('div');
  section.className = 'concept-workspace__section';

  const allStudents = classroom.teams.flatMap((team) => team.students);

  if (allStudents.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'concept-workspace__empty-message';
    empty.textContent = 'No students in this classroom yet.';
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement('div');
  list.className = 'concept-workspace__progress-list';

  allStudents.forEach((student) => {
    const record = learningRecordService.getStudentConceptRecord(student, concept.id);

    const row = document.createElement('div');
    row.className = 'concept-workspace__progress-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'concept-workspace__progress-name';
    nameEl.textContent = student.name;
    row.appendChild(nameEl);

    const understandingEl = document.createElement('span');
    understandingEl.className = 'concept-workspace__progress-tag';
    understandingEl.textContent = getUnderstandingLabel(record.understanding);
    row.appendChild(understandingEl);

    const notebookEl = document.createElement('span');
    notebookEl.className = 'concept-workspace__progress-tag';
    notebookEl.textContent = getNotebookStatusLabel(record.notebook);
    row.appendChild(notebookEl);

    if (record.helpRequested) {
      const helpEl = document.createElement('span');
      helpEl.className = 'concept-workspace__progress-tag concept-workspace__progress-tag--help';
      helpEl.textContent = 'Needs Help';
      row.appendChild(helpEl);
    }

    list.appendChild(row);
  });

  section.appendChild(list);
  return section;
}
