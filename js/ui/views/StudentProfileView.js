/**
 * ui/views/StudentProfileView.js
 *
 * The Student Profile: a tabbed dashboard (Overview / Achievements /
 * Learning / Activity / Notes) rather than one long form. The header is
 * tinted with the student's Learning Bucket colour (soft pastel, not a
 * bright solid) and summarizes every key stat at a glance; each tab adds
 * detail and, where relevant, an action button that opens a modal
 * (Award Badge, Add Note, Log Participation) rather than showing a
 * permanent input field.
 *
 * Like ui/views/SettingsView.js and ui/views/SetupWizardView.js, this
 * file calls straight into services and mutates the classroom/student
 * objects directly, persisting via workspaceService.save(classroom) after
 * each
 * change.
 */

import * as workspaceService from '../../services/workspaceService.js';
import * as studentIdentityService from '../../services/studentIdentityService.js';
import * as studentService from '../../services/studentService.js';
import * as teamService from '../../services/teamService.js';
import { createOverflowMenu } from '../components/OverflowMenu.js';
import { openChooseGroupModal, openNameEntryModal } from './ClassroomManagementView.js';
import * as bucketService from '../../services/bucketService.js';
import * as badgeService from '../../services/badgeService.js';
import * as noteService from '../../services/noteService.js';
import * as timelineService from '../../services/timelineService.js';
import * as studentProgressService from '../../services/studentProgressService.js';
import { createWeeklyNetPointsSection } from '../components/WeeklyNetPointsGraph.js';
import * as learningActivityService from '../../services/learningActivityService.js';
import * as goalService from '../../services/goalService.js';
import * as studentGoalsService from '../../services/studentGoalsService.js';
import * as workRequestService from '../../services/workRequestService.js';
import * as notebookConfigService from '../../services/notebookConfigService.js';
import { getStatusMeta } from './WorkRequestRosterView.js';
import * as studentEventService from '../../services/studentEventService.js';
import { STUDENT_EVENT_CATEGORIES } from '../../config/studentEventCategories.js';
import { formatDateKey } from '../../utils/dateHelpers.js';
import { BUCKET_KEYS, BUCKET_LABELS, getBucketLabel, getBucketRowStyle } from '../../config/bucketConfig.js';
import { createAvatarElement } from '../components/AvatarDisplay.js';
import { getGroupColorHex } from '../../config/groupColorConfig.js';
import { formatDate } from '../../utils/dateHelpers.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { openAwardBadgeModal } from '../components/AwardBadgeModal.js';
import { openAddNoteModal } from '../components/AddNoteModal.js';
import { openLogParticipationModal } from '../components/LogParticipationModal.js';
import { createBackButton } from '../components/BackButton.js';

const TABS = ['overview', 'achievements', 'learning', 'notebooks', 'activity', 'access', 'notes'];
const TAB_LABELS = {
  overview: 'Overview',
  achievements: 'Recognition',
  learning: 'Learning',
  notebooks: 'Notebooks',
  activity: 'Timeline',
  access: 'Parent Access',
  notes: 'Notes',
};

export function renderStudentProfileView(container, { classroom, studentId, tab, onBack, onNavigateTab, onOpenStudentAccess }) {
  container.innerHTML = '';

  const found = studentService.findStudentInClassroom(classroom, studentId);
  if (!found) {
    container.appendChild(createEmptyStateElement({ message: 'This student could not be found.' }));
    return;
  }

  const { student, team } = found;
  const activeTab = TABS.includes(tab) ? tab : 'overview';
  const rerender = () => renderStudentProfileView(container, { classroom, studentId, tab: activeTab, onBack, onNavigateTab, onOpenStudentAccess });

  const wrapper = document.createElement('div');
  wrapper.className = 'profile-view';

  wrapper.appendChild(renderProfileHeader(classroom, student, team, rerender, onBack));
  wrapper.appendChild(renderTabNav(activeTab, onNavigateTab));

  const content = document.createElement('div');
  content.className = 'profile-tab-content';

  const tabRenderers = {
    overview: renderOverviewTab,
    achievements: renderAchievementsTab,
    learning: renderLearningTab,
    notebooks: renderNotebooksTab,
    activity: renderActivityTab,
    access: renderAccessTab,
    notes: renderNotesTab,
  };
  tabRenderers[activeTab](content, classroom, student, team, rerender, onOpenStudentAccess);

  wrapper.appendChild(content);
  container.appendChild(wrapper);
}

