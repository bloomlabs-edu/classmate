/**
 * ui/student-portal/views/StudentLearningView.js
 *
 * The student-facing learning map: Subjects -> Units -> a Concept
 * Map (the whole unit's concepts at once, each with the student's
 * own real reflection status) -> a Concept Detail/card view (one
 * concept at a time: reflect, then continue into the appropriate
 * Learning Hub experience).
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
 *   - learningRecordService.getStudentConceptRecord() /
 *     services/studentPortalDataService.js's own
 *     setUnderstandingForCurrentStudent() for reading and persisting
 *     reflection — the exact same understanding field ClassMate
 *     already had, not a second, competing field. Student-facing
 *     labels/icons (config/learningRecordConfig.js's
 *     STUDENT_UNDERSTANDING_LABELS) are a distinct vocabulary layer
 *     over the same 5 underlying values the teacher-facing
 *     UNDERSTANDING_LABELS already use — ConceptWorkspaceView.js's
 *     own teacher-facing display is untouched. Of those 5 values,
 *     only 4 (need_help/understand/confident/can_teach — see
 *     SELECTABLE_UNDERSTANDING_KEYS below) are ever offered as a
 *     reflection choice in the Concept Detail view; "not_marked"
 *     ("Not explored yet") is a real key too, but only ever a
 *     default/absence-of-reflection state a concept starts in — a
 *     student would never deliberately choose it for themselves, so
 *     it's shown on the Concept Map's own row status, never as a
 *     selectable button.
 *   - resourceService.getStudentVisibleResources() for the audience
 *     filter (student/both only) — the one, single place that rule
 *     lives, not reimplemented here.
 *   - ConceptWorkspaceView.js's own buildLearningHubLaunchUrl() for
 *     the actual Learning Hub launch — the exact same, unmodified
 *     mechanism the teacher-side "Open Learning Experience" action
 *     already uses. A concept with no linked Learning Hub experience
 *     shows a plain, honest "Not available yet" state, never a fake
 *     or broken button.
 *
 * Deliberately NOT shown: any Learning Hub-side progress/score
 * evidence (e.g. "Quiz: 7/10") — no such data exists anywhere in
 * ClassMate yet (no progress-sync has been built), so none is
 * fabricated here. Only real, existing data is displayed.
 */

import { createBackButton } from '../../components/BackButton.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';
import { createIcon } from '../../components/Icon.js';
import { loadCurrentStudentAndClassroom, setUnderstandingForCurrentStudent } from '../../../services/studentPortalDataService.js';
import * as learningRecordService from '../../../services/learningRecordService.js';
import * as resourceService from '../../../services/resourceService.js';
import { getStudentUnderstandingLabel, getStudentUnderstandingIcon } from '../../../config/learningRecordConfig.js';
import { buildLearningHubLaunchUrl } from '../../views/ConceptWorkspaceView.js';

// The 4 real progression steps a student can deliberately choose in
// the Concept Detail view — "not_marked" (Not explored yet) is a
// real key too, but only ever a default/absence-of-reflection state,
// never something a student picks for themselves. See
// renderConceptDetailLevel()'s own comment for the full reasoning.
const SELECTABLE_UNDERSTANDING_KEYS = ['need_help', 'understand', 'confident', 'can_teach'];

