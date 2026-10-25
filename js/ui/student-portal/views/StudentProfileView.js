/**
 * ui/student-portal/views/StudentProfileView.js
 *
 * A lightweight settings page: avatar, name, classroom, group, role,
 * Learning Bucket, plus "Customize Avatar" and "Manage Students"
 * actions.
 *
 * The avatar shown here is always the illustrated 2D avatar (custom
 * or default) — never initials — since this is the student's own
 * profile; see ui/components/AvatarDisplay.js's `useDefaultIfMissing`
 * for why "self" always gets a real avatar rather than a fallback.
 * Phase 1: the avatar config itself lives in this device's
 * localStorage only (see services/avatarConfigService.js) — no photo
 * upload anywhere, not a missing feature, a deliberate decision (see
 * this project's CHANGELOG).
 *
 * Live Firestore data for name/classroom/group/role/bucket — see
 * services/studentPortalDataService.js.
 *
 * The Learning Bucket chip reuses config/bucketConfig.js entirely —
 * the exact same colors, labels, and getBucketRowStyle()/
 * getBucketLabel() the teacher-facing Student Profile
 * (ui/views/StudentProfileView.js) already uses, so a bucket change a
 * teacher makes (e.g. Red -> Yellow) shows up here in the same color
 * the teacher themselves sees, the next time this student opens their
 * own Profile — no separate color logic to keep in sync.
 */

import {
  getCurrentStudentProfile,
  getAchievementBadgesForCurrentStudent,
  getAssignmentProgressForCurrentStudent,
  getNotebookStatusForCurrentStudent,
} from '../../../services/studentPortalDataService.js';
import { createAvatarElement } from '../../components/AvatarDisplay.js';
import { getBucketRowStyle, getBucketLabel } from '../../../config/bucketConfig.js';
import { getEventCopyForViewer } from '../../../services/studentEventService.js';
import { formatDate } from '../../../utils/dateHelpers.js';
import { createWeeklyNetPointsSection } from '../../components/WeeklyNetPointsGraph.js';
import { createBadge } from '../../components/Badge.js';
import { BADGE_THEMES, BADGE_SIZES } from '../../../config/badgeDefinitions.js';
import { getAssignmentCellMeta } from '../../views/AssignmentDetailView.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';
import { renderNotebookStatusSummary } from '../../components/NotebookStatusSummary.js';
import { buildGuidanceMessage } from '../../../services/studentGuidanceService.js';

