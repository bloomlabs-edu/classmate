/**
 * ui/views/DashboardView.js
 *
 * The Classroom Dashboard — the default landing page for a classroom.
 *
 * Phase 4 refinement: the two highest-frequency needs — starting Class
 * Mode, and picking up where a notebook was left off — are now in the
 * header itself (ui/components/ClassroomHeader.js's Primary Action and
 * Secondary Content slots), visible with zero scrolling the instant a
 * teacher opens the classroom. Both are *relocated* from their previous
 * mid-page positions, not duplicated — Start Class Mode no longer
 * appears in the Teaching section, and Continue Working no longer
 * appears as its own section further down the page.
 *
 * Structured around the four questions the Dashboard should answer, in
 * order:
 *   1. What should I celebrate?     -> Recognition Wall, Weekly Snapshot
 *   2. What needs my attention?     -> Pending Tasks (now actionable —
 *      each item deep-links straight to the relevant screen)
 *   3. What should I do next?       -> "Teaching" section (Subjects,
 *      Activities — now a real shortcut into the existing Learning
 *      Activities feature, not a placeholder)
 *   4. How is my classroom organized? -> "Classroom" section
 *
 * TeachingSection and ClassroomSection remain lightweight layout
 * wrappers — no data source or service of their own.
 *
 * This view is purely an assembly layer: every widget reuses an
 * existing service or view rather than duplicating functionality.
 * Notebook Tracker, Settings (all its tabs), Learning Activities, and
 * Class Mode are all reached through here, never reimplemented here.
 *
 * Continue Working is still the one piece that loads asynchronously —
 * see services/continueWorkingService.js's getRecentOnce() doc comment
 * for why this is a one-time read rather than a live subscription. The
 * rest of the Dashboard (including the header's Primary Action) renders
 * immediately; only the header's Secondary Content slot fills in once
 * that read resolves.
 */

import * as notebookConfigService from '../../services/notebookConfigService.js';
import * as pendingTaskService from '../../services/pendingTaskService.js';
import * as continueWorkingService from '../../services/continueWorkingService.js';
import { renderTeachingAssistant } from '../components/TeachingAssistant.js';
import { getDisplayName, getDisplaySubtitle } from '../../services/classroomService.js';
import { createClassroomHeaderElement } from '../components/ClassroomHeader.js';
import { createRecognitionWidgetElement } from '../components/RecognitionWidget.js';
import { createWeeklySnapshotWidgetElement } from '../components/WeeklySnapshotWidget.js';
import { createContinueWorkingWidgetElement } from '../components/ContinueWorkingWidget.js';
import { createPendingTasksWidgetElement } from '../components/PendingTasksWidget.js';
import { createSubjectsWidgetElement } from '../components/SubjectsWidget.js';
import { createGroupsWidgetElement } from '../components/GroupsWidget.js';
import { createClassModeWidgetElement } from '../components/ClassModeWidget.js';
import { createTeachingSectionElement } from '../components/TeachingSection.js';
import { createClassroomSectionElement } from '../components/ClassroomSection.js';