function renderProfileHeader(classroom, student, team, rerender, onBack) {
  const header = document.createElement('header');
  header.className = 'profile-header';
  const style = getBucketRowStyle(student.bucket);
  header.style.backgroundColor = style.background;
  header.style.color = style.text;

  const topRow = document.createElement('div');
  topRow.className = 'profile-header__top-row';

  const backButton = createBackButton(onBack);
  topRow.appendChild(backButton);

  // Rename, Move to Group, and Remove Student — moved here from the
  // Classroom Management student row's own overflow menu, per
  // explicit product decision: that row now only navigates (see
  // ui/views/ClassroomManagementView.js's renderStudentRow()), and
  // these individual-student actions belong on the profile they lead
  // to, the same way this app's other navigation-row/destination-page
  // pairs already work (a Subject row leads to a page whose own menu
  // holds that Subject's actions, not the row that led there).
  const menuActions = [
    {
      label: 'Rename',
      onClick: () => {
        openNameEntryModal({
          heading: 'Rename Student',
          placeholder: 'Student name',
          initialValue: student.name,
          confirmLabel: 'Save',
          onConfirm: (newName) => {
            studentService.renameStudent(team, student.id, newName);
            workspaceService.save(classroom);
            rerender();
          },
        });
      },
    },
    {
      label: 'Move to Group',
      onClick: () => {
        openChooseGroupModal(classroom, {
          title: `Move ${student.name} to\u2026`,
          excludeTeamId: team ? team.id : null,
          onChoose: (destination) => {
            studentService.moveStudentToTeam(classroom, team.id, student.id, destination.id);
            workspaceService.save(classroom);
            rerender();
          },
        });
      },
    },
    {
      label: 'Remove Student',
      danger: true,
      onClick: () => {
        if (!window.confirm(`Remove ${student.name} from ${team ? team.name : 'this classroom'}?`)) return;
        studentService.removeStudent(team, student.id);
        workspaceService.save(classroom);
        // The student this whole page is about no longer exists —
        // navigate away rather than re-render a profile for someone
        // who's gone, the same "delete the thing you're viewing, then
        // leave" pattern used elsewhere in this app (e.g. deleting a
        // Curriculum Index or an Assessment from their own page).
        onBack();
      },
    },
  ];
  topRow.appendChild(createOverflowMenu({ actions: menuActions, ariaLabel: `${student.name} settings` }));

  header.appendChild(topRow);

  header.appendChild(
    createAvatarElement({ studentId: student.id, name: student.name, size: 72, useDefaultIfMissing: true, className: 'profile-header__avatar' })
  );

  const name = document.createElement('h1');
  name.className = 'profile-header__name';
  name.textContent = student.name;
  header.appendChild(name);

  const groupLine = document.createElement('p');
  groupLine.className = 'profile-header__group';
  groupLine.textContent = team ? team.name : 'Ungrouped';
  header.appendChild(groupLine);

  const hasLearningActivities = (classroom.learningActivities || []).length > 0;
  const summary = learningActivityService.getSubmissionSummary(classroom, student);
  const submissionText = `${summary.Submitted} Submitted \u00b7 ${summary['Submitted Late']} Late \u00b7 ${summary.Missing} Missing`;

  const notebookSummary = workRequestService.getStudentSummary(classroom, student.id);
  const hasNotebookActivity = workRequestService.listWorkRequests(classroom).some((request) => workRequestService.getEntryForStudent(request, student.id));
  const notebookText = `${notebookSummary.awaitingSubmission} Awaiting \u00b7 ${notebookSummary.awaitingReview} Review \u00b7 ${notebookSummary.needsCorrection} Correction \u00b7 ${notebookSummary.reviewed} Reviewed`;

  const stats = document.createElement('div');
  stats.className = 'profile-header__stats';

  [
    ['Bucket', getBucketLabel(student.bucket), 'bucket'],
    ['Net Score', timelineService.getNetPoints(student), null],
    ['Positive', timelineService.getTotalPositivePoints(student), 'positive'],
    ['Negative', timelineService.getTotalNegativePoints(student), 'negative'],
    ['Badges', (student.badges || []).length, 'badges'],
    ['Notes', (student.notes || []).length, null],
    ...(hasLearningActivities ? [['Learning Activities', submissionText, null]] : []),
    ...(hasNotebookActivity ? [['Notebooks', notebookText, null]] : []),
  ].forEach(([label, value, variant]) => {
    stats.appendChild(createHeaderChip(label, value, variant, student.bucket));
  });

  header.appendChild(stats);
  return header;
}

