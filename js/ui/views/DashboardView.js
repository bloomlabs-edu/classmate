/**
 * ui/views/DashboardView.js
 *
 * The Classroom Dashboard — the default landing page for a classroom.
 *
 * Information Architecture: the Dashboard now emphasizes daily
 * teaching only, as one primary card plus lower-tier "daily"/"setup"
 * cards — replacing every previous Dashboard entry point (the header
 * used to carry "Start Class Mode" as its Primary Action and, across
 * earlier milestones, "📚 Manage Lessons," "✏️ Create Lesson," a
 * "Continue Working" card, and later a standalone "⚙️ Curriculum
 * Management" card as its own peer destination — all of that
 * collapses into this shape now):
 *
 *   ▶ Classroom              — merges the former separate "Class
 *     Mode" and "Classroom" cards into one destination, per explicit
 *     product decision: a teacher shouldn't need to understand the
 *     difference between those two names to know where to go. Opens
 *     ui/views/ClassroomLandingView.js, which offers "Run Today's
 *     Class" (the exact same, unmodified Class Mode experience —
 *     onStartClassMode, still the exact same route) and "Manage
 *     Classroom" (Students / Teams & Groups, both reaching the exact
 *     same, unmodified ClassroomManagementView.js).
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

import { createIcon } from '../components/Icon.js';
import * as pendingTaskService from '../../services/pendingTaskService.js';
import * as goalService from '../../services/goalService.js';
import * as notificationService from '../../services/notificationService.js';
import { NOTIFICATION_CATEGORIES } from '../../config/notificationCategories.js';
import { renderTeachingAssistant } from '../components/TeachingAssistant.js';
import { getDisplayName, getDisplaySubtitle } from '../../services/classroomService.js';
import { createClassroomHeaderElement } from '../components/ClassroomHeader.js';
import { createRecognitionWidgetElement } from '../components/RecognitionWidget.js';
import { createWeeklySnapshotWidgetElement } from '../components/WeeklySnapshotWidget.js';
import { createPendingTasksWidgetElement } from '../components/PendingTasksWidget.js';
import { createOpenWorkWidgetElement } from '../components/OpenWorkWidget.js';
import { createSubjectsWidgetElement } from '../components/SubjectsWidget.js';
import { createGroupsWidgetElement } from '../components/GroupsWidget.js';
import { createTeachingSectionElement } from '../components/TeachingSection.js';
import { createClassroomSectionElement } from '../components/ClassroomSection.js';
import * as router from '../router.js';
import { renderClassroomManagementView } from './ClassroomManagementView.js';
import { renderClassroomLandingView } from './ClassroomLandingView.js';
import { renderSeatingView } from './SeatingView.js';
import { renderCurriculumManagementView } from './CurriculumManagementView.js';
import { logViewMounted } from '../../services/persistenceLogger.js';
import { renderTodaysScheduleWidget } from '../components/TodaysScheduleWidget.js';

export function renderDashboardView(container, props) {
  logViewMounted('DashboardView');

  const {
    classroom,
    currentUser,
    notifications = [],
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
    onNavigateOpenWork,
  } = props;

  container.innerHTML = '';

  function openLearningManagement() {
    router.navigate(`/classroom/${classroom.id}/learning`);
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
    router.navigate(`/classroom/${classroom.id}/assessments`);
  }

  function openGoalManagement() {
    router.navigate(`/classroom/${classroom.id}/goals`);
  }

  function openFeed() {
    router.navigate(`/classroom/${classroom.id}/feed`);
  }

  function openLearningProgrammes() {
    router.navigate(`/classroom/${classroom.id}/learning-programmes`);
  }

  function openClassroomManagement() {
    renderClassroomManagementView(container, {
      classroom,
      onBack: () => renderDashboardView(container, props),
      onSelectStudent,
    });
  }

  function openSeating() {
    renderSeatingView(container, {
      classroom,
      onBack: openClassroomLanding,
      onSelectStudent,
    });
  }

  function openClassroomLanding() {
    renderClassroomLandingView(container, {
      onBack: () => renderDashboardView(container, props),
      onStartClassMode,
      onOpenClassroomManagement: openClassroomManagement,
      onOpenSeating: openSeating,
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
    }, openLearningManagement);
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

  // Open Work — the first, minimal instance of the agreed
  // "Open Work / Start New / Configuration" direction (see
  // ui/components/OpenWorkWidget.js's own header comment). Positioned
  // above the module cards deliberately: this is meant to move the
  // product toward the final architecture now, not sit as a
  // temporary Notebook-specific fix that gets thrown away once the
  // full Dashboard redesign lands.
  const openWorkWidget = createOpenWorkWidgetElement({
    classroom,
    onNavigate: onNavigateOpenWork,
  });
  if (openWorkWidget) {
    wrapper.appendChild(openWorkWidget);
  }

  // Today's Schedule — a compact summary only (see
  // ui/components/TodaysScheduleWidget.js's own header comment); the
  // full Timetable grid deliberately never lives on Home, per explicit
  // product decision. Self-contained async component: fires off its
  // own render and fills itself in once real data resolves, so this
  // still-synchronous renderDashboardView() doesn't need to become
  // async just to host it.
  const todaysScheduleContainer = document.createElement('div');
  wrapper.appendChild(todaysScheduleContainer);
  renderTodaysScheduleWidget(todaysScheduleContainer, {
    classroom,
    onViewFullTimetable: () => router.navigate(`/classroom/${classroom.id}/timetable`),
  });

  // Card-level attention indicators — each one reuses data this app
  // already computes elsewhere for its own existing purpose; nothing
  // here is a new listener or a new calculation invented just to
  // populate a card. A module with no reliable signal (Classroom,
  // Learning, Learning Programmes, Assessments — no "needs grading"
  // concept exists anywhere yet) simply has no entry, and its card
  // stays as plain description text, per explicit instruction not to
  // fabricate a count.
  const pendingTaskGroups = pendingTaskService.getPendingTasks(classroom);
  const attentionById = {};

  // Notebooks — the same three work-request groups
  // PendingTasksWidget.js already surfaces below, summed the exact
  // same way that widget's own "N tasks need your attention" line
  // already does (group.items.length, not item.count) — deliberately
  // excludes activity_awaiting_completion, which belongs to a
  // different destination than this card navigates to.
  const notebookPendingCount = pendingTaskGroups
    .filter((group) => group.id !== 'activity_awaiting_completion')
    .reduce((sum, group) => sum + group.items.length, 0);
  if (notebookPendingCount > 0) {
    attentionById.notebooks = `${notebookPendingCount} need${notebookPendingCount === 1 ? 's' : ''} review`;
  }

  // Goals — goalService.getPendingApprovalGoals() already exists for
  // Goal Management's own review queue; this just counts it.
  const activeGoalCycle = goalService.getActiveCycle(classroom);
  const pendingGoalApprovals = activeGoalCycle ? goalService.getPendingApprovalGoals(activeGoalCycle).length : 0;
  if (pendingGoalApprovals > 0) {
    attentionById.goals = `${pendingGoalApprovals} awaiting approval`;
  }

  // Class Feed — the exact same `notifications` list UserBar.js's own
  // bell renders (see main.js's manageNotificationSubscription()),
  // filtered to this one category and counted with the bell's own
  // countUnread() — no second subscription to the notifications
  // collection.
  const unreadFeedCount = notificationService.countUnread(
    notifications.filter((notification) => notification.category === NOTIFICATION_CATEGORIES.FEED),
    currentUser?.uid
  );
  if (unreadFeedCount > 0) {
    attentionById.feed = `${unreadFeedCount} new message${unreadFeedCount === 1 ? '' : 's'}`;
  }

  wrapper.appendChild(
    renderPrimaryModulesSection({
      onOpenClassroomLanding: openClassroomLanding,
      onOpenLearningManagement: openLearningManagement,
      onOpenAssessmentManagement: openAssessmentManagement,
      onOpenGoalManagement: openGoalManagement,
      onOpenNotebookTracker,
      onOpenFeed: openFeed,
      onOpenLearningProgrammes: openLearningProgrammes,
      attentionById,
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
  const hasPendingTasks = pendingTaskGroups.length > 0;
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
    id: 'classroom',
    title: 'Classroom',
    icon: 'users',
    description: 'Run your class, manage students, and organize teams',
    tier: 'primary',
    // No accentColor: this card fills with the teacher's own chosen
    // brand accent (--color-primary-deep), not a fixed module color —
    // inherited from the old Class Mode card's own treatment, since
    // "Run Today's Class" remains the single most time-critical
    // action reachable from this merged destination.
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
  {
    id: 'goals',
    title: 'Goals',
    icon: 'check-circle-2',
    description: 'Track student goals and streaks',
    tier: 'daily',
    accentColor: '#A8541A', // warm terracotta/amber, verified at 5.32:1 against white — distinct from Classroom (teal)/Learning (purple)/Assessments (slate-indigo), fitting for a growth/progress-themed module
  },
  {
    // Learning Programmes — Phase 2A. 'graduation-cap' is otherwise
    // unused across this module list (see ui/components/Icon.js) and
    // fits the concept directly: an additional learning context
    // beyond the regular classroom. Deliberately its own card, not
    // folded into 'goals' or 'learning' — Learning Programmes are a
    // structurally separate domain (see models/LearningProgramme.js's
    // own header comment), not a mode of either existing feature.
    id: 'learningProgrammes',
    title: 'Teaching Programmes',
    icon: 'graduation-cap',
    description: 'Run after-school circles like English Literacy Circle',
    tier: 'daily',
    accentColor: '#3D7A4E', // a restrained forest green, distinct from every other card's own color (teal/purple/slate-indigo/terracotta/amber-orange/blue)
  },
  {
    id: 'notebooks',
    title: 'Notebooks',
    icon: 'notebook-text',
    description: 'Track notebook submissions',
    tier: 'daily',
    accentColor: '#B8630F', // warm amber-orange, distinct from every other card's own color; this screen's existing Notebook Tracker, unchanged, is the destination
  },
  {
    id: 'feed',
    title: 'Class Feed',
    icon: 'file-text',
    description: 'See what students are sharing',
    tier: 'daily',
    accentColor: '#2E7D9E', // a restrained blue, distinct from every other card's own color; this screen's existing Class Feed, unchanged, is the destination
  },
];

function renderPrimaryModulesSection({
  onOpenClassroomLanding,
  onOpenLearningManagement,
  onOpenAssessmentManagement,
  onOpenGoalManagement,
  onOpenNotebookTracker,
  onOpenFeed,
  onOpenLearningProgrammes,
  attentionById = {},
}) {
  const section = document.createElement('div');
  section.className = 'primary-modules';

  // The one place runtime behavior meets static metadata — a plain
  // id -> handler lookup, not a chain of per-module conditionals.
  const handlersById = {
    classroom: onOpenClassroomLanding,
    learning: onOpenLearningManagement,
    assessments: onOpenAssessmentManagement,
    goals: onOpenGoalManagement,
    notebooks: onOpenNotebookTracker,
    feed: onOpenFeed,
    learningProgrammes: onOpenLearningProgrammes,
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
        attentionText: attentionById[module.id],
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
function createPrimaryModuleCard({ icon, label, description, onClick, tier, accentColor, attentionText }) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `primary-module-card primary-module-card--${tier}`;
  // A single custom property, set once here, that every tier's CSS
  // (--daily, --setup) reads for icon color, border color, tinted
  // background, and hover treatment — the module's own identity color
  // flows through one channel rather than being hardcoded per module
  // name in CSS. Class Mode (tier "primary") has no accentColor at
  // all; its own CSS rule uses --color-primary-deep directly instead,
  // so this is simply never set for that card.
  if (accentColor) card.style.setProperty('--module-accent', accentColor);

  // Primary (Class Mode) keeps its existing bare icon directly on the
  // solid filled background — a badge circle there would just be a
  // duplicate colored shape on top of an already-colored card. Daily/
  // setup tiers get an icon badge, matching the tinted-card language
  // this restyle is otherwise built on.
  if (tier === 'primary') {
    card.appendChild(createIcon(icon, { size: 28, strokeWidth: 1.75, className: 'primary-module-card__icon' }));
  } else {
    const badge = document.createElement('span');
    badge.className = 'primary-module-card__icon-badge';
    badge.appendChild(createIcon(icon, { size: 22, strokeWidth: 1.75, className: 'primary-module-card__icon' }));
    card.appendChild(badge);
  }

  const labelEl = document.createElement('span');
  labelEl.className = 'primary-module-card__label';
  labelEl.textContent = label;
  card.appendChild(labelEl);

  const descriptionEl = document.createElement('span');
  descriptionEl.className = 'primary-module-card__description';
  descriptionEl.textContent = description;
  card.appendChild(descriptionEl);

  // Short, actionable, subordinate to the title — a small muted pill,
  // never a large red count. Omitted entirely (not rendered empty)
  // when the caller found nothing real to say — see this file's own
  // attentionById comment above for exactly what backs each one.
  if (attentionText) {
    const attentionEl = document.createElement('span');
    attentionEl.className = 'primary-module-card__attention';
    attentionEl.textContent = attentionText;
    card.appendChild(attentionEl);
  }

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
function renderPreRosterWelcome(container, classroom, assistantCallbacks, onOpenLearningManagement) {
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
  button.textContent = 'Classroom Access';
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

