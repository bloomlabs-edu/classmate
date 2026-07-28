/**
 * ui/views/CurriculumManagementView.js
 *
 * Curriculum Management — "⚙️ Curriculum Management," a platform
 * administration workspace, not part of a teacher's daily flow.
 * Curriculum Assignment at Creation milestone: assigning a curriculum
 * to a class no longer happens here at all in the normal case — it
 * happens once, up front, when the class is created (see
 * ui/components/NewClassroomModal.js, where Curriculum is now a
 * required field alongside Classroom Name, Grade, School, and
 * Academic Year). This workspace is left with exactly what platform
 * administration actually needs:
 *
 *   - 📚 Browse Curriculum Library — the primary screen. Official and
 *     Community curricula as cards (name, publisher, board, grades,
 *     subjects, version, status). Clicking one opens Curriculum
 *     Details (publisher, grades, subjects, version, and a single
 *     action: Preview Structure — no assignment action here anymore).
 *     Preview Structure reuses the *exact same* explorer Learning
 *     Management uses (see ui/components/CurriculumExplorerPanel.js)
 *     — no second viewer. No upload capability anywhere in this
 *     screen or its children.
 *   - ➕ Contribute Curriculum — the renamed upload flow (Upload PDF ->
 *     Extract -> Review -> Submit). Submitting does *not* add
 *     anything to the Library — it goes to
 *     services/contributedCurriculaService.js with status
 *     'pending_review' instead. This milestone still simulates the
 *     review step rather than building real reviewer tooling — a
 *     future phase's actual "review submissions" screen belongs here,
 *     reading from that same pending store, alongside version
 *     management (publishing a new version of an existing curriculum,
 *     retiring an old one) as this workspace's next real
 *     administrative capabilities. Neither is built yet; this file's
 *     job is staying the one place they'll eventually live, not
 *     pretending they exist today.
 *
 * A classroom's curriculum assignment still only ever stores
 * `{ curriculumId, versionId }` (see models/Classroom.js) — never a
 * copy of the curriculum's data — whether that assignment was made at
 * creation or, for a classroom that predates this requirement, via
 * the one-time prompt on its own Dashboard (see
 * ui/views/AssignCurriculumPromptView.js). Either way, Learning
 * Management never asks a teacher to choose a curriculum — it simply
 * reads whatever's already there.
 *
 * Self-contained, same pattern as every other view in this feature:
 * no router, no URL, local state only for which step is active.
 */

import * as curriculumLibraryService from '../../services/curriculumLibraryService.js';
import * as curriculumPdfParsingService from '../../services/curriculumPdfParsingService.js';
import * as curriculumPackBuilderService from '../../services/curriculumPackBuilderService.js';
import * as contributedCurriculaService from '../../services/contributedCurriculaService.js';
import { createIcon } from '../components/Icon.js';
import { createCurriculumExplorerPanel } from '../components/CurriculumExplorerPanel.js';
import { showToast } from '../components/Toast.js';

