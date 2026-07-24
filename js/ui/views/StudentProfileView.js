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
import * as bucketService from '../../services/bucketService.js';
import * as badgeService from '../../services/badgeService.js';
import * as noteService from '../../services/noteService.js';
import * as timelineService from '../../services/timelineService.js';
import * as learningActivityService from '../../services/learningActivityService.js';
import * as notebookConfigService from '../../services/notebookConfigService.js';
import * as notebookService from '../../services/notebookService.js';
import * as studentProgressService from '../../services/studentProgressService.js';
import { createNotebookTimelineElement } from '../components/NotebookTimeline.js';
import { NOTEBOOK_TIMELINE_SYMBOLS, NOTEBOOK_TIMELINE_STATUS_LABELS, deriveDaySymbolKey } from '../../config/notebookStatuses.js';
import { getCurrentYearMonth, getDaysInYearMonth, formatDateKey } from '../../utils/dateHelpers.js';
import { BUCKET_KEYS, BUCKET_LABELS, getBucketLabel, getBucketRowStyle } from '../../config/bucketConfig.js';
import { getGroupColorHex } from '../../config/groupColorConfig.js';
import { formatDate } from '../../utils/dateHelpers.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { openAwardBadgeModal } from '../components/AwardBadgeModal.js';
import { openAddNoteModal } from '../components/AddNoteModal.js';
import { openLogParticipationModal } from '../components/LogParticipationModal.js';

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

  wrapper.appendChild(renderProfileHeader(classroom, student, team, onBack));
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

function renderProfileHeader(classroom, student, team, onBack) {
  const style = getBucketRowStyle(student.bucket);

  const header = document.createElement('header');
  header.className = 'profile-header';
  header.style.backgroundColor = style.background;

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.textContent = '\u2190 Back to Tracker';
  backButton.addEventListener('click', onBack);
  header.appendChild(backButton);

  const titleBlock = document.createElement('div');
  titleBlock.className = 'profile-header__title-block';

  const name = document.createElement('h1');
  name.className = 'profile-header__name';
  name.textContent = student.name;

  const groupLine = document.createElement('p');
  groupLine.className = 'profile-header__group';
  groupLine.textContent = team ? team.name : 'Ungrouped';

  titleBlock.append(name, groupLine);
  header.appendChild(titleBlock);

  const summary = learningActivityService.getSubmissionSummary(classroom, student);
  const submissionText = `${summary.Submitted} Submitted \u00b7 ${summary['Submitted Late']} Late \u00b7 ${summary.Missing} Missing`;

  const stats = document.createElement('div');
  stats.className = 'profile-header__stats';

  [
    ['Bucket', getBucketLabel(student.bucket)],
    ['Session Score', student.score],
    ['Positive', timelineService.getTotalPositivePoints(student)],
    ['Negative', timelineService.getTotalNegativePoints(student)],
    ['Badges', (student.badges || []).length],
    ['Notes', (student.notes || []).length],
    ['Learning Activities', submissionText],
  ].forEach(([label, value]) => {
    stats.appendChild(createHeaderChip(label, value));
  });

  header.appendChild(stats);
  return header;
}

