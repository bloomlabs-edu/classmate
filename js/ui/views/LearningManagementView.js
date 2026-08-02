/**
 * ui/views/LearningManagementView.js
 *
 * Learning Management, rebuilt from a genuinely clean slate — see
 * this file's own history in CHANGELOG.md for the full incremental
 * rebuild. The home screen's one responsibility: render exactly the
 * classroom's own persisted Subjects (via
 * ui/components/ExistingSubjectsList.js) and nothing else — no
 * suggestions, no placeholders, no empty-state copy of any kind.
 *
 * Creating a Subject and assigning it a curriculum are, once again, one
 * combined step — reverted per explicit product decision: "+ Add
 * Subject" (ui/components/AddSubjectModal.js) runs Choose Subject ->
 * Choose Curriculum, and the Subject is only ever created (via
 * services/curriculumLinkingService.js's createSubjectWithCurriculum())
 * once both are chosen. Cancelling curriculum selection creates
 * nothing. The data flow this maintains: Subject -> Assigned
 * Curriculum -> Units -> Concepts. A Subject never owns Units
 * independent of a curriculum; every Unit it has is derived from that
 * curriculum's own data (see
 * services/curriculumLinkingService.js's createSubjectWithCurriculum()
 * and assignCurriculumToSubject()), not hardcoded here.
 *
 * ui/components/AssignCurriculumModal.js and the "no curriculum
 * assigned" state (ui/components/CurriculumMetadataLine.js) still
 * exist, but only for the defensive case now — a Subject whose
 * Curriculum Index was deleted after assignment, or a genuinely
 * legacy Subject predating this reversion — not as part of the normal
 * creation flow.
 *
 * Component hierarchy, and why the Subject Picker can never end up on
 * this home screen by accident:
 *
 *   LearningManagementView
 *   ├── ExistingSubjectsList     (persisted Subjects only — no
 *   │                             suggestion data, no fallback list)
 *   ├── "+ Add Subject" button   (trivial — stays inline here)
 *   ├── AddSubjectModal          (Choose Subject -> Choose Curriculum,
 *   │     └── SubjectSelectionList   combined — a Subject is only
 *   │         (the only file that     created once both are chosen)
 *   │          imports config/commonSubjectsConfig.js)
 *   └── AssignCurriculumModal    (defensive path only now — a legacy
 *                                  or orphaned-curriculum Subject; see
 *                                  ui/components/CurriculumMetadataLine.js)
 *
 * This file has no import reaching suggested-subject data anywhere in
 * its own tree — not directly, not transitively. That's what makes
 * "the home screen renders suggestions" structurally hard to
 * reintroduce by accident, not just currently untrue.
 *
 * Choose Class is back, minimally — skipped entirely when there's
 * only one classroom, the same "only ask when there's a real choice"
 * principle used throughout this app. Resolving a real,
 * currently-blocking gap (persistence needs a specific classroom),
 * not a speculative addition.
 *
 * Reused, unmodified: services/learningRecordService.js (reading
 * Subjects). Still untouched and waiting for a later milestone:
 * Concepts, the Resource Workspace.
 *
 * DEVELOPER UTILITIES: the home screen includes a temporary, clearly
 * marked "Developer Utilities" block with a "Reset Learning
 * Management (Current Classroom)" action — see
 * services/devLearningManagementResetService.js for exactly what it
 * does and does not touch. Remove that import, the block in
 * renderHomeStep(), and the service file itself before production;
 * everything is contained to make that removal a clean, three-part
 * deletion.
 */

