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
 *     screen or its children. Curriculum Library Data Integrity
 *     milestone: this screen only ever shows curricula that are
 *     actually published — see services/curriculumSubmissionsService.js.
 *     A fresh install shows a real, informative empty state here
 *     instead of hardcoded sample cards.
 *   - ➕ Contribute Curriculum — the upload flow (capture standardized
 *     metadata -> Upload PDF or start blank -> Extract -> Review ->
 *     Submit). Submitting does *not* add anything to the Library — it
 *     goes to services/curriculumSubmissionsService.js with status
 *     'pending_review' instead.
 *   - 🔍 Review Submissions — where 'pending_review' actually becomes
 *     'published'. An admin opens a pending submission, decides
 *     Official vs. Community, and publishes it — the one and only way
 *     anything ever reaches Browse Curriculum Library. This milestone
 *     still doesn't build a rejection flow, an audit trail, or
 *     multi-reviewer coordination — "the important part is the
 *     architecture" carries over from the earlier milestone that
 *     first introduced this pending/published split. What's real now:
 *     the publish step itself, not a simulation of it.
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
import * as curriculumSubmissionsService from '../../services/curriculumSubmissionsService.js';
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

  // Review Submissions state.
  let selectedSubmission = null;

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
        selectedSubmission,
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
            previewPack = await curriculumLibraryService.getPack(subjectEntry.submissionId);
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
        onCreateDraft: (metadata) => {
          draft = curriculumPackBuilderService.createDraftPack(metadata);
          mode = 'contribute-review';
          rerender();
        },
        onUploadPdf: async (metadata, file) => {
          draft = curriculumPackBuilderService.createDraftPack(metadata);
          extractError = null;
          mode = 'contribute-extracting';
          rerender();
          try {
            const rawText = await curriculumPdfParsingService.extractTextFromPdf(file);
            const extractedUnits = curriculumPdfParsingService.parseTextIntoUnits(rawText);
            curriculumPackBuilderService.loadExtractedUnitsIntoDraft(draft, extractedUnits);
            if (extractedUnits.length === 0) {
              // Diagnostic detail, not just a generic message — this
              // distinguishes two very different real causes: pdf.js
              // extracting little or no text at all (worker/CORS/load
              // failure, often silent rather than a thrown error) vs.
              // text extracting fine but not matching either heading
              // shape parseTextIntoUnits() recognizes. Whichever it is
              // is now visible on screen, not just in a console log
              // nobody may think to open.
              const charCount = rawText.length;
              const preview = rawText.trim().slice(0, 160).replace(/\s+/g, ' ');
              extractError =
                charCount < 50
                  ? `Couldn't find any "Unit N" or "Chapter N" headings in this PDF — and only ${charCount} characters of text were extracted at all, which usually means the PDF reader itself didn't load correctly rather than the heading search failing. Try again, and if this repeats, the extracted-text preview is: "${preview || '(nothing)'}"`
                  : `Couldn't find any "Unit N" or "Chapter N" headings in this PDF (${charCount.toLocaleString()} characters were extracted, so the reader worked — the heading shape just didn't match). You can still add units and concepts manually below. Extracted text starts with: "${preview}"`;
            }
          } catch (error) {
            console.error('[CurriculumManagementView] PDF extraction failed:', error);
            extractError = `Couldn't read that PDF (${error.message || error}). You can still add units and concepts manually below.`;
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
          submittedContribution = curriculumSubmissionsService.submitContribution(packJson);
          mode = 'contribute-submitted';
          rerender();
        },
        onGoToReview: () => {
          selectedSubmission = null;
          mode = 'review-list';
          rerender();
        },
        onSelectSubmission: (submission) => {
          selectedSubmission = submission;
          expandedUnitId = null;
          mode = 'review-detail';
          rerender();
        },
        onPublishSubmission: (reviewStatus) => {
          curriculumSubmissionsService.publishSubmission(selectedSubmission.id, { reviewStatus });
          showToast(`${selectedSubmission.packJson.curriculum} published`);
          mode = 'review-list';
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
      'review-list': 'hub',
      'review-detail': 'review-list',
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
  } else if (mode === 'review-list') {
    wrapper.appendChild(renderReviewListStep(handlers));
  } else if (mode === 'review-detail') {
    wrapper.appendChild(renderReviewDetailStep(state.selectedSubmission, state.expandedUnitId, handlers));
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
  intro.textContent = 'Browse, contribute, and review curricula. This is a separate, occasional workspace — not part of daily lesson prep.';
  section.appendChild(intro);

  const grid = document.createElement('div');
  grid.className = 'curriculum-management__hub-grid';

  const pendingCount = curriculumSubmissionsService.getPendingSubmissions().length;

  grid.appendChild(createHubCard('\ud83d\udcda', 'Browse Curriculum Library', 'Official and community curricula', handlers.onGoToBrowse));
  grid.appendChild(createHubCard('\u2795', 'Contribute Curriculum', 'Submit a curriculum for review', handlers.onGoToContribute));
  grid.appendChild(
    createHubCard(
      '\ud83d\udd0d',
      'Review Submissions',
      pendingCount > 0 ? `${pendingCount} awaiting review` : 'Nothing waiting right now',
      handlers.onGoToReview
    )
  );

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
      if (official.length === 0 && community.length === 0) {
        section.appendChild(renderBrowseEmptyState(handlers));
        return;
      }
      if (official.length > 0) section.appendChild(renderCurriculumSection('Official', official, handlers));
      if (community.length > 0) section.appendChild(renderCurriculumSection('Community', community, handlers));
    })
    .catch((error) => {
      console.error('[CurriculumManagementView] Failed to load the library:', error);
      loadingNote.textContent = "Couldn't load the Curriculum Library. Check your connection and try again.";
    });

  return section;
}