export async function renderStudentLearningView(container, { onBack } = {}) {
  container.innerHTML = '';

  const found = await loadCurrentStudentAndClassroom();
  if (!found) {
    container.appendChild(createEmptyStateElement({ message: 'Could not load your classroom right now.' }));
    return;
  }
  const { classroom, student } = found;

  // level: 'subjects' | 'units' | 'concept-map' | 'concept-detail'
  let level = 'subjects';
  let selectedSubject = null;
  let selectedUnit = null;
  let selectedConceptIndex = 0;

  async function rerender() {
    render(container, classroom, student, level, { selectedSubject, selectedUnit, selectedConceptIndex }, {
      onBack,
      onSelectSubject: (subject) => {
        selectedSubject = subject;
        level = 'units';
        rerender();
      },
      onSelectUnit: (unit) => {
        selectedUnit = unit;
        level = 'concept-map';
        rerender();
      },
      onSelectConcept: (conceptIndex) => {
        selectedConceptIndex = conceptIndex;
        level = 'concept-detail';
        rerender();
      },
      onNavigateConcept: (conceptIndex) => {
        selectedConceptIndex = conceptIndex;
        rerender();
      },
      onSetUnderstanding: async (conceptId, understanding) => {
        await setUnderstandingForCurrentStudent(conceptId, understanding);
        rerender();
      },
      onBackOneLevel: () => {
        if (level === 'concept-detail') { level = 'concept-map'; }
        else if (level === 'concept-map') { level = 'units'; selectedUnit = null; }
        else if (level === 'units') { level = 'subjects'; selectedSubject = null; }
        rerender();
      },
    });
  }

  await rerender();
}

function render(container, classroom, student, level, selection, handlers) {
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
  } else if (level === 'concept-map') {
    content.appendChild(renderConceptMapLevel(selection.selectedUnit, student, handlers));
  } else if (level === 'concept-detail') {
    content.appendChild(renderConceptDetailLevel(classroom, selection.selectedUnit, selection.selectedConceptIndex, student, handlers));
  }

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

function titleForLevel(level, selection) {
  if (level === 'subjects') return 'Learning';
  if (level === 'units') return selection.selectedSubject?.title || 'Subject';
  if (level === 'concept-map') return selection.selectedUnit?.title || 'Unit';
  if (level === 'concept-detail') return selection.selectedUnit?.title || 'Unit';
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

/**
 * The concept map — the student's overview of the whole unit before
 * drilling into any single concept. Answers "where am I?": how many
 * concepts exist, and the student's own real, current reflection on
 * each one (reusing learningRecordService.getStudentConceptRecord()
 * directly — no second understanding-tracking mechanism). Every
 * concept in the unit is always shown, regardless of whether a
 * teacher has marked it "taught" yet — an untaught concept simply
 * shows as "Not explored yet", which is honestly, already true.
 */
function renderConceptMapLevel(unit, student, handlers) {
  const wrapper = document.createElement('div');

  if (unit?.learningHubPack) {
    wrapper.appendChild(createPackCard(unit.learningHubPack));
  }

  const concepts = unit?.concepts || [];
  if (concepts.length === 0) {
    wrapper.appendChild(createEmptyStateElement({ message: 'This unit has no concepts yet.' }));
    return wrapper;
  }

  const canTeachCount = concepts.filter((concept) => {
    const record = learningRecordService.getStudentConceptRecord(student, concept.id);
    return record.understanding === 'can_teach';
  }).length;

  const summary = document.createElement('div');
  summary.className = 'student-learning__map-summary';
  const summaryText = document.createElement('p');
  summaryText.className = 'student-learning__map-summary-text';
  summaryText.textContent = `${concepts.length} concept${concepts.length === 1 ? '' : 's'} \u00b7 ${canTeachCount} you can teach`;
  summary.appendChild(summaryText);

  const progressTrack = document.createElement('div');
  progressTrack.className = 'student-learning__map-progress-track';
  const progressFill = document.createElement('div');
  progressFill.className = 'student-learning__map-progress-fill';
  progressFill.style.width = `${concepts.length > 0 ? Math.round((canTeachCount / concepts.length) * 100) : 0}%`;
  progressTrack.appendChild(progressFill);
  summary.appendChild(progressTrack);
  wrapper.appendChild(summary);

  const list = document.createElement('div');
  list.className = 'student-learning__list';
  concepts.forEach((concept, index) => {
    const record = learningRecordService.getStudentConceptRecord(student, concept.id);
    list.appendChild(createConceptMapRow(concept, record.understanding, () => handlers.onSelectConcept(index)));
  });
  wrapper.appendChild(list);

  return wrapper;
}

function createConceptMapRow(concept, understanding, onClick) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = `student-learning__row student-learning__concept-map-row student-learning__concept-map-row--${understanding}`;

  const icon = document.createElement('span');
  icon.className = 'student-learning__concept-map-icon';
  icon.textContent = getStudentUnderstandingIcon(understanding);
  icon.setAttribute('aria-hidden', 'true');
  row.appendChild(icon);

  const textWrap = document.createElement('span');
  textWrap.className = 'student-learning__concept-map-text';
  const titleEl = document.createElement('span');
  titleEl.className = 'student-learning__concept-map-title';
  titleEl.textContent = concept.title;
  const statusEl = document.createElement('span');
  statusEl.className = 'student-learning__concept-map-status';
  statusEl.textContent = getStudentUnderstandingLabel(understanding);
  textWrap.append(titleEl, statusEl);
  row.appendChild(textWrap);

  const chevron = document.createElement('span');
  chevron.className = 'student-learning__row-chevron';
  chevron.textContent = '\u203a';
  chevron.setAttribute('aria-hidden', 'true');
  row.appendChild(chevron);

  row.addEventListener('click', onClick);
  return row;
}