/**
 * `variant` picks this chip's own color, reusing existing semantic
 * colors rather than inventing new ones: 'positive'/'negative' reuse
 * the exact same green/red pastels config/bucketConfig.js already
 * establishes for "good"/"needs attention"; 'badges' reuses the app's
 * existing gold Recognition accent (--color-accent, already tied to
 * trophy/star imagery). 'bucket' is dynamic — it always matches this
 * specific student's own current bucket color (`bucketKey`), the same
 * getBucketRowStyle() the header itself uses, so the chip and the
 * header's own background never disagree. `null` (Net Score, Notes,
 * Learning Activities, Notebooks) stays the existing neutral default
 * — these are plain counts, not inherently good or bad on their own.
 *
 * Learning Activities and Notebooks are both conditional — shown only
 * when this classroom/student actually has real activity in that
 * domain, per explicit product decision: an always-present "0
 * Submitted · 0 Late · 0 Missing" chip for a domain with nothing in
 * it reads as a real number, not as "this doesn't apply here," and
 * invites exactly the kind of comparison against an unrelated
 * domain's own chip that a teacher correctly flagged as confusing.
 */
function createHeaderChip(label, value, variant, bucketKey) {
  const chip = document.createElement('div');
  chip.className = 'profile-header__chip';
  if (variant) chip.classList.add(`profile-header__chip--${variant}`);
  if (variant === 'bucket') {
    const bucketStyle = getBucketRowStyle(bucketKey);
    chip.style.backgroundColor = bucketStyle.background;
    chip.style.color = bucketStyle.text;
  }

  const labelEl = document.createElement('span');
  labelEl.className = 'profile-header__chip-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = 'profile-header__chip-value';
  valueEl.textContent = String(value);

  chip.append(labelEl, valueEl);
  return chip;
}

function renderTabNav(activeTab, onNavigateTab) {
  const nav = document.createElement('nav');
  nav.className = 'profile-tabs';
  nav.setAttribute('aria-label', 'Student profile sections');

  TABS.forEach((key) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'profile-tabs__tab' + (key === activeTab ? ' profile-tabs__tab--active' : '');
    button.textContent = TAB_LABELS[key];
    button.addEventListener('click', () => onNavigateTab(key));
    nav.appendChild(button);
  });

  return nav;
}

// ---------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------