export function renderCurriculumManagementView(container, { onBack, onOpenLearningManagement }) {
  // See this file's header comment for the three top-level flows.
  let mode = 'hub';

  // Browse / Details / Preview / Assign state.
  let selectedCurriculum = null;
  let previewGrade = null;
  let previewSubjectEntry = null;
  let previewPack = null;
  let expandedUnitId = null;
  let loadError = null;

  // Contribute state.
  let draft = null;
  let extractError = null;
  let submittedContribution = null;

  function rerender() {
    renderView(
      container,
      mode,
      {
        selectedCurriculum,
        previewGrade,
        previewSubjectEntry,
        previewPack,
        expandedUnitId,
        loadError,
        draft,
        extractError,
        submittedContribution,
      },
      {
        onBack,
        onGoToHub: () => {
          mode = 'hub';
          rerender();
        },
        onGoToLearningManagement: () => {
          if (onOpenLearningManagement) {
            onOpenLearningManagement();
          } else {
            // Defensive fallback for any entry point that hasn't wired
            // this in — the hub is at least a real, working screen,
            // never a dead click.
            mode = 'hub';
            rerender();
          }
        },
        onGoToBrowse: () => {
          mode = 'browse';
          rerender();
        },
        onOpenCurriculumDetails: (curriculum) => {
          selectedCurriculum = curriculum;
          previewGrade = null;
          previewSubjectEntry = null;
          previewPack = null;
          expandedUnitId = null;
          mode = 'curriculum-details';
          rerender();
        },
        onGoToPreview: () => {
          mode = 'preview-choose-grade';
          rerender();
        },
        onChoosePreviewGrade: (grade) => {
          previewGrade = grade;
          mode = 'preview-choose-subject';
          rerender();
        },
        onChoosePreviewSubject: async (subjectEntry) => {
          previewSubjectEntry = subjectEntry;
          loadError = null;
          try {
            previewPack = await curriculumLibraryService.getPack(subjectEntry.packFile);
          } catch (error) {
            console.error('[CurriculumManagementView] Failed to load pack for preview:', error);
            loadError = "Couldn't load this subject's structure. Check your connection and try again.";
          }
          expandedUnitId = null;
          mode = 'preview-structure';
          rerender();
        },
        onToggleUnit: (unitId) => {
          expandedUnitId = expandedUnitId === unitId ? null : unitId;
          rerender();
        },
        onGoToContribute: () => {
          draft = null;
          extractError = null;
          submittedContribution = null;
          mode = 'contribute-create';
          rerender();
        },
        onCreateDraft: (curriculumName, gradeName, subjectName) => {
          draft = curriculumPackBuilderService.createDraftPack({ curriculumName, gradeName, subjectName });
          mode = 'contribute-review';
          rerender();
        },
        onUploadPdf: async (curriculumName, gradeName, subjectName, file) => {
          draft = curriculumPackBuilderService.createDraftPack({ curriculumName, gradeName, subjectName });
          extractError = null;
          mode = 'contribute-extracting';
          rerender();
          try {
            const rawText = await curriculumPdfParsingService.extractTextFromPdf(file);
            const extractedUnits = curriculumPdfParsingService.parseTextIntoUnits(rawText);
            curriculumPackBuilderService.loadExtractedUnitsIntoDraft(draft, extractedUnits);
            if (extractedUnits.length === 0) {
              extractError =
                "Couldn't find any \"Unit N\" or \"Chapter N\" headings in this PDF. You can still add units and concepts manually below.";
            }
          } catch (error) {
            console.error('[CurriculumManagementView] PDF extraction failed:', error);
            extractError = "Couldn't read that PDF. You can still add units and concepts manually below.";
          }
          mode = 'contribute-review';
          rerender();
        },
        onAddUnit: (title) => {
          curriculumPackBuilderService.addDraftUnit(draft, title);
          rerender();
        },
        onRenameUnit: (unitId, title) => {
          curriculumPackBuilderService.renameDraftUnit(draft, unitId, title);
        },
        onDeleteUnit: (unitId) => {
          curriculumPackBuilderService.deleteDraftUnit(draft, unitId);
          rerender();
        },
        onMoveUnitUp: (unitId) => {
          curriculumPackBuilderService.moveDraftUnitUp(draft, unitId);
          rerender();
        },
        onMoveUnitDown: (unitId) => {
          curriculumPackBuilderService.moveDraftUnitDown(draft, unitId);
          rerender();
        },
        onAddConcept: (unitId, title) => {
          curriculumPackBuilderService.addDraftConcept(draft, unitId, title);
          rerender();
        },
        onRenameConcept: (unitId, conceptId, title) => {
          curriculumPackBuilderService.renameDraftConcept(draft, unitId, conceptId, title);
        },
        onDeleteConcept: (unitId, conceptId) => {
          curriculumPackBuilderService.deleteDraftConcept(draft, unitId, conceptId);
          rerender();
        },
        onMoveConceptUp: (unitId, conceptId) => {
          curriculumPackBuilderService.moveDraftConceptUp(draft, unitId, conceptId);
          rerender();
        },
        onMoveConceptDown: (unitId, conceptId) => {
          curriculumPackBuilderService.moveDraftConceptDown(draft, unitId, conceptId);
          rerender();
        },
        onSubmitContribution: () => {
          const packJson = curriculumPackBuilderService.exportPackJson(draft);
          submittedContribution = contributedCurriculaService.submitContribution(packJson);
          mode = 'contribute-submitted';
          rerender();
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

function renderView(container, mode, state, handlers) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'curriculum-management';

  const header = document.createElement('header');
  header.className = 'curriculum-management__header';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.appendChild(createIcon('arrow-left'));
  backButton.append(mode === 'hub' ? 'Back to My Classrooms' : 'Back');
  backButton.addEventListener('click', () => {
    if (mode === 'hub') return handlers.onBack();
    const previous = {
      browse: 'hub',
      'curriculum-details': 'browse',
      'preview-choose-grade': 'curriculum-details',
      'preview-choose-subject': 'preview-choose-grade',
      'preview-structure': 'curriculum-details',
      'contribute-create': 'hub',
      'contribute-extracting': 'contribute-create',
      'contribute-review': 'contribute-create',
      'contribute-submitted': 'hub',
    }[mode];
    handlers.onBackTo(previous);
  });
  header.appendChild(backButton);

  const title = document.createElement('h1');
  title.className = 'curriculum-management__title';
  title.textContent = '\u2699\ufe0f Curriculum Management';
  header.appendChild(title);

  wrapper.appendChild(header);

  if (mode === 'browse') {
    wrapper.appendChild(renderBrowseStep(handlers));
  } else if (mode === 'curriculum-details') {
    wrapper.appendChild(renderCurriculumDetailsStep(state.selectedCurriculum, handlers));
  } else if (mode === 'preview-choose-grade') {
    wrapper.appendChild(renderPreviewChooseGradeStep(state.selectedCurriculum, handlers));
  } else if (mode === 'preview-choose-subject') {
    wrapper.appendChild(renderPreviewChooseSubjectStep(state.previewGrade, handlers));
  } else if (mode === 'preview-structure') {
    wrapper.appendChild(renderPreviewStructureStep(state, handlers));
  } else if (mode === 'contribute-create') {
    wrapper.appendChild(renderContributeCreateStep(handlers));
  } else if (mode === 'contribute-extracting') {
    wrapper.appendChild(renderExtractingStep());
  } else if (mode === 'contribute-review') {
    wrapper.appendChild(renderContributeReviewStep(state, handlers));
  } else if (mode === 'contribute-submitted') {
    wrapper.appendChild(renderContributeSubmittedStep(state.submittedContribution));
  } else {
    wrapper.appendChild(renderHubStep(handlers));
  }

  container.appendChild(wrapper);
}

// ---- Hub -----------------------------------------------------------------

function renderHubStep(handlers) {
  const section = document.createElement('div');
  section.className = 'curriculum-management__section';

  const intro = document.createElement('p');
  intro.className = 'curriculum-management__intro';
  intro.textContent = 'Browse and contribute curricula. This is a separate, occasional workspace — not part of daily lesson prep.';
  section.appendChild(intro);

  const grid = document.createElement('div');
  grid.className = 'curriculum-management__hub-grid';

  grid.appendChild(createHubCard('\ud83d\udcda', 'Browse Curriculum Library', 'Official and community curricula', handlers.onGoToBrowse));
  grid.appendChild(createHubCard('\u2795', 'Contribute Curriculum', 'Submit a curriculum for review', handlers.onGoToContribute));

  section.appendChild(grid);
  return section;
}

function createHubCard(icon, title, description, onClick) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'curriculum-management__hub-card';

  const iconEl = document.createElement('span');
  iconEl.className = 'curriculum-management__hub-card-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;
  card.appendChild(iconEl);

  const titleEl = document.createElement('span');
  titleEl.className = 'curriculum-management__hub-card-title';
  titleEl.textContent = title;
  card.appendChild(titleEl);

  const descEl = document.createElement('span');
  descEl.className = 'curriculum-management__hub-card-description';
  descEl.textContent = description;
  card.appendChild(descEl);

  card.addEventListener('click', onClick);
  return card;
}

// ---- Browse Curriculum Library -------------------------------------------

function renderBrowseStep(handlers) {
  const section = document.createElement('div');
  section.className = 'curriculum-management__section';

  const heading = document.createElement('p');
  heading.className = 'curriculum-management__step-heading';
  heading.textContent = 'Browse Curriculum Library';
  section.appendChild(heading);

  const loadingNote = document.createElement('p');
  loadingNote.className = 'curriculum-management__intro';
  loadingNote.textContent = 'Loading\u2026';
  section.appendChild(loadingNote);

  curriculumLibraryService
    .getLibrary()
    .then(({ official, community }) => {
      loadingNote.remove();
      section.appendChild(renderCurriculumSection('Official', official, handlers));
      section.appendChild(renderCurriculumSection('Community', community, handlers));
    })
    .catch((error) => {
      console.error('[CurriculumManagementView] Failed to load the library:', error);
      loadingNote.textContent = "Couldn't load the Curriculum Library. Check your connection and try again.";
    });

  return section;
}

function renderCurriculumSection(label, curricula, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'curriculum-management__library-section';

  const heading = document.createElement('p');
  heading.className = 'curriculum-management__library-section-heading';
  heading.textContent = label;
  wrap.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'curriculum-management__curriculum-grid';
  curricula.forEach((curriculum) => {
    grid.appendChild(createCurriculumCard(curriculum, handlers));
  });
  wrap.appendChild(grid);

  return wrap;
}

function createCurriculumCard(curriculum, handlers) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'curriculum-management__curriculum-card';

  const nameRow = document.createElement('div');
  nameRow.className = 'curriculum-management__curriculum-card-name-row';
  const star = document.createElement('span');
  star.textContent = curriculum.status === 'official' ? '\u2b50' : '';
  nameRow.appendChild(star);
  const nameEl = document.createElement('span');
  nameEl.className = 'curriculum-management__curriculum-card-name';
  nameEl.textContent = curriculum.name;
  nameRow.appendChild(nameEl);
  card.appendChild(nameRow);

  const publisherEl = document.createElement('span');
  publisherEl.className = 'curriculum-management__curriculum-card-meta';
  publisherEl.textContent = curriculum.publisher;
  card.appendChild(publisherEl);

  const latestVersion = curriculumLibraryService.getLatestVersion(curriculum);
  if (latestVersion) {
    const gradeNames = latestVersion.grades.map((g) => g.name);
    const subjectNames = [...new Set(curriculumLibraryService.getSubjectsInVersion(latestVersion).map((s) => s.name))];

    const gradesEl = document.createElement('span');
    gradesEl.className = 'curriculum-management__curriculum-card-meta';
    gradesEl.textContent = `Grades: ${gradeNames.join(', ')}`;
    card.appendChild(gradesEl);

    const subjectsEl = document.createElement('span');
    subjectsEl.className = 'curriculum-management__curriculum-card-meta';
    subjectsEl.textContent = `Subjects: ${subjectNames.join(', ')}`;
    card.appendChild(subjectsEl);

    const versionEl = document.createElement('span');
    versionEl.className = 'curriculum-management__curriculum-card-badge';
    versionEl.textContent = `Version ${latestVersion.versionLabel}`;
    card.appendChild(versionEl);
  } else {
    const noneEl = document.createElement('span');
    noneEl.className = 'curriculum-management__curriculum-card-meta';
    noneEl.textContent = 'No published version yet';
    card.appendChild(noneEl);
  }

  card.addEventListener('click', () => handlers.onOpenCurriculumDetails(curriculum));
  return card;
}

// ---- Curriculum Details ----------------------------------------------

function renderCurriculumDetailsStep(curriculum, handlers) {
  const section = document.createElement('div');
  section.className = 'curriculum-management__section';

  const heading = document.createElement('p');
  heading.className = 'curriculum-management__step-heading';
  heading.textContent = curriculum.name;
  section.appendChild(heading);

  const card = document.createElement('div');
  card.className = 'curriculum-management__details-card';

  card.appendChild(createDetailRow('Publisher', curriculum.publisher));
  card.appendChild(createDetailRow('Board', curriculum.board));
  card.appendChild(createDetailRow('Status', curriculum.status === 'official' ? '\u2b50 Official' : 'Community'));

  const latestVersion = curriculumLibraryService.getLatestVersion(curriculum);

  if (latestVersion) {
    const gradeNames = latestVersion.grades.map((g) => g.name);
    const subjectNames = [...new Set(curriculumLibraryService.getSubjectsInVersion(latestVersion).map((s) => s.name))];
    card.appendChild(createDetailRow('Grades', gradeNames.join(', ')));
    card.appendChild(createDetailRow('Subjects', subjectNames.join('\n')));
    card.appendChild(createDetailRow('Version', latestVersion.versionLabel));

    const actions = document.createElement('div');
    actions.className = 'curriculum-management__details-actions';

    const previewButton = document.createElement('button');
    previewButton.type = 'button';
    previewButton.className = 'btn btn--primary';
    previewButton.textContent = 'Preview Structure';
    previewButton.addEventListener('click', handlers.onGoToPreview);
    actions.appendChild(previewButton);

    card.appendChild(actions);
  } else {
    const noneMessage = document.createElement('p');
    noneMessage.className = 'curriculum-management__intro';
    noneMessage.textContent = 'No published version yet — nothing to preview or assign until one is contributed and approved.';
    card.appendChild(noneMessage);
  }

  section.appendChild(card);
  return section;
}

function createDetailRow(label, value) {
  const row = document.createElement('div');
  row.className = 'curriculum-management__detail-row';
  const labelEl = document.createElement('span');
  labelEl.className = 'curriculum-management__detail-label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'curriculum-management__detail-value';
  valueEl.textContent = value;
  row.append(labelEl, valueEl);
  return row;
}

// ---- Preview Structure (reuses the shared Curriculum Explorer) ------

function renderPreviewChooseGradeStep(curriculum, handlers) {
  const section = document.createElement('div');
  section.className = 'curriculum-management__section';

  const heading = document.createElement('p');
  heading.className = 'curriculum-management__step-heading';
  heading.textContent = `Preview \u2014 Choose Grade`;
  section.appendChild(heading);

  const latestVersion = curriculumLibraryService.getLatestVersion(curriculum);
  const grid = document.createElement('div');
  grid.className = 'curriculum-management__hub-grid';
  latestVersion.grades.forEach((grade) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'curriculum-management__assign-choice';
    button.textContent = grade.name;
    button.addEventListener('click', () => handlers.onChoosePreviewGrade(grade));
    grid.appendChild(button);
  });
  section.appendChild(grid);

  return section;
}

function renderPreviewChooseSubjectStep(grade, handlers) {
  const section = document.createElement('div');
  section.className = 'curriculum-management__section';

  const heading = document.createElement('p');
  heading.className = 'curriculum-management__step-heading';
  heading.textContent = `Preview \u2014 ${grade.name}`;
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'curriculum-management__hub-grid';
  grade.subjects.forEach((subjectEntry) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'curriculum-management__assign-choice';
    button.textContent = subjectEntry.name;
    button.addEventListener('click', () => handlers.onChoosePreviewSubject(subjectEntry));
    grid.appendChild(button);
  });
  section.appendChild(grid);

  return section;
}

