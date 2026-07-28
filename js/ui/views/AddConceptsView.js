/**
 * ui/views/AddConceptsView.js
 *
 * Curriculum Library v1's bulk-import path — reached from a Unit's
 * Concepts screen (see ui/views/LearningRecordView.js's "+ Add
 * Concepts" button, distinct from that same screen's existing
 * single-item "+ Add Concept" form) via a target `unit` and its
 * `classroom`.
 *
 * Journey: Add Concepts -> pick a source -> (Curriculum Library only,
 * this milestone) Curriculum -> Grade -> Subject -> Unit -> Review
 * Concepts -> Import. Imported concepts land in the exact unit this
 * view was opened for and are visible the moment the teacher is back
 * on that unit's screen.
 *
 * PDF Upload and Paste Text are real, visible options here, not
 * hidden — just disabled with a "Coming Soon" label, per explicit
 * instruction. Every source is expected to end at the same
 * review-and-import step, handing
 * services/conceptImportService.js's importConceptsIntoUnit() the
 * same plain `string[]` of titles regardless of where they came from
 * — see that file and services/curriculumLibraryService.js's
 * getUnitAsImportCandidate() for the seam where a curriculum unit
 * becomes that generic shape.
 *
 * This is the *bulk, multi-select* import path, distinct from
 * ui/views/LearningManagementView.js's own curriculum browsing, which
 * materializes one Unit/Concept at a time as a teacher clicks through
 * it (see services/curriculumLibraryService.js's
 * materializeUnitAndConcept()) rather than reviewing a checklist.
 * Both read from the same manifest/pack data and the same service —
 * they just serve two different moments (bulk-populate an existing
 * unit here, vs. browse-and-write-one-lesson there).
 *
 * Self-contained, same pattern as every other view in this feature:
 * no router, no URL, local state only for which drill-down step is
 * active.
 */

import * as workspaceService from '../../services/workspaceService.js';
import * as curriculumLibraryService from '../../services/curriculumLibraryService.js';
import * as conceptImportService from '../../services/conceptImportService.js';
import { createIcon } from '../components/Icon.js';
import { showToast } from '../components/Toast.js';

export function renderAddConceptsView(container, { classroom, unit, onBack }) {
  // 'source-picker' (default), 'choose-curriculum', 'choose-grade',
  // 'choose-subject', 'choose-unit', or 'review'.
  let mode = 'source-picker';
  let selectedCurriculum = null;
  let selectedGrade = null;
  let selectedSubjectEntry = null; // { id, name, submissionId }
  let selectedPack = null; // fetched pack content
  let selectedSourceUnit = null; // the curriculum pack's own unit, not the target classroom unit
  let checkedTitles = null; // Set<string>, only meaningful during 'review'
  let loadError = null;

  function rerender() {
    renderAddConcepts(
      container,
      mode,
      { selectedCurriculum, selectedGrade, selectedSubjectEntry, selectedPack, selectedSourceUnit, checkedTitles, loadError },
      {
        onBack,
        onPickCurriculumLibrary: () => {
          loadError = null;
          mode = 'choose-curriculum';
          rerender();
        },
        onChooseCurriculum: (curriculum) => {
          selectedCurriculum = curriculum;
          mode = 'choose-grade';
          rerender();
        },
        onChooseGrade: (grade) => {
          selectedGrade = grade;
          mode = 'choose-subject';
          rerender();
        },
        onChooseSubject: async (subjectEntry) => {
          selectedSubjectEntry = subjectEntry;
          loadError = null;
          try {
            selectedPack = await curriculumLibraryService.getPack(subjectEntry.submissionId);
          } catch (error) {
            console.error('[AddConceptsView] Failed to load curriculum pack:', error);
            loadError = "Couldn't load this subject's units. Check your connection and try again.";
          }
          mode = 'choose-unit';
          rerender();
        },
        onChooseSourceUnit: (sourceUnit) => {
          selectedSourceUnit = sourceUnit;
          const candidate = curriculumLibraryService.getUnitAsImportCandidate(selectedPack, sourceUnit);
          checkedTitles = new Set(candidate.conceptTitles);
          mode = 'review';
          rerender();
        },
        onToggleTitle: (title) => {
          if (checkedTitles.has(title)) checkedTitles.delete(title);
          else checkedTitles.add(title);
          rerender();
        },
        onImport: () => {
          const titles = selectedSourceUnit.concepts.filter((title) => checkedTitles.has(title));
          const created = conceptImportService.importConceptsIntoUnit(classroom, unit, titles);
          workspaceService.save(classroom);
          showToast(`${created.length} concept${created.length === 1 ? '' : 's'} imported`);
          onBack();
        },
        onBackTo: (targetMode) => {
          mode = targetMode;
          rerender();
        },
      }
    );
  }

  rerender();
}

