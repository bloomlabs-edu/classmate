/**
 * ui/views/AssignCurriculumPromptView.js
 *
 * Curriculum Assignment at Creation milestone: Curriculum is now a
 * required field when creating a classroom (see
 * ui/components/NewClassroomModal.js), so new classrooms always
 * arrive with an assignment already in place. This view exists only
 * for classrooms that predate that requirement — it's the one-time
 * prompt shown on such a classroom's Dashboard (see
 * ui/views/DashboardView.js's own "needs a curriculum" banner) until
 * one is picked. Once assigned, this screen has nothing left to do —
 * the banner that opens it stops appearing on its own, since it's
 * simply gated on whether `curriculumLibraryService.getCurriculumAssignment()`
 * returns anything.
 *
 * A flat, pick-one list, not the richer Official/Community browsing
 * Curriculum Management's own Browse Curriculum Library offers — same
 * data source as ui/components/NewClassroomModal.js's own picker (see
 * services/curriculumLibraryService.js's getAssignableCurriculumOptions()),
 * just presented as a full screen here instead of a modal field, since
 * this is reached from the Dashboard, not classroom creation.
 *
 * Self-contained, same pattern as every other view in this feature:
 * no router, no URL, local state only for which step is active.
 */

import * as workspaceService from '../../services/workspaceService.js';
import * as curriculumLibraryService from '../../services/curriculumLibraryService.js';
import { getDisplayName } from '../../services/classroomService.js';
import { createBackButton } from '../components/BackButton.js';
import { showToast } from '../components/Toast.js';

export function renderAssignCurriculumPromptView(container, { classroom, onBack }) {
  let mode = 'loading'; // 'loading' | 'choose' | 'error' | 'confirm'
  let options = [];
  let selectedOption = null;

  function rerender() {
    renderView(container, mode, { classroom, options, selectedOption }, {
      onBack,
      onChooseOption: (option) => {
        curriculumLibraryService.setCurriculumAssignment(classroom, {
          curriculumId: option.curriculumId,
          versionId: option.versionId,
        });
        workspaceService.save(classroom);
        selectedOption = option;
        showToast(`${option.curriculumName} assigned to ${getDisplayName(classroom)}`);
        mode = 'confirm';
        rerender();
      },
    });
  }

  rerender();

  curriculumLibraryService
    .getAssignableCurriculumOptions()
    .then((fetchedOptions) => {
      options = fetchedOptions;
      mode = 'choose';
      rerender();
    })
    .catch((error) => {
      console.error('[AssignCurriculumPromptView] Failed to load curriculum options:', error);
      mode = 'error';
      rerender();
    });
}

function renderView(container, mode, state, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'assign-curriculum-prompt';

  const header = document.createElement('header');
  header.className = 'assign-curriculum-prompt__header';

  const backButton = createBackButton(handlers.onBack);
  header.appendChild(backButton);

  const title = document.createElement('h1');
  title.className = 'assign-curriculum-prompt__title';
  title.textContent = 'Assign a Curriculum';
  header.appendChild(title);

  wrapper.appendChild(header);

  if (mode === 'loading') {
    const loading = document.createElement('p');
    loading.className = 'assign-curriculum-prompt__intro';
    loading.textContent = 'Loading available curricula\u2026';
    wrapper.appendChild(loading);
  } else if (mode === 'error') {
    const error = document.createElement('p');
    error.className = 'assign-curriculum-prompt__error';
    error.textContent = "Couldn't load the Curriculum Library. Check your connection and try again.";
    wrapper.appendChild(error);
  } else if (mode === 'confirm') {
    wrapper.appendChild(renderConfirmStep(state, handlers));
  } else {
    wrapper.appendChild(renderChooseStep(state, handlers));
  }

  container.appendChild(wrapper);
}

function renderChooseStep(state, handlers) {
  const section = document.createElement('div');
  section.className = 'assign-curriculum-prompt__section';

  const intro = document.createElement('p');
  intro.className = 'assign-curriculum-prompt__intro';
  intro.textContent = `Choose the curriculum ${getDisplayName(state.classroom)} will use. Learning will use it automatically from here on — this is the only time you'll need to pick it.`;
  section.appendChild(intro);

  if (state.options.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'assign-curriculum-prompt__intro';
    empty.textContent = 'No curricula are available yet. Check back once one has been added to the Curriculum Library.';
    section.appendChild(empty);
    return section;
  }

  const grid = document.createElement('div');
  grid.className = 'assign-curriculum-prompt__option-grid';
  state.options.forEach((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'assign-curriculum-prompt__option';
    const nameEl = document.createElement('span');
    nameEl.className = 'assign-curriculum-prompt__option-name';
    nameEl.textContent = option.curriculumName;
    const versionEl = document.createElement('span');
    versionEl.className = 'assign-curriculum-prompt__option-version';
    versionEl.textContent = `Version ${option.versionLabel}`;
    button.append(nameEl, versionEl);
    button.addEventListener('click', () => handlers.onChooseOption(option));
    grid.appendChild(button);
  });
  section.appendChild(grid);

  return section;
}

function renderConfirmStep(state, handlers) {
  const section = document.createElement('div');
  section.className = 'assign-curriculum-prompt__section';

  const heading = document.createElement('p');
  heading.className = 'assign-curriculum-prompt__confirm-heading';
  heading.textContent = '\u2705 Curriculum Assigned';
  section.appendChild(heading);

  const card = document.createElement('div');
  card.className = 'assign-curriculum-prompt__confirm-card';
  card.appendChild(createDetailRow('Class', getDisplayName(state.classroom)));
  card.appendChild(createDetailRow('Curriculum', state.selectedOption.curriculumName));
  card.appendChild(createDetailRow('Version', state.selectedOption.versionLabel));
  section.appendChild(card);

  const readyMessage = document.createElement('p');
  readyMessage.className = 'assign-curriculum-prompt__intro';
  readyMessage.textContent = 'Your class is now ready to start planning lessons using this curriculum.';
  section.appendChild(readyMessage);

  const doneButton = document.createElement('button');
  doneButton.type = 'button';
  doneButton.className = 'btn btn--primary';
  doneButton.textContent = 'Done';
  doneButton.addEventListener('click', handlers.onBack);
  section.appendChild(doneButton);

  return section;
}

function createDetailRow(label, value) {
  const row = document.createElement('div');
  row.className = 'assign-curriculum-prompt__detail-row';
  const labelEl = document.createElement('span');
  labelEl.className = 'assign-curriculum-prompt__detail-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'assign-curriculum-prompt__detail-value';
  valueEl.textContent = value;
  row.append(labelEl, valueEl);
  return row;
}