function renderPreviewStructureStep(state, handlers) {
  const section = document.createElement('div');
  section.className = 'curriculum-management__section';

  if (state.loadError) {
    const error = document.createElement('p');
    error.className = 'curriculum-management__error';
    error.textContent = state.loadError;
    section.appendChild(error);
    return section;
  }

  const heading = document.createElement('p');
  heading.className = 'curriculum-management__step-heading';
  heading.textContent = `${state.previewGrade.name} \u2014 ${state.previewSubjectEntry.name}`;
  section.appendChild(heading);

  const readOnlyNote = document.createElement('p');
  readOnlyNote.className = 'curriculum-management__intro';
  readOnlyNote.textContent = 'Inspecting this curriculum\u2019s structure. Assign it to a class to actually use it in Learning Management.';
  section.appendChild(readOnlyNote);

  const normalizedUnits = state.previewPack.units.map((unit) => ({
    id: unit.id,
    title: unit.title,
    concepts: unit.concepts.map((conceptTitle) => ({ id: conceptTitle, title: conceptTitle })),
  }));

  section.appendChild(
    createCurriculumExplorerPanel({
      units: normalizedUnits,
      expandedUnitId: state.expandedUnitId,
      onToggleUnit: handlers.onToggleUnit,
      readOnly: true,
    })
  );

  return section;
}