export async function renderStudentProfileView(container, { onManageStudents, onCustomizeAvatar }) {
  container.innerHTML = '';

  // THE ACTUAL FIX for Workstream 1 (Student Profile parity) — three
  // reads that previously had no student-facing path at all
  // (Achievement Engine badges, Assignment completion, merged notebook
  // status), fetched alongside the existing profile read rather than
  // sequentially, matching ui/student-portal/views/StudentJourneyView.js's
  // own Promise.all-then-render shape.
  const [profile, achievementBadges, assignmentProgress, notebookStatus] = await Promise.all([
    getCurrentStudentProfile(),
    getAchievementBadgesForCurrentStudent(),
    getAssignmentProgressForCurrentStudent(),
    getNotebookStatusForCurrentStudent(),
  ]);

  const wrapper = document.createElement('div');
  wrapper.className = 'student-profile';

  if (!profile) {
    const notice = document.createElement('p');
    notice.className = 'student-home__empty-notice';
    notice.textContent = "We couldn't load your profile right now. Try rejoining your classroom.";
    wrapper.appendChild(notice);
    container.appendChild(wrapper);
    return;
  }

  const header = document.createElement('div');
  header.className = 'student-profile__header';
  const headerBucketStyle = getBucketRowStyle(profile.bucket);
  header.style.backgroundColor = headerBucketStyle.background;
  header.style.color = headerBucketStyle.text;

  const topRow = document.createElement('div');
  topRow.className = 'profile-header__top-row';

  const topRowSpacer = document.createElement('span');
  topRow.appendChild(topRowSpacer);

  if (onManageStudents) {
    const manageStudentsButton = document.createElement('button');
    manageStudentsButton.type = 'button';
    manageStudentsButton.className = 'btn btn--ghost student-profile__join-another';
    manageStudentsButton.textContent = 'Manage Students';
    manageStudentsButton.addEventListener('click', onManageStudents);
    topRow.appendChild(manageStudentsButton);
  }
  header.appendChild(topRow);

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'student-profile__avatar-wrap';
  avatarWrap.appendChild(
    createAvatarElement({
      studentId: profile.studentId,
      name: profile.name,
      size: 96,
      useDefaultIfMissing: true,
      className: 'student-profile__avatar',
    })
  );

  if (onCustomizeAvatar) {
    const customizeButton = document.createElement('button');
    customizeButton.type = 'button';
    customizeButton.className = 'student-profile__customize-avatar';
    customizeButton.setAttribute('aria-label', 'Customize Avatar');
    customizeButton.title = 'Customize Avatar';
    customizeButton.textContent = '\u270e';
    customizeButton.addEventListener('click', () => onCustomizeAvatar(profile.studentId));
    avatarWrap.appendChild(customizeButton);
  }
  header.appendChild(avatarWrap);

  const name = document.createElement('h1');
  name.className = 'student-profile__name';
  name.textContent = profile.name;
  header.appendChild(name);

  if (profile.groupName) {
    const team = document.createElement('p');
    team.className = 'student-profile__team';
    team.textContent = profile.groupName;
    header.appendChild(team);
  }

  const bucketStyle = getBucketRowStyle(profile.bucket);
  const bucketChip = document.createElement('div');
  bucketChip.className = 'student-profile__bucket-chip';
  bucketChip.style.backgroundColor = bucketStyle.background;
  bucketChip.style.borderColor = bucketStyle.border;
  bucketChip.style.color = bucketStyle.text;
  bucketChip.textContent = `Learning Bucket: ${getBucketLabel(profile.bucket)}`;
  header.appendChild(bucketChip);

  // The four Journey metrics, as one horizontal chip row inside the
  // SAME header block — reusing profile-header__chip verbatim, the
  // exact class the Teacher Portal's own header already uses for its
  // own metrics. Same visual component, different role-appropriate
  // data, not a separately-designed metrics card underneath.
  // Net Score and Negative Points are new (see
  // services/studentPortalDataService.js's own getCurrentStudentProfile()
  // comment) — added here, never replacing Total Stars (positive points),
  // per explicit instruction not to hide negative points or change what
  // a student can already see. `negative` reuses the exact variant
  // ui/views/StudentProfileView.js's own teacher-facing header chip
  // already uses for the same figure (config/bucketConfig.js's
  // green/red pastel pair), so a negative count reads the same way in
  // both places.
  const stats = document.createElement('div');
  stats.className = 'profile-header__stats';
  [
    ['Net Score', profile.netScore, null],
    ['Total Stars', profile.totalStars, 'positive'],
    ['Negative Points', profile.negativePoints, 'negative'],
    ['Badges Earned', profile.badgeCount, null],
    ['Current Streak', profile.currentStreak, null],
    ['Biggest Climb', profile.biggestClimb, null],
  ].forEach(([label, value, variant]) => {
    const chip = document.createElement('div');
    chip.className = `profile-header__chip${variant ? ` profile-header__chip--${variant}` : ''}`;
    const labelEl = document.createElement('span');
    labelEl.className = 'profile-header__chip-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'profile-header__chip-value';
    valueEl.textContent = String(value);
    chip.append(labelEl, valueEl);
    stats.appendChild(chip);
  });
  header.appendChild(stats);

  // Brief, constructive, and strictly data-driven — never a fabricated
  // "X points to your next bucket" claim, since bucket assignment is a
  // teacher's own manual judgment call (services/bucketService.js's own
  // assignBucket()), not a score threshold; inventing one here would
  // misrepresent how buckets actually work.
  const guidance = document.createElement('p');
  guidance.className = 'student-profile__guidance';
  guidance.textContent = buildGuidanceMessage(profile, notebookStatus);
  header.appendChild(guidance);

  wrapper.appendChild(header);

  wrapper.appendChild(createWeeklyNetPointsSection(profile.weeklyNetPoints, 'How your points moved this week'));

  if (achievementBadges.length > 0) {
    wrapper.appendChild(createAchievementBadgesSection(achievementBadges));
  }

  wrapper.appendChild(createNotebooksSection(notebookStatus));

  wrapper.appendChild(createAssignmentsSection(assignmentProgress));

  wrapper.appendChild(createRecentRecognitionSection(profile));

  container.appendChild(wrapper);
}