function renderOverviewTab(content, classroom, student, team, rerender) {
  const bucketSection = document.createElement('div');
  bucketSection.className = 'profile-section';
  const bucketHeading = document.createElement('h2');
  bucketHeading.className = 'profile-section__heading';
  bucketHeading.textContent = 'Learning Bucket';
  bucketSection.appendChild(bucketHeading);

  const bucketSelect = document.createElement('select');
  bucketSelect.className = 'profile-stat-card__select';

  const noneOption = document.createElement('option');
  noneOption.value = '';
  noneOption.textContent = 'Not Assigned';
  if (!student.bucket) noneOption.selected = true;
  bucketSelect.appendChild(noneOption);

  BUCKET_KEYS.forEach((key) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = BUCKET_LABELS[key];
    if (student.bucket === key) option.selected = true;
    bucketSelect.appendChild(option);
  });

  bucketSelect.addEventListener('change', () => {
    bucketService.assignBucket(student, bucketSelect.value || null);
    workspaceService.save(classroom);
    rerender();
  });

  bucketSection.appendChild(bucketSelect);
  content.appendChild(bucketSection);

  const statsSection = document.createElement('div');
  statsSection.className = 'profile-section';
  const statsHeading = document.createElement('h2');
  statsHeading.className = 'profile-section__heading';
  statsHeading.textContent = 'Statistics';
  statsSection.appendChild(statsHeading);

  const statsGrid = document.createElement('div');
  statsGrid.className = 'profile-overview';
  statsGrid.appendChild(createStatCard('Net Score', timelineService.getNetPoints(student)));
  statsGrid.appendChild(createStatCard('Total Positive Points', timelineService.getTotalPositivePoints(student)));
  statsGrid.appendChild(createStatCard('Total Negative Points', timelineService.getTotalNegativePoints(student)));
  statsSection.appendChild(statsGrid);
  content.appendChild(statsSection);

  content.appendChild(createWeeklyNetPointsSection(studentProgressService.getWeeklyNetPoints(classroom, student.id), 'Points movement this week'));

  const groupSection = document.createElement('div');
  groupSection.className = 'profile-section';
  const groupHeading = document.createElement('h2');
  groupHeading.className = 'profile-section__heading';
  groupHeading.textContent = 'Group';
  groupSection.appendChild(groupHeading);

  const groupCard = document.createElement('div');
  groupCard.className = 'profile-group-card';
  if (team) {
    const swatch = document.createElement('span');
    swatch.className = 'profile-group-card__swatch';
    swatch.style.backgroundColor = team.color ? getGroupColorHex(team.color) : '#94a3b8';
    const name = document.createElement('span');
    name.textContent = team.name;
    groupCard.append(swatch, name);
  } else {
    groupCard.textContent = 'Ungrouped';
  }
  groupSection.appendChild(groupCard);
  content.appendChild(groupSection);

  // Portal Access (PIN/invitation-link management) used to live here,
  // one student at a time. Moved to a dedicated Student Access page
  // (reached from the Classroom Dashboard) instead — the realistic
  // workflow is onboarding a whole class's parents in one sitting, not
  // visiting each student's profile individually. See this project's
  // CHANGELOG for the full reasoning, and ui/views/StudentAccessView.js.
}

// ---------------------------------------------------------------------
// Parent Access
// ---------------------------------------------------------------------

/**
 * Status only — "is this student's parent linked yet?" — not PIN
 * management. That stays canonically on the dedicated Student Access
 * page (see ui/views/StudentAccessView.js and its own CHANGELOG entry
 * on why bulk management shouldn't be duplicated across two screens).
 * This tab answers a different, narrower question: someone already
 * looking at *this* student's own profile ("understand a student," in
 * the four-workflow framing) can see their parent-link status without
 * leaving, and jump to the bulk page only if they actually need to
 * take an action.
 */
function renderAccessTab(content, classroom, student, team, rerender, onOpenStudentAccess) {
  const section = document.createElement('div');
  section.className = 'profile-section';

  const heading = document.createElement('h2');
  heading.className = 'profile-section__heading';
  heading.textContent = 'Parent Access';
  section.appendChild(heading);

  const statusRow = document.createElement('div');
  statusRow.className = 'access-status-row';

  const statusBadge = document.createElement('span');
  // Resolved async below, since isStudentLinked() is a real lookup —
  // shown as "Checking..." only for the instant before it resolves,
  // not a meaningful loading state.
  statusBadge.className = 'access-status-badge';
  statusBadge.textContent = 'Checking\u2026';
  studentIdentityService.isStudentLinked(classroom.id, student.id).then((linked) => {
    statusBadge.className = 'access-status-badge' + (linked ? ' access-status-badge--linked' : ' access-status-badge--pending');
    statusBadge.textContent = linked ? '\u2705 Linked' : '\u23f3 Not Linked';
  });
  statusRow.appendChild(statusBadge);
  section.appendChild(statusRow);

  const manageButton = document.createElement('button');
  manageButton.type = 'button';
  manageButton.className = 'btn btn--ghost';
  manageButton.textContent = 'Manage in Student Access';
  manageButton.addEventListener('click', () => onOpenStudentAccess?.());
  section.appendChild(manageButton);

  content.appendChild(section);
}

function createStatCard(label, value) {
  const card = document.createElement('div');
  card.className = 'profile-stat-card';

  const labelEl = document.createElement('span');
  labelEl.className = 'profile-stat-card__label';
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = 'profile-stat-card__value';
  valueEl.textContent = String(value);

  card.append(labelEl, valueEl);
  return card;
}