// ---- Contribute Curriculum -----------------------------------------

function renderContributeCreateStep(handlers) {
  const section = document.createElement('div');
  section.className = 'curriculum-management__section';

  const intro = document.createElement('p');
  intro.className = 'curriculum-management__intro';
  intro.textContent = 'Contribute a curriculum for review. It won\u2019t appear in the Library until approved.';
  section.appendChild(intro);

  const form = document.createElement('div');
  form.className = 'curriculum-management__create-form';

  const curriculumInput = createLabeledInput('Curriculum name', 'e.g. Samacheer Kalvi');
  const gradeInput = createLabeledInput('Grade', 'e.g. Grade 8');
  const subjectInput = createLabeledInput('Subject', 'e.g. Science');
  form.append(curriculumInput.wrapper, gradeInput.wrapper, subjectInput.wrapper);

  const fileLabel = document.createElement('label');
  fileLabel.className = 'curriculum-management__file-label';
  fileLabel.textContent = 'Upload Curriculum PDF';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/pdf';
  fileLabel.appendChild(fileInput);
  form.appendChild(fileLabel);

  const uploadButton = document.createElement('button');
  uploadButton.type = 'button';
  uploadButton.className = 'btn btn--primary';
  uploadButton.textContent = 'Upload & Extract';
  uploadButton.addEventListener('click', () => {
    const curriculumName = curriculumInput.input.value.trim();
    const gradeName = gradeInput.input.value.trim();
    const subjectName = subjectInput.input.value.trim();
    const file = fileInput.files[0];
    if (!curriculumName || !gradeName || !subjectName) {
      showToast('Fill in curriculum, grade, and subject first');
      return;
    }
    if (!file) {
      showToast('Choose a PDF first, or use "Start From Scratch" below');
      return;
    }
    handlers.onUploadPdf(curriculumName, gradeName, subjectName, file);
  });
  form.appendChild(uploadButton);

  const blankButton = document.createElement('button');
  blankButton.type = 'button';
  blankButton.className = 'btn btn--ghost';
  blankButton.textContent = 'Start From Scratch (no PDF)';
  blankButton.addEventListener('click', () => {
    const curriculumName = curriculumInput.input.value.trim();
    const gradeName = gradeInput.input.value.trim();
    const subjectName = subjectInput.input.value.trim();
    if (!curriculumName || !gradeName || !subjectName) {
      showToast('Fill in curriculum, grade, and subject first');
      return;
    }
    handlers.onCreateDraft(curriculumName, gradeName, subjectName);
  });
  form.appendChild(blankButton);

  section.appendChild(form);
  return section;
}