/**
 * The Badge & Achievement Engine's own real, persisted recognition
 * (services/achievementService.js) — see
 * services/studentPortalDataService.js's own getAchievementBadgesForCurrentStudent()
 * comment for why this previously reached no student-facing screen at
 * all. Reuses ui/views/StudentProfileView.js's own card shape
 * (createBadge + BADGE_THEMES) exactly, so the same badge reads
 * identically whether a teacher or this student is looking at it.
 */
function createAchievementBadgesSection(achievementBadges) {
  const section = document.createElement('div');
  section.className = 'profile-section';

  const heading = document.createElement('h2');
  heading.className = 'profile-section__heading';
  heading.textContent = 'Achievements';
  section.appendChild(heading);

  const row = document.createElement('div');
  row.className = 'profile-header__recognition student-profile__achievements-row';
  achievementBadges.forEach((summary) => {
    const theme = BADGE_THEMES[summary.definition.theme];
    const card = document.createElement('div');
    card.className = 'profile-header__recognition-chip';
    card.style.backgroundColor = theme.light;
    card.style.color = theme.dark;

    card.appendChild(
      createBadge({
        family: summary.definition.family,
        recognitionType: summary.definition.recognitionType,
        level: summary.level,
        size: BADGE_SIZES.compact,
        showLevel: false,
      })
    );

    const text = document.createElement('div');
    text.className = 'profile-header__recognition-chip-text';
    const title = document.createElement('span');
    title.className = 'profile-header__recognition-chip-title';
    title.textContent = summary.definition.title;
    const level = document.createElement('span');
    level.className = 'profile-header__recognition-chip-level';
    level.textContent = `LV ${summary.level}`;
    text.append(title, level);
    card.appendChild(text);

    row.appendChild(card);
  });
  section.appendChild(row);

  return section;
}

/**
 * Merged notebook status (see services/notebookStatusService.js) —
 * the exact same shared component and data source as
 * ui/views/StudentProfileView.js's own teacher-facing Notebooks tab,
 * so the two can never disagree about this student's own counts.
 */
function createNotebooksSection(notebookStatus) {
  const section = document.createElement('div');
  section.className = 'profile-section';

  const heading = document.createElement('h2');
  heading.className = 'profile-section__heading';
  heading.textContent = 'Notebooks';
  section.appendChild(heading);

  const summaryContainer = document.createElement('div');
  renderNotebookStatusSummary(summaryContainer, notebookStatus, {
    emptyMessage: 'Nothing of yours in this status right now.',
  });
  section.appendChild(summaryContainer);

  return section;
}

/**
 * Assignment completion/progress — see
 * services/studentPortalDataService.js's own
 * getAssignmentProgressForCurrentStudent() comment for why this
 * previously had no student-facing screen at all. Same summary shape
 * and per-assignment checkpoint progress as
 * ui/views/StudentProfileView.js's own renderAssignmentsTab(), reused
 * directly rather than recalculated.
 */