export function renderDashboardView(container, props) {
  const {
    classroom,
    currentUser,
    onOpenSettings,
    onOpenSettingsStudents,
    onOpenSettingsGroups,
    onOpenSettingsNotebooks,
    onOpenStudentAccess,
    onOpenNotebookTracker,
    onOpenGroups,
    onStartClassMode,
    onSelectNotebook,
    onOpenRecognition,
    onOpenActivities,
    onOpenLearningRecord,
    onSelectPendingTask,
    onSelectStudent,
  } = props;

  container.innerHTML = '';

  // Every teaching-time feature (Start Class Mode, Continue Working,
  // Recognition Wall, Weekly Snapshot, Groups, Subjects, Reports) is
  // suppressed entirely until the classroom has a usable roster — "a
  // newly created classroom is still in the setup phase, not the
  // teaching phase." This reuses setupStateService.js and
  // TeachingAssistant.js completely unchanged: the "add students"
  // welcome screen below isn't a new, separately-maintained mockup —
  // it's the exact same top recommendation the Assistant already
  // produces when there are no students yet, just rendered as the
  // page's entire content instead of a card sitting above a full
  // dashboard. See this project's CHANGELOG for the full reasoning
  // behind reusing the engine here rather than hand-building a
  // second, parallel "no students yet" screen.
  const hasStudents = classroom.teams.some((team) => team.students.length > 0);

  if (!hasStudents) {
    renderPreRosterWelcome(container, classroom, {
      onOpenSettingsStudents,
      onOpenStudentAccess,
      onOpenSettingsGroups,
      onOpenSettingsNotebooks,
    }, onOpenLearningRecord);
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'dashboard-view';

  const classroomContext = document.createElement('div');
  classroomContext.className = 'classroom-hero';

  const greeting = document.createElement('p');
  greeting.className = 'classroom-hero__greeting';
  greeting.textContent = `Welcome back, ${getFirstName(currentUser?.displayName)}`;
  classroomContext.appendChild(greeting);

  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = getDisplayName(classroom);
  classroomContext.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'tracker-header__subtitle';
  subtitle.textContent = getDisplaySubtitle(classroom);
  classroomContext.appendChild(subtitle);

  // Deliberately timeless — a sense of entering a classroom, not a
  // dashboard summary. No live stats or pending counts here; those
  // already live in their own widgets below. `classroom.motto` doesn't
  // exist as a field yet (setting one is scoped to a future Classroom
  // Culture phase — banner, motto, color, theme, mascot) — this slot
  // is forward-compatible for when that phase adds it, but renders
  // nothing until then.
  if (classroom.motto) {
    const motto = document.createElement('p');
    motto.className = 'classroom-hero__motto';
    motto.textContent = classroom.motto;
    classroomContext.appendChild(motto);
  }

  const secondaryContentSlot = document.createElement('div');

  wrapper.appendChild(
    createClassroomHeaderElement({
      classroomContext,
      primaryAction: createClassModeWidgetElement({ onStartClassMode }),
      secondaryContent: secondaryContentSlot,
    })
  );

  // The Teaching Assistant is entirely self-contained — see
  // ui/components/TeachingAssistant.js. The dashboard has zero
  // awareness of setup state, recommendations, or priorities; it just
  // gives this component a mount point above its own single, always-
  // built content below. Removing this call entirely would leave the
  // rest of the dashboard completely unaffected.
  const assistantSlot = document.createElement('div');
  wrapper.appendChild(assistantSlot);
  renderTeachingAssistant(assistantSlot, {
    classroom,
    onOpenSettingsStudents,
    onOpenStudentAccess,
    onOpenSettingsGroups,
    onOpenSettingsNotebooks,
    onDismiss: () => renderDashboardView(container, props),
  });

  const content = document.createElement('div');
  content.className = 'dashboard-view__content';

  // Every widget below is gated on whether it actually has something
  // meaningful to show — not rendered unconditionally with an
  // explanatory empty state. The Teaching Assistant above already
  // owns "what should the teacher do next"; this content area is
  // reserved for real information about the classroom, and simply
  // doesn't exist on screen until there's real information to show.
  // See this project's CHANGELOG for the reasoning: an earlier version
  // of this file rendered every widget unconditionally, which meant a
  // teacher who'd just added their first student saw five empty
  // widgets and an explanatory placeholder in each — exactly the
  // "dashboard appearing too early" problem this redesign corrects.
  const allStudents = classroom.teams.flatMap((team) => team.students);
  const hasAnyRecognition = allStudents.some((student) => (student.badges || []).length > 0);
  const hasAnyScoreActivity = allStudents.some((student) => student.score !== 0 || (student.history || []).length > 0);
  const hasPendingTasks = pendingTaskService.getPendingTasks(classroom).length > 0;
  const hasSubjectsConfigured = (classroom.notebookConfig?.subjects || []).length > 0;
  const hasRealGroups = classroom.teams.some((team) => !team.isUngrouped);

  if (hasAnyRecognition || hasAnyScoreActivity) {
    const celebrateGroup = document.createElement('div');
    celebrateGroup.className = 'dashboard-view__group';
    if (hasAnyRecognition) celebrateGroup.appendChild(createRecognitionWidgetElement({ classroom, onViewAll: onOpenRecognition, onSelectStudent }));
    if (hasAnyScoreActivity) celebrateGroup.appendChild(createWeeklySnapshotWidgetElement({ classroom, onSelectStudent }));
    content.appendChild(celebrateGroup);
  }

  if (hasPendingTasks) {
    content.appendChild(createPendingTasksWidgetElement({ classroom, onSelectTask: onSelectPendingTask }));
  }

  // One "Teaching" section, always shown once there's a roster —
  // Learning Record is always included (independent of Notebook
  // Tracker setup, see docs/LEARNING_RECORD.md); the Subjects widget
  // and Activities link only join it once notebook subjects exist,
  // same condition as before. Built as one section with conditional
  // children, not two separate createTeachingSectionElement() calls,
  // since that would render two identical "Teaching" headings stacked
  // on top of each other.
  const teachingChildren = [];
  if (hasSubjectsConfigured) {
    teachingChildren.push(createSubjectsWidgetElement({ classroom, onOpenNotebookTracker }), createActivitiesLink(onOpenActivities));
  }
  teachingChildren.push(createLearningRecordLink(onOpenLearningRecord));
  content.appendChild(createTeachingSectionElement({ children: teachingChildren }));

  // Student Access and Settings are persistent, evergreen navigation
  // actions, not data widgets summarizing activity — they always
  // belong here once a classroom has students. The Groups widget
  // specifically is the one piece of this section gated on real data,
  // since an empty "no groups yet" card is exactly the placeholder
  // pattern being removed.
  const classroomSectionChildren = [];
  if (hasRealGroups) classroomSectionChildren.push(createGroupsWidgetElement({ classroom, onOpenGroups }));
  classroomSectionChildren.push(createStudentAccessButton(onOpenStudentAccess), createSettingsButton(onOpenSettings));
  content.appendChild(createClassroomSectionElement({ children: classroomSectionChildren }));

  wrapper.appendChild(content);
  container.appendChild(wrapper);

  loadContinueWorking(classroom, currentUser, secondaryContentSlot, onSelectNotebook, onOpenLearningRecord);
}

/**
 * The entire screen shown before a classroom has any students —
 * deliberately nothing but a celebratory heading and whatever
 * ui/components/TeachingAssistant.js decides to render (which, with
 * no students yet, will always be its "add students" recommendation
 * at full-card priority), PLUS one deliberate exception: a Learning
 * Record link (see ui/views/LearningRecordView.js,
 * docs/LEARNING_RECORD.md). Every other Dashboard feature suppressed
 * here — Start Class Mode, Recognition, Groups, Notebook Tracker — is
 * genuinely a teaching-time feature with nothing to act on without a
 * roster. Learning Record is not: building a syllabus (Subjects ->
 * Units -> Concepts) is independent of whether any students have been
 * added yet, and a teacher very plausibly wants to do this *before*
 * importing a roster, not after. Omitting it here would mean the
 * feature has no visible entry point at all on a brand-new classroom
 * — exactly the gap that was reported and is being fixed by this
 * change.
 */
function renderPreRosterWelcome(container, classroom, assistantCallbacks, onOpenLearningRecord) {
  const wrapper = document.createElement('div');
  wrapper.className = 'pre-roster-welcome';

  const emoji = document.createElement('span');
  emoji.className = 'pre-roster-welcome__emoji';
  emoji.setAttribute('aria-hidden', 'true');
  emoji.textContent = '\ud83c\udf89';

  const title = document.createElement('h1');
  title.className = 'pre-roster-welcome__title';
  title.textContent = `Welcome to ${getDisplayName(classroom)}`;

  wrapper.append(emoji, title);

  const assistantSlot = document.createElement('div');
  wrapper.appendChild(assistantSlot);

  if (onOpenLearningRecord) {
    const learningRecordLink = document.createElement('button');
    learningRecordLink.type = 'button';
    learningRecordLink.className = 'btn btn--primary pre-roster-welcome__learning-record-link';
    learningRecordLink.textContent = '+ Add Lesson';
    learningRecordLink.addEventListener('click', onOpenLearningRecord);
    wrapper.appendChild(learningRecordLink);
  }

  container.appendChild(wrapper);

  renderTeachingAssistant(assistantSlot, {
    classroom,
    ...assistantCallbacks,
    // No onDismiss wired here: "Add Students" is the only
    // recommendation the engine can ever return while hasStudents is
    // false (every other rule requires it), and that one is marked
    // non-dismissible in recommendationEngine.js — so there's nothing
    // to reconstruct a dismiss re-render for at this call site. If a
    // future rule ever changes that, this is the first place to
    // revisit.
  });
}

/** Extracts a first name for the Hero's greeting — falls back gracefully if displayName is ever missing. */
function getFirstName(displayName) {
  if (!displayName) return 'there';
  return displayName.trim().split(/\s+/)[0];
}

/**
 * Real shortcut into the existing Learning Activities feature (see
 * services/learningActivityService.js, ui/views/ActivitiesView.js) —
 * upgraded this phase from a disabled "Coming soon" placeholder, since
 * the feature itself was never actually unbuilt; the Dashboard just
 * hadn't grown a direct link to it yet.
 */
function createActivitiesLink(onOpenActivities) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dashboard-widget__chip';
  button.textContent = 'Activities';
  button.addEventListener('click', onOpenActivities);
  return button;
}