function createLabeledInput(labelText, placeholder) {
  const wrapper = document.createElement('label');
  wrapper.className = 'curriculum-management__labeled-input';
  const label = document.createElement('span');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  wrapper.append(label, input);
  return { wrapper, input };
}

function renderExtractingStep() {
  const section = document.createElement('div');
  section.className = 'curriculum-management__section';
  const message = document.createElement('p');
  message.className = 'curriculum-management__intro';
  message.textContent = 'Reading the PDF and looking for units\u2026';
  section.appendChild(message);
  return section;
}

function renderContributeReviewStep(state, handlers) {
  const { draft, extractError } = state;
  const section = document.createElement('div');
  section.className = 'curriculum-management__section';

  const heading = document.createElement('p');
  heading.className = 'curriculum-management__step-heading';
  heading.textContent = `Review \u2014 ${draft.curriculumName} \u00b7 ${draft.gradeName} \u00b7 ${draft.subjectName}`;
  section.appendChild(heading);

  if (extractError) {
    const errorNote = document.createElement('p');
    errorNote.className = 'curriculum-management__extract-note';
    errorNote.textContent = extractError;
    section.appendChild(errorNote);
  }

  const unitList = document.createElement('div');
  unitList.className = 'curriculum-management__unit-list';

  draft.units.forEach((unit, unitIndex) => {
    unitList.appendChild(renderUnitBlock(draft, unit, unitIndex, handlers));
  });
  section.appendChild(unitList);

  section.appendChild(
    createAddForm('New unit title (e.g. Unit 9 \u2013 Pollution)', '+ Add Unit', (title) => handlers.onAddUnit(title))
  );

  const submitButton = document.createElement('button');
  submitButton.type = 'button';
  submitButton.className = 'btn btn--primary';
  submitButton.textContent = 'Submit for Review';
  submitButton.disabled = draft.units.length === 0;
  submitButton.addEventListener('click', handlers.onSubmitContribution);
  section.appendChild(submitButton);

  return section;
}