import { createBackButton } from '../components/BackButton.js';
import { openAddSubjectModal } from '../components/AddSubjectModal.js';
import { openAssignCurriculumModal } from '../components/AssignCurriculumModal.js';
import { renderExistingSubjectsList } from '../components/ExistingSubjectsList.js';
import { createNavigationRow } from '../components/NavigationRow.js';
import { renderCurriculumMetadataLine } from '../components/CurriculumMetadataLine.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { getDisplayName } from '../../services/classroomService.js';
import * as learningRecordService from '../../services/learningRecordService.js';
import * as learningRecordTeacherService from '../../services/learningRecordTeacherService.js';
import * as workspaceService from '../../services/workspaceService.js';
import * as curriculumIndexRepository from '../../services/curriculumIndexRepository.js';
import { resetLearningManagementData } from '../../services/devLearningManagementResetService.js';
import { isDebugModeEnabled } from '../../services/debugModeService.js';
import { migrateClassroomSubjects, migrateUnitNumbers, repairUndefinedPartNames } from '../../services/subjectIdMigrationService.js';
import { logPersistenceEvent, logViewMounted } from '../../services/persistenceLogger.js';
import * as workspaceCoordinator from '../../services/workspaceCoordinator.js';
import { renderConceptWorkspaceView } from './ConceptWorkspaceView.js';