function renderAddConcepts(container, mode, selection, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'add-concepts';

  const header = document.createElement('header');
  header.className = 'add-concepts__header';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append(mode === 'source-picker' ? 'Cancel' : 'Back');
  backButton.addEventListener('click', () => {
    if (mode === 'source-picker') return handlers.onBack();
    const previous = {
      'choose-curriculum': 'source-picker',
      'choose-grade': 'choose-curriculum',
      'choose-subject': 'choose-grade',
      'choose-unit': 'choose-subject',
      review: 'choose-unit',
    }[mode];
    handlers.onBackTo(previous);
  });
  header.appendChild(backButton);

  const title = document.createElement('h1');
  title.className = 'add-concepts__title';
  title.textContent = 'Add Concepts';
  header.appendChild(title);

  wrapper.appendChild(header);

  if (mode === 'choose-curriculum') {
    wrapper.appendChild(renderCurriculumStep(handlers));
  } else if (mode === 'choose-grade') {
    wrapper.appendChild(renderGradeStep(selection.selectedCurriculum, handlers));
  } else if (mode === 'choose-subject') {
    wrapper.appendChild(renderSubjectStep(selection.selectedGrade, handlers));
  } else if (mode === 'choose-unit') {
    wrapper.appendChild(renderSourceUnitStep(selection, handlers));
  } else if (mode === 'review') {
    wrapper.appendChild(renderReviewStep(selection, handlers));
  } else {
    wrapper.appendChild(renderSourcePicker(handlers));
  }

  container.appendChild(wrapper);
}

// ---- Step 1: source picker ------------------------------------------

function renderSourcePicker(handlers) {
  const section = document.createElement('div');
  section.className = 'add-concepts__section';

  const intro = document.createElement('p');
  intro.className = 'add-concepts__step-heading';
  intro.textContent = 'Where are these concepts coming from?';
  section.appendChild(intro);

  const grid = document.createElement('div');
  grid.className = 'add-concepts__source-grid';

  const curriculumOption = document.createElement('button');
  curriculumOption.type = 'button';
  curriculumOption.className = 'add-concepts__source-option';
  curriculumOption.appendChild(createIcon('graduation-cap', { size: 24 }));
  const curriculumLabel = document.createElement('span');
  curriculumLabel.textContent = 'Curriculum Library';
  curriculumOption.appendChild(curriculumLabel);
  curriculumOption.addEventListener('click', handlers.onPickCurriculumLibrary);
  grid.appendChild(curriculumOption);

  grid.appendChild(createDisabledSourceOption('file-up', 'PDF Upload'));
  grid.appendChild(createDisabledSourceOption('file-text', 'Paste Text'));

  section.appendChild(grid);
  return section;
}

function createDisabledSourceOption(iconName, label) {
  const option = document.createElement('button');
  option.type = 'button';
  option.className = 'add-concepts__source-option add-concepts__source-option--disabled';
  option.disabled = true;
  option.title = 'Coming Soon';
  option.appendChild(createIcon(iconName, { size: 24 }));
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  option.appendChild(labelEl);
  const badge = document.createElement('span');
  badge.className = 'add-concepts__coming-soon-badge';
  badge.textContent = 'Coming Soon';
  option.appendChild(badge);
  return option;
}

// ---- Curriculum Library drill-down ----------------------------------

function renderCurriculumStep(handlers) {
  const section = document.createElement('div');
  section.className = 'add-concepts__section';
  const heading = document.createElement('p');
  heading.className = 'add-concepts__step-heading';
  heading.textContent = 'Choose a Curriculum';
  section.appendChild(heading);

  const listEl = document.createElement('div');
  listEl.className = 'add-concepts__choice-list add-concepts__choice-list--loading';
  listEl.textContent = 'Loading\u2026';
  section.appendChild(listEl);

  curriculumLibraryService
    .getCurricula()
    .then((curricula) => {
      listEl.className = 'add-concepts__choice-list';
      listEl.innerHTML = '';
      if (curricula.length === 0) {
        listEl.textContent = 'No curricula available yet.';
        return;
      }
      curricula.forEach((curriculum) => {
        listEl.appendChild(createChoiceButton(curriculum.name, () => handlers.onChooseCurriculum(curriculum)));
      });
    })
    .catch((error) => {
      console.error('[AddConceptsView] Failed to load curricula:', error);
      listEl.className = 'add-concepts__choice-list';
      listEl.textContent = "Couldn't load the Curriculum Library. Check your connection and try again.";
    });

  return section;
}