// ---------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------

function renderAchievementsTab(content, classroom, student, team, rerender) {
  const section = document.createElement('div');
  section.className = 'profile-section';

  const heading = document.createElement('h2');
  heading.className = 'profile-section__heading';
  heading.textContent = 'Behaviour Badges';
  section.appendChild(heading);

  const awardedBadges = student.badges || [];

  if (awardedBadges.length === 0) {
    section.appendChild(
      createEmptyStateElement({
        message: 'No badges earned yet. Award a badge to celebrate positive behaviour.',
      })
    );
  } else {
    const grid = document.createElement('div');
    grid.className = 'achievement-grid';
    awardedBadges.forEach((badgeName) => {
      const card = document.createElement('div');
      card.className = 'achievement-card';

      const icon = document.createElement('span');
      icon.className = 'achievement-card__icon';
      icon.textContent = '\u2605';

      const label = document.createElement('span');
      label.className = 'achievement-card__label';
      label.textContent = badgeName;

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'achievement-card__remove';
      removeButton.textContent = '\u00d7';
      removeButton.setAttribute('aria-label', `Remove ${badgeName} badge`);
      removeButton.addEventListener('click', () => {
        badgeService.revokeBadge(student, badgeName);
        workspaceService.save(classroom);
        rerender();
      });

      card.append(icon, label, removeButton);
      grid.appendChild(card);
    });
    section.appendChild(grid);
  }

  const awardButton = document.createElement('button');
  awardButton.type = 'button';
  awardButton.className = 'btn btn--primary';
  awardButton.textContent = '+ Award Badge';
  awardButton.addEventListener('click', () => {
    const catalog = badgeService.listCatalog(classroom);
    const availableBadges = catalog.filter((badge) => !awardedBadges.includes(badge));

    openAwardBadgeModal({
      availableBadges,
      onAwardExisting: (badgeName) => {
        const awarded = badgeService.awardBadge(student, badgeName);
        if (awarded) {
          studentEventService.publishEvent(classroom, {
            studentId: student.id,
            type: 'badge_awarded',
            category: STUDENT_EVENT_CATEGORIES.RECOGNITION,
            title: `\ud83c\udf96\ufe0f You earned the "${badgeName}" badge!`,
            message: 'Your teacher recognized you for this.',
            payload: { badgeName },
          });
        }
        workspaceService.save(classroom);
        rerender();
      },
      onCreateAndAward: (badgeName) => {
        badgeService.addBadgeToCatalog(classroom, badgeName);
        const awarded = badgeService.awardBadge(student, badgeName);
        if (awarded) {
          studentEventService.publishEvent(classroom, {
            studentId: student.id,
            type: 'badge_awarded',
            category: STUDENT_EVENT_CATEGORIES.RECOGNITION,
            title: `\ud83c\udf96\ufe0f You earned the "${badgeName}" badge!`,
            message: 'Your teacher recognized you for this.',
            payload: { badgeName },
          });
        }
        workspaceService.save(classroom);
        rerender();
      },
    });
  });
  section.appendChild(awardButton);

  content.appendChild(section);
}

// ---------------------------------------------------------------------
// Learning
// ---------------------------------------------------------------------

/**
 * One category's own goal status, for the teacher-facing profile.
 * Read-only — a teacher approves/edits goals through
 * ui/views/GoalManagementView.js's own existing "Goals Awaiting
 * Approval" flow, not from here; this card exists purely so a
 * teacher checking one specific student doesn't have to already know
 * to visit a separate, classroom-wide screen to see whether that
 * student has submitted anything at all.
 */
function createGoalSummaryCard(category, goal) {
  const card = document.createElement('div');
  card.className = 'activity-card';

  const titleRow = document.createElement('div');
  titleRow.className = 'activity-card__title-row';
  const title = document.createElement('span');
  title.className = 'activity-card__title';
  title.textContent = category.name;
  titleRow.appendChild(title);

  if (goal) {
    const statusLabel = document.createElement('span');
    statusLabel.className = 'activity-card__type';
    statusLabel.textContent = goal.status === 'approved' ? 'Approved' : 'Awaiting Approval';
    titleRow.appendChild(statusLabel);
  }
  card.appendChild(titleRow);

  const text = document.createElement('p');
  text.className = 'profile-section__meta';
  text.textContent = goal ? `\u201C${goal.text}\u201D` : 'No goal submitted yet.';
  card.appendChild(text);

  return card;
}