export function renderLearningManagementView(container, { classrooms, onBack, onOpenCurriculumManagement }) {
  logViewMounted('LearningManagementView');

  // One-time backfill for Subjects predating subjectId, and one-time
  // repair for LearningUnits with a legacy `partName: undefined` bug
  // (see services/subjectIdMigrationService.js's own header comments
  // for migrateClassroomSubjects()/repairUndefinedPartNames()) — run
  // together, saved together: Firestore rejects an entire document
  // containing any field set to `undefined`, so if a classroom needed
  // the partName repair, migrateClassroomSubjects()'s own save on its
  // own would still fail for the same reason this repair exists to
  // fix. Idempotent: a no-op for any classroom already migrated/
  // repaired, so running this on every entry costs nothing once done.
  // Its own autosave write is safe regardless of any unsaved local
  // work elsewhere in this classroom — services/workspaceService.js
  // now defers an incoming snapshot echo instead of applying it while
  // anything is dirty (see canApplyIncomingServerState()), so this
  // write can never clobber a teacher's own in-progress edit the way
  // it could before that existed.
  classrooms.forEach((classroom) => {
    const subjectIdMigratedCount = migrateClassroomSubjects(classroom);
    const partNameRepairedCount = repairUndefinedPartNames(classroom);
    if (subjectIdMigratedCount > 0 || partNameRepairedCount > 0) {
      workspaceService.save(classroom);
    }
  });

  // One-time backfill for LearningUnits linked from a Curriculum Index
  // before buildUnitsFromCurriculumIndex() copied `number` through at
  // all — see services/subjectIdMigrationService.js's own
  // migrateUnitNumbers() for the full reasoning. Async (a real
  // Curriculum Index read), so this can't run inline with the
  // synchronous backfill above — fire-and-forget here, re-rendering
  // only the classrooms that actually changed, so a teacher sees Unit
  // numbers appear without needing to reload the page themselves.
  classrooms.forEach((classroom) => {
    migrateUnitNumbers(classroom).then((migratedCount) => {
      if (migratedCount > 0) {
        workspaceService.save(classroom);
        rerender();
      }
    });
  });

  const singleClassroomMode = classrooms.length === 1;

  let mode = singleClassroomMode ? 'home' : 'choose-class';
  let selectedClassroom = singleClassroomMode ? classrooms[0] : null;
  if (selectedClassroom) {
    workspaceCoordinator.registerActiveWorkspace(selectedClassroom.id, resyncFromServer);
  }
  let selectedSubject = null;
  let selectedPartName = null; // set once a Part is chosen, for a Subject whose curriculum actually has them
  // Set once a Unit is chosen, to show that Unit's own Concepts — the
  // one further drill-down level Phase 1.5 restores. A stable id, not
  // a name (per explicit direction), the same convention every other
  // stored selection in this app already uses except selectedPartName
  // above, which genuinely can't be an id yet: Parts aren't a
  // first-class entity today, only a derived, deduplicated string off
  // each Unit's own partName field — promoting them to real entities
  // with their own id is real scope beyond "restore navigation," left
  // as an explicit, flagged gap rather than quietly worked around.
  let selectedUnitId = null;
  // Created only at the moment a Concept is actually opened — null
  // the rest of the time, including while merely browsing a Unit's
  // Concepts list. Bundles subjectId/unitId/conceptId together since
  // those three values always travel together once a Concept is open
  // (per explicit direction), even though services/learningRecordService.js's
  // findConcept(classroom, conceptId) alone could technically resolve
  // all three from conceptId — this exists for the workspace's own
  // future needs (breadcrumbs, analytics, whatever a growing Concept
  // Workspace ends up wanting direct access to), not because the
  // lookup itself requires it.
  let conceptContext = null;
  // Fetched once per Subject selection, not on every re-render — see
  // ui/components/CurriculumMetadataLine.js's own header comment for
  // why this lives here instead of inside that component. One of:
  // {status:'loading'} | {status:'ready', curriculumIndex} |
  // {status:'none'} | {status:'error'}.
  let selectedSubjectCurriculumState = null;

  /**
   * Applies a fresh, server-confirmed classroom object in place of the
   * one this workspace has been showing — registered with
   * services/workspaceCoordinator.js as this classroom's own active
   * workspace (see the registration calls below), so a background
   * snapshot updates this screen in place instead of the coarser,
   * older onChange-triggers-renderRoute() path tearing it down
   * entirely.
   *
   * Re-resolves selectedSubject by its own stable id (subject.id, not
   * subjectId — always present from creation, unlike subjectId which
   * can be null before subjectIdMigrationService.js's backfill runs)
   * in the *new* classroom's own data, rather than assuming the old
   * object reference is still valid. selectedUnitId/conceptContext
   * don't need this same treatment — both are already plain ids,
   * re-resolved fresh against whatever classroom is current every time
   * something renders (see renderUnitsOrParts()), never stored as a
   * direct object reference the way selectedSubject is.
   *
   * Falls back to the Learning home screen — never all the way out to
   * the Dashboard — only if the currently selected Subject genuinely
   * no longer exists in the fresh data (deleted from another
   * tab/device); anything else about where the teacher currently is
   * (mode, navigation, in-progress unsaved edits elsewhere) is left
   * completely untouched.
   */
  function resyncFromServer(freshClassroom) {
    selectedClassroom = freshClassroom;

    if (selectedSubject) {
      const freshSubject = learningRecordService.getSubjects(freshClassroom).find((subject) => subject.id === selectedSubject.id);
      if (freshSubject) {
        selectedSubject = freshSubject;
      } else {
        selectedSubject = null;
        selectedPartName = null;
        selectedUnitId = null;
        conceptContext = null;
        mode = 'home';
      }
    }

    rerender();
  }

  function rerender() {
    renderView(
      container,
      mode,
      {
        classrooms,
        selectedClassroom,
        selectedSubject,
        selectedPartName,
        selectedUnitId,
        conceptContext,
        selectedSubjectCurriculumState,
        singleClassroomMode,
        saveState: selectedClassroom ? workspaceService.getSaveState(selectedClassroom.id) : null,
      },
      handlers
    );
  }

  function loadCurriculumStateFor(subject) {
    if (!subject.linkedCurriculumIndexId) {
      selectedSubjectCurriculumState = { status: 'none' };
      rerender();
      return;
    }

    selectedSubjectCurriculumState = { status: 'loading' };
    rerender();
    curriculumIndexRepository
      .getIndex(subject.linkedCurriculumIndexId)
      .then((curriculumIndex) => {
        // A different Subject may have been opened while this was in
        // flight — don't let a stale response overwrite it.
        if (selectedSubject !== subject) return;
        selectedSubjectCurriculumState = curriculumIndex ? { status: 'ready', curriculumIndex } : { status: 'none' };
        rerender();
      })
      .catch((error) => {
        console.error('[LearningManagementView] Failed to load the Subject\u2019s linked Curriculum Index:', error);
        if (selectedSubject !== subject) return;
        selectedSubjectCurriculumState = { status: 'error' };
        rerender();
      });
  }

  const handlers = {
    onBack: () => {
      if (selectedClassroom) workspaceCoordinator.unregisterActiveWorkspace(selectedClassroom.id);
      onBack();
    },
    /**
     * The "Change" action next to a Subject's currently-assigned
     * curriculum (see renderSubjectStep()) — opens the exact same
     * Curriculum Hub the Dashboard used to link to directly, only
     * now reached contextually from within a Subject, and returning
     * to that same Subject afterward rather than out to the
     * Dashboard. This is the one piece of new wiring this redesign
     * needed; ui/views/CurriculumManagementView.js itself is
     * completely unchanged.
     */
    onManageCurriculum: () => {
      onOpenCurriculumManagement({ onBack: () => rerender() });
    },
    onChooseClass: (classroom) => {
      if (selectedClassroom) workspaceCoordinator.unregisterActiveWorkspace(selectedClassroom.id);
      selectedClassroom = classroom;
      workspaceCoordinator.registerActiveWorkspace(selectedClassroom.id, resyncFromServer);
      mode = 'home';
      rerender();
    },
    onGoToAddSubject: () => {
      const existingSubjectTitles = learningRecordService.getSubjects(selectedClassroom).map((subject) => subject.title);
      openAddSubjectModal({
        classroom: selectedClassroom,
        existingSubjectTitles,
        onSubjectAdded: () => {
          // The modal already persisted and saved the Subject itself
          // (services/curriculumLinkingService.js's
          // createSubjectWithCurriculum() + services/workspaceService.js)
          // — this only needs to re-render so the home screen reads
          // it back from services/learningRecordService.js, the
          // single source of truth for what's actually persisted.
          rerender();
        },
        onOpenCurriculumManagement: () => onOpenCurriculumManagement({ onBack: () => rerender() }),
      });
    },
    onChooseSubject: (subject) => {
      selectedSubject = subject;
      selectedPartName = null;
      selectedUnitId = null;
      conceptContext = null;
      mode = 'subject';
      loadCurriculumStateFor(subject);
    },
    onGoToAssignCurriculum: () => {
      openAssignCurriculumModal({
        classroom: selectedClassroom,
        subject: selectedSubject,
        onCurriculumAssigned: () => {
          // The modal already assigned and saved the curriculum
          // (services/curriculumLinkingService.js +
          // services/workspaceService.js) — reload this Subject's
          // curriculum state so Units now render from what was just
          // assigned.
          loadCurriculumStateFor(selectedSubject);
        },
        // Same "return to this Subject, not the Dashboard" wrapper
        // handlers.onManageCurriculum above uses — this modal's own
        // "zero matches" fallback leads to the exact same Curriculum
        // Hub takeover of the container, so it needs the same return
        // target for the same reason.
        onOpenCurriculumManagement: () => onOpenCurriculumManagement({ onBack: () => rerender() }),
      });
    },
    onChoosePart: (partName) => {
      selectedPartName = partName;
      selectedUnitId = null;
      rerender();
    },
    onSelectUnit: (unitId) => {
      selectedUnitId = unitId;
      rerender();
    },
    onSelectConcept: (concept) => {
      conceptContext = { subjectId: selectedSubject.id, unitId: selectedUnitId, conceptId: concept.id };
      mode = 'concept';
      rerender();
    },
    onBackFromConceptWorkspace: () => {
      // Lands back on the same Unit's Concepts list the workspace was
      // opened from, not the Subject home screen — selectedUnitId was
      // never cleared while conceptContext held the same value, so
      // browsing state is exactly where the teacher left it.
      mode = 'subject';
      conceptContext = null;
      rerender();
    },
    onBackTo: (targetMode) => {
      mode = targetMode;
      rerender();
    },
    onRemoveSubject: (subject) => {
      const confirmed = window.confirm(`Remove "${subject.title}" from this classroom?\n\nThis removes its Units and Concepts. This cannot be undone.`);
      if (!confirmed) return;
      learningRecordTeacherService.deleteSubject(selectedClassroom, subject.id);
      logPersistenceEvent('Subject removed', { classroomId: selectedClassroom.id, subjectTitle: subject.title });
      workspaceService.markDirty(selectedClassroom.id);
      // Whether this was triggered from the home list or from the
      // Subject's own page, there's no longer a Subject to show —
      // always land back on the home screen, not wherever we
      // happened to be.
      mode = 'home';
      rerender();
    },
    onResetLearningManagement: () => {
      const confirmed = window.confirm(
        'Reset Learning for this classroom?\n\nThis removes every Subject, Unit, Concept, and curriculum link for this classroom only. Students, attendance, and classroom settings are not affected. This cannot be undone.'
      );
      if (!confirmed) return;
      resetLearningManagementData(selectedClassroom);
      logPersistenceEvent('Learning reset', { classroomId: selectedClassroom.id });
      workspaceService.markDirty(selectedClassroom.id);
      rerender();
    },
    onSaveChanges: async () => {
      logPersistenceEvent('Save requested', { classroomId: selectedClassroom.id });
      try {
        await workspaceService.saveExplicitly(selectedClassroom);
      } catch (error) {
        // Already logged and reflected in saveState by saveExplicitly()
        // itself — this catch exists only so a rejected save can never
        // propagate as an unhandled promise rejection from this click
        // handler. The "Save failed. Retry" UI (see renderSaveStatus())
        // is what actually surfaces this to the teacher.
      }
    },
  };

  workspaceService.onSaveStateChange((classroomId) => {
    if (selectedClassroom && classroomId === selectedClassroom.id) rerender();
  });

  rerender();
}