/**
 * The concept detail/card view — answers "what should I do with this
 * concept?". Reflection is persisted immediately on tap (reusing
 * setUnderstandingForCurrentStudent(), the established student-side
 * save pattern — no separate "save" step). "Continue Learning"
 * launches the first student-visible Learning Hub experience linked
 * to this concept via the exact, unmodified launch mechanism; a
 * concept with none shows a plain, honest "not available yet" state
 * rather than a broken or fake button. Learning-evidence numbers
 * (journey/quiz scores) are deliberately omitted — no real data for
 * this exists anywhere in ClassMate yet, and showing invented numbers
 * would be worse than showing none.
 */
function renderConceptDetailLevel(classroom, unit, conceptIndex, student, handlers) {
  const concepts = unit?.concepts || [];
  const concept = concepts[conceptIndex];
  const wrapper = document.createElement('div');
  wrapper.className = 'student-learning__concept-detail';

  if (!concept) {
    wrapper.appendChild(createEmptyStateElement({ message: 'Could not find this concept.' }));
    return wrapper;
  }

  const positionEl = document.createElement('p');
  positionEl.className = 'student-learning__concept-detail-position';
  positionEl.textContent = `Concept ${conceptIndex + 1} of ${concepts.length}`;
  wrapper.appendChild(positionEl);

  const titleEl = document.createElement('h2');
  titleEl.className = 'student-learning__concept-detail-title';
  titleEl.textContent = concept.title;
  wrapper.appendChild(titleEl);

  const introEl = document.createElement('p');
  introEl.className = 'student-learning__concept-detail-intro';
  introEl.textContent = `One of the ideas you're expected to understand in ${unit.title}.`;
  wrapper.appendChild(introEl);

  const reflectionPrompt = document.createElement('p');
  reflectionPrompt.className = 'student-learning__concept-detail-prompt';
  reflectionPrompt.textContent = 'How do you feel about this concept now?';
  wrapper.appendChild(reflectionPrompt);

  const currentRecord = learningRecordService.getStudentConceptRecord(student, concept.id);
  const reflectionGroup = document.createElement('div');
  reflectionGroup.className = 'student-learning__reflection-group';
  // "not_marked" (Not explored yet) is deliberately excluded here — a
  // student would never deliberately choose "not explored" as their
  // own reflection; it's the absence of one, not a real progression
  // step. It remains visible on the Concept Map's own row status for
  // a concept with no reflection yet, just never as a selectable
  // button here.
  SELECTABLE_UNDERSTANDING_KEYS.forEach((key) => {
    const reflectionButton = document.createElement('button');
    reflectionButton.type = 'button';
    reflectionButton.className = `student-learning__reflection-option student-learning__reflection-option--${key}` + (key === currentRecord.understanding ? ' student-learning__reflection-option--active' : '');
    const reflectionIcon = document.createElement('span');
    reflectionIcon.textContent = getStudentUnderstandingIcon(key);
    reflectionIcon.setAttribute('aria-hidden', 'true');
    const reflectionLabel = document.createElement('span');
    reflectionLabel.textContent = getStudentUnderstandingLabel(key);
    reflectionButton.append(reflectionIcon, reflectionLabel);
    reflectionButton.addEventListener('click', () => handlers.onSetUnderstanding(concept.id, key));
    reflectionGroup.appendChild(reflectionButton);
  });
  wrapper.appendChild(reflectionGroup);

  const continueSlot = document.createElement('div');
  continueSlot.className = 'student-learning__concept-detail-continue';
  const loadingMessage = document.createElement('p');
  loadingMessage.className = 'student-learning__loading';
  loadingMessage.textContent = 'Loading\u2026';
  continueSlot.appendChild(loadingMessage);
  wrapper.appendChild(continueSlot);
  loadAndRenderContinueLearning(continueSlot, classroom, concept);

  const navRow = document.createElement('div');
  navRow.className = 'student-learning__concept-nav-row';
  const prevButton = document.createElement('button');
  prevButton.type = 'button';
  prevButton.className = 'btn btn--text';
  prevButton.textContent = '\u2190 Previous concept';
  prevButton.disabled = conceptIndex === 0;
  prevButton.addEventListener('click', () => handlers.onNavigateConcept(conceptIndex - 1));
  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.className = 'btn btn--text';
  nextButton.textContent = 'Next concept \u2192';
  nextButton.disabled = conceptIndex === concepts.length - 1;
  nextButton.addEventListener('click', () => handlers.onNavigateConcept(conceptIndex + 1));
  navRow.append(prevButton, nextButton);
  wrapper.appendChild(navRow);

  // Touch swipe between concepts — explicitly called for, plain touch
  // events, no new library. A deliberately generous threshold (60px)
  // so an ordinary vertical scroll gesture on this same, scrollable
  // page never gets misread as a swipe.
  let touchStartX = null;
  wrapper.addEventListener('touchstart', (event) => { touchStartX = event.touches[0].clientX; });
  wrapper.addEventListener('touchend', (event) => {
    if (touchStartX === null) return;
    const deltaX = event.changedTouches[0].clientX - touchStartX;
    touchStartX = null;
    if (Math.abs(deltaX) < 60) return;
    if (deltaX < 0 && conceptIndex < concepts.length - 1) handlers.onNavigateConcept(conceptIndex + 1);
    else if (deltaX > 0 && conceptIndex > 0) handlers.onNavigateConcept(conceptIndex - 1);
  });

  return wrapper;
}