function createHeaderChip(label, value) {
  const chip = document.createElement('div');
  chip.className = 'profile-header__chip';

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
  statsGrid.appendChild(createStatCard('Current Session Score', student.score));
  statsGrid.appendChild(createStatCard('Total Positive Points', timelineService.getTotalPositivePoints(student)));
  statsGrid.appendChild(createStatCard('Total Negative Points', timelineService.getTotalNegativePoints(student)));
  statsSection.appendChild(statsGrid);
  content.appendChild(statsSection);

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

  const demoEntry = studentIdentityService.listDemoRoster().find((entry) => entry.studentName === student.name);
  const statusBadge = document.createElement('span');

  if (!demoEntry) {
    statusBadge.className = 'access-status-badge access-status-badge--unknown';
    statusBadge.textContent = 'Not available in this demo roster';
  } else {
    // Resolved async below, since isStudentLinked() is a real (if
    // demo-backed) lookup — shown as "Checking..." only for the
    // instant before it resolves, not a meaningful loading state.
    statusBadge.className = 'access-status-badge';
    statusBadge.textContent = 'Checking\u2026';
    studentIdentityService.isStudentLinked(classroom.id, demoEntry.studentId).then((linked) => {
      statusBadge.className = 'access-status-badge' + (linked ? ' access-status-badge--linked' : ' access-status-badge--pending');
      statusBadge.textContent = linked ? '\u2705 Linked' : '\u23f3 Not Linked';
    });
  }
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
        badgeService.awardBadge(student, badgeName);
        workspaceService.save(classroom);
        rerender();
      },
      onCreateAndAward: (badgeName) => {
        badgeService.addBadgeToCatalog(classroom, badgeName);
        badgeService.awardBadge(student, badgeName);
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

function renderLearningTab(content, classroom, student) {
  const section = document.createElement('div');
  section.className = 'profile-section';

  const heading = document.createElement('h2');
  heading.className = 'profile-section__heading';
  heading.textContent = 'Learning Activities';
  section.appendChild(heading);

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
// Notebooks
// ---------------------------------------------------------------------

function renderNotebooksTab(content, classroom, student) {
  const section = document.createElement('div');
  section.className = 'profile-section';

  const heading = document.createElement('h2');
  heading.className = 'profile-section__heading';
  heading.textContent = 'Notebooks';
  section.appendChild(heading);

  const subjects = notebookConfigService.listSubjects(classroom);
  const notebookTypePairs = [];
  subjects.forEach((subject) => {
    notebookConfigService.listNotebookTypes(classroom, subject.id).forEach((notebookType) => {
      notebookTypePairs.push({ subject, notebookType });
    });
  });

  if (notebookTypePairs.length === 0) {
    section.appendChild(
      createEmptyStateElement({
        message: 'No notebooks configured yet for this classroom.',
      })
    );
    content.appendChild(section);
    return;
  }

  const yearMonth = getCurrentYearMonth();
  const daysInMonth = getDaysInYearMonth(yearMonth);

  notebookTypePairs.forEach(({ subject, notebookType }) => {
    const history = notebookService.getStudentHistory(classroom, subject.id, notebookType.id, student.id);
    if (history.length === 0) return; // nothing recorded for this notebook yet — skip rather than show an empty block

    const block = document.createElement('div');
    block.className = 'settings-team-block';

    const blockHeading = document.createElement('h3');
    blockHeading.className = 'settings-team-block__heading';
    blockHeading.textContent = `${subject.name} \u00b7 ${notebookType.name}`;
    block.appendChild(blockHeading);

    const days = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${yearMonth}-${String(day).padStart(2, '0')}`;
      const entry = notebookService.getEntry(classroom, subject.id, notebookType.id, dateKey, student.id);
      const symbolKey = deriveDaySymbolKey(entry);
      days.push({
        dateKey,
        symbol: NOTEBOOK_TIMELINE_SYMBOLS[symbolKey],
        statusLabel: NOTEBOOK_TIMELINE_STATUS_LABELS[symbolKey],
      });
    }
    block.appendChild(createNotebookTimelineElement({ days }));

    const statsRow = document.createElement('div');
    statsRow.className = 'profile-overview';
    const completionPercent = studentProgressService.getCompletionPercent(classroom, subject.id, notebookType.id, student.id);
    const currentStreak = studentProgressService.getCurrentStreak(classroom, subject.id, notebookType.id, student.id);
    const bestStreak = studentProgressService.getBestStreak(classroom, subject.id, notebookType.id, student.id);
    const lastChecked = studentProgressService.getLastChecked(classroom, subject.id, notebookType.id, student.id);

    statsRow.appendChild(createStatCard('\ud83d\udcd2 Completion', `${completionPercent}%`));
    statsRow.appendChild(createStatCard('\ud83d\udd25 Current Streak', currentStreak));
    statsRow.appendChild(createStatCard('\ud83c\udfc6 Best Streak', bestStreak));
    statsRow.appendChild(createStatCard('Last Checked', lastChecked ? formatDateKey(lastChecked) : '\u2014'));
    block.appendChild(statsRow);

    section.appendChild(block);
  });

  content.appendChild(section);
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
      onSave: ({ teacherName, content }) => {
        noteService.addNote(student, { teacherName, content });
        workspaceService.save(classroom);
        rerender();
      },
    });
  });
  section.appendChild(addButton);

  content.appendChild(section);
}