function renderUnitBlock(draft, unit, unitIndex, handlers) {
  const block = document.createElement('div');
  block.className = 'curriculum-management__unit-block';

  const row = document.createElement('div');
  row.className = 'curriculum-management__unit-row';

  const reorder = createReorderButtons(
    unitIndex === 0,
    unitIndex === draft.units.length - 1,
    () => handlers.onMoveUnitUp(unit.id),
    () => handlers.onMoveUnitDown(unit.id)
  );
  row.appendChild(reorder);

  const titleInput = createRenameInput(unit.title, (newTitle) => handlers.onRenameUnit(unit.id, newTitle));
  titleInput.classList.add('curriculum-management__unit-title-input');
  row.appendChild(titleInput);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'btn btn--text btn--danger-text';
  deleteButton.textContent = 'Delete Unit';
  deleteButton.addEventListener('click', () => {
    if (!window.confirm(`Delete "${unit.title}" and its concepts?`)) return;
    handlers.onDeleteUnit(unit.id);
  });
  row.appendChild(deleteButton);

  block.appendChild(row);

  const conceptList = document.createElement('div');
  conceptList.className = 'curriculum-management__concept-list';
  unit.concepts.forEach((concept, conceptIndex) => {
    const conceptRow = document.createElement('div');
    conceptRow.className = 'curriculum-management__concept-row';

    const conceptReorder = createReorderButtons(
      conceptIndex === 0,
      conceptIndex === unit.concepts.length - 1,
      () => handlers.onMoveConceptUp(unit.id, concept.id),
      () => handlers.onMoveConceptDown(unit.id, concept.id)
    );
    conceptRow.appendChild(conceptReorder);

    const conceptInput = createRenameInput(concept.title, (newTitle) => handlers.onRenameConcept(unit.id, concept.id, newTitle));
    conceptRow.appendChild(conceptInput);

    const conceptDeleteButton = document.createElement('button');
    conceptDeleteButton.type = 'button';
    conceptDeleteButton.className = 'btn btn--text btn--danger-text';
    conceptDeleteButton.textContent = 'Delete';
    conceptDeleteButton.addEventListener('click', () => handlers.onDeleteConcept(unit.id, concept.id));
    conceptRow.appendChild(conceptDeleteButton);

    conceptList.appendChild(conceptRow);
  });
  block.appendChild(conceptList);

  block.appendChild(
    createAddForm('New concept title', '+ Add Concept', (title) => handlers.onAddConcept(unit.id, title))
  );

  return block;
}