/**
 * The temporary explicit-Save status/action, shown near the top of
 * the Learning workspace for whichever classroom is currently
 * selected — see services/workspaceService.js's own saveState
 * tracking (markDirty/saveExplicitly/getSaveState) for where this
 * data comes from. Renders nothing for 'clean' (no local change has
 * happened yet this session that needs saving).
 */
function renderSaveStatus(saveState, handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'learning-management__save-status';

  if (!saveState || saveState.status === 'clean') return wrap;

  if (saveState.status === 'dirty') {
    const indicator = document.createElement('span');
    indicator.className = 'learning-management__save-indicator learning-management__save-indicator--dirty';
    indicator.textContent = '\u25cf Unsaved changes';
    wrap.appendChild(indicator);

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'btn btn--primary learning-management__save-button';
    saveButton.textContent = 'Save Changes';
    saveButton.addEventListener('click', handlers.onSaveChanges);
    wrap.appendChild(saveButton);
    return wrap;
  }

  if (saveState.status === 'saving') {
    const savingText = document.createElement('span');
    savingText.className = 'learning-management__save-indicator learning-management__save-indicator--saving';
    savingText.textContent = 'Saving\u2026';
    wrap.appendChild(savingText);
    return wrap;
  }

  if (saveState.status === 'saved') {
    const savedText = document.createElement('span');
    savedText.className = 'learning-management__save-indicator learning-management__save-indicator--saved';
    savedText.textContent = '\u2713 Changes saved';
    wrap.appendChild(savedText);
    return wrap;
  }

  if (saveState.status === 'failed') {
    const failedText = document.createElement('span');
    failedText.className = 'learning-management__save-indicator learning-management__save-indicator--failed';
    failedText.textContent = 'Save failed.';
    wrap.appendChild(failedText);

    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.className = 'btn btn--danger-text learning-management__save-retry-button';
    retryButton.textContent = 'Retry';
    retryButton.addEventListener('click', handlers.onSaveChanges);
    wrap.appendChild(retryButton);
    return wrap;
  }

  return wrap;
}