async function renderLearningTab(content, classroom, student) {
  const section = document.createElement('div');
  section.className = 'profile-section';

  // LSRW Goals — categories (Listening/Speaking/Reading/Writing
  // themselves) still come from goalService.js/the classroom document
  // directly, unchanged. Individual goal SUBMISSIONS now come from
  // the dedicated studentGoals collection (see studentGoalsService.js
  // and the accepted "student-owned data gets its own collection"
  // architecture decision) — this is the fix for a real, confirmed
  // gap: a teacher viewing this exact profile previously had no way
  // to see this student's own goals at all.
  const goalsHeading = document.createElement('h2');
  goalsHeading.className = 'profile-section__heading';
  goalsHeading.textContent = 'Goals';
  section.appendChild(goalsHeading);

  const activeCycle = goalService.getActiveCycle(classroom);
  if (!activeCycle) {
    const noCycle = document.createElement('p');
    noCycle.className = 'profile-section__meta';
    noCycle.textContent = 'No active Goal Cycle right now.';
    section.appendChild(noCycle);
  } else {
    const categories = goalService.listCategories(activeCycle);
    if (categories.length === 0) {
      const noCategories = document.createElement('p');
      noCategories.className = 'profile-section__meta';
      noCategories.textContent = 'This cycle has no categories yet.';
      section.appendChild(noCategories);
    } else {
      const goalsList = document.createElement('div');
      goalsList.className = 'activity-list';
      for (const category of categories) {
        const goal = await studentGoalsService.getGoalForStudent(classroom.id, activeCycle.id, category.id, student.id);
        goalsList.appendChild(createGoalSummaryCard(category, goal));
      }
      section.appendChild(goalsList);
    }
  }

  const activitiesHeading = document.createElement('h2');
  activitiesHeading.className = 'profile-section__heading';
  activitiesHeading.textContent = 'Learning Activities';
  section.appendChild(activitiesHeading);

  const activities = learningActivityService.listActivities(classroom);

  if (activities.length === 0) {
    section.appendChild(
      createEmptyStateElement({
        message: 'No learning activities yet. Create an assignment to begin tracking submissions.',
      })
    );
    content.appendChild(section);
    return;
  }

  const summary = learningActivityService.getSubmissionSummary(classroom, student);
  const summaryLine = document.createElement('p');
  summaryLine.className = 'profile-section__meta';
  summaryLine.textContent = `${summary.Submitted} Submitted \u00b7 ${summary['Submitted Late']} Late \u00b7 ${summary.Missing} Missing \u00b7 ${summary.Resubmitted} Resubmitted`;
  section.appendChild(summaryLine);

  const note = document.createElement('p');
  note.className = 'profile-section__meta';
  note.textContent = 'Statuses are set from Learning Activities (see the classroom\u2019s Activities screen), not from here.';
  section.appendChild(note);

  const list = document.createElement('div');
  list.className = 'activity-list';

  activities.forEach((activity) => {
    const status = learningActivityService.getSubmissionStatus(student, activity.id);
    const submission = student.submissions?.[activity.id];

    const card = document.createElement('div');
    card.className = 'activity-card';

    const titleRow = document.createElement('div');
    titleRow.className = 'activity-card__title-row';
    const title = document.createElement('span');
    title.className = 'activity-card__title';
    title.textContent = activity.title;
    const type = document.createElement('span');
    type.className = 'activity-card__type';
    type.textContent = activity.type;
    titleRow.append(title, type);
    card.appendChild(titleRow);

    if (activity.dueDate) {
      const due = document.createElement('p');
      due.className = 'profile-section__meta';
      due.textContent = `Due ${activity.dueDate}`;
      card.appendChild(due);
    }

    const statusBadge = document.createElement('span');
    statusBadge.className = 'status-badge status-badge--' + status.toLowerCase().replace(/\s+/g, '-');
    statusBadge.textContent = status;
    card.appendChild(statusBadge);

    if (submission?.score !== null && submission?.score !== undefined && submission?.score !== '') {
      const score = document.createElement('p');
      score.className = 'profile-section__meta';
      score.textContent = `Score: ${submission.score}`;
      card.appendChild(score);
    }

    if (submission?.feedback) {
      const feedback = document.createElement('p');
      feedback.className = 'profile-section__meta';
      feedback.textContent = `Feedback: ${submission.feedback}`;
      card.appendChild(feedback);
    }

    list.appendChild(card);
  });

  section.appendChild(list);
  content.appendChild(section);
}

// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Notebooks
// ---------------------------------------------------------------------

/**
 * Reads exclusively from services/workRequestService.js — the same
 * single source of truth the WorkRequest roster itself is built on
 * (see ui/views/WorkRequestRosterView.js).
 *
 * Organized by NOTEBOOK (subject x notebook type), not by individual
 * WorkRequest — per the frozen architecture: a profile is
 * longitudinal, and "which WorkRequests has this student
 * participated in" is the wrong altitude for that. This answers "how
 * is this student's Science notebook progressing over time," with
 * the currently-open WorkRequest (if any) as just one facet of that
 * longer-running relationship — not the other way around.
 */
function renderNotebooksTab(content, classroom, student) {
  const section = document.createElement('div');
  section.className = 'profile-section';

  const heading = document.createElement('h2');
  heading.className = 'profile-section__heading';
  heading.textContent = 'Notebooks';
  section.appendChild(heading);

  const summary = workRequestService.getStudentSummary(classroom, student.id);
  const statsRow = document.createElement('div');
  statsRow.className = 'profile-overview';
  statsRow.appendChild(createStatCard('Awaiting Submission', summary.awaitingSubmission));
  statsRow.appendChild(createStatCard('Awaiting Review', summary.awaitingReview));
  statsRow.appendChild(createStatCard('Needs Correction', summary.needsCorrection));
  statsRow.appendChild(createStatCard('Reviewed', summary.reviewed));
  section.appendChild(statsRow);

  const notebooks = workRequestService.getNotebooksForStudent(classroom, student.id);
  if (notebooks.length === 0) {
    section.appendChild(createEmptyStateElement({ message: 'No notebook activity recorded yet for this student.' }));
  } else {
    const list = document.createElement('div');
    list.className = 'profile-notebook-activity';
    notebooks.forEach((notebook) => {
      list.appendChild(createNotebookCard(classroom, notebook));
    });
    section.appendChild(list);
  }

  content.appendChild(section);
}

/**
 * One card per NOTEBOOK, not per WorkRequest. `activeEntry` is null
 * whenever nothing is currently open for this notebook — the
 * notebook still exists as a real thing between cycles (see
 * ui/views/NotebookTrackerView.js's own "No active work" cards for
 * the same idea at the classroom level), so this renders a genuine
 * "no active work" state rather than omitting the notebook entirely.
 * Reuses WorkRequestRosterView.js's own exported getStatusMeta() so
 * this card and the roster's own chip always agree.
 */
function createNotebookCard(classroom, notebook) {
  const card = document.createElement('div');
  card.className = 'profile-notebook-activity__card';

  const subject = notebookConfigService.getSubjectById(classroom, notebook.subjectId);
  const notebookType = notebookConfigService.getNotebookTypeById(classroom, notebook.notebookTypeId);

  const title = document.createElement('p');
  title.className = 'profile-notebook-activity__title';
  title.textContent = [subject?.name, notebookType?.name].filter(Boolean).join(' \u00b7 ') || 'Notebook';
  card.appendChild(title);

  if (notebook.activeEntry) {
    const meta = getStatusMeta(notebook.activeEntry);
    const chip = document.createElement('span');
    chip.className = `work-request-roster__chip work-request-roster__chip--${meta.chipClass}`;
    chip.textContent = `${meta.icon} ${meta.label}`;
    card.appendChild(chip);
  } else {
    const chip = document.createElement('span');
    chip.className = 'work-request-roster__chip work-request-roster__chip--gray';
    chip.textContent = 'No active work';
    card.appendChild(chip);
  }

  const supportingLine = document.createElement('p');
  supportingLine.className = 'profile-notebook-activity__date';
  const lastCheckedText = notebook.lastChecked ? `Last reviewed ${formatDateKey(notebook.lastChecked.slice(0, 10))}` : 'Never reviewed';
  supportingLine.textContent = `${lastCheckedText} \u00b7 Reviewed ${notebook.totalReviewed} time${notebook.totalReviewed === 1 ? '' : 's'} overall`;
  card.appendChild(supportingLine);

  return card;
}