function createAssignmentsSection(assignmentProgress) {
  const section = document.createElement('div');
  section.className = 'profile-section';

  const heading = document.createElement('h2');
  heading.className = 'profile-section__heading';
  heading.textContent = 'Assignments';
  section.appendChild(heading);

  const { summary, entries } = assignmentProgress;
  const statsRow = document.createElement('div');
  statsRow.className = 'profile-overview';
  [
    ['Complete', summary.completeCount],
    ['Needs Attention', summary.needsAttentionCount],
    ['In Progress', summary.inProgressCount],
  ].forEach(([label, value]) => {
    const card = document.createElement('div');
    card.className = 'profile-stat-card';
    const labelEl = document.createElement('span');
    labelEl.className = 'profile-stat-card__label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'profile-stat-card__value';
    valueEl.textContent = String(value);
    card.append(labelEl, valueEl);
    statsRow.appendChild(card);
  });
  section.appendChild(statsRow);

  if (entries.length === 0) {
    section.appendChild(createEmptyStateElement({ message: 'No assignment activity recorded yet.' }));
    return section;
  }

  const list = document.createElement('div');
  list.className = 'profile-notebook-activity';
  entries.forEach(({ assignment, category, status, checkpointProgress, completionStatus }) => {
    const card = document.createElement('div');
    card.className = 'profile-notebook-activity__card';

    const title = document.createElement('p');
    title.className = 'profile-notebook-activity__title';
    title.textContent = [category?.name, assignment.title].filter(Boolean).join(' · ');
    card.appendChild(title);

    const meta = getAssignmentCellMeta(status);
    const chip = document.createElement('span');
    chip.className = `work-request-roster__chip work-request-roster__chip--${meta.chipClass}`;
    chip.textContent = `Overall: ${meta.label}`;
    card.appendChild(chip);

    // Workstream 4C — mirrors ui/views/StudentProfileView.js's own
    // teacher-facing createAssignmentEvidenceCard() exactly, so this
    // student sees the identical Done/Not Done signal their teacher
    // does. Omitted for "not_recorded" — nothing shown until something
    // real has happened, same rule the checkpoint chip below follows.
    if (completionStatus !== 'not_recorded') {
      const completionChip = document.createElement('span');
      completionChip.className = `work-request-roster__chip work-request-roster__chip--${completionStatus === 'done' ? 'green' : 'red'}`;
      completionChip.textContent = completionStatus === 'done' ? 'Marked Done' : 'Marked Not Done';
      card.appendChild(completionChip);
    }

    if (checkpointProgress.totalCount > 0) {
      const checkpointChip = document.createElement('span');
      checkpointChip.className = 'work-request-roster__chip work-request-roster__chip--purple';
      checkpointChip.textContent = `Checkpoints: ${checkpointProgress.submittedCount}/${checkpointProgress.totalCount} submitted`;
      card.appendChild(checkpointChip);
    }

    const supportingLine = document.createElement('p');
    supportingLine.className = 'profile-notebook-activity__date';
    supportingLine.textContent = assignment.dueDate ? `Due ${formatDate(assignment.dueDate)}` : `Given ${formatDate(assignment.givenDate)}`;
    card.appendChild(supportingLine);

    list.appendChild(card);
  });
  section.appendChild(list);

  return section;
}

function createRecentRecognitionSection(profile) {
  const section = document.createElement('div');
  section.className = 'recent-recognition-section';

  const heading = document.createElement('h2');
  heading.className = 'recent-recognition-section__heading';
  heading.textContent = 'Recent Recognition';
  section.appendChild(heading);

  const events = profile.recentEvents || [];

  if (events.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'recent-recognition-section__empty';
    empty.textContent = 'No recognition yet.';
    section.appendChild(empty);
    return section;
  }

  events.forEach((event) => {
    const copy = getEventCopyForViewer(event, 'self');

    const card = document.createElement('div');
    card.className = 'recognition-moment-card';

    const title = document.createElement('p');
    title.className = 'recognition-moment-card__title';
    title.textContent = copy.title;
    card.appendChild(title);

    if (copy.message) {
      const message = document.createElement('p');
      message.className = 'recognition-moment-card__message';
      message.textContent = copy.message;
      card.appendChild(message);
    }

    const date = document.createElement('p');
    date.className = 'recognition-moment-card__date';
    date.textContent = formatDate(event.createdAt);
    card.appendChild(date);

    section.appendChild(card);
  });

  return section;
}