function renderView(container, mode, state, handlers) {
  // The Concept Workspace owns its own screen entirely (its own
  // header, its own Back button — see ConceptWorkspaceView.js) — a
  // genuine hand-off between two different responsibilities
  // (browsing the curriculum hierarchy vs. working inside a Concept),
  // not a tab or sub-step wrapped inside Learning Management's own
  // header, matching how DashboardView.js already hands off entirely
  // to renderLearningManagementView() itself rather than merging the
  // two screens' rendering.
  if (mode === 'concept') {
    const resolved = learningRecordService.findConcept(state.selectedClassroom, state.conceptContext.conceptId);
    if (!resolved) {
      // The concept this workspace was opened for no longer exists
      // (deleted from another tab/device) — fall back to browsing
      // rather than rendering a workspace with nothing to show.
      handlers.onBackFromConceptWorkspace();
      return;
    }
    renderConceptWorkspaceView(container, {
      classroom: state.selectedClassroom,
      subject: resolved.subject,
      unit: resolved.unit,
      concept: resolved.concept,
      onBack: handlers.onBackFromConceptWorkspace,
    });
    return;
  }

  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'learning-management';

  const header = document.createElement('header');
  header.className = 'learning-management__header';

  const isEntryStep = mode === 'choose-class' || (mode === 'home' && state.singleClassroomMode);

  const backButton = createBackButton(() => {
    if (isEntryStep) return handlers.onBack();
    if (mode === 'subject' && state.selectedUnitId) {
      // Back out of a Unit's own Concepts to that Subject's Units
      // list, not all the way home in one step — same "step back one
      // level within the same mode" shape as the Part case below.
      handlers.onSelectUnit(null);
      return;
    }
    if (mode === 'subject' && state.selectedPartName) {
      // Back out of a Part's own units to that Subject's Part list,
      // not all the way home in one step.
      handlers.onChoosePart(null);
      return;
    }
    const previous = { home: 'choose-class', subject: 'home' }[mode];
    handlers.onBackTo(previous);
  });
  header.appendChild(backButton);

  const title = document.createElement('h1');
  title.className = 'learning-management__title';
  title.textContent = 'Learning';
  header.appendChild(title);

  if (state.selectedClassroom) {
    header.appendChild(renderSaveStatus(state.saveState, handlers));
  }

  wrapper.appendChild(header);

  if (mode === 'choose-class') {
    wrapper.appendChild(renderChooseClassStep(state.classrooms, handlers));
  } else if (mode === 'subject') {
    wrapper.appendChild(renderSubjectStep(state.selectedSubject, state.selectedSubjectCurriculumState, state.selectedPartName, state.selectedUnitId, handlers));
  } else {
    wrapper.appendChild(renderHomeStep(state.selectedClassroom, handlers));
  }

  container.appendChild(wrapper);
}

