/**
 * ui/views/DashboardView.js
 *
 * The Classroom Dashboard — the default landing page for a classroom.
 *
 * Information Architecture: the Dashboard now emphasizes daily
 * teaching only, as two equally-weighted primary cards, plus two
 * lower-tier "setup" cards — replacing every previous Dashboard entry
 * point (the header used to carry "Start Class Mode" as its Primary
 * Action and, across earlier milestones, "📚 Manage Lessons,"
 * "✏️ Create Lesson," a "Continue Working" card, and later a
 * standalone "⚙️ Curriculum Management" card as its own peer
 * destination — all of that collapses into this shape now):
 *
 *   ▶ Class Mode             — running today's class (onStartClassMode).
 *   👥 Classroom Management  — students, groups, daily operations.
 *   📚 Learning Management   — preparing learning materials and
 *     supporting students. See ui/views/LearningManagementView.js.
 *   📋 Assessment Management — recording exam/test marks.
 *
 * Curriculum Management (see ui/views/CurriculumManagementView.js) is
 * deliberately *not* one of these cards anymore — per explicit product
 * decision, editing a curriculum's own structure is administrative
 * infrastructure that supports Learning, not a destination a teacher
 * reaches for daily, and giving it equal dashboard weight against
 * Class Mode/Learning/Assessments misrepresented how rarely it's
 * actually used (setup and occasional maintenance, not every-day
 * work). It's still the exact same screen, completely unredesigned —
 * only *how a teacher reaches it* changed: contextually, from within
 * a Subject on the Learning screen (see
 * ui/views/LearningManagementView.js's own renderSubjectStep(), which
 * shows the Subject's currently-assigned curriculum directly, with a
 * secondary "Change" action opening this same Hub). See
 * openCurriculumManagement() below for the one piece of supporting
 * plumbing this needed: it now accepts an optional custom return
 * target, so reaching the Hub from a Subject returns to that same
 * Subject afterward, not out to the Dashboard — the thing that makes
 * this feel like a contextual management action rather than a
 * separate application.
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
import { createIcon } from '../components/Icon.js';
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
import { renderClassroomManagementView } from './ClassroomManagementView.js';
import { renderCurriculumManagementView } from './CurriculumManagementView.js';
import { renderAssessmentManagementView } from './AssessmentManagementView.js';
import { renderAssignCurriculumPromptView } from './AssignCurriculumPromptView.js';
import * as curriculumLibraryService from '../../services/curriculumLibraryService.js';
import { logViewMounted } from '../../services/persistenceLogger.js';

export function renderDashboardView(container, props) {
  logViewMounted('DashboardView');

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

  function openLearningManagement() {
    renderLearningManagementView(container, {
      classrooms: workspaceService.getState().classrooms,
      onBack: () => renderDashboardView(container, props),
      onOpenCurriculumManagement: openCurriculumManagement,
    });
  }

  /**
   * Opens the Curriculum Hub — unchanged itself (see
   * ui/views/CurriculumManagementView.js's own "Do not redesign the
   * Curriculum Hub" scope). What changed is *how a caller returns
   * from it*: `onBack` defaults to the Dashboard, but a caller can
   * supply its own return target instead — specifically,
   * ui/views/LearningManagementView.js's own Subject screen now
   * reaches this same function directly (see the "Change" curriculum
   * action there) and needs "Back" to land on that same Subject, not
   * jump all the way out to the Dashboard. That's the one genuine
   * piece of new wiring this redesign needed; the Hub itself is
   * completely untouched.
   */
  function openCurriculumManagement({ onBack: customOnBack } = {}) {
    renderCurriculumManagementView(container, {
      onBack: customOnBack || (() => renderDashboardView(container, props)),
      onOpenLearningManagement: openLearningManagement,
    });
  }

  function openAssessmentManagement() {
    renderAssessmentManagementView(container, {
      classroom,
      onBack: () => renderDashboardView(container, props),
    });
  }

  function openClassroomManagement() {
    renderClassroomManagementView(container, {
      classroom,
      onBack: () => renderDashboardView(container, props),
      onSelectStudent,
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
      onOpenSettingsStudents: openClassroomManagement,
      onOpenStudentAccess,
      onOpenSettingsGroups: openClassroomManagement,
      onOpenSettingsNotebooks,
    }, openLearningManagement, needsCurriculumAssignment ? openAssignCurriculumPrompt : null);
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
      onOpenClassroomManagement: openClassroomManagement,
      onOpenLearningManagement: openLearningManagement,
      onOpenAssessmentManagement: openAssessmentManagement,
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
    onOpenSettingsStudents: openClassroomManagement,
    onOpenStudentAccess,
    onOpenSettingsGroups: openClassroomManagement,
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
  if (hasRealGroups) classroomSectionChildren.push(createGroupsWidgetElement({ classroom, onOpenGroups: openClassroomManagement }));
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

/**
 * Dashboard module metadata — one declarative entry per module,
 * describing what it is (id, title, icon, description) and how
 * central it is to a teacher's actual daily workflow (tier), not how
 * it should look. All visual treatment (fill, border, icon color,
 * elevation, hover behavior) is derived from `tier` alone, in CSS
 * (see .primary-module-card--primary/--daily/--setup) — nothing here
 * or in createPrimaryModuleCard() hardcodes styling by module name.
 * Adding a future module means adding one entry to this array, not
 * writing new per-module styling logic.
 *
 * Tiers, matching how often a teacher actually reaches for each:
 *   - primary: used multiple times every single teaching day (Class
 *     Mode) — the one filled, strongest-elevation card.
 *   - daily: used frequently while preparing or managing classes
 *     (Classroom, Learning) — white surface, accent border and icon.
 *   - setup: occasional administrative workspace (Curriculum,
 *     Assessments) — white surface, neutral border, muted icon.
 */
const DASHBOARD_MODULES = [
  {
    id: 'classMode',
    title: 'Class Mode',
    icon: 'play',
    description: 'Run today\u2019s class',
    tier: 'primary',
    // No accentColor: this card fills with the teacher's own chosen
    // brand accent (--color-primary-deep), not a fixed module color.
  },
  {
    id: 'classroom',
    title: 'Classroom',
    icon: 'users',
    description: 'Students, groups, and daily operations',
    tier: 'daily',
    accentColor: '#0F9E8E', // reuses ICON_CATEGORIES.groups (Icon.js) — Classroom owns Students and Groups, the exact same "groups" concept that color already represents elsewhere in the app
  },
  {
    id: 'learning',
    title: 'Learning',
    icon: 'book-open',
    description: 'Prepare lessons, support students',
    tier: 'daily',
    accentColor: '#6D5AC4', // reuses ICON_CATEGORIES.notebook (Icon.js) — Learning owns Notebook configuration and Subjects
  },
  {
    id: 'assessments',
    title: 'Assessments',
    icon: 'clipboard-list',
    description: 'Record exam and test marks',
    tier: 'setup',
    accentColor: '#5B6B8C', // a new, restrained slate-indigo, verified at 5.35:1 against white — formal without reading as plain neutral gray
  },
];

function renderPrimaryModulesSection({ onStartClassMode, onOpenClassroomManagement, onOpenLearningManagement, onOpenAssessmentManagement }) {
  const section = document.createElement('div');
  section.className = 'primary-modules';

  // The one place runtime behavior meets static metadata — a plain
  // id -> handler lookup, not a chain of per-module conditionals.
  const handlersById = {
    classMode: onStartClassMode,
    classroom: onOpenClassroomManagement,
    learning: onOpenLearningManagement,
    assessments: onOpenAssessmentManagement,
  };

  DASHBOARD_MODULES.forEach((module) => {
    const onClick = handlersById[module.id];
    if (!onClick) return;
    section.appendChild(
      createPrimaryModuleCard({
        icon: module.icon,
        label: module.title,
        description: module.description,
        onClick,
        tier: module.tier,
        accentColor: module.accentColor,
      })
    );
  });

  return section;
}

/**
 * Three tiers, by actual frequency of teacher use — per explicit
 * product decision. Class Mode is used multiple times every teaching
 * day; Classroom and Learning are opened frequently while preparing
 * or managing classes; Curriculum and Assessments are occasional
 * administrative workspaces. Which tier a module belongs to is
 * declared once, in DASHBOARD_MODULES above — every visual
 * consequence of that tier (fill, border, icon color, elevation,
 * hover behavior) lives entirely in CSS
 * (.primary-module-card--primary/--daily/--setup), never hardcoded by
 * module name here.
 *
 *   - primary (Class Mode): filled, solid accent color, strongest
 *     elevation — the one daily, time-critical action.
 *   - daily (Classroom, Learning): white surface, accent-colored
 *     border and icon — frequently used, clearly present, but not
 *     competing with Class Mode's own filled treatment.
 *   - setup (Curriculum, Assessments): white surface, neutral border,
 *     muted gray icon — occasional administrative tasks that should
 *     read as quieter without looking disabled. Per explicit
 *     correction, typography (size and weight) is identical across
 *     every tier — hierarchy comes only from fill/border/icon
 *     color/elevation, never from a lighter font weight.
 *
 * Icons are real SVGs from ui/components/Icon.js, not emoji or text
 * characters — these are functional, wayfinding icons (which screen
 * does this lead to), exactly the case ClassMate's own icon design
 * guide (docs/icon-design-guide.md) already says belongs to the
 * Lucide icon system, not emoji (emoji stay reserved for celebration/
 * recognition/emotion, as documented there).
 */
function createPrimaryModuleCard({ icon, label, description, onClick, tier, accentColor }) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `primary-module-card primary-module-card--${tier}`;
  // A single custom property, set once here, that every tier's CSS
  // (--daily, --setup) reads for icon color, border color, and hover
  // treatment — the module's own identity color flows through one
  // channel rather than being hardcoded per module name in CSS. Class
  // Mode (tier "primary") has no accentColor at all; its own CSS rule
  // uses --color-primary-deep directly instead, so this is simply
  // never set for that card.
  if (accentColor) card.style.setProperty('--module-accent', accentColor);

  const iconEl = createIcon(icon, { size: 28, strokeWidth: 1.75, className: 'primary-module-card__icon' });
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
function renderPreRosterWelcome(container, classroom, assistantCallbacks, onOpenLearningManagement, onOpenAssignCurriculumPrompt) {
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

  if (onOpenLearningManagement) {
    const actionsRow = document.createElement('div');
    actionsRow.className = 'pre-roster-welcome__actions-row';

    const learningManagementButton = document.createElement('button');
    learningManagementButton.type = 'button';
    learningManagementButton.className = 'btn btn--primary pre-roster-welcome__curriculum-button';
    learningManagementButton.appendChild(createIcon('book-open', { size: 16 }));
    learningManagementButton.append('Learning');
    learningManagementButton.addEventListener('click', onOpenLearningManagement);
    actionsRow.appendChild(learningManagementButton);

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