function createReorderButtons(isFirst, isLast, onUp, onDown) {
  const wrap = document.createElement('div');
  wrap.className = 'curriculum-management__reorder';

  const upButton = document.createElement('button');
  upButton.type = 'button';
  upButton.className = 'curriculum-management__reorder-button';
  upButton.textContent = '\u25b2';
  upButton.disabled = isFirst;
  upButton.addEventListener('click', onUp);

  const downButton = document.createElement('button');
  downButton.type = 'button';
  downButton.className = 'curriculum-management__reorder-button';
  downButton.textContent = '\u25bc';
  downButton.disabled = isLast;
  downButton.addEventListener('click', onDown);

  wrap.append(upButton, downButton);
  return wrap;
}

function createRenameInput(value, onRename) {
  const input = document.createElement('input');
  input.type = 'text';
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

function createAddForm(placeholder, buttonLabel, onAdd) {
  const form = document.createElement('div');
  form.className = 'curriculum-management__add-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--ghost';
  button.textContent = buttonLabel;
  button.addEventListener('click', () => {
    const value = input.value.trim();
    if (!value) return;
    onAdd(value);
    input.value = '';
  });

  form.append(input, button);
  return form;
}

function renderContributeSubmittedStep(contribution) {
  const section = document.createElement('div');
  section.className = 'curriculum-management__section';

  const heading = document.createElement('p');
  heading.className = 'curriculum-management__step-heading';
  heading.textContent = contribution.packJson.curriculum;
  section.appendChild(heading);

  const statusCard = document.createElement('div');
  statusCard.className = 'curriculum-management__status-card';

  const statusLabel = document.createElement('span');
  statusLabel.className = 'curriculum-management__status-label';
  statusLabel.textContent = 'Status';
  statusCard.appendChild(statusLabel);

  const statusValue = document.createElement('span');
  statusValue.className = 'curriculum-management__status-value';
  statusValue.textContent = 'Pending Review';
  statusCard.appendChild(statusValue);

  section.appendChild(statusCard);

  const explanation = document.createElement('p');
  explanation.className = 'curriculum-management__intro';
  explanation.textContent =
    'This won\u2019t appear in the Curriculum Library until it\u2019s reviewed and approved. You can check back here — contributions aren\u2019t published automatically.';
  section.appendChild(explanation);

  return section;
}