async function loadAndRenderContinueLearning(container, classroom, concept) {
  const resources = await resourceService.getStudentVisibleResources(classroom.id, concept);
  const learningHubResource = resources.find((resource) => resource.content?.kind === 'learning_hub_experience');

  container.innerHTML = '';
  const continueButton = document.createElement('button');
  continueButton.type = 'button';
  continueButton.className = 'btn btn--primary student-learning__continue-button';
  if (learningHubResource) {
    continueButton.textContent = 'Continue Learning \u2192';
    continueButton.addEventListener('click', () => {
      window.open(buildLearningHubLaunchUrl(learningHubResource.content.experienceType, learningHubResource.content.experienceId), '_blank');
    });
  } else {
    // Honest, not fake — no student-visible Learning Hub experience
    // is linked to this concept yet, so there is genuinely nothing
    // to continue to.
    continueButton.textContent = 'Not available yet';
    continueButton.disabled = true;
  }
  container.appendChild(continueButton);
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
  const introEl = document.createElement('p');
  introEl.className = 'student-learning__resource-type';
  introEl.textContent = 'Your teacher has selected learning resources to help you understand this.';
  textWrap.append(titleEl, introEl);
  card.appendChild(textWrap);

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'btn btn--primary student-learning__resource-action';
  openButton.textContent = 'Learn';
  openButton.addEventListener('click', () => {
    window.open(buildLearningHubLaunchUrl('pack', learningHubPack.packId), '_blank');
  });
  card.appendChild(openButton);

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