// ---------------------------------------------------------------------
// Activity (Participation Timeline)
// ---------------------------------------------------------------------

function renderActivityTab(content, classroom, student, team, rerender) {
  const section = document.createElement('div');
  section.className = 'profile-section';

  const heading = document.createElement('h2');
  heading.className = 'profile-section__heading';
  heading.textContent = 'Participation';
  section.appendChild(heading);

  const entries = timelineService.listTimeline(student);

  if (entries.length === 0) {
    section.appendChild(createEmptyStateElement({ message: 'No activity recorded.' }));
  } else {
    const timeline = document.createElement('ul');
    timeline.className = 'timeline';

    entries.forEach((entry) => {
      const item = document.createElement('li');
      item.className = 'timeline__item';

      const label = document.createElement('span');
      label.className = 'timeline__label';

      if (entry.kind === 'badge') {
        label.textContent = `${entry.label} Badge Awarded`;
      } else if (entry.kind === 'points') {
        const sign = entry.delta > 0 ? '+' : '';
        label.textContent = `${sign}${entry.delta} ${entry.label}`;
        label.classList.add(entry.delta > 0 ? 'timeline__label--positive' : 'timeline__label--negative');
      } else {
        label.textContent = entry.label;
      }

      const date = document.createElement('span');
      date.className = 'timeline__date';
      date.textContent = formatDate(entry.recordedAt);

      item.append(label, date);
      timeline.appendChild(item);
    });

    section.appendChild(timeline);
  }

  const logButton = document.createElement('button');
  logButton.type = 'button';
  logButton.className = 'btn btn--primary';
  logButton.textContent = '+ Log Participation';
  logButton.addEventListener('click', () => {
    openLogParticipationModal({
      onSave: ({ delta, reason }) => {
        timelineService.logPoints(student, delta, reason);
        workspaceService.save(classroom);
        rerender();
      },
    });
  });
  section.appendChild(logButton);

  content.appendChild(section);
}

// ---------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------

function renderNotesTab(content, classroom, student, team, rerender) {
  const section = document.createElement('div');
  section.className = 'profile-section';

  const heading = document.createElement('h2');
  heading.className = 'profile-section__heading';
  heading.textContent = 'Teacher Notes';
  section.appendChild(heading);

  const notes = noteService.listNotes(student);

  if (notes.length === 0) {
    section.appendChild(
      createEmptyStateElement({
        message: 'No notes yet. Add observations to support future conversations.',
      })
    );
  } else {
    const list = document.createElement('div');
    list.className = 'note-list';

    notes.forEach((note) => {
      const card = document.createElement('div');
      card.className = 'note-card';

      const metaRow = document.createElement('div');
      metaRow.className = 'note-card__meta';
      const teacher = document.createElement('span');
      teacher.className = 'note-card__teacher';
      teacher.textContent = note.teacherName || 'Teacher';
      const date = document.createElement('span');
      date.className = 'note-card__date';
      date.textContent = formatDate(note.createdAt);
      metaRow.append(teacher, date);

      const contentEl = document.createElement('p');
      contentEl.className = 'note-card__content';
      contentEl.textContent = note.content;

      card.append(metaRow, contentEl);
      list.appendChild(card);
    });

    section.appendChild(list);
  }

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'btn btn--primary';
  addButton.textContent = '+ Add Note';
  addButton.addEventListener('click', () => {
    openAddNoteModal({
      onSave: ({ teacherName, content, aboutDate }) => {
        noteService.addNote(student, { teacherName, content, aboutDate });
        workspaceService.save(classroom);
        rerender();
      },
    });
  });
  section.appendChild(addButton);

  content.appendChild(section);
}