function renderBrowseEmptyState(handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'curriculum-management__empty-state';

  const icon = document.createElement('span');
  icon.className = 'curriculum-management__empty-state-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '\ud83d\udcda';
  wrap.appendChild(icon);

  const title = document.createElement('p');
  title.className = 'curriculum-management__empty-state-title';
  title.textContent = 'The Curriculum Library is empty';
  wrap.appendChild(title);

  const message = document.createElement('p');
  message.className = 'curriculum-management__empty-state-message';
  message.textContent = 'Nothing has been uploaded and published yet. Contribute a curriculum to get started — once it\u2019s reviewed and published, it\u2019ll show up here.';
  wrap.appendChild(message);

  const uploadButton = document.createElement('button');
  uploadButton.type = 'button';
  uploadButton.className = 'btn btn--primary';
  uploadButton.textContent = 'Upload Curriculum';
  uploadButton.addEventListener('click', handlers.onGoToContribute);
  wrap.appendChild(uploadButton);

  return wrap;
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
    card.appendChild(createDetailRow('Academic Year', latestVersion.academicYear));
    card.appendChild(createDetailRow('Language', latestVersion.language));

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

  // Standardized metadata, captured up front — before any extraction
  // happens — so a published curriculum never has placeholder or
  // back-filled fields. See services/curriculumPackBuilderService.js's
  // createDraftPack() for the exact shape this feeds.
  const curriculumInput = createLabeledInput('Curriculum name', 'e.g. Samacheer Kalvi');
  const boardInput = createLabeledInput('Board', 'e.g. Tamil Nadu State Board');
  const gradeInput = createLabeledInput('Grade', 'e.g. Grade 8');
  const subjectInput = createLabeledInput('Subject', 'e.g. Science');
  const academicYearInput = createLabeledInput('Academic Year', 'e.g. 2026\u201327');
  const versionInput = createLabeledInput('Version', 'e.g. 2026');
  const languageInput = createLabeledInput('Language', 'e.g. English');
  const publisherInput = createLabeledInput('Publisher', 'e.g. Tamil Nadu School Education Department');
  form.append(
    curriculumInput.wrapper,
    boardInput.wrapper,
    gradeInput.wrapper,
    subjectInput.wrapper,
    academicYearInput.wrapper,
    versionInput.wrapper,
    languageInput.wrapper,
    publisherInput.wrapper
  );

  function readMetadata() {
    return {
      curriculumName: curriculumInput.input.value.trim(),
      board: boardInput.input.value.trim(),
      gradeName: gradeInput.input.value.trim(),
      subjectName: subjectInput.input.value.trim(),
      academicYear: academicYearInput.input.value.trim(),
      versionLabel: versionInput.input.value.trim(),
      language: languageInput.input.value.trim(),
      publisher: publisherInput.input.value.trim(),
    };
  }

  function validateMetadata(metadata) {
    const requiredLabels = {
      curriculumName: 'Curriculum name',
      board: 'Board',
      gradeName: 'Grade',
      subjectName: 'Subject',
      academicYear: 'Academic Year',
      versionLabel: 'Version',
      language: 'Language',
      publisher: 'Publisher',
    };
    const missing = Object.entries(requiredLabels).find(([key]) => !metadata[key]);
    return missing ? missing[1] : null;
  }

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
    const metadata = readMetadata();
    const missingLabel = validateMetadata(metadata);
    if (missingLabel) {
      showToast(`${missingLabel} is required`);
      return;
    }
    const file = fileInput.files[0];
    if (!file) {
      showToast('Choose a PDF first, or use "Start From Scratch" below');
      return;
    }
    handlers.onUploadPdf(metadata, file);
  });
  form.appendChild(uploadButton);

  const blankButton = document.createElement('button');
  blankButton.type = 'button';
  blankButton.className = 'btn btn--ghost';
  blankButton.textContent = 'Start From Scratch (no PDF)';
  blankButton.addEventListener('click', () => {
    const metadata = readMetadata();
    const missingLabel = validateMetadata(metadata);
    if (missingLabel) {
      showToast(`${missingLabel} is required`);
      return;
    }
    handlers.onCreateDraft(metadata);
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

// ---- Review Submissions ------------------------------------------------

function renderReviewListStep(handlers) {
  const section = document.createElement('div');
  section.className = 'curriculum-management__section';

  const heading = document.createElement('p');
  heading.className = 'curriculum-management__step-heading';
  heading.textContent = 'Review Submissions';
  section.appendChild(heading);

  const pending = curriculumSubmissionsService.getPendingSubmissions();

  if (pending.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'curriculum-management__intro';
    empty.textContent = 'Nothing is waiting for review right now.';
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement('div');
  list.className = 'curriculum-management__review-list';
  pending.forEach((submission) => {
    list.appendChild(createReviewListRow(submission, handlers));
  });
  section.appendChild(list);

  return section;
}

function createReviewListRow(submission, handlers) {
  const { packJson } = submission;
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'curriculum-management__review-row';

  const titleEl = document.createElement('span');
  titleEl.className = 'curriculum-management__review-row-title';
  titleEl.textContent = `${packJson.curriculum} \u00b7 ${packJson.grade} \u00b7 ${packJson.subject}`;
  row.appendChild(titleEl);

  const metaEl = document.createElement('span');
  metaEl.className = 'curriculum-management__review-row-meta';
  metaEl.textContent = `${packJson.publisher} \u00b7 Version ${packJson.versionLabel} \u00b7 Submitted ${formatSubmittedDate(submission.submittedAt)}`;
  row.appendChild(metaEl);

  row.addEventListener('click', () => handlers.onSelectSubmission(submission));
  return row;
}

function formatSubmittedDate(isoDate) {
  try {
    return new Date(isoDate).toLocaleDateString();
  } catch {
    return isoDate;
  }
}

function renderReviewDetailStep(submission, expandedUnitId, handlers) {
  const { packJson } = submission;
  const section = document.createElement('div');
  section.className = 'curriculum-management__section';

  const heading = document.createElement('p');
  heading.className = 'curriculum-management__step-heading';
  heading.textContent = `${packJson.curriculum} \u00b7 ${packJson.grade} \u00b7 ${packJson.subject}`;
  section.appendChild(heading);

  const card = document.createElement('div');
  card.className = 'curriculum-management__details-card';
  card.appendChild(createDetailRow('Publisher', packJson.publisher));
  card.appendChild(createDetailRow('Board', packJson.board));
  card.appendChild(createDetailRow('Grade', packJson.grade));
  card.appendChild(createDetailRow('Subject', packJson.subject));
  card.appendChild(createDetailRow('Academic Year', packJson.academicYear));
  card.appendChild(createDetailRow('Version', packJson.versionLabel));
  card.appendChild(createDetailRow('Language', packJson.language));
  card.appendChild(createDetailRow('Submitted', formatSubmittedDate(submission.submittedAt)));
  section.appendChild(card);

  const structureHeading = document.createElement('p');
  structureHeading.className = 'curriculum-management__intro';
  structureHeading.textContent = `${packJson.units.length} unit${packJson.units.length === 1 ? '' : 's'} submitted for review:`;
  section.appendChild(structureHeading);

  // Read-only inspection, same shared explorer Learning Management
  // and Preview Structure both use — see
  // ui/components/CurriculumExplorerPanel.js's own doc comment.
  const normalizedUnits = packJson.units.map((unit) => ({
    id: unit.id,
    title: unit.title,
    concepts: unit.concepts.map((conceptTitle) => ({ id: conceptTitle, title: conceptTitle })),
  }));
  section.appendChild(
    createCurriculumExplorerPanel({
      units: normalizedUnits,
      expandedUnitId,
      onToggleUnit: handlers.onToggleUnit,
      readOnly: true,
    })
  );

  const actions = document.createElement('div');
  actions.className = 'curriculum-management__details-actions';

  const publishOfficialButton = document.createElement('button');
  publishOfficialButton.type = 'button';
  publishOfficialButton.className = 'btn btn--primary';
  publishOfficialButton.textContent = '\u2b50 Publish as Official';
  publishOfficialButton.addEventListener('click', () => handlers.onPublishSubmission('official'));
  actions.appendChild(publishOfficialButton);

  const publishCommunityButton = document.createElement('button');
  publishCommunityButton.type = 'button';
  publishCommunityButton.className = 'btn btn--ghost';
  publishCommunityButton.textContent = 'Publish as Community';
  publishCommunityButton.addEventListener('click', () => handlers.onPublishSubmission('community'));
  actions.appendChild(publishCommunityButton);

  section.appendChild(actions);

  return section;
}
