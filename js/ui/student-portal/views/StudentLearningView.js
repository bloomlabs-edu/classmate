/**
 * ui/student-portal/views/StudentLearningView.js
 *
 * The student-facing curriculum/resource discovery surface:
 * Subjects -> Units -> Concepts -> student-visible Resources ->
 * (for a Learning Hub resource) the real Learning Hub Mission.
 *
 * Self-contained, same pattern as ConceptWorkspaceView.js: no router,
 * no URL per drill-down level, local level/selection state in a
 * closure, re-renders itself into whatever container it's handed.
 * The only thing it's given is `onBack` — pressing back at the top
 * (Subjects) level calls it; every deeper level's own "back" moves up
 * one level internally first, matching how a student would expect
 * "back" to behave while browsing a tree, and matching the exact
 * convention ConceptWorkspaceView.js already established for its own
 * Overview/Resources tab navigation.
 *
 * Reuses, never duplicates:
 *   - The real curriculum tree — learningRecordService.getSubjects(),
 *     the same function/data every teacher-side curriculum screen
 *     already reads. No second Subject/Unit/Concept tree is built.
 *   - resourceService.getStudentVisibleResources() for the audience
 *     filter (student/both only) — the one, single place that rule
 *     lives, not reimplemented here.
 *   - ConceptWorkspaceView.js's own buildLearningHubLaunchUrl() for
 *     the actual Learning Hub launch — the exact same, unmodified
 *     mechanism the teacher-side "Open Learning Experience" action
 *     already uses. Resource types with no student-facing experience
 *     built yet are shown as a plain, disabled "Coming soon" state,
 *     never pretended to be playable.
 */

import { createBackButton } from '../../components/BackButton.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';
import { createIcon } from '../../components/Icon.js';
import { loadCurrentStudentAndClassroom } from '../../../services/studentPortalDataService.js';
import * as learningRecordService from '../../../services/learningRecordService.js';
import * as resourceService from '../../../services/resourceService.js';
import { getResourceTypeLabel, getResourceTypeIcon } from '../../../config/resourceTypeConfig.js';
import { buildLearningHubLaunchUrl } from '../../views/ConceptWorkspaceView.js';

export async function renderStudentLearningView(container, { onBack } = {}) {
  container.innerHTML = '';

  const found = await loadCurrentStudentAndClassroom();
  if (!found) {
    container.appendChild(createEmptyStateElement({ message: 'Could not load your classroom right now.' }));
    return;
  }
  const { classroom } = found;

  // level: 'subjects' | 'units' | 'concepts' | 'resources'
  let level = 'subjects';
  let selectedSubject = null;
  let selectedUnit = null;
  let selectedConcept = null;

  async function rerender() {
    render(container, classroom, level, { selectedSubject, selectedUnit, selectedConcept }, {
      onBack,
      onSelectSubject: (subject) => {
        selectedSubject = subject;
        level = 'units';
        rerender();
      },
      onSelectUnit: (unit) => {
        selectedUnit = unit;
        level = 'concepts';
        rerender();
      },
      onSelectConcept: (concept) => {
        selectedConcept = concept;
        level = 'resources';
        rerender();
      },
      onBackOneLevel: () => {
        if (level === 'resources') { level = 'concepts'; selectedConcept = null; }
        else if (level === 'concepts') { level = 'units'; selectedUnit = null; }
        else if (level === 'units') { level = 'subjects'; selectedSubject = null; }
        rerender();
      },
    });
  }

  await rerender();
}

