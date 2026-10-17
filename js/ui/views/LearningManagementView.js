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
 * Creating a Subject and assigning it a curriculum are two separate
 * steps, on purpose — three distinct concepts: a CURRICULUM RESOURCE
 * (a Curriculum Index in the library), a CLASSROOM SUBJECT (this
 * Subject), and a CURRICULUM ASSIGNMENT (the link between them).
 * "+ Add Subject" (ui/components/AddSubjectModal.js) only ever runs
 * Choose Subject, creating a bare Subject immediately via
 * services/learningRecordTeacherService.js's createSubject() — no
 * curriculum required or implied. Landing directly on that Subject's
 * own page afterward (see onGoToAddSubject below) is what makes
 * "Assign curriculum ->" the natural next click, not a forced one:
 * a Subject with no curriculum assigned is a completely normal,
 * persistent state (ui/components/CurriculumMetadataLine.js's own
 * "Curriculum: Not assigned"), not an error condition.
 *
 * The data flow once a curriculum IS assigned: Subject -> Assigned
 * Curriculum -> Units -> Concepts. A Subject never owns Units
 * independent of a curriculum unless a teacher adds them manually
 * (+ Add Unit); every curriculum-derived Unit comes from that
 * curriculum's own data (see
 * services/curriculumLinkingService.js's createSubjectWithCurriculum()
 * and assignCurriculumToSubject()), not hardcoded here.
 *
 * Both ui/components/AssignCurriculumModal.js's entry points —
 * Path A, "Learning -> Subject -> Assign curriculum", reached here —
 * and ui/views/CurriculumManagementView.js's own "Assign Curriculum"
 * (Path B, from a Curriculum Index's own detail page) read/write the
 * exact same underlying relationship
 * (services/curriculumLinkingService.js's
 * findAvailableCurriculumIndexesForSubject()/assignCurriculumToSubject()/
 * createSubjectWithCurriculum()) — never two separate assignment
 * mechanisms.
 *
 * Component hierarchy, and why the Subject Picker can never end up on
 * this home screen by accident:
 *
 *   LearningManagementView
 *   ├── ExistingSubjectsList     (persisted Subjects only — no
 *   │                             suggestion data, no fallback list)
 *   ├── "+ Add Subject" button   (trivial — stays inline here)
 *   ├── AddSubjectModal          (Choose Subject only — creates a
 *   │     └── SubjectSelectionList   bare Subject, no curriculum step)
 *   │         (the only file that
 *   │          imports config/commonSubjectsConfig.js)
 *   └── AssignCurriculumModal    (the always-available "Assign
 *                                  curriculum ->" action on a
 *                                  Subject's own page; see
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
import { createIcon, createIconBadge } from '../components/Icon.js';
import { openAddSubjectModal } from '../components/AddSubjectModal.js';
import { openAssignCurriculumModal } from '../components/AssignCurriculumModal.js';
import { renderExistingSubjectsList } from '../components/ExistingSubjectsList.js';
import { createNavigationRow } from '../components/NavigationRow.js';
import { createOverflowMenu, createCardRowWithOverflowMenu } from '../components/OverflowMenu.js';
import { renderCurriculumMetadataLine } from '../components/CurriculumMetadataLine.js';
import { getPartIconName } from '../../config/partIconConfig.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { getDisplayName, getGradeLabelForClassroom } from '../../services/classroomService.js';
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

export function renderLearningManagementView(container, { classrooms, onBack, onOpenCurriculumManagement, initialSubjectId = null, initialUnitId = null, initialConceptId = null }) {
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
  // Non-null only while a just-created Unit/Concept's own save is
  // in flight or has failed — { status: 'saving' | 'failed', title }.
  // Carries the title through so a failed save's Retry (which re-runs
  // this same handler) can re-display it and re-attempt the save
  // without creating a second Unit/Concept (see onCreateUnit/
  // onCreateConcept below: the in-memory mutation only ever happens
  // once, guarded by this state being null).
  let unitCreateState = null;
  let conceptCreateState = null;
  // Inline rename state for the Subject's own heading (renderSubjectStep())
  // and, separately, for whichever single Unit row in the Units list
  // (renderUnitsOrParts()) currently has its own inline rename control
  // open — same "toggle swaps a heading/row for an editable input,
  // separate {status:'saving'|'failed', title} slot tracks the in-
  // flight save" shape as addingUnit/unitCreateState above, just for
  // a single-string edit rather than a create. editingUnitId (an id,
  // not a boolean) is deliberately distinct from selectedUnitId below:
  // selectedUnitId tracks navigation/drill-down into a Unit's own
  // Concepts, while editingUnitId tracks which row in the LIST is
  // showing its inline rename control — a Unit's rename now happens
  // entirely in place in the list, never by navigating into that
  // Unit's own page (see onStartRenameUnit/onRenameUnit below and
  // renderUnitsOrParts()'s own Units-list branch). Only one rename can
  // be in progress at a time on this page (a Subject rename and a Unit
  // rename are never shown together, and choosing/leaving a Subject or
  // Unit always resets these below), so two separate slots (rather
  // than one shared "what am I renaming" slot) stay simplest.
  let editingSubjectTitle = false;
  let subjectRenameState = null;
  let editingUnitId = null;
  let unitRenameState = null;
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
        // Page-containment/curriculum-state audit: a background sync
        // used to swap in `freshSubject` without ever re-checking
        // whether its OWN linkedCurriculumIndexId changed (e.g. a
        // co-teacher assigned/changed the curriculum on another
        // device/tab) — selectedSubjectCurriculumState was only ever
        // (re)loaded from onChooseSubject, so it could silently go
        // stale relative to the just-swapped-in subject. Re-derive it
        // whenever the link itself actually differs; a resync that
        // doesn't touch this Subject's curriculum link (the common
        // case — most syncs are score/history changes elsewhere)
        // still costs nothing extra.
        const curriculumLinkChanged = freshSubject.linkedCurriculumIndexId !== selectedSubject.linkedCurriculumIndexId;
        selectedSubject = freshSubject;
        if (curriculumLinkChanged) {
          loadCurriculumStateFor(freshSubject); // also calls rerender()
          return;
        }
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
        unitCreateState,
        conceptCreateState,
        pendingLearningHubExperience,
        editingSubjectTitle,
        subjectRenameState,
        editingUnitId,
        unitRenameState,
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
        // Root-cause fix (2026-09-11 second browser pass) — getIndex()
        // reads services/curriculumIndexRepository.js's own IndexedDB,
        // which is local to THIS browser and never synced. A null
        // result here means "linkedCurriculumIndexId is genuinely set,
        // but that record isn't in this browser's IndexedDB" — a real,
        // existing link the app just can't resolve locally, not the
        // same thing as `!subject.linkedCurriculumIndexId` above. This
        // used to collapse into the same {status:'none'} as a Subject
        // that was never linked at all, which is exactly why "no
        // Curriculum Index linked" could show for a Subject that
        // actually had one. See ui/components/CurriculumMetadataLine.js's
        // own header comment for the full story.
        selectedSubjectCurriculumState = curriculumIndex
          ? { status: 'ready', curriculumIndex }
          : { status: 'missing' };
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
      onOpenCurriculumManagement({
        onBack: () => rerender(),
        subjectTitle: selectedSubject.title,
        gradeLabel: getGradeLabelForClassroom(selectedClassroom),
      });
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
        onSubjectAdded: (subject) => {
          // The modal already created and marked the Subject dirty —
          // land directly on that Subject's own page (not just the
          // Home list) so "Assign curriculum ->" is the natural next
          // action, rather than making the teacher find and reopen
          // the Subject they just added.
          handlers.onChooseSubject(subject);
        },
      });
    },
    onChooseSubject: (subject) => {
      selectedSubject = subject;
      selectedPartName = null;
      selectedUnitId = null;
      conceptContext = null;
      addingUnit = false;
      addingConcept = false;
      unitCreateState = null;
      conceptCreateState = null;
      pendingLearningHubExperience = null;
      editingSubjectTitle = false;
      subjectRenameState = null;
      editingUnitId = null;
      unitRenameState = null;
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
        // target for the same reason. Also carries the same subject/
        // grade context so a teacher who falls into this fallback
        // still sees *why* they're there (see CurriculumManagementView.js's
        // own optional contextLabel) instead of landing on a bare,
        // unrelated-looking "Curriculum" screen.
        onOpenCurriculumManagement: () =>
          onOpenCurriculumManagement({
            onBack: () => rerender(),
            subjectTitle: selectedSubject.title,
            gradeLabel: getGradeLabelForClassroom(selectedClassroom),
          }),
      });
    },
    onChoosePart: (partName) => {
      selectedPartName = partName;
      selectedUnitId = null;
      addingUnit = false;
      unitCreateState = null;
      pendingLearningHubExperience = null;
      editingUnitId = null;
      unitRenameState = null;
      rerender();
    },
    onSelectUnit: (unitId) => {
      selectedUnitId = unitId;
      addingConcept = false;
      conceptCreateState = null;
      pendingLearningHubExperience = null;
      editingUnitId = null;
      unitRenameState = null;
      rerender();
    },
    onSetUnitLearningHubPack: (unit, pack) => {
      // A reference only — {packId, title} — never the Pack's own
      // internal Topics/Experiences. Mirrors exactly how
      // linkedCurriculumUnitId already works on this same model.
      unit.learningHubPack = pack ? { packId: pack.id, title: pack.title } : null;
      if (!pack) delete unit.learningHubPack; // omit entirely when cleared, matching this field's own "omit, never undefined" Firestore-safety convention
      // markDirty() closes the stale-snapshot window the instant this
      // mutation happens — see workspaceService.js's own
      // canApplyIncomingServerState() — before saveExplicitly() (not
      // save()) actually persists it, so a concurrent incoming
      // snapshot can never revert this pick back out from under the
      // teacher. Not awaited here (no per-row pending UI in this
      // picker), but saveExplicitly()'s own saveState transitions
      // still drive the existing "Saving…/✓ Changes saved/Save
      // failed. Retry" banner (renderSaveStatus() below) — the
      // failure case is not silently swallowed, just not blocking
      // this specific click.
      workspaceService.markDirty(selectedClassroom.id);
      workspaceService.saveExplicitly(selectedClassroom).catch(() => {});
      rerender();
    },
    onStartAddUnit: () => {
      addingUnit = true;
      unitCreateState = null;
      rerender();
    },
    onCancelAddUnit: () => {
      addingUnit = false;
      unitCreateState = null;
      rerender();
    },
    onCreateUnit: async (title) => {
      // The in-memory mutation runs exactly once, guarded by
      // unitCreateState being null — a Retry click (after a failed
      // save below) re-enters this same handler with unitCreateState
      // already set to 'failed', so it only re-attempts the save,
      // never creates a second Unit.
      if (!unitCreateState) {
        // Reuses the exact, already-existing, already-curriculum-optional
        // service function directly — no linkedCurriculumUnitId passed
        // at all, matching a manually-created Unit's own real
        // provenance. Behaves identically to a curriculum-derived Unit
        // from this point forward (see models/LearningUnit.js's own
        // header comment).
        const unit = learningRecordTeacherService.createUnit(selectedClassroom, selectedSubject.id, { title });
        // Marks this classroom dirty the instant the Unit exists in
        // memory — before the network write below even starts — so
        // an incoming Firestore snapshot from before this Unit existed
        // can never overwrite it out of the UI while the save is in
        // flight (see workspaceService.js's canApplyIncomingServerState()).
        workspaceService.markDirty(selectedClassroom.id);
        unitCreateState = { status: 'saving', title, unit };
      } else if (title !== unitCreateState.title) {
        // The teacher edited the title in the form before clicking
        // Retry — the Unit already exists in memory from the attempt
        // above (never re-created), so a plain Retry re-saves it
        // under its original title regardless of what the input now
        // shows. Applying the edit here, in place, is what makes
        // Retry actually save what the teacher currently sees.
        unitCreateState.unit.title = title;
        unitCreateState = { ...unitCreateState, status: 'saving', title };
      } else {
        unitCreateState = { ...unitCreateState, status: 'saving' };
      }
      rerender();
      try {
        // saveExplicitly(), not save() — awaited, so this handler
        // (and the Create button it's driving; see
        // renderAddUnitControl()) knows exactly when the write has
        // actually settled, rather than firing-and-forgetting it.
        await workspaceService.saveExplicitly(selectedClassroom);
        addingUnit = false;
        unitCreateState = null;
      } catch (error) {
        // Already logged by saveExplicitly() itself. The Unit stays
        // created in memory (nothing here undoes it) and the form
        // shows Retry — clicking it re-enters this same handler with
        // unitCreateState already set, so it only retries the save.
        unitCreateState = { ...unitCreateState, status: 'failed' };
      }
      rerender();
    },
    /**
     * Renaming the Subject/Unit heading — see renderSubjectStep()/
     * renderUnitsOrParts()'s own renderInlineRenameControl() calls.
     * Unlike onCreateUnit/onCreateConcept above, renameSubject()/
     * renameUnit() (services/learningRecordTeacherService.js) simply
     * overwrite `title` in place — calling them again with the same
     * value on a Retry is harmless, so there's no "only mutate once"
     * guard to mirror here; a Retry click just re-runs this same
     * handler with whatever title the input currently shows.
     */
    onStartRenameSubject: () => {
      editingSubjectTitle = true;
      subjectRenameState = null;
      rerender();
    },
    onCancelRenameSubject: () => {
      editingSubjectTitle = false;
      subjectRenameState = null;
      rerender();
    },
    onRenameSubject: async (newTitle) => {
      const title = newTitle.trim();
      if (!title) return;
      learningRecordTeacherService.renameSubject(selectedClassroom, selectedSubject.id, title);
      workspaceService.markDirty(selectedClassroom.id);
      subjectRenameState = { status: 'saving', title };
      rerender();
      try {
        await workspaceService.saveExplicitly(selectedClassroom);
        editingSubjectTitle = false;
        subjectRenameState = null;
      } catch (error) {
        // Already logged by saveExplicitly() itself. The title stays
        // changed in memory (nothing here reverts it) and the control
        // shows Retry — clicking Save again re-enters this same
        // handler, harmlessly re-applying the same title and retrying
        // the save.
        subjectRenameState = { status: 'failed', title };
      }
      rerender();
    },
    onStartRenameUnit: (unitId) => {
      editingUnitId = unitId;
      unitRenameState = null;
      rerender();
    },
    onCancelRenameUnit: () => {
      editingUnitId = null;
      unitRenameState = null;
      rerender();
    },
    onRenameUnit: async (unitId, newTitle) => {
      const title = newTitle.trim();
      if (!title) return;
      learningRecordTeacherService.renameUnit(selectedClassroom, unitId, title);
      workspaceService.markDirty(selectedClassroom.id);
      unitRenameState = { status: 'saving', title };
      rerender();
      try {
        await workspaceService.saveExplicitly(selectedClassroom);
        editingUnitId = null;
        unitRenameState = null;
      } catch (error) {
        unitRenameState = { status: 'failed', title };
      }
      rerender();
    },
    onStartAddConcept: () => {
      addingConcept = true;
      conceptCreateState = null;
      rerender();
    },
    onCancelAddConcept: () => {
      addingConcept = false;
      conceptCreateState = null;
      rerender();
    },
    onCreateConcept: async (unitId, title) => {
      // Same guarded-mutation-then-awaited-save shape as onCreateUnit
      // above — see its own comments for why, including the
      // edited-title-on-Retry handling.
      if (!conceptCreateState) {
        const concept = learningRecordTeacherService.createConcept(selectedClassroom, unitId, { title });
        workspaceService.markDirty(selectedClassroom.id);
        conceptCreateState = { status: 'saving', title, concept };
      } else if (title !== conceptCreateState.title) {
        conceptCreateState.concept.title = title;
        conceptCreateState = { ...conceptCreateState, status: 'saving', title };
      } else {
        conceptCreateState = { ...conceptCreateState, status: 'saving' };
      }
      rerender();
      try {
        await workspaceService.saveExplicitly(selectedClassroom);
        addingConcept = false;
        conceptCreateState = null;
      } catch (error) {
        conceptCreateState = { ...conceptCreateState, status: 'failed' };
      }
      rerender();
    },
    onOpenLearningHubPanel: (unit) => {
      openLearningHubPanelInstance = openLearningHubPanel({
        concept: unit.concepts.length === 1 ? unit.concepts[0] : null,
        unit,
        pendingLearningHubExperience,
        handlers,
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
      // Marked dirty up front, before any of the awaits below —
      // createResourceOnConcept() mutates concept.resourceLinks (part
      // of this classroom document) partway through its own body, and
      // there's a real await gap between that mutation and the
      // classroom save at the end of this handler. Calling
      // markDirty() first closes that whole window at once rather
      // than trying to time it to land exactly when the mutation
      // happens inside a function this handler doesn't control.
      workspaceService.markDirty(selectedClassroom.id);
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
      // saveExplicitly(), not save() — the resulting saveState still
      // drives the same "Saving…/✓ Changes saved/Save failed. Retry"
      // banner (renderSaveStatus() below) on failure, rather than
      // silently dropping the classroom-side link if this write fails.
      try {
        await workspaceService.saveExplicitly(selectedClassroom);
      } catch (error) {
        // Already logged and reflected in saveState by saveExplicitly()
        // itself — the Resource itself is already durably saved via
        // resourceRepository above regardless; only its link from this
        // Concept is at risk, and the save-status banner's Retry
        // covers that.
      }
      pendingLearningHubExperience = null;
      openLearningHubPanelInstance?.rerender(pendingLearningHubExperience);
    },
    onSelectConcept: (concept) => {
      conceptContext = { subjectId: selectedSubject.id, unitId: selectedUnitId, conceptId: concept.id };
      mode = 'concept';
      rerender();
    },
    // Previous/Next Concept navigation (see
    // ui/views/ConceptWorkspaceView.js's own renderConceptWorkspaceView)
    // stays inside that workspace's own closure — it never calls this
    // screen's rerender(), since re-invoking renderConceptWorkspaceView
    // from scratch would reset its own local activeTab/etc. state back
    // to Overview. This is a thin, non-rendering setter, only kept so
    // conceptContext.conceptId doesn't go stale: a later, unrelated
    // workspaceService.onSaveStateChange rerender() here (see below)
    // still needs to re-resolve to whichever Concept the teacher
    // actually has open, not the one this workspace originally opened
    // for.
    onConceptContextChange: (concept) => {
      if (mode !== 'concept' || !conceptContext) return;
      conceptContext = { ...conceptContext, conceptId: concept.id };
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
    onRemoveUnit: (subjectId, unitId) => {
      // subjectId is always selectedSubject.id in practice (this
      // handler is only ever reached from that Subject's own Units
      // list) — accepted explicitly anyway to mirror
      // deleteUnit(classroom, subjectId, unitId)'s own signature
      // rather than relying on the outer closure alone.
      const unit = selectedSubject?.units.find((candidate) => candidate.id === unitId);
      const unitLabel = unit ? (unit.number != null ? `Unit ${unit.number} – ${unit.title}` : unit.title) : 'this Unit';
      const confirmed = window.confirm(`Remove "${unitLabel}" from this Subject?\n\nThis removes its Concepts. This cannot be undone.`);
      if (!confirmed) return;
      learningRecordTeacherService.deleteUnit(selectedClassroom, subjectId, unitId);
      logPersistenceEvent('Unit removed', { classroomId: selectedClassroom.id, unitTitle: unit ? unit.title : unitLabel });
      workspaceService.markDirty(selectedClassroom.id);
      // Unlike onRemoveSubject above, stay right here — the Unit
      // disappears from its Subject's own list while that Subject
      // itself stays open, rather than navigating away to 'home'.
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

  // Timetable's own "Go to {subject} in Learning Management" gateway
  // (see ui/views/TimetableView.js's renderAttachLessonForm()) — lands
  // directly on that Subject's existing page via the exact same
  // handlers.onChooseSubject() every other entry point already uses,
  // never a new subject-selection workflow. Silently falls through to
  // the normal home-screen render below if selectedClassroom isn't
  // resolved yet (multi-classroom mode) or no LearningSubject matches
  // this canonical id — never an error.
  if (initialSubjectId && selectedClassroom) {
    const matchingSubject = learningRecordService
      .getSubjects(selectedClassroom)
      .find((subject) => subject.subjectId === initialSubjectId);
    if (matchingSubject) {
      handlers.onChooseSubject(matchingSubject);

      // A clicked concept box in Timetable's Week/Day view (see
      // ui/views/TimetableView.js's own renderPeriodCardConcepts())
      // lands here with ?unitId=&conceptId= alongside subjectId —
      // resolve the real Unit+Concept and jump straight into the
      // Concept Workspace, reusing the EXACT existing
      // handlers.onSelectUnit()/onSelectConcept() mechanism every
      // other "open a Concept" path in this screen already uses —
      // never a new destination or a parallel navigation path.
      // Silently falls through (stays on the Subject's own home page,
      // just opened above) if the Unit/Concept can no longer be found
      // (e.g. deleted since the Timetable link was generated) — never
      // an error.
      if (initialUnitId && initialConceptId) {
        const unit = learningRecordService.getUnitById(selectedClassroom, initialUnitId);
        const concept = unit?.concepts.find((c) => c.id === initialConceptId);
        if (unit && concept) {
          handlers.onSelectUnit(unit.id);
          handlers.onSelectConcept(concept);
        }
      }
    }
  }

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
      onConceptContextChange: handlers.onConceptContextChange,
    });
    return;
  }

  container.innerHTML = '';

  const wrapper = document.createElement('div');
  // 'learning-management' alone is a shared page-chrome class also
  // reused (unmodified) by AssessmentManagementView/GoalDashboardView/
  // GoalManagementView — the page-container sizing below is scoped to
  // this second, dedicated class so it affects only this screen, not
  // those other three.
  wrapper.className = 'learning-management learning-management-view';

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
    wrapper.appendChild(
      renderSubjectStep(
        state.selectedSubject,
        state.selectedClassroom,
        state.selectedSubjectCurriculumState,
        state.selectedPartName,
        state.selectedUnitId,
        state.addingUnit,
        state.addingConcept,
        state.unitCreateState,
        state.conceptCreateState,
        state.pendingLearningHubExperience,
        state.editingSubjectTitle,
        state.subjectRenameState,
        state.editingUnitId,
        state.unitRenameState,
        handlers
      )
    );
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
 * empty-state copy, no suggestions (the "Choose a subject to
 * continue" intro line below is scoped inside the same
 * `subjects.length > 0` branch as the subject grid itself, for
 * exactly this reason — there is nothing to "choose" yet when the
 * list is empty).
 *
 * "+ Add Subject" is a secondary management action, never the
 * loudest thing on this screen — the subject cards themselves are the
 * primary content (per the ClassMate style guide's own "Action
 * prominence should reflect action importance" rule). `btn--ghost`
 * (compact, outlined, blue) replaces the previous full-width
 * `btn--primary` bar; `existing-subjects__add-subject-button` only
 * overrides this section's own flex `align-items: stretch` so the
 * button sizes to its own content instead of stretching to the
 * section's full width the way every other flex child here still
 * correctly does (the subject grid itself DOES want that full width).
 */
function renderHomeStep(classroom, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const subjects = learningRecordService.getSubjects(classroom);
  if (subjects.length > 0) {
    const intro = document.createElement('p');
    intro.className = 'learning-management__intro';
    intro.textContent = 'Choose a subject to continue';
    section.appendChild(intro);

    section.appendChild(renderExistingSubjectsList(subjects, handlers.onChooseSubject));
  }

  const addSubjectButton = document.createElement('button');
  addSubjectButton.type = 'button';
  addSubjectButton.className = 'btn btn--ghost existing-subjects__add-subject-button';
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
 * Subject actions ("Edit Subject", "Delete Subject") live in a "⋮"
 * overflow menu beside the title (ui/components/OverflowMenu.js's
 * createOverflowMenu()) — not on the home screen's own list
 * (ui/components/ExistingSubjectsList.js), which is a plain
 * navigation list per the platform design rules and carries no
 * management actions of its own. "Change Curriculum" is a separate,
 * always-visible button in the Curriculum tile below (see
 * curriculumActionButton below) — it isn't a Subject-identity action
 * the way rename/delete are, so it stays out of this menu.
 */
/**
 * A previous round removed an overflow menu from this exact spot,
 * citing recurring positioning bugs, and moved "Remove Subject" to an
 * always-visible Danger Zone at the page bottom instead. Per explicit,
 * current product direction this is reversed: Edit/Delete Subject now
 * live in a "⋮" menu here, and the bottom Danger Zone is gone
 * entirely (see the removed renderDangerZone() this file used to
 * have). This isn't repeating the earlier mistake — the earlier menu
 * was a bespoke, ad-hoc dropdown local to this screen; this one reuses
 * ui/components/OverflowMenu.js's createOverflowMenu(), a newer,
 * centrally-coordinated component (see utils/popupCoordinator.js's
 * shared one-popup-at-a-time registry, built specifically to fix this
 * class of positioning/stacking bug) already used successfully by
 * Curriculum/Assessment/Resource/Recognition cards elsewhere in this
 * app.
 */
function renderSubjectStep(subject, classroom, curriculumState, selectedPartName, selectedUnitId, addingUnit, addingConcept, unitCreateState, conceptCreateState, pendingLearningHubExperience, editingSubjectTitle, subjectRenameState, editingUnitId, unitRenameState, handlers) {
  const section = document.createElement('div');
  section.className = 'learning-management__section';

  const headingRow = document.createElement('div');
  headingRow.className = 'learning-management__heading-row';

  if (editingSubjectTitle) {
    headingRow.appendChild(
      renderInlineRenameControl({
        currentValue: subject.title,
        state: subjectRenameState,
        inputClassName: 'learning-management__rename-input learning-management__step-heading-input',
        onSave: (newTitle) => handlers.onRenameSubject(newTitle),
        onCancel: handlers.onCancelRenameSubject,
      })
    );
  } else {
    const heading = document.createElement('p');
    heading.className = 'learning-management__step-heading';
    heading.textContent = subject.title;
    headingRow.appendChild(heading);

    headingRow.appendChild(
      createOverflowMenu({
        actions: [
          { label: 'Edit Subject', onClick: handlers.onStartRenameSubject },
          { label: 'Delete Subject', onClick: () => handlers.onRemoveSubject(subject), danger: true },
        ],
        ariaLabel: 'Subject options',
      })
    );
  }
  section.appendChild(headingRow);

  // Gateway context — a teacher landing here from Timetable's "Go to
  // {subject} in Learning Management" CTA (see TimetableView.js) should
  // immediately see which classroom/grade this Subject belongs to, not
  // just its bare name. Reuses the exact grade label already shown
  // elsewhere (services/classroomService.js's getGradeLabelForClassroom,
  // e.g. TimetableView.js) — no new context/label logic invented here.
  const gradeLabel = classroom ? getGradeLabelForClassroom(classroom) : '';
  if (gradeLabel) {
    const subheading = document.createElement('p');
    subheading.className = 'learning-management__subject-context';
    subheading.textContent = gradeLabel;
    section.appendChild(subheading);
  }

  const hasUnits = subject.units.length > 0;

  // Bento-style Curriculum -> Units (-> Concepts) management area —
  // two tiles in that same hierarchy order, so a teacher who landed
  // here from Timetable immediately sees "assign a curriculum, then
  // build Units" as one connected structure instead of a flat,
  // divider-separated stack of unrelated-looking controls. No new
  // business logic anywhere below: every condition is byte-identical
  // to what this function already computed before this redesign —
  // only *where* each existing piece is appended has changed.
  const bento = document.createElement('div');
  bento.className = 'learning-management__bento';
  section.appendChild(bento);

  // ---- Curriculum tile ----
  const curriculumTile = document.createElement('div');
  curriculumTile.className = 'learning-management__bento-tile learning-management__bento-tile--curriculum';

  const curriculumTileLabel = document.createElement('p');
  curriculumTileLabel.className = 'learning-management__bento-tile-label';
  curriculumTileLabel.textContent = 'Curriculum';
  curriculumTile.appendChild(curriculumTileLabel);

  // Curriculum metadata ("Curriculum: Samacheer Kalvi..." or
  // "Curriculum: Not assigned") is always visible, regardless of
  // whether Units exist yet — a Subject's curriculum assignment is a
  // real, always-inspectable state, not something that only becomes
  // worth showing once Units happen to exist.
  const metadataSlot = document.createElement('div');
  renderCurriculumMetadataLine(metadataSlot, { curriculumState, unitCount: subject.units.length });
  curriculumTile.appendChild(metadataSlot);

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
    curriculumActionButton.textContent = 'Assign curriculum →';
    curriculumActionButton.addEventListener('click', handlers.onGoToAssignCurriculum);
  }
  // "Import from Curriculum" is deliberately NOT offered here once
  // real Units already exist without one — curriculumLinkingService.js's
  // own assignment fully replaces subject.units (never merges),
  // confirmed directly; offering this action here would risk
  // silently destroying a teacher's own manually-created Units.
  // "Change Curriculum" remains available for a Subject that already
  // has a real curriculum link — that path is safe, since a teacher
  // explicitly chose it once already. Same exact two conditions this
  // screen always used, just both now live in the Curriculum tile
  // itself instead of trailing after the Units list.
  if ((hasUnits && curriculumState.status === 'ready') || (!hasUnits && curriculumState.status === 'none')) {
    curriculumTile.appendChild(curriculumActionButton);
  }

  bento.appendChild(curriculumTile);

  // ---- Units (-> Concepts) tile ----
  const unitsTile = document.createElement('div');
  unitsTile.className = 'learning-management__bento-tile learning-management__bento-tile--units';

  if (hasUnits) {
    // Units are shown whenever they genuinely exist — regardless of
    // Curriculum status — matching how Assessments already read this
    // exact same tree with no curriculum gating at all. This same
    // function also renders a selected Unit's own Concepts in place
    // of the Units list (see its own header comment) — that drill-in
    // is exactly the "-> Concepts" half of this tile, reusing the
    // existing Concept workflow verbatim, never a new one.
    unitsTile.appendChild(renderUnitsOrParts(subject, selectedPartName, selectedUnitId, addingUnit, addingConcept, unitCreateState, conceptCreateState, pendingLearningHubExperience, editingUnitId, unitRenameState, handlers));
  } else {
    const unitsTileLabel = document.createElement('p');
    unitsTileLabel.className = 'learning-management__bento-tile-label';
    unitsTileLabel.textContent = 'Units';
    unitsTile.appendChild(unitsTileLabel);
    unitsTile.appendChild(createEmptyStateElement({ message: 'No units yet.', compact: true }));
    unitsTile.appendChild(renderAddUnitControl(addingUnit, unitCreateState, handlers));
  }

  bento.appendChild(unitsTile);

  return section;
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
  // Tonal-neutral, not btn--secondary — this sits right under "+ Add
  // Concept" (a core action) while being explicitly labelled an
  // OPTIONAL shortcut; btn--secondary's solid cyan fill read as equally
  // weighted as Add Concept's own btn--secondary fill, flattening a
  // hierarchy the heading above already states in words (caught during
  // the 2026-10-01 UI consistency audit — see docs/
  // classmate_ui_consistency_guidelines.md Section 9, "do not flatten
  // this hierarchy by making every button the same weight").
  associateButton.className = 'btn btn--tonal btn--tonal-neutral';
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
 * Shared inline rename control for the Subject heading
 * (renderSubjectStep(), triggered from that Subject's own "⋮" ->
 * "Edit Subject") and, separately, for a single Unit row in the Units
 * list (renderUnitsOrParts(), triggered from that row's own "⋮" ->
 * "Edit Unit") — swaps the heading/row for this: a text input
 * pre-filled with the current title, with Save/Cancel; Enter commits,
 * Escape cancels. Mirrors ui/views/LearningRecordView.js's own
 * createRenameInput() interaction *behavior* only (not its markup/CSS
 * — that's a different screen with its own visual language); no
 * window.prompt() anywhere — the "⋮" menu only ever chooses which
 * action to take, never collects the new title itself.
 *
 * `state` is this rename's own {status:'saving'|'failed', title} —
 * see editingSubjectTitle/subjectRenameState and
 * editingUnitId/unitRenameState in renderLearningManagementView().
 * A failed save leaves the title already changed in memory (nothing
 * here reverts it) and simply relabels Save as "Retry" — clicking it
 * re-invokes onSave with whatever the input currently shows, the same
 * "harmless to re-run" shape renameSubject()/renameUnit() themselves
 * already have (they just overwrite `title` in place).
 */
function renderInlineRenameControl({ currentValue, state, inputClassName, onSave, onCancel }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'learning-management__rename-control';

  const isSaving = state?.status === 'saving';
  const isFailed = state?.status === 'failed';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = inputClassName || 'learning-management__rename-input';
  // Re-populated from state (not just currentValue) once a save has
  // been attempted — same "Retry shows exactly what was last
  // submitted" reasoning as renderAddUnitControl()'s own input above.
  input.value = state ? state.title : currentValue;
  input.disabled = isSaving;

  const commit = () => {
    const title = input.value.trim();
    if (!title) return;
    onSave(title);
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  });
  wrapper.appendChild(input);
  // Focus once mounted, so clicking "Edit" drops the teacher straight
  // into typing rather than requiring a second click into the input.
  queueMicrotask(() => input.focus());

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'btn btn--primary learning-management__rename-save';
  saveButton.disabled = isSaving;
  saveButton.textContent = isSaving ? 'Saving…' : isFailed ? 'Retry' : 'Save';
  saveButton.addEventListener('click', commit);
  wrapper.appendChild(saveButton);

  if (isFailed) {
    const errorNote = document.createElement('p');
    errorNote.className = 'learning-management__inline-error';
    errorNote.textContent = 'Save failed. Check your connection and try again.';
    wrapper.appendChild(errorNote);
  } else {
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn--text learning-management__rename-cancel';
    cancelButton.disabled = isSaving;
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', onCancel);
    wrapper.appendChild(cancelButton);
  }

  return wrapper;
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
function renderAddUnitControl(addingUnit, unitCreateState, handlers) {
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

  const isSaving = unitCreateState?.status === 'saving';
  const isFailed = unitCreateState?.status === 'failed';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Unit title';
  // Re-populated from state (not just left blank) so a failed save's
  // Retry click re-reads the exact same title it already created —
  // handlers.onCreateUnit() itself never re-creates the Unit once
  // unitCreateState is set, but it still needs a non-empty `title` to
  // pass through the "if (!title) return;" guard below.
  if (unitCreateState) input.value = unitCreateState.title;
  input.disabled = isSaving;
  wrapper.appendChild(input);

  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'btn btn--primary';
  createButton.disabled = isSaving;
  createButton.textContent = isSaving ? 'Creating…' : isFailed ? 'Retry' : 'Create';
  createButton.addEventListener('click', () => {
    const title = input.value.trim();
    if (!title) return;
    handlers.onCreateUnit(title);
  });
  wrapper.appendChild(createButton);

  if (isFailed) {
    const errorNote = document.createElement('p');
    errorNote.className = 'learning-management__inline-error';
    errorNote.textContent = 'Save failed. Check your connection and try again.';
    wrapper.appendChild(errorNote);
  } else {
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn--text';
    cancelButton.textContent = 'Cancel';
    cancelButton.disabled = isSaving;
    cancelButton.addEventListener('click', handlers.onCancelAddUnit);
    wrapper.appendChild(cancelButton);
  }

  return wrapper;
}

/**
 * The "+ Add Concept" action/inline form — mirrors renderAddUnitControl()
 * exactly, reusing the existing learningRecordTeacherService.createConcept()
 * directly.
 */
function renderAddConceptControl(unitId, addingConcept, conceptCreateState, handlers) {
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

  const isSaving = conceptCreateState?.status === 'saving';
  const isFailed = conceptCreateState?.status === 'failed';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Concept title';
  // See renderAddUnitControl()'s own comment on this same pattern —
  // re-populated from state so Retry re-submits the same title
  // without creating a second Concept.
  if (conceptCreateState) input.value = conceptCreateState.title;
  input.disabled = isSaving;
  wrapper.appendChild(input);

  const createButton = document.createElement('button');
  createButton.type = 'button';
  createButton.className = 'btn btn--primary';
  createButton.disabled = isSaving;
  createButton.textContent = isSaving ? 'Creating…' : isFailed ? 'Retry' : 'Create';
  createButton.addEventListener('click', () => {
    const title = input.value.trim();
    if (!title) return;
    handlers.onCreateConcept(unitId, title);
  });
  wrapper.appendChild(createButton);

  if (isFailed) {
    const errorNote = document.createElement('p');
    errorNote.className = 'learning-management__inline-error';
    errorNote.textContent = 'Save failed. Check your connection and try again.';
    wrapper.appendChild(errorNote);
  } else {
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'btn btn--text';
    cancelButton.textContent = 'Cancel';
    cancelButton.disabled = isSaving;
    cancelButton.addEventListener('click', handlers.onCancelAddConcept);
    wrapper.appendChild(cancelButton);
  }

  return wrapper;
}

/**
 * The Parts choice itself (History/Geography/Civics/Economics, or
 * whatever a Subject's own Units happen to be grouped by) — a small,
 * icon-based Bento grid, not another `createNavigationRow()` strip.
 * Mirrors ui/components/ExistingSubjectsList.js's own card composition
 * (icon badge + arrow + label) deliberately, since the product goal is
 * for a Parts choice to visually read as "the same kind of decision" as
 * the Subject choice one level up — but kept as its own local markup,
 * not a shared component, for the exact reason that file's own header
 * comment gives for not reusing NavigationRow itself: this is scoped to
 * one screen, not a platform-wide primitive. Only the glyph varies per
 * Part (config/partIconConfig.js); colour stays the one restrained
 * 'teacher' tint every such choice already uses (see
 * docs/classmate_ui_consistency_guidelines.md Section 11).
 */
function renderPartsGrid(distinctPartNames, handlers) {
  const grid = document.createElement('div');
  grid.className = 'learning-management__parts-grid';

  distinctPartNames.forEach((partName) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'learning-management__part-card';
    card.setAttribute('aria-label', partName);
    card.addEventListener('click', () => handlers.onChoosePart(partName));

    const top = document.createElement('div');
    top.className = 'learning-management__part-card-top';
    top.appendChild(createIconBadge(getPartIconName(partName), 'teacher', { size: 40 }));

    const arrow = document.createElement('span');
    arrow.className = 'learning-management__part-card-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.appendChild(createIcon('arrow-right', { size: 14 }));
    top.appendChild(arrow);
    card.appendChild(top);

    const label = document.createElement('span');
    label.className = 'learning-management__part-card-label';
    label.textContent = partName;
    card.appendChild(label);

    grid.appendChild(card);
  });

  return grid;
}

function renderUnitsOrParts(subject, selectedPartName, selectedUnitId, addingUnit, addingConcept, unitCreateState, conceptCreateState, pendingLearningHubExperience, editingUnitId, unitRenameState, handlers) {
  const wrapper = document.createElement('div');

  const distinctPartNames = [...new Set(subject.units.map((unit) => unit.partName).filter(Boolean))];

  if (distinctPartNames.length > 0 && selectedPartName === null) {
    const partHeading = document.createElement('p');
    partHeading.className = 'learning-management__intro';
    partHeading.textContent = 'Parts';
    wrapper.appendChild(partHeading);

    wrapper.appendChild(renderPartsGrid(distinctPartNames, handlers));
    return wrapper;
  }

  const unitsToShow = selectedPartName ? subject.units.filter((unit) => unit.partName === selectedPartName) : subject.units;

  // A Unit is selected — show that Unit's own Concepts instead of the
  // Units list, the one further drill-down level Phase 1.5 restores.
  // Concepts render the same NavigationRow way Units do just below;
  // selecting one hands off to the Concept Workspace entirely (see
  // handlers.onSelectConcept in renderLearningManagementView, and
  // renderView's own "mode === 'concept'" branch) rather than
  // anything being rendered further here. No repeat of the Unit's own
  // title/rename affordance lives on this page anymore — per explicit
  // product decision, a Unit's rename now happens entirely in place on
  // that Unit's own row in the Units list below (via that row's "⋮" ->
  // "Edit Unit"), never by navigating in here first.
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
      wrapper.appendChild(createEmptyStateElement({ message: "What do you want your students to understand in this unit?", compact: true }));
      wrapper.appendChild(renderAddConceptControl(selectedUnit.id, addingConcept, conceptCreateState, handlers));
    } else {
      const conceptList = document.createElement('div');
      conceptList.className = 'learning-management__subject-card-list';
      selectedUnit.concepts.forEach((concept) => {
        conceptList.appendChild(createNavigationRow({ label: concept.title, onClick: () => handlers.onSelectConcept(concept) }));
      });
      wrapper.appendChild(conceptList);
      wrapper.appendChild(renderAddConceptControl(selectedUnit.id, addingConcept, conceptCreateState, handlers));
    }

    // Learning Hub is now a dormant plugin (see
    // ui/components/LearningHubPanel.js), never a permanent page
    // section — per explicit product decision, this trigger is the
    // ENTIRE Learning Hub resource-discovery footprint on the Unit
    // page when the panel is closed. Docked toward the right edge via
    // its own `margin-left: auto` (css/styles.css's own
    // .learning-management__learning-hub-trigger) — NOT `align-self`,
    // since this button's real parent here is this function's own
    // plain, unclassed `wrapper` div, never actually a flex container
    // (a prior version of this comment claimed otherwise and the rule
    // used align-self:flex-end, which was consequently a silent no-op
    // — caught during the 2026-10-01 UI consistency audit) — so it
    // reads as a plugin launcher, not another stacked ClassMate action
    // beneath "+ Add Concept".
    const learningHubTrigger = document.createElement('button');
    learningHubTrigger.type = 'button';
    learningHubTrigger.className = 'learning-management__learning-hub-trigger';
    learningHubTrigger.setAttribute('aria-label', 'Open Learning Hub');
    const triggerIcon = document.createElement('span');
    triggerIcon.setAttribute('aria-hidden', 'true');
    triggerIcon.textContent = '\ud83d\udcda';
    const triggerLabel = document.createElement('span');
    triggerLabel.textContent = 'Learning Hub';
    learningHubTrigger.append(triggerIcon, ' ', triggerLabel);
    learningHubTrigger.addEventListener('click', () => {
      handlers.onOpenLearningHubPanel(selectedUnit);
    });
    wrapper.appendChild(learningHubTrigger);

    // The Pack mechanism (renderUnitPackControl(), completely
    // unmodified) lives HERE, on the Unit page itself — never inside
    // the Learning Hub drawer. Given its own heading + divider,
    // deliberately separated from the trigger above so it never
    // reads as "another Learning Hub launcher" — a Pack is a
    // Unit-level shortcut, a genuinely different concern from the
    // plugin's own resource-discovery workflow.
    const packDivider = document.createElement('hr');
    packDivider.className = 'learning-management__subject-divider';
    wrapper.appendChild(packDivider);

    const packHeading = document.createElement('p');
    packHeading.className = 'learning-management__intro';
    packHeading.textContent = 'Unit shortcut (optional)';
    wrapper.appendChild(packHeading);

    const packSection = document.createElement('div');
    packSection.className = 'learning-management__learning-hub-pack-section';
    renderUnitPackControl(packSection, selectedUnit, handlers);
    wrapper.appendChild(packSection);

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
    // A Unit currently being renamed (editingUnitId === unit.id, set by
    // this row's own "\u22ee" -> "Edit Unit") swaps its whole row for the
    // shared inline rename control in place \u2014 never a navigation into
    // that Unit's own Concepts page, and never a plain NavigationRow
    // for that one row while the edit is in progress.
    if (editingUnitId === unit.id) {
      list.appendChild(
        renderInlineRenameControl({
          currentValue: unit.title,
          state: unitRenameState,
          inputClassName: 'learning-management__rename-input',
          onSave: (newTitle) => handlers.onRenameUnit(unit.id, newTitle),
          onCancel: handlers.onCancelRenameUnit,
        })
      );
      return;
    }
    list.appendChild(
      createCardRowWithOverflowMenu({
        label,
        onClick: () => handlers.onSelectUnit(unit.id),
        actions: [
          { label: 'Edit Unit', onClick: () => handlers.onStartRenameUnit(unit.id) },
          { label: 'Delete Unit', onClick: () => handlers.onRemoveUnit(subject.id, unit.id), danger: true },
        ],
        ariaLabel: `${label} options`,
      })
    );
  });
  wrapper.appendChild(list);
  wrapper.appendChild(renderAddUnitControl(addingUnit, unitCreateState, handlers));

  return wrapper;
}
