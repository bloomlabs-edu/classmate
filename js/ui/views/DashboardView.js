/**
 * ui/views/DashboardView.js
 *
 * The Classroom Dashboard — the default landing page for a classroom.
 *
 * Information Architecture milestone: a teacher should immediately see
 * that ClassMate has three separate responsibilities, as three
 * equally-weighted cards, replacing every previous Dashboard entry
 * point (the header used to carry "Start Class Mode" as its Primary
 * Action and, across earlier milestones, "📚 Manage Lessons,"
 * "✏️ Create Lesson," a "Continue Working" card, and later a single
 * "📚 Curriculum" button as Secondary Content — all of that collapses
 * into these three cards now):
 *
 *   ▶ Classroom Management  — running today's class. For now, this is
 *     exactly the existing Class Mode workflow (onStartClassMode),
 *     unchanged — just presented as one of three cards instead of a
 *     standalone header button.
 *   📚 Learning Management  — preparing learning materials and
 *     supporting students. See ui/views/LearningManagementView.js —
 *     this absorbs what the old "📚 Curriculum" button did (Manage
 *     Lessons and the recent-resource shortcut both still exist,
 *     reached from inside it).
 *   ⚙️ Curriculum Management — configuring the curriculum structure
 *     itself (install/upload/edit packs, assign a curriculum to a
 *     class). Used occasionally, not part of daily teaching — see
 *     ui/views/CurriculumManagementView.js. Also reachable from
 *     Teacher Home (ui/views/HomeView.js), since a curriculum pack
 *     isn't classroom-specific data; this Dashboard card is a second,
 *     equally-convenient door to the exact same screen.
 *
 * `canAccessCurriculumManagement` (see renderPrimaryModulesSection())
 * is the intentional hook for a future permission system — hardcoded
 * `true` for every teacher today, by explicit instruction not to
 * implement real permissions yet. When that system exists, computing
 * this one boolean (teacher vs. school admin) is the entire change
 * needed to show or hide this card; nothing else here should need to
 * change.
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
 */

