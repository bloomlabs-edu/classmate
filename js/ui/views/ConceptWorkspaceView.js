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
import { hydrateConceptRecordsForConcepts } from '../../services/conceptRecordHydrationService.js';
import * as learningRecordTeacherService from '../../services/learningRecordTeacherService.js';
import * as resourceService from '../../services/resourceService.js';
import * as resourceRepository from '../../services/resourceRepository.js';
import { fetchLearningHubCatalogue, groupExperiencesByType } from '../../services/learningHubCatalogueService.js';
import { openLearningHubPanel } from '../components/LearningHubPanel.js';
import { getUnderstandingLabel, getNotebookStatusLabel } from '../../config/learningRecordConfig.js';
import {
  RESOURCE_TYPE_KEYS,
  RESOURCE_STATUS_KEYS,
  AUDIENCE_KEYS,
  getResourceTypeLabel,
  getResourceTypeIcon,
  getResourceStatusLabel,
  getAudienceLabel,
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
  let pendingLearningHubExperience = null; // the {id, title, type, entry} the teacher picked from the catalogue, held until the naming/audience step

  // Overview tab's own "What did we learn?" description editor state —
  // Phase 5. `editingDescription` toggles the textarea open; `descriptionSaveState`
  // is null | { status: 'saving' | 'failed' }, matching the exact
  // guarded-mutation-then-awaited-save shape Phase 4 established for
  // Learning Management's own inline create forms (see
  // ui/views/LearningManagementView.js's onCreateUnit/onCreateConcept)
  // — this is a new mutation, not a change to any existing Resource
  // CRUD call in this file, so it uses that established, reliable
  // pattern from the start rather than this file's own older
  // fire-and-forget workspaceService.save() convention.
  let editingDescription = false;
  let descriptionSaveState = null;

  async function rerender() {
    // Learning Hub's own concern, not workspaceService's or
    // classroomService's — see resourceService.js's own comment for
    // why this is a lazy, explicit call here rather than a hook fired
    // on every classroom load.
    const migrated = await resourceService.migrateConceptResourceLinksIfNeeded(classroom.id, concept);
    if (migrated) workspaceService.save(classroom);

    // Phase N — overlays every student's real studentConceptRecords
    // document for THIS ONE concept onto classroom.teams[].students[].learningRecord,
    // so the Student Progress tab's "needing help"/"mastered" counts
    // below reflect real data. Bounded by roster size (one concept ×
    // every student), never by the classroom's full syllabus size —
    // see services/conceptRecordHydrationService.js's own header
    // comment on why this is deliberately not a whole-classroom fetch.
    await hydrateConceptRecordsForConcepts(classroom, [concept.id]);

    // Fetched once per render and passed down as a plain array —
    // both the Overview tab's resource count and the Resources tab's
    // own card list need it, and every sub-render function below
    // stays synchronous this way, with exactly one async boundary
    // here rather than scattered through the render tree.
    const resources = await resourceService.getResources(classroom.id, concept);

    renderWorkspace(container, classroom, subject, unit, concept, activeTab, resources, { resourceMode, pendingType, selectedResourceId, pendingLearningHubExperience, editingDescription, descriptionSaveState }, {
      onBack,
      rerender,
      onStartEditDescription: () => {
        editingDescription = true;
        descriptionSaveState = null;
        rerender();
      },
      onCancelEditDescription: () => {
        editingDescription = false;
        descriptionSaveState = null;
        rerender();
      },
      onSaveDescription: async (text) => {
        learningRecordTeacherService.setConceptDescription(classroom, concept.id, text);
        workspaceService.markDirty(classroom.id);
        descriptionSaveState = { status: 'saving' };
        rerender();
        try {
          await workspaceService.saveExplicitly(classroom);
          editingDescription = false;
          descriptionSaveState = null;
        } catch (error) {
          // Already logged by saveExplicitly() itself. The description
          // stays set in memory; the Overview tab shows Retry.
          descriptionSaveState = { status: 'failed' };
        }
        rerender();
      },
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
      onChooseLearningHubExperience: () => {
        resourceMode = 'learning-hub-catalogue';
        rerender();
      },
      onSelectLearningHubExperience: (experience) => {
        pendingLearningHubExperience = experience;
        resourceMode = 'learning-hub-name-new';
        rerender();
      },
      onCreateResource: async (title) => {
        const resource = await resourceService.createResourceOnConcept(classroom.id, concept, { title, type: pendingType });
        workspaceService.save(classroom);
        pendingType = null;
        selectedResourceId = resource.id;
        resourceMode = 'details'; // land on the new resource's own page, not back on the list
        rerender();
      },
      onCreateLearningHubResource: async (title, audience) => {
        // Per explicit product decision: an existing, appropriate
        // Resource type is used (never a new type), content.kind
        // remains the sole authoritative marker of "this is a
        // Learning Hub experience," and only the selected
        // reference — never the full catalogue entry — is stored.
        const resourceType = LEARNING_HUB_EXPERIENCE_TYPE_TO_RESOURCE_TYPE[pendingLearningHubExperience.type] || 'activity';
        const resource = await resourceService.createResourceOnConcept(classroom.id, concept, { title, type: resourceType });
        resource.content = {
          kind: 'learning_hub_experience',
          experienceType: pendingLearningHubExperience.type,
          experienceId: pendingLearningHubExperience.id,
        };
        resource.audience = audience;
        await resourceRepository.saveResource(classroom.id, resource);
        workspaceService.save(classroom);
        pendingLearningHubExperience = null;
        selectedResourceId = resource.id;
        resourceMode = 'details';
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
        pendingLearningHubExperience = null;
        rerender();
      },
      rerender,
    });
  }

  rerender();
}