function renderGradeStep(curriculum, handlers) {
  const section = document.createElement('div');
  section.className = 'add-concepts__section';
  const heading = document.createElement('p');
  heading.className = 'add-concepts__step-heading';
  heading.textContent = `Choose a Grade \u2014 ${curriculum.name}`;
  section.appendChild(heading);

  const listEl = document.createElement('div');
  listEl.className = 'add-concepts__choice-list';
  section.appendChild(listEl);

  curriculum.grades.forEach((grade) => {
    listEl.appendChild(createChoiceButton(grade.name, () => handlers.onChooseGrade(grade)));
  });

  return section;
}

function renderSubjectStep(grade, handlers) {
  const section = document.createElement('div');
  section.className = 'add-concepts__section';
  const heading = document.createElement('p');
  heading.className = 'add-concepts__step-heading';
  heading.textContent = `Choose a Subject \u2014 ${grade.name}`;
  section.appendChild(heading);

  const listEl = document.createElement('div');
  listEl.className = 'add-concepts__choice-list';
  section.appendChild(listEl);

  grade.subjects.forEach((subject) => {
    listEl.appendChild(createChoiceButton(subject.name, () => handlers.onChooseSubject(subject)));
  });

  return section;
}

function renderSourceUnitStep(selection, handlers) {
  const section = document.createElement('div');
  section.className = 'add-concepts__section';

  if (selection.loadError) {
    const error = document.createElement('p');
    error.className = 'add-concepts__error';
    error.textContent = selection.loadError;
    section.appendChild(error);
    return section;
  }

  const pack = selection.selectedPack;
  const heading = document.createElement('p');
  heading.className = 'add-concepts__step-heading';
  heading.textContent = `Choose a Unit \u2014 ${pack.curriculum} ${pack.grade} ${pack.subject}`;
  section.appendChild(heading);

  const listEl = document.createElement('div');
  listEl.className = 'add-concepts__choice-list';
  section.appendChild(listEl);

  pack.units.forEach((sourceUnit) => {
    const button = createChoiceButton(sourceUnit.title, () => handlers.onChooseSourceUnit(sourceUnit));
    const count = document.createElement('span');
    count.className = 'add-concepts__unit-count';
    count.textContent = `${sourceUnit.concepts.length} concept${sourceUnit.concepts.length === 1 ? '' : 's'}`;
    button.appendChild(count);
    listEl.appendChild(button);
  });

  return section;
}

// ---- Review & Import -------------------------------------------------

function renderReviewStep(selection, handlers) {
  const section = document.createElement('div');
  section.className = 'add-concepts__section';

  const heading = document.createElement('p');
  heading.className = 'add-concepts__step-heading';
  heading.textContent = `Review Concepts \u2014 ${selection.selectedSourceUnit.title}`;
  section.appendChild(heading);

  const subheading = document.createElement('p');
  subheading.className = 'add-concepts__review-subheading';
  subheading.textContent = 'Uncheck anything you don\u2019t want to import.';
  section.appendChild(subheading);

  const list = document.createElement('div');
  list.className = 'add-concepts__review-list';

  selection.selectedSourceUnit.concepts.forEach((title) => {
    const row = document.createElement('label');
    row.className = 'add-concepts__review-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selection.checkedTitles.has(title);
    checkbox.addEventListener('change', () => handlers.onToggleTitle(title));

    const label = document.createElement('span');
    label.textContent = title;

    row.append(checkbox, label);
    list.appendChild(row);
  });

  section.appendChild(list);

  const importButton = document.createElement('button');
  importButton.type = 'button';
  importButton.className = 'btn btn--primary';
  const count = selection.checkedTitles.size;
  importButton.textContent = count > 0 ? `Import ${count} Concept${count === 1 ? '' : 's'}` : 'Import';
  importButton.disabled = count === 0;
  importButton.addEventListener('click', handlers.onImport);
  section.appendChild(importButton);

  return section;
}

function createChoiceButton(label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'add-concepts__choice-option';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  button.appendChild(labelEl);
  button.addEventListener('click', onClick);
  return button;
}