/**
 * Shortcut into the Learning Record teacher workflow (see
 * ui/views/LearningRecordView.js, docs/LEARNING_RECORD.md). Its own
 * always-visible Teaching section rather than nested alongside
 * Activities above — see this file's call site for why.
 */
function createLearningRecordLink(onOpenLearningRecord) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dashboard-widget__chip';
  button.textContent = 'Learning Record';
  button.addEventListener('click', onOpenLearningRecord);
  return button;
}

function createStudentAccessButton(onOpenStudentAccess) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--ghost';
  button.textContent = 'Student Access';
  button.addEventListener('click', onOpenStudentAccess);
  return button;
}

function createSettingsButton(onOpenSettings) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--ghost';
  button.textContent = 'Settings';
  button.addEventListener('click', onOpenSettings);
  return button;
}

async function loadContinueWorking(classroom, currentUser, slot, onSelectNotebook, onAddLesson) {
  const allEntries = await continueWorkingService.getRecentOnce(currentUser?.uid);
  const classroomEntries = allEntries.filter((entry) => entry.classroomId === classroom.id);

  const resolvedEntries = classroomEntries.map((entry) => ({
    ...entry,
    subjectName: notebookConfigService.getSubjectById(classroom, entry.subjectId)?.name || 'Unknown subject',
    notebookTypeName: notebookConfigService.getNotebookTypeById(classroom, entry.notebookTypeId)?.name || 'Unknown notebook',
  }));

  slot.innerHTML = '';
  // Always rendered now, regardless of whether there are any recent
  // notebooks — this card carries the "+ Add Lesson" entry point into
  // Learning Record (see ContinueWorkingWidget.js's own doc comment),
  // which must always be visible. Previously this function returned
  // early here whenever a teacher had no recent notebooks at all,
  // which would have hidden that button for exactly the teachers most
  // likely to be new to the app.
  slot.appendChild(createContinueWorkingWidgetElement({ entries: resolvedEntries, onOpenNotebook: onSelectNotebook, onAddLesson }));
}