import * as workspaceService from '../../services/workspaceService.js';
import * as pendingTaskService from '../../services/pendingTaskService.js';
import { renderTeachingAssistant } from '../components/TeachingAssistant.js';
import { getDisplayName, getDisplaySubtitle } from '../../services/classroomService.js';
import { createClassroomHeaderElement } from '../components/ClassroomHeader.js';
import { createRecognitionWidgetElement } from '../components/RecognitionWidget.js';
import { createWeeklySnapshotWidgetElement } from '../components/WeeklySnapshotWidget.js';
import { createPendingTasksWidgetElement } from '../components/PendingTasksWidget.js';
import { createSubjectsWidgetElement } from '../components/SubjectsWidget.js';
import { createGroupsWidgetElement } from '../components/GroupsWidget.js';
import { createTeachingSectionElement } from '../components/TeachingSection.js';
import { createClassroomSectionElement } from '../components/ClassroomSection.js';
import { renderLearningManagementView } from './LearningManagementView.js';
import { renderCurriculumManagementView } from './CurriculumManagementView.js';
import { renderAssignCurriculumPromptView } from './AssignCurriculumPromptView.js';
import * as curriculumLibraryService from '../../services/curriculumLibraryService.js';

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
    onOpenRecognition,
    onOpenActivities,
    onSelectPendingTask,
    onSelectStudent,
  } = props;

  container.innerHTML = '';

  // The future permission hook — see this file's own header comment.
  // Always true today; a future permission system replaces this one
  // line with a real check and nothing else here needs to change.
  const canAccessCurriculumManagement = true;

  function openLearningManagement() {
    renderLearningManagementView(container, {
      classrooms: workspaceService.getState().classrooms,
      onBack: () => renderDashboardView(container, props),
    });
  }

  function openCurriculumManagement() {
    renderCurriculumManagementView(container, {
      onBack: () => renderDashboardView(container, props),
      onOpenLearningManagement: openLearningManagement,
    });
  }

  // The one-time prompt for a classroom that predates Curriculum being
  // a required field at creation (see
  // ui/components/NewClassroomModal.js, ui/views/AssignCurriculumPromptView.js's
  // own header comment). Gated purely on whether an assignment exists
  // — once one does, this function and the banner that calls it simply
  // never render again for this classroom.
  const needsCurriculumAssignment = !curriculumLibraryService.getCurriculumAssignment(classroom);

  function openAssignCurriculumPrompt() {
    renderAssignCurriculumPromptView(container, {
      classroom,
      onBack: () => renderDashboardView(container, props),
    });
  }

  // Every teaching-time feature (Start Class Mode, Recognition,
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
    }, openLearningManagement, canAccessCurriculumManagement ? openCurriculumManagement : null, needsCurriculumAssignment ? openAssignCurriculumPrompt : null);
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

  wrapper.appendChild(createClassroomHeaderElement({ classroomContext }));

  if (needsCurriculumAssignment) {
    wrapper.appendChild(createAssignCurriculumBanner(openAssignCurriculumPrompt));
  }

  wrapper.appendChild(
    renderPrimaryModulesSection({
      onStartClassMode,
      onOpenLearningManagement: openLearningManagement,
      onOpenCurriculumManagement: canAccessCurriculumManagement ? openCurriculumManagement : null,
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

  if (hasSubjectsConfigured) {
    content.appendChild(
      createTeachingSectionElement({
        children: [createSubjectsWidgetElement({ classroom, onOpenNotebookTracker }), createActivitiesLink(onOpenActivities)],
      })
    );
  }

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
}

/**
 * The three equally-weighted cards that are now the Dashboard's only
 * entry points into anything beyond what's already visible on this
 * page — see this file's own header comment for the full reasoning
 * and what each one replaces.
 */
/**
 * The one-time nudge for a classroom created before Curriculum was a
 * required field — see ui/views/AssignCurriculumPromptView.js's own
 * header comment. Deliberately its own small, unmissable banner (not
 * folded into the Teaching Assistant's recommendation engine) since
 * it's a one-off migration prompt, not an ongoing "what should I do
 * next" recommendation.
 */
function createAssignCurriculumBanner(onOpen) {
  const banner = document.createElement('div');
  banner.className = 'assign-curriculum-banner';

  const text = document.createElement('span');
  text.className = 'assign-curriculum-banner__text';
  text.textContent = 'This class doesn\u2019t have a curriculum yet.';
  banner.appendChild(text);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--primary assign-curriculum-banner__button';
  button.textContent = 'Assign Curriculum';
  button.addEventListener('click', onOpen);
  banner.appendChild(button);

  return banner;
}

function renderPrimaryModulesSection({ onStartClassMode, onOpenLearningManagement, onOpenCurriculumManagement }) {
  const section = document.createElement('div');
  section.className = 'primary-modules';

  section.appendChild(
    createPrimaryModuleCard({
      icon: '\u25b6',
      label: 'Classroom Management',
      description: 'Run today\u2019s class',
      onClick: onStartClassMode,
    })
  );

  section.appendChild(
    createPrimaryModuleCard({
      icon: '\ud83d\udcda',
      label: 'Learning Management',
      description: 'Prepare lessons, support students',
      onClick: onOpenLearningManagement,
    })
  );

  if (onOpenCurriculumManagement) {
    section.appendChild(
      createPrimaryModuleCard({
        icon: '\u2699\ufe0f',
        label: 'Curriculum Management',
        description: 'Install, upload, assign curriculum',
        onClick: onOpenCurriculumManagement,
        muted: true, // "used occasionally" — see this file's header comment on why the entry-point *card* still matches the other two in size, just not in color/emphasis
      })
    );
  }

  return section;
}

function createPrimaryModuleCard({ icon, label, description, onClick, muted = false }) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'primary-module-card' + (muted ? ' primary-module-card--muted' : '');

  const iconEl = document.createElement('span');
  iconEl.className = 'primary-module-card__icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;
  card.appendChild(iconEl);

  const labelEl = document.createElement('span');
  labelEl.className = 'primary-module-card__label';
  labelEl.textContent = label;
  card.appendChild(labelEl);

  const descriptionEl = document.createElement('span');
  descriptionEl.className = 'primary-module-card__description';
  descriptionEl.textContent = description;
  card.appendChild(descriptionEl);

  card.addEventListener('click', onClick);
  return card;
}

/**
 * The entire screen shown before a classroom has any students —
 * deliberately nothing but a celebratory heading and whatever
 * ui/components/TeachingAssistant.js decides to render (which, with
 * no students yet, will always be its "add students" recommendation
 * at full-card priority), PLUS two deliberate exceptions: Learning
 * Management and Curriculum Management (see
 * ui/views/LearningManagementView.js,
 * ui/views/CurriculumManagementView.js). Classroom Management (Class
 * Mode) is genuinely a teaching-time feature with nothing to act on
 * without a roster, so it's omitted here, matching every other
 * teaching-time feature suppressed on this screen — Recognition,
 * Groups, Notebook Tracker. Curriculum work is not: building a
 * syllabus (Subjects -> Units -> Concepts) or setting up a curriculum
 * assignment is independent of whether any students have been added
 * yet, and a teacher very plausibly wants to do either *before*
 * importing a roster, not after.
 */
function renderPreRosterWelcome(container, classroom, assistantCallbacks, onOpenLearningManagement, onOpenCurriculumManagement, onOpenAssignCurriculumPrompt) {
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

  if (onOpenAssignCurriculumPrompt) {
    wrapper.appendChild(createAssignCurriculumBanner(onOpenAssignCurriculumPrompt));
  }

  const assistantSlot = document.createElement('div');
  wrapper.appendChild(assistantSlot);

  if (onOpenLearningManagement || onOpenCurriculumManagement) {
    const actionsRow = document.createElement('div');
    actionsRow.className = 'pre-roster-welcome__actions-row';

    if (onOpenLearningManagement) {
      const learningManagementButton = document.createElement('button');
      learningManagementButton.type = 'button';
      learningManagementButton.className = 'btn btn--primary pre-roster-welcome__curriculum-button';
      learningManagementButton.textContent = '\ud83d\udcda Learning Management';
      learningManagementButton.addEventListener('click', onOpenLearningManagement);
      actionsRow.appendChild(learningManagementButton);
    }

    if (onOpenCurriculumManagement) {
      const curriculumManagementButton = document.createElement('button');
      curriculumManagementButton.type = 'button';
      curriculumManagementButton.className = 'btn btn--ghost pre-roster-welcome__curriculum-management-button';
      curriculumManagementButton.textContent = '\u2699\ufe0f Curriculum Management';
      curriculumManagementButton.addEventListener('click', onOpenCurriculumManagement);
      actionsRow.appendChild(curriculumManagementButton);
    }

    wrapper.appendChild(actionsRow);
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