function renderChooseClassStep(classrooms, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = 'Choose Class';
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'learning-management__choice-grid';
  classrooms.forEach((classroom) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'learning-management__choice-option';
    button.textContent = getDisplayName(classroom);
    button.addEventListener('click', () => handlers.onChooseClass(classroom));
    grid.appendChild(button);
  });
  section.appendChild(grid);

  return section;
}

/**
 * The home screen's one responsibility: render exactly the
 * classroom's own persisted Subjects, nothing else. Renders nothing
 * at all beyond "+ Add Subject" when there are none — no heading, no
 * empty-state copy, no suggestions.
 */
function renderHomeStep(classroom, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const subjects = learningRecordService.getSubjects(classroom);
  if (subjects.length > 0) {
    section.appendChild(renderExistingSubjectsList(subjects, handlers.onChooseSubject));
  }

  const addSubjectButton = document.createElement('button');
  addSubjectButton.type = 'button';
  addSubjectButton.className = 'btn btn--primary';
  addSubjectButton.textContent = '+ Add Subject';
  addSubjectButton.addEventListener('click', handlers.onGoToAddSubject);
  section.appendChild(addSubjectButton);

  if (isDebugModeEnabled()) {
    section.appendChild(renderDeveloperUtilities(handlers));
  }

  return section;
}

/**
 * DEVELOPER-ONLY — see services/devLearningManagementResetService.js's
 * own header comment for exactly what "Reset Learning Management"
 * does and does not touch. Gated behind
 * services/debugModeService.js's isDebugModeEnabled() — a normal
 * teacher never sees this section at all, regardless of scroll or
 * screen size, unless debug mode has been explicitly turned on via
 * ui/views/DeveloperToolsView.js.
 */
function renderDeveloperUtilities(handlers) {
  const devSection = document.createElement('div');
  devSection.className = 'learning-management__dev-utilities';

  const devHeading = document.createElement('p');
  devHeading.className = 'learning-management__dev-utilities-heading';
  devHeading.textContent = 'Developer Utilities';
  devSection.appendChild(devHeading);

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'btn btn--danger';
  resetButton.textContent = 'Reset Learning (Current Classroom)';
  resetButton.addEventListener('click', handlers.onResetLearningManagement);
  devSection.appendChild(resetButton);

  return devSection;
}

