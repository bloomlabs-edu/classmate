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
import * as resourceService from '../../services/resourceService.js';
import * as resourceRepository from '../../services/resourceRepository.js';
import { LEARNING_HUB_EXPERIENCE_TYPE_TO_RESOURCE_TYPE } from './ConceptWorkspaceView.js';
import { openLearningHubPanel } from '../components/LearningHubPanel.js';
import { fetchLearningHubPacks } from '../../services/learningHubCatalogueService.js';
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
  // Whether the small, inline "Add Unit"/"Add Concept" forms are
  // currently open — per explicit product decision, Units/Concepts
  // are now a first-class ClassMate structure independent of
  // Curriculum, so creating one manually needs a real UI entry point
  // (learningRecordTeacherService.createUnit()/createConcept()
  // already existed and already worked without any Curriculum
  // reference at all; they simply had no caller anywhere in the UI
  // until now).
  let addingUnit = false;
  let addingConcept = false;
  // Set only while a teacher has picked a Learning Hub result but the
  // Unit has more than one Concept, so a small "which concept?" step
  // is needed before the real Resource+link is created — see
  // ui/components/LearningHubPanel.js's own comment for why this
  // can't just always use the first Concept.
  let pendingLearningHubExperience = null;
  // The currently-open Learning Hub panel instance (see
  // ui/components/LearningHubPanel.js's own openLearningHubPanel()),
  // or null when closed. Its own DOM is mounted directly on
  // document.body, outside this screen's own container — the
  // page-level rerender() below never touches it at all, so every
  // handler that changes pendingLearningHubExperience must also call
  // this panel's own .rerender() explicitly to keep it in sync.
  let openLearningHubPanelInstance = null;

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
        addingUnit,
        addingConcept,
        pendingLearningHubExperience,
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
      addingUnit = false;
      addingConcept = false;
      pendingLearningHubExperience = null;
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
      addingUnit = false;
      pendingLearningHubExperience = null;
      rerender();
    },
    onSelectUnit: (unitId) => {
      selectedUnitId = unitId;
      addingConcept = false;
      pendingLearningHubExperience = null;
      rerender();
    },
    onSetUnitLearningHubPack: (unit, pack) => {
      // A reference only — {packId, title} — never the Pack's own
      // internal Topics/Experiences. Mirrors exactly how
      // linkedCurriculumUnitId already works on this same model.
      unit.learningHubPack = pack ? { packId: pack.id, title: pack.title } : null;
      if (!pack) delete unit.learningHubPack; // omit entirely when cleared, matching this field's own "omit, never undefined" Firestore-safety convention
      workspaceService.save(selectedClassroom);
      rerender();
    },
    onStartAddUnit: () => {
      addingUnit = true;
      rerender();
    },
    onCancelAddUnit: () => {
      addingUnit = false;
      rerender();
    },
    onCreateUnit: (title) => {
      // Reuses the exact, already-existing, already-curriculum-optional
      // service function directly — no linkedCurriculumUnitId passed
      // at all, matching a manually-created Unit's own real
      // provenance. Behaves identically to a curriculum-derived Unit
      // from this point forward (see models/LearningUnit.js's own
      // header comment).
      learningRecordTeacherService.createUnit(selectedClassroom, selectedSubject.id, { title });
      workspaceService.save(selectedClassroom);
      addingUnit = false;
      rerender();
    },
    onStartAddConcept: () => {
      addingConcept = true;
      rerender();
    },
    onCancelAddConcept: () => {
      addingConcept = false;
      rerender();
    },
    onCreateConcept: (unitId, title) => {
      learningRecordTeacherService.createConcept(selectedClassroom, unitId, { title });
      workspaceService.save(selectedClassroom);
      addingConcept = false;
      rerender();
    },
    onOpenLearningHubPanel: (unit) => {
      openLearningHubPanelInstance = openLearningHubPanel({
        unit,
        pendingLearningHubExperience,
        handlers,
        renderPackSection: (container) => renderUnitPackControl(container, unit, handlers),
        onClose: () => {
          openLearningHubPanelInstance = null;
          pendingLearningHubExperience = null;
        },
      });
    },
    onPickLearningHubExperience: (experience, unit) => {
      // Exactly one Concept — no ambiguity about which one this is
      // for, so create the real Resource+link immediately, skipping
      // an unnecessary extra step.
      if (unit.concepts.length === 1) {
        handlers.onUseLearningHubResourceForConcept(experience, unit.concepts[0]);
        return;
      }
      // Zero Concepts — there is genuinely nothing to attach this to
      // yet; the panel's own rerender() below will show a plain,
      // honest message rather than silently doing nothing.
      pendingLearningHubExperience = experience;
      openLearningHubPanelInstance?.rerender(pendingLearningHubExperience);
    },
    onCancelPendingLearningHubExperience: () => {
      pendingLearningHubExperience = null;
      openLearningHubPanelInstance?.rerender(pendingLearningHubExperience);
    },
    onUseLearningHubResourceForConcept: async (experience, concept) => {
      // Mirrors ui/views/ConceptWorkspaceView.js's own
      // onCreateLearningHubResource exactly — same Resource type
      // mapping, same content shape, same default ('teacher')
      // audience, reusing the exact same, already-existing
      // createResourceOnConcept() call. Not a second implementation.
      const resourceType = LEARNING_HUB_EXPERIENCE_TYPE_TO_RESOURCE_TYPE[experience.type] || 'activity';
      const resource = await resourceService.createResourceOnConcept(selectedClassroom.id, concept, { title: experience.title, type: resourceType });
      resource.content = { kind: 'learning_hub_experience', experienceType: experience.type, experienceId: experience.id };
      resource.audience = 'teacher';
      await resourceRepository.saveResource(selectedClassroom.id, resource);
      workspaceService.save(selectedClassroom);
      pendingLearningHubExperience = null;
      openLearningHubPanelInstance?.rerender(pendingLearningHubExperience);
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
    wrapper.appendChild(renderSubjectStep(state.selectedSubject, state.selectedSubjectCurriculumState, state.selectedPartName, state.selectedUnitId, state.addingUnit, state.addingConcept, state.pendingLearningHubExperience, handlers));
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
function renderSubjectStep(subject, curriculumState, selectedPartName, selectedUnitId, addingUnit, addingConcept, pendingLearningHubExperience, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const heading = document.createElement('p');
  heading.className = 'learning-management__step-heading';
  heading.textContent = subject.title;
  section.appendChild(heading);

  const hasUnits = subject.units.length > 0;

  // Curriculum metadata (e.g. "Linked to NCERT Science Grade 8") is
  // still shown when genuinely relevant — but only once real Units
  // already exist. A brand-new Subject with neither Units nor a
  // Curriculum shows the plain "No Units yet." message below instead,
  // per explicit product decision: Curriculum status is no longer
  // the thing this screen leads with.
  if (hasUnits) {
    const metadataSlot = document.createElement('div');
    renderCurriculumMetadataLine(metadataSlot, { curriculumState });
    section.appendChild(metadataSlot);
  }

  const curriculumActionButton = document.createElement('button');
  curriculumActionButton.type = 'button';
  // Always a secondary, "btn--text" action now — reaching the
  // Curriculum Hub (to import/change a curriculum) is one optional
  // way to populate Units, never the primary or required one. Same,
  // unmodified handlers/mechanism either way.
  curriculumActionButton.className = 'btn btn--text learning-management__curriculum-action';
  if (curriculumState.status === 'ready') {
    curriculumActionButton.textContent = 'Change Curriculum';
    curriculumActionButton.addEventListener('click', handlers.onManageCurriculum);
  } else if (curriculumState.status === 'none') {
    curriculumActionButton.textContent = 'Import from Curriculum';
    curriculumActionButton.addEventListener('click', handlers.onGoToAssignCurriculum);
  }

  const divider = document.createElement('hr');
  divider.className = 'learning-management__subject-divider';
  section.appendChild(divider);

  if (hasUnits) {
    // Units are shown whenever they genuinely exist — regardless of
    // Curriculum status — matching how Assessments already read this
    // exact same tree with no curriculum gating at all.
    section.appendChild(renderUnitsOrParts(subject, selectedPartName, selectedUnitId, addingUnit, addingConcept, pendingLearningHubExperience, handlers));
    // "Import from Curriculum" is deliberately NOT offered here once
    // real Units already exist without one — curriculumLinkingService.js's
    // own assignment fully replaces subject.units (never merges),
    // confirmed directly; offering this action here would risk
    // silently destroying a teacher's own manually-created Units.
    // "Change Curriculum" remains available for a Subject that
    // already has a real curriculum link — that path is safe, since
    // a teacher explicitly chose it once already.
    if (curriculumState.status === 'ready') {
      section.appendChild(curriculumActionButton);
    }
  } else {
    section.appendChild(createEmptyStateElement({ message: 'No Units yet.' }));
    section.appendChild(renderAddUnitControl(addingUnit, handlers));
    if (curriculumState.status === 'none') {
      section.appendChild(curriculumActionButton);
    }
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

/**
 * Shows the currently-referenced Learning Hub Pack (title only, never
 * its own internal Topics/Experiences) with a Change/Remove action,
 * or an "Associate" action when none is set. The picker itself
 * fetches the real Packs list on demand, mirroring the exact same
 * "sync placeholder, then async replace" pattern already used for
 * the Learning Hub Experience picker in ConceptWorkspaceView.js.
 */
export function renderUnitPackControl(container, unit, handlers) {
  container.innerHTML = '';

  if (unit.learningHubPack) {
    const currentLine = document.createElement('p');
    currentLine.className = 'learning-management__learning-hub-pack-current';
    currentLine.textContent = `\ud83d\udce6 Learning Hub Pack: ${unit.learningHubPack.title}`;
    container.appendChild(currentLine);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn--text';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => handlers.onSetUnitLearningHubPack(unit, null));
    container.appendChild(removeButton);
    return;
  }

  const associateButton = document.createElement('button');
  associateButton.type = 'button';
  associateButton.className = 'btn btn--secondary';
  associateButton.textContent = '+ Associate Learning Hub Pack';
  associateButton.addEventListener('click', () => {
    const pickerContainer = document.createElement('div');
    pickerContainer.className = 'learning-management__learning-hub-pack-picker';
    const loadingMessage = document.createElement('p');
    loadingMessage.className = 'learning-management__intro';
    loadingMessage.textContent = 'Loading\u2026';
    pickerContainer.appendChild(loadingMessage);
    container.appendChild(pickerContainer);
    associateButton.disabled = true;

    fetchLearningHubPacks().then((packs) => {
      pickerContainer.innerHTML = '';
      if (packs.length === 0) {
        pickerContainer.appendChild(createEmptyStateElement({ message: 'Could not load Learning Hub Packs right now.' }));
        return;
      }
      packs.forEach((pack) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'learning-management__learning-hub-pack-option';
        const curriculumLine = pack.curriculum ? ` \u00b7 ${pack.curriculum.curriculum} \u00b7 Grade ${pack.curriculum.grade}` : '';
        row.textContent = `${pack.title}${curriculumLine}`;
        row.addEventListener('click', () => handlers.onSetUnitLearningHubPack(unit, pack));
        pickerContainer.appendChild(row);
      });
    });
  });
  container.appendChild(associateButton);
}

/**
 * The "+ Add Unit" action/inline form — reuses the exact, already-
 * existing learningRecordTeacherService.createUnit() directly, with
 * no linkedCurriculumUnitId at all, matching a manually-created
 * Unit's own real provenance. Once created, this Unit behaves
 * identically to a curriculum-derived one everywhere else in the app
 * (see models/LearningUnit.js's own header comment) — this control's
 * only job is calling that existing function, not a second creation
 * path.
 */
function renderAddUnitControl(addingUnit, handlers) {
  const wrapper = document.createElement('div');
  wrapper.className = 'learning-management__add-unit-control';

  if (!addingUnit) {
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn btn--secondary';
    addButton.textContent = '+ Add Unit';
    addButton.addEventListener('click', handlers.onStartAddUnit);
    wrapper.appendChild(addButton);
    return wrapper;
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Unit title';
  wrapper.appendChild(input);

  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'btn btn--primary';
  createButton.textContent = 'Create';
  createButton.addEventListener('click', () => {
    const title = input.value.trim();
    if (!title) return;
    handlers.onCreateUnit(title);
  });
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', handlers.onCancelAddUnit);
  wrapper.append(createButton, cancelButton);

  return wrapper;
}

/**
 * The "+ Add Concept" action/inline form — mirrors renderAddUnitControl()
 * exactly, reusing the existing learningRecordTeacherService.createConcept()
 * directly.
 */
function renderAddConceptControl(unitId, addingConcept, handlers) {
  const wrapper = document.createElement('div');
  wrapper.className = 'learning-management__add-unit-control';

  if (!addingConcept) {
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn btn--secondary';
    addButton.textContent = '+ Add Concept';
    addButton.addEventListener('click', handlers.onStartAddConcept);
    wrapper.appendChild(addButton);
    return wrapper;
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Concept title';
  wrapper.appendChild(input);

  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'btn btn--primary';
  createButton.textContent = 'Create';
  createButton.addEventListener('click', () => {
    const title = input.value.trim();
    if (!title) return;
    handlers.onCreateConcept(unitId, title);
  });
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn btn--text';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', handlers.onCancelAddConcept);
  wrapper.append(createButton, cancelButton);

  return wrapper;
}

function renderUnitsOrParts(subject, selectedPartName, selectedUnitId, addingUnit, addingConcept, pendingLearningHubExperience, handlers) {
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
    conceptsHeading.className = 'learning-management__primary-section-heading';
    conceptsHeading.textContent = 'Concepts';
    wrapper.appendChild(conceptsHeading);

    if (selectedUnit.concepts.length === 0) {
      wrapper.appendChild(createEmptyStateElement({ message: "What do you want your students to understand in this unit?" }));
      wrapper.appendChild(renderAddConceptControl(selectedUnit.id, addingConcept, handlers));
    } else {
      const conceptList = document.createElement('div');
      conceptList.className = 'learning-management__subject-card-list';
      selectedUnit.concepts.forEach((concept) => {
        conceptList.appendChild(createNavigationRow({ label: concept.title, onClick: () => handlers.onSelectConcept(concept) }));
      });
      wrapper.appendChild(conceptList);
      wrapper.appendChild(renderAddConceptControl(selectedUnit.id, addingConcept, handlers));
    }

    // Learning Hub is now a dormant plugin (see
    // ui/components/LearningHubPanel.js), never a permanent page
    // section — per explicit product decision, this trigger is the
    // ENTIRE Learning Hub footprint on the Unit page when the panel
    // is closed. No heading, no search box, no results, no Pack
    // control occupy any space here at all.
    const learningHubTrigger = document.createElement('button');
    learningHubTrigger.type = 'button';
    learningHubTrigger.className = 'learning-management__learning-hub-trigger';
    learningHubTrigger.setAttribute('aria-label', 'Open Learning Hub');
    const triggerIcon = document.createElement('span');
    triggerIcon.setAttribute('aria-hidden', 'true');
    triggerIcon.textContent = '\ud83e\udded';
    const triggerLabel = document.createElement('span');
    triggerLabel.textContent = 'Learning Hub';
    learningHubTrigger.append(triggerIcon, ' ', triggerLabel);
    learningHubTrigger.addEventListener('click', () => {
      handlers.onOpenLearningHubPanel(selectedUnit);
    });
    wrapper.appendChild(learningHubTrigger);

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
  wrapper.appendChild(renderAddUnitControl(addingUnit, handlers));

  return wrapper;
}