function renderWorkspace(container, classroom, subject, unit, concept, activeTab, resources, resourceState, handlers) {
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

  // A distinct, dormant Learning Hub trigger — see
  // ui/components/LearningHubPanel.js's own header comment. Opened
  // from here, the panel always knows this exact Concept — no
  // "which Concept?" step is ever needed at all.
  const learningHubTrigger = document.createElement('button');
  learningHubTrigger.type = 'button';
  learningHubTrigger.className = 'learning-management__learning-hub-trigger concept-workspace__learning-hub-trigger';
  learningHubTrigger.setAttribute('aria-label', 'Open Learning Hub');
  const triggerIcon = document.createElement('span');
  triggerIcon.setAttribute('aria-hidden', 'true');
  triggerIcon.textContent = '\ud83d\udcda';
  const triggerLabel = document.createElement('span');
  triggerLabel.textContent = 'Learning Hub';
  learningHubTrigger.append(triggerIcon, ' ', triggerLabel);
  learningHubTrigger.addEventListener('click', () => {
    openLearningHubPanel({
      concept,
      unit,
      pendingLearningHubExperience: null,
      handlers: {
        onPickLearningHubExperience: async (experience) => {
          // Mirrors ui/views/LearningManagementView.js's own
          // onUseLearningHubResourceForConcept exactly — same
          // Resource type mapping, same content shape, same default
          // ('teacher') audience. Not a second implementation; this
          // Concept is always known here already, so there is no
          // "which Concept?" step at all.
          const resourceType = LEARNING_HUB_EXPERIENCE_TYPE_TO_RESOURCE_TYPE[experience.type] || 'activity';
          const resource = await resourceService.createResourceOnConcept(classroom.id, concept, { title: experience.title, type: resourceType });
          resource.content = { kind: 'learning_hub_experience', experienceType: experience.type, experienceId: experience.id };
          resource.audience = 'teacher';
          await resourceRepository.saveResource(classroom.id, resource);
          workspaceService.save(classroom);
          handlers.rerender();
        },
        onUseLearningHubResourceForConcept: () => {},
        onCancelPendingLearningHubExperience: () => {},
      },
      onClose: () => {},
    });
  });
  wrapper.appendChild(learningHubTrigger);

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
    content.appendChild(renderResourcesTab(container, classroom, concept, resources, resourceState, handlers));
  } else if (activeTab === 'student-progress') {
    content.appendChild(renderStudentProgressTab(classroom, concept));
  } else {
    content.appendChild(renderOverviewTab(classroom, concept, resources, resourceState, handlers));
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

// ---- Overview ---------------------------------------------------------

function renderOverviewTab(classroom, concept, resources, resourceState, handlers) {
  const section = document.createElement('div');
  section.className = 'concept-workspace__section';

  section.appendChild(renderConceptDescriptionEditor(concept, resourceState, handlers));

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
  // Resolved once in rerender() and passed down, since
  // resourceService.getResources() is now async (Resources live in
  // their own Firestore subcollection — see resourceRepository.js).
  const resourceCount = resources.length;

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

/**
 * "What did we learn?" — the short, optional recall blurb students
 * see in the Student Learning View's own concept preview (see
 * models/LearningConcept.js's `description` doc comment, added this
 * phase). Read-mode shows the current blurb (or an honest "No
 * description yet" prompt, never a fake placeholder) with an
 * Edit/Add action; edit-mode is a plain textarea + Save/Cancel,
 * mirroring the exact inline-form shape
 * ui/views/LearningManagementView.js's own renderAddUnitControl()/
 * renderAddConceptControl() established in Phase 4 (disabled +
 * "Saving…"/Retry while a save is in flight, error text on failure,
 * nothing here ever silently drops the teacher's own text).
 */
function renderConceptDescriptionEditor(concept, resourceState, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'concept-workspace__description';

  const heading = document.createElement('p');
  heading.className = 'concept-workspace__description-heading';
  heading.textContent = 'What did we learn?';
  wrap.appendChild(heading);

  const { editingDescription, descriptionSaveState } = resourceState;
  const isSaving = descriptionSaveState?.status === 'saving';
  const isFailed = descriptionSaveState?.status === 'failed';

  if (!editingDescription) {
    const text = document.createElement('p');
    text.className = 'concept-workspace__description-text';
    text.textContent = concept.description || 'No description yet — students will only see the concept title.';
    if (!concept.description) text.classList.add('concept-workspace__description-text--empty');
    wrap.appendChild(text);

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'btn btn--text';
    editButton.textContent = concept.description ? 'Edit description' : '+ Add description';
    editButton.addEventListener('click', handlers.onStartEditDescription);
    wrap.appendChild(editButton);
    return wrap;
  }

  const textarea = document.createElement('textarea');
  textarea.className = 'concept-workspace__description-input';
  textarea.value = concept.description || '';
  textarea.placeholder = 'e.g. A force is a push or pull that can change how something moves.';
  textarea.rows = 3;
  textarea.disabled = isSaving;
  wrap.appendChild(textarea);

  const actions = document.createElement('div');
  actions.className = 'concept-workspace__description-actions';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary';
  saveButton.disabled = isSaving;
  saveButton.textContent = isSaving ? 'Saving…' : isFailed ? 'Retry' : 'Save';
  saveButton.addEventListener('click', () => handlers.onSaveDescription(textarea.value));
  actions.appendChild(saveButton);

  if (!isFailed) {
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn--text';
    cancelButton.disabled = isSaving;
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', handlers.onCancelEditDescription);
    actions.appendChild(cancelButton);
  }
  wrap.appendChild(actions);

  if (isFailed) {
    const errorNote = document.createElement('p');
    errorNote.className = 'learning-management__inline-error';
    errorNote.textContent = 'Save failed. Check your connection and try again.';
    wrap.appendChild(errorNote);
  }

  return wrap;
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
function renderResourcesTab(container, classroom, concept, resources, resourceState, handlers) {
  const { resourceMode, pendingType, selectedResourceId, pendingLearningHubExperience } = resourceState;

  if (resourceMode === 'choose-type') {
    return renderChooseResourceTypeView(handlers);
  }
  if (resourceMode === 'name-new') {
    return renderNameNewResourceView(pendingType, handlers);
  }
  if (resourceMode === 'learning-hub-catalogue') {
    return renderLearningHubCatalogueView(handlers);
  }
  if (resourceMode === 'learning-hub-name-new') {
    return renderLearningHubNameNewView(pendingLearningHubExperience, handlers);
  }
  if (resourceMode === 'details') {
    const resource = resources.find((r) => r.id === selectedResourceId) || null;
    // The resource this page was opened for no longer exists (deleted
    // from another tab/device) — fall back to the list rather than
    // rendering a details page with nothing to show, same "handle the
    // gone-missing case explicitly" reasoning used elsewhere in this
    // app rather than letting it render broken.
    if (!resource) return renderResourceListView(classroom, concept, resources, handlers);
    return renderResourceDetailsView(container, classroom, concept, resource, handlers);
  }
  return renderResourceListView(classroom, concept, resources, handlers);
}

function renderResourceListView(classroom, concept, resources, handlers) {
  const section = document.createElement('div');
  section.className = 'concept-workspace__section';

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

  const learningHubButton = document.createElement('button');
  learningHubButton.type = 'button';
  learningHubButton.className = 'concept-workspace__resource-type-option concept-workspace__learning-hub-option';
  learningHubButton.appendChild(createIcon('chalkboard-easel', { size: 20 }));
  const learningHubLabel = document.createElement('span');
  learningHubLabel.textContent = 'Learning Hub Experience';
  learningHubButton.appendChild(learningHubLabel);
  learningHubButton.addEventListener('click', () => handlers.onChooseLearningHubExperience());
  section.appendChild(learningHubButton);

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
 * The Learning Hub catalogue picker — fetches the real, currently
 * available experiences (services/learningHubCatalogueService.js)
 * and lets a teacher search/select one. A search box filters the
 * already-loaded list client-side (no search infrastructure, no
 * server-side query) — matching the explicit "simple catalogue
 * picker, not a marketplace" instruction. An unreachable/empty
 * catalogue shows a plain message rather than a broken screen.
 */
function renderLearningHubCatalogueView(handlers) {
  const section = document.createElement('div');
  section.className = 'concept-workspace__section';

  const backButton = createBackButton(handlers.onBackToResourceList);
  section.appendChild(backButton);

  const heading = document.createElement('p');
  heading.className = 'concept-workspace__tab-intro';
  heading.textContent = 'Learning Hub Experience';
  section.appendChild(heading);

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search experiences...';
  searchInput.className = 'concept-workspace__learning-hub-search';
  section.appendChild(searchInput);

  const resultsContainer = document.createElement('div');
  resultsContainer.className = 'concept-workspace__learning-hub-results';
  const loadingMessage = document.createElement('p');
  loadingMessage.className = 'concept-workspace__tab-intro';
  loadingMessage.textContent = 'Loading\u2026';
  resultsContainer.appendChild(loadingMessage);
  section.appendChild(resultsContainer);

  fetchLearningHubCatalogue().then((experiences) => {
    function renderResults(filterText) {
      resultsContainer.innerHTML = '';
      const filtered = filterText
        ? experiences.filter((experience) => experience.title.toLowerCase().includes(filterText.toLowerCase()))
        : experiences;

      if (filtered.length === 0) {
        resultsContainer.appendChild(createEmptyStateElement({ message: experiences.length === 0 ? 'Could not load Learning Hub experiences right now.' : 'No experiences match your search.' }));
        return;
      }

      const groups = groupExperiencesByType(filtered);
      groups.forEach((experiencesOfType, type) => {
        const groupHeading = document.createElement('p');
        groupHeading.className = 'concept-workspace__learning-hub-group-heading';
        groupHeading.textContent = LEARNING_HUB_TYPE_GROUP_LABELS[type] || type;
        resultsContainer.appendChild(groupHeading);

        experiencesOfType.forEach((experience) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'concept-workspace__learning-hub-experience-row';
          row.textContent = experience.title;
          row.addEventListener('click', () => handlers.onSelectLearningHubExperience(experience));
          resultsContainer.appendChild(row);
        });
      });
    }

    renderResults('');
    searchInput.addEventListener('input', () => renderResults(searchInput.value));
  });

  return section;
}

export const LEARNING_HUB_TYPE_GROUP_LABELS = {
  lesson: 'Lessons',
  'element-journey': 'Element Journeys',
  'root-journey': 'Root Word Journeys',
  'sound-journey': 'Sound Journeys',
  'listen-read': 'Listen & Read',
};

/**
 * Naming + audience step for a Learning Hub experience the teacher
 * just picked — mirrors renderNameNewResourceView()'s own shape
 * (title input pre-filled as a suggestion, never auto-used
 * silently) plus the Audience toggle already established for the
 * Resource Details screen, reused here rather than a third
 * implementation. Audience defaults to 'teacher' (the same
 * conservative default createResource() itself already uses),
 * never silently forced to 'student'.
 */
function renderLearningHubNameNewView(experience, handlers) {
  const section = document.createElement('div');
  section.className = 'concept-workspace__section';

  const backButton = createBackButton(handlers.onBackToResourceList);
  section.appendChild(backButton);

  const heading = document.createElement('p');
  heading.className = 'concept-workspace__tab-intro';
  heading.textContent = 'Name your Learning Hub Experience';
  section.appendChild(heading);

  const form = document.createElement('div');
  form.className = 'concept-workspace__name-new-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = experience.title; // a real, human-readable suggestion from the catalogue — never auto-used without the teacher seeing/editing it
  input.placeholder = 'Resource title';
  form.appendChild(input);

  const audienceLabel = document.createElement('p');
  audienceLabel.className = 'concept-workspace__tab-intro';
  audienceLabel.textContent = 'Audience';
  form.appendChild(audienceLabel);

  const audienceGroup = document.createElement('div');
  audienceGroup.className = 'toggle-group';
  let selectedAudience = 'teacher'; // the same conservative default createResource() itself already uses
  AUDIENCE_KEYS.forEach((audience) => {
    const audienceButton = document.createElement('button');
    audienceButton.type = 'button';
    audienceButton.className = 'toggle-group__button' + (audience === selectedAudience ? ' toggle-group__button--active' : '');
    audienceButton.textContent = getAudienceLabel(audience);
    audienceButton.addEventListener('click', () => {
      selectedAudience = audience;
      audienceGroup.querySelectorAll('.toggle-group__button').forEach((button, index) => {
        button.classList.toggle('toggle-group__button--active', AUDIENCE_KEYS[index] === audience);
      });
    });
    audienceGroup.appendChild(audienceButton);
  });
  form.appendChild(audienceGroup);

  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'btn btn--primary';
  createButton.textContent = 'Create';
  createButton.addEventListener('click', () => {
    const title = input.value.trim();
    if (!title) return;
    handlers.onCreateLearningHubResource(title, selectedAudience);
  });
  form.appendChild(createButton);

  section.appendChild(form);
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
// PLACEHOLDER — Learning Hub is not deployed anywhere yet (today it
// is a file://-only ZIP with no hosting at all). This host is not a
// real, working deployment target; it exists so the launch mechanism
// itself can be built and tested end-to-end now, ready to point at a
// real host the moment one exists, without any other code changing.
const LEARNING_HUB_HOST_PLACEHOLDER = 'https://learning-hub-b2586.web.app';

/**
 * Maps a Learning Hub experience's own `type` (from the catalogue —
 * see services/learningHubCatalogueService.js) to the closest
 * existing ClassMate Resource type — never a new Resource type
 * invented for this. Improves the created Resource's own icon/label
 * accuracy for free; falls back to 'activity' for anything not
 * listed here, including any future experience type the catalogue
 * might add.
 *
 * Exported so ui/views/LearningManagementView.js's own Unit-level
 * Learning Hub search plugin can reuse this exact mapping directly —
 * the same "reuse, never build a second implementation" precedent
 * this file's own buildLearningHubLaunchUrl() export already set.
 */
export const LEARNING_HUB_EXPERIENCE_TYPE_TO_RESOURCE_TYPE = {
  lesson: 'activity',
  'element-journey': 'activity',
  'root-journey': 'activity',
  'sound-journey': 'activity',
  'listen-read': 'reading',
};

/**
 * Builds a Learning Hub launch URL from an experience type + id — the
 * ONLY thing ClassMate knows about Learning Hub's own launch
 * mechanism: an entry TYPE and an id, never anything about Learning
 * Hub's internal Mission/Card/Journey structure. Mirrors the real,
 * now-multiple entry types Learning Hub's own app.js genuinely
 * supports (lesson, element-journey, root-journey, sound-journey,
 * listen-read) — this function doesn't hardcode "mission" as the
 * only shape any more.
 *
 * Backward-compatible: calling this with a single string argument
 * (the old missionId-only call) still builds the exact, unchanged
 * `mission:<id>` URL — nothing already relying on the original,
 * accepted single-argument call breaks.
 *
 * Exported so ui/student-portal/views/StudentLearningView.js can
 * reuse this exact function rather than duplicating it — the same
 * "reuse, never build a second implementation" precedent
 * StudentNotebooksView.js already established by importing
 * getCellMeta() directly from NotebookCheckpointsView.js.
 */
export function buildLearningHubLaunchUrl(experienceTypeOrMissionId, experienceId) {
  // Old, single-argument call: build the exact, unchanged mission: URL.
  if (experienceId === undefined) {
    return `${LEARNING_HUB_HOST_PLACEHOLDER}/?entry=${encodeURIComponent(`mission:${experienceTypeOrMissionId}`)}`;
  }
  return `${LEARNING_HUB_HOST_PLACEHOLDER}/?entry=${encodeURIComponent(`${experienceTypeOrMissionId}:${experienceId}`)}`;
}

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

  const titleInput = createResourceRenameInput(resource.title, async (newTitle) => {
    await resourceService.renameResource(classroom.id, concept, resource.id, newTitle);
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
    statusButton.addEventListener('click', async () => {
      await resourceService.setResourceStatus(classroom.id, concept, resource.id, status);
      workspaceService.save(classroom);
      handlers.rerender();
    });
    statusGroup.appendChild(statusButton);
  });
  detailsCard.appendChild(statusGroup);

  const audienceLabel = document.createElement('p');
  audienceLabel.className = 'concept-workspace__tab-intro';
  audienceLabel.textContent = 'Audience';
  detailsCard.appendChild(audienceLabel);

  const audienceGroup = document.createElement('div');
  audienceGroup.className = 'toggle-group';
  // A resource with no audience at all (every resource created
  // before this field existed, or any resource a teacher hasn't
  // touched yet) displays as "Teacher only" selected here — the
  // exact same conservative default already established for
  // student-facing reads (see resourceService.js's own
  // getStudentVisibleResources()). This control never implies a
  // resource is already student-visible when it genuinely isn't.
  const currentAudience = resource.audience || 'teacher';
  AUDIENCE_KEYS.forEach((audience) => {
    const audienceButton = document.createElement('button');
    audienceButton.type = 'button';
    audienceButton.className = 'toggle-group__button' + (audience === currentAudience ? ' toggle-group__button--active' : '');
    audienceButton.textContent = getAudienceLabel(audience);
    audienceButton.addEventListener('click', async () => {
      await resourceService.setResourceAudience(classroom.id, concept, resource.id, audience);
      workspaceService.save(classroom);
      handlers.rerender();
    });
    audienceGroup.appendChild(audienceButton);
  });
  detailsCard.appendChild(audienceGroup);

  // The extension point future editors attach to — see this file's
  // header comment and resourceService.js's doc comment. Reading is
  // the first type with a real editor (see ReadingEditorView.js);
  // every other type stays disabled until it gets its own the same
  // way.
  //
  // A Learning Hub experience resource is a separate case, not
  // governed by `type` at all — a Learning Hub experience could
  // eventually be any type (quiz, simulation, worksheet...), so the
  // discriminator is content.kind, never resource.type. This reuses
  // the exact same button/action area, relabeled, rather than a
  // second button or a new screen.
  const isLearningHubExperience = resource.content?.kind === 'learning_hub_experience';
  const hasEditor = resource.type === 'reading';

  const openEditorButton = document.createElement('button');
  openEditorButton.type = 'button';
  openEditorButton.className = 'btn btn--primary concept-workspace__resource-open-editor-button';
  if (isLearningHubExperience) {
    openEditorButton.textContent = 'Open Learning Experience';
    openEditorButton.addEventListener('click', () => {
      window.open(buildLearningHubLaunchUrl(resource.content.experienceType, resource.content.experienceId), '_blank');
    });
  } else {
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
  deleteButton.addEventListener('click', async () => {
    if (!window.confirm(`Delete "${resource.title}"?`)) return;
    await resourceService.deleteResource(classroom.id, concept, resource.id);
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