/**
 * Adapts to the Subject's own linked curriculum rather than forcing
 * a level that doesn't exist: a Subject whose Units carry more than
 * one distinct `partName` shows Parts first; anything else (no
 * Parts at all, or a Part already chosen) shows Units directly.
 * Units themselves are a plain list for now — Concepts are a later
 * milestone, not stubbed in here ahead of time.
 *
 * The curriculum metadata line (see
 * ui/components/CurriculumMetadataLine.js) always renders directly
 * beneath the title, per the frozen design — quiet, always present,
 * never its own card. `curriculumState` is fetched once, in
 * renderLearningManagementView()'s onChooseSubject handler, and
 * cached there — this function is a pure, synchronous render of
 * whatever that state currently is, deliberately not an async fetch
 * of its own. Navigating between Parts re-renders this function
 * repeatedly (every onChoosePart call), and a fetch living here would
 * mean re-fetching, and re-flashing "Loading…", on every single one
 * of those clicks for data that never changed.
 *
 * Units/Parts render only once curriculumState confirms a curriculum
 * actually exists ('ready'); for every other status ('loading',
 * 'none', 'error') this section is simply absent, per the frozen
 * design's "Units remain unavailable until [a curriculum is chosen]."
 *
 * Subject actions ("Change Curriculum", "Remove Subject") live in a
 * Settings "⋮" here, beside the title — not on the home screen's own
 * list (ui/components/ExistingSubjectsList.js), which is a plain
 * navigation list per the platform design rules and carries no
 * management actions of its own.
 */
/**
 * Simplified per explicit product decision: the overflow menu here
 * was causing recurring positioning bugs, and with only two actions
 * (Change/Assign Curriculum, Remove Subject) it never genuinely
 * needed a menu in the first place — "prefer visible primary actions
 * over hidden menus whenever there are fewer than three actions."
 * "Change Curriculum" is a real, visible button now, directly beneath
 * the curriculum metadata it acts on (still deliberately does nothing
 * on click while a curriculum is already assigned — see this
 * function's own comment below for why); "Remove Subject" lives in a
 * Danger Zone at the bottom of the page, visually set apart from
 * everything else here, not hidden behind "⋮". No floating menu
 * anywhere on this screen.
 */
function renderSubjectStep(subject, curriculumState, selectedPartName, selectedUnitId, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = subject.title;
  section.appendChild(heading);

  const metadataSlot = document.createElement('div');
  renderCurriculumMetadataLine(metadataSlot, { curriculumState });
  section.appendChild(metadataSlot);

  const curriculumActionButton = document.createElement('button');
  curriculumActionButton.type = 'button';
  if (curriculumState.status === 'ready') {
    // Opens the Curriculum Hub itself (Review Units, Concepts, and
    // everything else it already does — see
    // ui/views/CurriculumManagementView.js, deliberately unredesigned)
    // to manage this Subject's own curriculum structure. Distinct
    // from — and safe, unlike — *reassigning a different* Curriculum
    // Index to this Subject, which has genuine data consequences
    // (Units/Concepts/Resources are materialized from the curriculum
    // at assignment time) and remains its own, separately-built,
    // not-yet-implemented confirmation flow.
    curriculumActionButton.className = 'btn btn--text learning-management__curriculum-action';
    curriculumActionButton.textContent = 'Change';
    curriculumActionButton.addEventListener('click', handlers.onManageCurriculum);
  } else if (curriculumState.status === 'none') {
    // Still the prominent, primary call-to-action — a Subject with
    // no curriculum installed at all is the one case where reaching
    // the Curriculum Hub genuinely IS the most important thing on
    // this screen, per explicit product decision (once a curriculum
    // exists, this same action recedes to a secondary "Change" text
    // link instead, immediately above).
    curriculumActionButton.className = 'btn btn--primary learning-management__curriculum-action';
    curriculumActionButton.textContent = 'Install Curriculum';
    curriculumActionButton.addEventListener('click', handlers.onGoToAssignCurriculum);
  }
  if (curriculumState.status === 'ready' || curriculumState.status === 'none') {
    section.appendChild(curriculumActionButton);
  }

  const divider = document.createElement('hr');
  divider.className = 'learning-management__subject-divider';
  section.appendChild(divider);

  if (curriculumState.status === 'ready') {
    section.appendChild(renderUnitsOrParts(subject, selectedPartName, selectedUnitId, handlers));
  }

  section.appendChild(renderDangerZone(subject, handlers));

  return section;
}