function render(container, classroom, level, selection, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'student-learning';

  const header = document.createElement('header');
  header.className = 'tracker-header';
  // Top level's own back genuinely leaves this screen (the real
  // onBack prop); every deeper level's own back only moves up one
  // level internally, per this file's own header comment.
  header.appendChild(createBackButton(level === 'subjects' ? handlers.onBack : handlers.onBackOneLevel));
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = titleForLevel(level, selection);
  header.appendChild(title);
  wrapper.appendChild(header);

  const content = document.createElement('div');
  content.className = 'student-learning__content';

  if (level === 'subjects') {
    content.appendChild(renderSubjectsLevel(classroom, handlers));
  } else if (level === 'units') {
    content.appendChild(renderUnitsLevel(selection.selectedSubject, handlers));
  } else if (level === 'concepts') {
    content.appendChild(renderConceptsLevel(selection.selectedUnit, handlers));
  } else if (level === 'resources') {
    content.appendChild(renderResourcesLevelPlaceholder());
    // Resources load asynchronously (a real Firestore read) — see
    // loadAndRenderResources() below, which replaces this placeholder
    // once the real data arrives.
    loadAndRenderResources(content, classroom, selection.selectedConcept);
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

function titleForLevel(level, selection) {
  if (level === 'subjects') return 'Learning';
  if (level === 'units') return selection.selectedSubject?.title || 'Subject';
  if (level === 'concepts') return selection.selectedUnit?.title || 'Unit';
  if (level === 'resources') return selection.selectedConcept?.title || 'Concept';
  return 'Learning';
}

function renderSubjectsLevel(classroom, handlers) {
  const subjects = learningRecordService.getSubjects(classroom);
  if (subjects.length === 0) {
    return createEmptyStateElement({ message: 'No subjects have been set up for this classroom yet.' });
  }
  const list = document.createElement('div');
  list.className = 'student-learning__list';
  subjects.forEach((subject) => {
    list.appendChild(createLearningRow(subject.title, () => handlers.onSelectSubject(subject)));
  });
  return list;
}

function renderUnitsLevel(subject, handlers) {
  const units = subject?.units || [];
  if (units.length === 0) {
    return createEmptyStateElement({ message: 'This subject has no units yet.' });
  }
  const list = document.createElement('div');
  list.className = 'student-learning__list';
  units.forEach((unit) => {
    list.appendChild(createLearningRow(unit.title, () => handlers.onSelectUnit(unit)));
  });
  return list;
}

function renderConceptsLevel(unit, handlers) {
  const wrapper = document.createElement('div');

  if (unit?.learningHubPack) {
    wrapper.appendChild(createPackCard(unit.learningHubPack));
  }

  const concepts = unit?.concepts || [];
  if (concepts.length === 0) {
    wrapper.appendChild(createEmptyStateElement({ message: 'This unit has no concepts yet.' }));
    return wrapper;
  }
  const list = document.createElement('div');
  list.className = 'student-learning__list';
  concepts.forEach((concept) => {
    list.appendChild(createLearningRow(concept.title, () => handlers.onSelectConcept(concept)));
  });
  wrapper.appendChild(list);
  return wrapper;
}

/**
 * The assigned Learning Hub Pack card — title only (ClassMate never
 * stores the Pack's own Topics/Experiences, only this reference), a
 * single "Open Learning Experience" launch action reusing
 * buildLearningHubLaunchUrl('pack', packId) directly — the exact
 * same, already-generalized function every individual Experience
 * resource already uses, not a second launch mechanism.
 */
function createPackCard(learningHubPack) {
  const card = document.createElement('div');
  card.className = 'student-learning__resource-card';

  const iconEl = createIcon('chalkboard-easel', { size: 22, className: 'student-learning__resource-icon' });
  card.appendChild(iconEl);

  const textWrap = document.createElement('div');
  textWrap.className = 'student-learning__resource-text';
  const titleEl = document.createElement('p');
  titleEl.className = 'student-learning__resource-title';
  titleEl.textContent = learningHubPack.title;
  const typeEl = document.createElement('p');
  typeEl.className = 'student-learning__resource-type';
  typeEl.textContent = 'Learning Hub Pack';
  textWrap.append(titleEl, typeEl);
  card.appendChild(textWrap);

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'btn btn--primary student-learning__resource-action';
  openButton.textContent = 'Open Learning Experience';
  openButton.addEventListener('click', () => {
    window.open(buildLearningHubLaunchUrl('pack', learningHubPack.packId), '_blank');
  });
  card.appendChild(openButton);

  return card;
}

function renderResourcesLevelPlaceholder() {
  const placeholder = document.createElement('div');
  placeholder.className = 'student-learning__loading';
  placeholder.textContent = 'Loading\u2026';
  return placeholder;
}

async function loadAndRenderResources(content, classroom, concept) {
  const resources = await resourceService.getStudentVisibleResources(classroom.id, concept);

  content.innerHTML = '';
  if (resources.length === 0) {
    content.appendChild(createEmptyStateElement({ message: 'No learning resources yet.' }));
    return;
  }

  const list = document.createElement('div');
  list.className = 'student-learning__list';
  resources.forEach((resource) => {
    list.appendChild(createResourceCard(resource));
  });
  content.appendChild(list);
}

function createResourceCard(resource) {
  const card = document.createElement('div');
  card.className = 'student-learning__resource-card';

  const iconEl = createIcon(getResourceTypeIcon(resource.type), { size: 22, className: 'student-learning__resource-icon' });
  card.appendChild(iconEl);

  const textWrap = document.createElement('div');
  textWrap.className = 'student-learning__resource-text';
  const titleEl = document.createElement('p');
  titleEl.className = 'student-learning__resource-title';
  titleEl.textContent = resource.title;
  const typeEl = document.createElement('p');
  typeEl.className = 'student-learning__resource-type';
  typeEl.textContent = getResourceTypeLabel(resource.type);
  textWrap.append(titleEl, typeEl);
  card.appendChild(textWrap);

  const isLearningHubExperience = resource.content?.kind === 'learning_hub_experience';
  if (isLearningHubExperience) {
    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'btn btn--primary student-learning__resource-action';
    openButton.textContent = 'Open Learning Experience';
    openButton.addEventListener('click', () => {
      window.open(buildLearningHubLaunchUrl(resource.content.experienceType, resource.content.experienceId), '_blank');
    });
    card.appendChild(openButton);
  } else {
    // No student-facing experience/viewer exists yet for this
    // resource type (see this file's own header comment) — shown as
    // a plain, disabled state rather than pretending it's playable.
    const comingSoon = document.createElement('button');
    comingSoon.type = 'button';
    comingSoon.className = 'btn btn--primary student-learning__resource-action';
    comingSoon.textContent = 'Coming soon';
    comingSoon.disabled = true;
    card.appendChild(comingSoon);
  }

  return card;
}

function createLearningRow(title, onClick) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'student-learning__row';
  const titleEl = document.createElement('span');
  titleEl.textContent = title;
  const chevron = document.createElement('span');
  chevron.className = 'student-learning__row-chevron';
  chevron.textContent = '\u203a';
  chevron.setAttribute('aria-hidden', 'true');
  row.append(titleEl, chevron);
  row.addEventListener('click', onClick);
  return row;
}