/**
 * A visually distinct section at the bottom of the page for
 * destructive, rare actions — set apart from the rest of the screen
 * by styling alone, never hidden behind a menu. Only "Remove Subject"
 * lives here today; a future "Remove Curriculum" (mentioned as a
 * later requirement, not built yet) would belong here too.
 */
function renderDangerZone(subject, handlers) {
  const zone = document.createElement('div');
  zone.className = 'learning-management__danger-zone';

  const zoneHeading = document.createElement('p');
  zoneHeading.className = 'learning-management__danger-zone-heading';
  zoneHeading.textContent = 'Danger Zone';
  zone.appendChild(zoneHeading);

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'btn btn--danger';
  removeButton.textContent = 'Remove Subject';
  removeButton.addEventListener('click', () => handlers.onRemoveSubject(subject));
  zone.appendChild(removeButton);

  return zone;
}

function renderUnitsOrParts(subject, selectedPartName, selectedUnitId, handlers) {
  const wrapper = document.createElement('div');

  const distinctPartNames = [...new Set(subject.units.map((unit) => unit.partName).filter(Boolean))];

  if (distinctPartNames.length > 0 && selectedPartName === null) {
    const partHeading = document.createElement('p');
    partHeading.className = 'learning-management__intro';
    partHeading.textContent = 'Parts';
    wrapper.appendChild(partHeading);

    const list = document.createElement('div');
    list.className = 'learning-management__subject-card-list';
    distinctPartNames.forEach((partName) => {
      list.appendChild(createNavigationRow({ label: partName, onClick: () => handlers.onChoosePart(partName) }));
    });
    wrapper.appendChild(list);
    return wrapper;
  }

  const unitsToShow = selectedPartName ? subject.units.filter((unit) => unit.partName === selectedPartName) : subject.units;

  // A Unit is selected — show that Unit's own Concepts instead of the
  // Units list, the one further drill-down level Phase 1.5 restores.
  // Concepts render the same NavigationRow way Units do just below;
  // selecting one hands off to the Concept Workspace entirely (see
  // handlers.onSelectConcept in renderLearningManagementView, and
  // renderView's own "mode === 'concept'" branch) rather than
  // anything being rendered further here.
  if (selectedUnitId) {
    const selectedUnit = unitsToShow.find((unit) => unit.id === selectedUnitId);
    // The unit this drill-down was for no longer exists (deleted from
    // another tab/device) — fall back to the Units list rather than
    // rendering a Concepts heading with nothing real underneath it.
    if (!selectedUnit) {
      handlers.onSelectUnit(null);
      return wrapper;
    }

    const conceptsHeading = document.createElement('p');
    conceptsHeading.className = 'learning-management__intro';
    conceptsHeading.textContent = 'Concepts';
    wrapper.appendChild(conceptsHeading);

    if (selectedUnit.concepts.length === 0) {
      wrapper.appendChild(createEmptyStateElement({ message: 'No concepts yet.' }));
      return wrapper;
    }

    const conceptList = document.createElement('div');
    conceptList.className = 'learning-management__subject-card-list';
    selectedUnit.concepts.forEach((concept) => {
      conceptList.appendChild(createNavigationRow({ label: concept.title, onClick: () => handlers.onSelectConcept(concept) }));
    });
    wrapper.appendChild(conceptList);
    return wrapper;
  }

  const unitsHeading = document.createElement('p');
  unitsHeading.className = 'learning-management__intro';
  unitsHeading.textContent = 'Units';
  wrapper.appendChild(unitsHeading);

  const list = document.createElement('div');
  list.className = 'learning-management__subject-card-list';
  unitsToShow.forEach((unit) => {
    const label = unit.number != null ? `Unit ${unit.number} \u2013 ${unit.title}` : unit.title;
    list.appendChild(createNavigationRow({ label, onClick: () => handlers.onSelectUnit(unit.id) }));
  });
  wrapper.appendChild(list);

  return wrapper;
}
