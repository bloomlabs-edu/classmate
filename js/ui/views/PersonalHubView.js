/**
 * ui/views/PersonalHubView.js
 *
 * ClassMate Personal Hub — Phase 1, restyled to match the approved
 * visual reference (references/Personal Profile view.png). Replaces
 * the old "My Classrooms" grid (formerly ui/views/HomeView.js) as the
 * teacher landing page at #/teacher.
 *
 * Section order follows the reference exactly: Profile -> Today ->
 * My Classrooms / Other Classrooms (side by side) -> My Schools &
 * Programs (Schools / Learning Programmes side by side) -> My Week
 * (the full weekly grid) -> Management. "Today" and "My Week" are
 * both facets of the "My Week" concept from this feature's own
 * product brief — a quick-glance strip right under Profile, and the
 * detailed weekly grid further down, exactly where the reference puts
 * each.
 *
 * Every number/list here is read straight from the classrooms
 * workspaceService already loaded for this uid (see
 * services/personalHubService.js for the aggregation) — nothing is
 * mock data, and nothing here is a second Timetable/classroom/
 * permission implementation: My Week/Today reuse
 * services/timetableService.js's own concrete-slot derivation, and
 * every classroom card reuses ui/components/ClassroomCard.js exactly
 * (including its owner-gated delete menu).
 *
 * DOCUMENTED DEVIATIONS from the visual reference — each because the
 * reference shows something ClassMate's current data model has no
 * real field for, and inventing one would violate "no mock data":
 *   - The profile header's decorative quote + illustration graphic is
 *     omitted (purely decorative, no content to source it from, no
 *     illustration asset exists in this codebase).
 *   - The role line never shows "Program Manager" — no such role
 *     exists yet in config/memberRoles.js (Program Manager/HM is
 *     explicitly a later phase per this feature's own brief). Only
 *     real classroom roles (Owner/Teacher/Viewer) and a real
 *     Programme "Facilitator" relationship are shown.
 *   - School cards omit the "Primary/Partner/Trial" status pill — a
 *     school has no relationship-type field on models/Classroom.js at
 *     all, only a free-text name.
 *   - KNOWN LIMITATION, flagged for the future PM/HM phase: every
 *     "school" here (the profile's own school count/list, and My
 *     Schools & Programs' own Schools column) is a DERIVED grouping
 *     by that same free-text schoolName, not a verified school
 *     affiliation or employment record — see
 *     personalHubService.getSchools()'s own header comment. Copy in
 *     this view is worded to avoid implying otherwise ("From your
 *     classrooms," not "You're part of"; an explicit caption on the
 *     Schools column), and a real School entity with verified
 *     membership stays a PM/HM-phase decision, not something to
 *     retrofit onto this read-only aggregation.
 *   - Learning Programme cards omit the "Grade X-Y" line — no such
 *     field exists on models/LearningProgramme.js.
 *   - "View All" links on Schools/Learning Programmes are omitted —
 *     there is no dedicated list route for either today, and a link
 *     to nowhere would be worse than showing every real item inline.
 *   - The "Tasks & Reminders" / "Upcoming Events" sidebar next to My
 *     Week is omitted — there is no unified, cross-classroom Task or
 *     Event aggregation anywhere in ClassMate yet (WorkRequest/
 *     PendingTask/Notification are all classroom-scoped and shaped
 *     very differently); My Week takes the full row instead.
 */

import { createClassroomCardElement } from '../components/ClassroomCard.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { createIcon, createIconBadge } from '../components/Icon.js';
import {
  getStudentCount,
  getMemberCount,
  getDisplayName,
  getDisplaySubtitle,
} from '../../services/classroomService.js';
import * as memberService from '../../services/memberService.js';
import * as personalHubService from '../../services/personalHubService.js';
import { getGroupColorHex } from '../../config/groupColorConfig.js';
import { getTimetableSubjectColor } from '../../config/timetableSubjectColors.js';
import { formatDateKey, getTodayDateKey } from '../../utils/dateHelpers.js';

const WEEKDAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const FACILITATOR_HEX = getGroupColorHex('purple');

export function renderPersonalHubView(
  container,
  { classrooms, currentUser, onSelectClassroom, onNewClassroom, onJoinClassroom, onDeleteClassroom, onOpenCurriculumManagement, onOpenTimetable }
) {
  container.innerHTML = '';

  const uid = currentUser.uid;
  const colorMap = personalHubService.buildClassroomColorMap(classrooms);
  let weekAnchor = getTodayDateKey();

  const wrapper = document.createElement('div');
  wrapper.className = 'personal-hub';

  const { managedClassrooms, otherClassrooms } = personalHubService.splitClassroomsByRole(classrooms, uid);
  const schools = personalHubService.getSchools(classrooms);
  const programmes = personalHubService.getProgrammes(classrooms, uid);

  wrapper.appendChild(renderProfileHeader());
  wrapper.appendChild(renderTodaySection());
  wrapper.appendChild(renderClassroomsRow());
  wrapper.appendChild(renderSchoolsAndProgrammesSection());

  const weekSection = document.createElement('section');
  weekSection.className = 'hub-section hub-week';
  renderWeekSection(weekSection);
  wrapper.appendChild(weekSection);

  wrapper.appendChild(renderManagementSection());

  container.appendChild(wrapper);

  // --- shared helpers ---------------------------------------------------

  function colorFor(classroomId) {
    return colorMap.get(classroomId) || { hex: '#94a3b8' };
  }

  /** Tints an element with `hex` using this app's own color-mix wash/label convention (see css/styles.css's --palette-*-wash/-label tokens) rather than a fixed set of CSS classes, since the exact set of classroom colors is runtime data. */
  function tint(el, hex, { bg = 16, text = 60 } = {}) {
    el.style.backgroundColor = `color-mix(in srgb, ${hex} ${bg}%, var(--color-surface))`;
    el.style.color = `color-mix(in srgb, ${hex} ${text}%, var(--color-ink))`;
  }

  function monogramInitials(name) {
    const words = (name || '').trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return (name || '').slice(0, 2).toUpperCase();
  }

  function buildMonogramBadge(classroom) {
    const badge = document.createElement('span');
    badge.className = 'hub-monogram';
    badge.textContent = monogramInitials(getDisplayName(classroom));
    tint(badge, colorFor(classroom.id).hex, { bg: 22, text: 65 });
    return badge;
  }

  function buildClassroomCard(classroom, { managed }) {
    return createClassroomCardElement({
      badge: managed ? buildMonogramBadge(classroom) : createIconBadge('users', 'settings', { size: 40 }),
      displayName: getDisplayName(classroom),
      subtitle: getDisplaySubtitle(classroom),
      studentCount: getStudentCount(classroom),
      memberCount: getMemberCount(classroom),
      onClick: () => onSelectClassroom(classroom.id),
      isOwner: memberService.isOwner(classroom, uid),
      onDeleteClassroom: () => onDeleteClassroom?.(classroom.id),
      actionLabel: managed ? 'Open Classroom' : 'View Classroom',
      // Scoped to My Classrooms only, per explicit product direction —
      // "Other Classrooms" cards stay exactly as they were.
      subjectsTaught: managed ? personalHubService.getSubjectsTaughtInClassroom(classroom, uid) : undefined,
    });
  }

  function pickPrimaryClassroomId(entries) {
    const counts = new Map();
    entries.forEach((entry) => counts.set(entry.classroomId, (counts.get(entry.classroomId) || 0) + 1));
    let best = null;
    let bestCount = -1;
    counts.forEach((count, classroomId) => {
      if (count > bestCount) {
        best = classroomId;
        bestCount = count;
      }
    });
    return best || classrooms[0]?.id || null;
  }

  // --- Profile header -----------------------------------------------

  function renderProfileHeader() {
    const section = document.createElement('section');
    section.className = 'hub-section hub-profile';

    const main = document.createElement('div');
    main.className = 'hub-profile__main';

    const identity = document.createElement('div');
    identity.className = 'hub-profile__identity';

    if (currentUser.photoURL) {
      const avatar = document.createElement('img');
      avatar.className = 'hub-profile__avatar';
      avatar.src = currentUser.photoURL;
      avatar.alt = '';
      avatar.referrerPolicy = 'no-referrer';
      identity.appendChild(avatar);
    } else {
      const fallback = document.createElement('span');
      fallback.className = 'hub-profile__avatar hub-profile__avatar--fallback';
      fallback.textContent = (currentUser.displayName || 'T').charAt(0).toUpperCase();
      identity.appendChild(fallback);
    }

    const info = document.createElement('div');
    const name = document.createElement('h1');
    name.className = 'hub-profile__name';
    name.textContent = currentUser.displayName || 'Teacher';
    info.appendChild(name);

    const classroomRoles = personalHubService.getRolesSummary(classrooms, uid);
    const isFacilitator = programmes.some((p) => p.roleLabel === 'Facilitator');
    // Role line: real classroom roles only — see this file's own header
    // comment on why "Program Manager" never appears here yet.
    if (classroomRoles.length > 0) {
      const roleLine = document.createElement('p');
      roleLine.className = 'hub-profile__roles';
      roleLine.textContent = classroomRoles.join(' · ');
      info.appendChild(roleLine);
    }

    if (schools.length > 0) {
      // Listing the raw schoolName strings this uid's classrooms
      // happen to share — NOT a claim of verified employment/school
      // affiliation. See personalHubService.getSchools()'s own header
      // comment for why that distinction matters and stays a known
      // limitation until a real PM/HM-phase affiliation model exists.
      const affiliations = document.createElement('p');
      affiliations.className = 'hub-profile__affiliations';
      affiliations.textContent = schools.map((s) => s.schoolName).join(' · ');
      info.appendChild(affiliations);
    }

    const pills = document.createElement('div');
    pills.className = 'hub-profile__pills';
    classroomRoles.forEach((role) => pills.appendChild(buildRolePill(role)));
    if (isFacilitator) pills.appendChild(buildRolePill('Facilitator'));
    info.appendChild(pills);

    identity.appendChild(info);
    main.appendChild(identity);
    section.appendChild(main);

    const stats = document.createElement('div');
    stats.className = 'hub-profile__stats';
    stats.append(
      renderStatTile('users', 'teacher', managedClassrooms.length, 'Classrooms', 'You teach'),
      // "From your classrooms," not "You're part of" — deliberately
      // avoids implying a verified school affiliation/employment
      // relationship this count doesn't actually carry (it's just the
      // distinct schoolName values across this uid's classrooms; see
      // personalHubService.getSchools()'s own header comment).
      renderStatTile('home', 'progress', schools.length, 'Schools', 'From your classrooms'),
      renderStatTile('calendar', 'notebook', personalHubService.countPeriodsThisWeek(classrooms, uid, weekAnchor), 'Periods', 'This week'),
      renderStatTile('book-open', 'recognition', programmes.length, 'Programs', 'You facilitate')
    );
    section.appendChild(stats);

    return section;
  }

  function buildRolePill(role) {
    const pill = document.createElement('span');
    pill.className = 'hub-pill';
    pill.textContent = role;
    const hex =
      role === 'Owner' ? 'var(--color-primary)' : role === 'Teacher' ? 'var(--color-success)' : role === 'Facilitator' ? FACILITATOR_HEX : 'var(--color-muted)';
    tint(pill, hex, { bg: 16, text: 65 });
    return pill;
  }

  function renderStatTile(iconName, category, value, label, sublabel) {
    const tile = document.createElement('div');
    tile.className = 'hub-stat-tile';
    tile.appendChild(createIconBadge(iconName, category, { size: 44 }));

    const text = document.createElement('div');
    text.className = 'hub-stat-tile__text';
    const valueEl = document.createElement('span');
    valueEl.className = 'hub-stat-tile__value';
    valueEl.textContent = String(value);
    const labelEl = document.createElement('span');
    labelEl.className = 'hub-stat-tile__label';
    labelEl.textContent = label;
    const sublabelEl = document.createElement('span');
    sublabelEl.className = 'hub-stat-tile__sublabel';
    sublabelEl.textContent = sublabel;
    text.append(valueEl, labelEl, sublabelEl);
    tile.appendChild(text);
    return tile;
  }

  // --- Today strip -------------------------------------------------------

  function renderTodaySection() {
    const section = document.createElement('section');
    section.className = 'hub-section hub-today';

    const header = document.createElement('div');
    header.className = 'hub-section__header';

    const title = document.createElement('h2');
    title.className = 'hub-section__title';
    const todayKey = getTodayDateKey();
    title.textContent = `Today · ${new Date(`${todayKey}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}`;
    header.appendChild(title);

    const entries = personalHubService.getTodaySchedule(classrooms, uid, todayKey);

    const viewFullButton = document.createElement('button');
    viewFullButton.type = 'button';
    viewFullButton.className = 'btn btn--ghost btn--pill';
    viewFullButton.append('View Full Timetable ', createIcon('arrow-right', { size: 16 }));
    viewFullButton.addEventListener('click', () => {
      const classroomId = pickPrimaryClassroomId(entries);
      if (classroomId) onOpenTimetable(classroomId);
    });
    header.appendChild(viewFullButton);
    section.appendChild(header);

    if (entries.length === 0) {
      section.appendChild(createEmptyStateElement({ message: 'No periods scheduled today.' }));
      return section;
    }

    const stripWrapper = document.createElement('div');
    stripWrapper.className = 'hub-today-strip-wrapper';

    const strip = document.createElement('div');
    strip.className = 'hub-today-strip';

    entries.forEach((entry) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'hub-today-card';
      card.addEventListener('click', () => onOpenTimetable(entry.classroomId));

      const top = document.createElement('span');
      top.className = 'hub-today-card__top';
      const dot = document.createElement('span');
      dot.className = 'hub-today-card__dot';
      // Subject-colored, not classroom-colored — reuses ClassMate's
      // own existing Timetable subject palette (see
      // config/timetableSubjectColors.js, the same one
      // ui/views/TimetableView.js's own period cards already use) so
      // "what kind of class is this" reads at a glance across a
      // single day. My Week's grid below is colored by classroom
      // instead (see colorFor()) since distinguishing *which
      // classroom* matters more once a whole week is on screen.
      dot.style.backgroundColor = getTimetableSubjectColor(entry.subjectId).text;
      const time = document.createElement('span');
      time.className = 'hub-today-card__time';
      time.textContent = entry.startTime ? personalHubService.formatPeriodTime(entry.startTime) : '';
      top.append(dot, time);

      const subject = document.createElement('span');
      subject.className = 'hub-today-card__subject';
      subject.textContent = entry.subjectTitle;

      const meta = document.createElement('span');
      meta.className = 'hub-today-card__meta';
      meta.textContent = `P${entry.periodNumber} · ${entry.classroomName}`;

      const school = document.createElement('span');
      school.className = 'hub-today-card__school';
      school.textContent = entry.schoolName || '';

      const chevron = createIcon('arrow-right', { size: 16, className: 'hub-today-card__chevron' });

      card.append(top, subject, meta, school, chevron);
      strip.appendChild(card);
    });

    const prevButton = document.createElement('button');
    prevButton.type = 'button';
    prevButton.className = 'hub-today-strip__nav hub-today-strip__nav--prev';
    prevButton.setAttribute('aria-label', 'Scroll earlier');
    prevButton.appendChild(createIcon('arrow-left', { size: 16 }));
    prevButton.addEventListener('click', () => strip.scrollBy({ left: -260, behavior: 'smooth' }));

    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.className = 'hub-today-strip__nav hub-today-strip__nav--next';
    nextButton.setAttribute('aria-label', 'Scroll later');
    nextButton.appendChild(createIcon('arrow-right', { size: 16 }));
    nextButton.addEventListener('click', () => strip.scrollBy({ left: 260, behavior: 'smooth' }));

    stripWrapper.append(prevButton, strip, nextButton);
    section.appendChild(stripWrapper);

    const helper = document.createElement('p');
    helper.className = 'hub-today-helper';
    helper.textContent = 'Tap any period to open the classroom';
    section.appendChild(helper);

    return section;
  }

  // --- My Classrooms / Other Classrooms ----------------------------------

  function renderClassroomsRow() {
    const row = document.createElement('div');
    row.className = otherClassrooms.length > 0 ? 'hub-two-col hub-two-col--classrooms' : 'hub-two-col hub-two-col--single';

    row.appendChild(renderMyClassroomsSection());
    if (otherClassrooms.length > 0) row.appendChild(renderOtherClassroomsSection());

    return row;
  }

  function renderMyClassroomsSection() {
    const section = document.createElement('section');
    section.className = 'hub-section';

    const header = document.createElement('div');
    header.className = 'hub-section__header';

    const titleGroup = document.createElement('div');
    titleGroup.className = 'hub-section__title-group';
    titleGroup.appendChild(createIcon('users', { size: 20 }));
    const title = document.createElement('h2');
    title.className = 'hub-section__title';
    title.textContent = 'My Classrooms';
    titleGroup.appendChild(title);
    header.appendChild(titleGroup);

    const actions = document.createElement('div');
    actions.className = 'hub-section__actions';

    // Creating a classroom has no permission gate in this app today —
    // any signed-in teacher can create one and becomes its owner (see
    // services/classroomService.js's createEmptyClassroom()) — so this
    // stays unconditional.
    const newButton = document.createElement('button');
    newButton.type = 'button';
    newButton.className = 'btn btn--ghost btn--pill';
    newButton.append('+ New Classroom');
    newButton.addEventListener('click', onNewClassroom);
    actions.appendChild(newButton);

    // Not shown in the visual reference's own header row, but this is
    // real, preserved functionality (joining an existing classroom by
    // code) — kept as a lower-emphasis text button alongside it rather
    // than dropped, since removing it would be a functionality
    // regression, not a visual one.
    const joinButton = document.createElement('button');
    joinButton.type = 'button';
    joinButton.className = 'btn btn--text';
    joinButton.textContent = 'Join a Classroom';
    joinButton.addEventListener('click', onJoinClassroom);
    actions.appendChild(joinButton);

    header.appendChild(actions);
    section.appendChild(header);

    if (managedClassrooms.length === 0) {
      section.appendChild(createEmptyStateElement({ message: 'You don’t manage any classrooms yet.' }));
      return section;
    }

    const grid = document.createElement('div');
    grid.className = 'classroom-grid';
    managedClassrooms.forEach((classroom) => grid.appendChild(buildClassroomCard(classroom, { managed: true })));
    section.appendChild(grid);

    return section;
  }

  function renderOtherClassroomsSection() {
    const section = document.createElement('section');
    section.className = 'hub-section';

    const header = document.createElement('div');
    header.className = 'hub-section__header';
    const titleGroup = document.createElement('div');
    titleGroup.className = 'hub-section__title-group';
    titleGroup.appendChild(createIcon('users', { size: 20 }));
    const title = document.createElement('h2');
    title.className = 'hub-section__title';
    title.textContent = 'Other Classrooms I’m Part Of';
    titleGroup.appendChild(title);
    header.appendChild(titleGroup);
    section.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'classroom-grid';
    otherClassrooms.forEach((classroom) => grid.appendChild(buildClassroomCard(classroom, { managed: false })));
    section.appendChild(grid);

    return section;
  }

  // --- My Schools & Programs ------------------------------------------

  function renderSchoolsAndProgrammesSection() {
    const section = document.createElement('section');
    section.className = 'hub-section';

    const header = document.createElement('div');
    header.className = 'hub-section__header';
    const titleGroup = document.createElement('div');
    titleGroup.className = 'hub-section__title-group';
    titleGroup.appendChild(createIcon('home', { size: 20 }));
    const title = document.createElement('h2');
    title.className = 'hub-section__title';
    title.textContent = 'My Schools & Programs';
    titleGroup.appendChild(title);
    header.appendChild(titleGroup);
    section.appendChild(header);

    const columns = document.createElement('div');
    columns.className = 'hub-two-col hub-two-col--orgs';

    const schoolsCol = document.createElement('div');
    schoolsCol.className = 'hub-org-column';
    const schoolsHeading = document.createElement('h3');
    schoolsHeading.className = 'hub-org-column__title';
    schoolsHeading.textContent = 'Schools';
    schoolsCol.appendChild(schoolsHeading);

    // Visible, not just a code comment — these are groupings by each
    // classroom's own free-text schoolName, not a verified school
    // affiliation/employment record (no such model exists yet; see
    // personalHubService.getSchools()). Says so in the UI itself so a
    // reader doesn't mistake "3 Teachers" for an HR-verified headcount.
    const schoolsCaption = document.createElement('p');
    schoolsCaption.className = 'hub-org-column__caption';
    schoolsCaption.textContent = 'Grouped from your classroom records, not a verified affiliation.';
    schoolsCol.appendChild(schoolsCaption);

    const schoolsGrid = document.createElement('div');
    schoolsGrid.className = 'hub-org-grid';
    schools.forEach((school) => {
      const card = document.createElement('div');
      card.className = 'hub-org-card';

      card.appendChild(createIconBadge('home', 'progress', { size: 36 }));

      const name = document.createElement('h4');
      name.className = 'hub-org-card__name';
      name.textContent = school.schoolName;
      card.appendChild(name);

      const meta = document.createElement('p');
      meta.className = 'hub-org-card__meta';
      meta.textContent = `${school.classrooms.length} Classroom${school.classrooms.length === 1 ? '' : 's'}`;
      card.appendChild(meta);

      const meta2 = document.createElement('p');
      meta2.className = 'hub-org-card__meta';
      meta2.textContent = `${school.teacherCount} Teacher${school.teacherCount === 1 ? '' : 's'}`;
      card.appendChild(meta2);

      schoolsGrid.appendChild(card);
    });
    schoolsCol.appendChild(schoolsGrid);
    columns.appendChild(schoolsCol);

    const programmesCol = document.createElement('div');
    programmesCol.className = 'hub-org-column';
    const programmesHeading = document.createElement('h3');
    programmesHeading.className = 'hub-org-column__title';
    programmesHeading.textContent = 'Learning Programmes';
    programmesCol.appendChild(programmesHeading);

    const programmesGrid = document.createElement('div');
    programmesGrid.className = 'hub-org-grid';
    if (programmes.length === 0) {
      programmesGrid.appendChild(createEmptyStateElement({ message: 'No active programmes yet.' }));
    }
    programmes.forEach(({ programme, classroom, roleLabel }) => {
      const card = document.createElement('div');
      card.className = 'hub-org-card hub-org-card--programme';

      card.appendChild(createIconBadge('graduation-cap', 'recognition', { size: 36 }));

      const name = document.createElement('h4');
      name.className = 'hub-org-card__name';
      name.textContent = programme.name;
      card.appendChild(name);

      card.appendChild(buildRolePill(roleLabel));

      const meta = document.createElement('p');
      meta.className = 'hub-org-card__meta';
      meta.textContent = getDisplayName(classroom);
      card.appendChild(meta);

      const status = document.createElement('p');
      status.className = 'hub-org-card__status';
      const statusDot = document.createElement('span');
      statusDot.className = 'hub-org-card__status-dot';
      status.append(statusDot, 'Active');
      card.appendChild(status);

      programmesGrid.appendChild(card);
    });
    programmesCol.appendChild(programmesGrid);
    columns.appendChild(programmesCol);

    section.appendChild(columns);
    return section;
  }

  // --- My Week (full grid) ------------------------------------------

  function renderWeekSection(section) {
    section.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'hub-section__header';
    const titleGroup = document.createElement('div');
    titleGroup.className = 'hub-section__title-group';
    titleGroup.appendChild(createIcon('calendar', { size: 20 }));
    const title = document.createElement('h2');
    title.className = 'hub-section__title';
    title.textContent = 'My Week';
    titleGroup.appendChild(title);
    header.appendChild(titleGroup);

    const nav = document.createElement('div');
    nav.className = 'hub-week__nav';

    const prevButton = document.createElement('button');
    prevButton.type = 'button';
    prevButton.className = 'btn btn--icon-only';
    prevButton.setAttribute('aria-label', 'Previous week');
    prevButton.appendChild(createIcon('arrow-left', { size: 16 }));
    prevButton.addEventListener('click', () => {
      weekAnchor = personalHubService.getPreviousWeekAnchor(weekAnchor);
      renderWeekSection(section);
    });

    const todayButton = document.createElement('button');
    todayButton.type = 'button';
    todayButton.className = 'btn btn--ghost btn--pill';
    todayButton.textContent = 'This Week';
    todayButton.addEventListener('click', () => {
      weekAnchor = getTodayDateKey();
      renderWeekSection(section);
    });

    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.className = 'btn btn--icon-only';
    nextButton.setAttribute('aria-label', 'Next week');
    nextButton.appendChild(createIcon('arrow-right', { size: 16 }));
    nextButton.addEventListener('click', () => {
      weekAnchor = personalHubService.getNextWeekAnchor(weekAnchor);
      renderWeekSection(section);
    });

    nav.append(prevButton, todayButton, nextButton);
    header.appendChild(nav);
    section.appendChild(header);

    const { range, days, rows } = personalHubService.getWeekGrid(classrooms, uid, weekAnchor);
    const todayKey = getTodayDateKey();

    const subheader = document.createElement('div');
    subheader.className = 'hub-week__subheader';
    const rangeLabel = document.createElement('span');
    rangeLabel.className = 'hub-week__range';
    rangeLabel.textContent = `${formatDateKey(range.start)} – ${formatDateKey(range.end)}`;
    subheader.appendChild(rangeLabel);

    const legend = document.createElement('div');
    legend.className = 'hub-week__legend';
    classrooms.forEach((classroom) => {
      const item = document.createElement('span');
      item.className = 'hub-week__legend-item';
      const dot = document.createElement('span');
      dot.className = 'hub-week__legend-dot';
      dot.style.backgroundColor = colorFor(classroom.id).hex;
      item.append(dot, getDisplayName(classroom));
      legend.appendChild(item);
    });
    subheader.appendChild(legend);
    section.appendChild(subheader);

    if (rows.length === 0) {
      section.appendChild(createEmptyStateElement({ message: 'No periods scheduled this week yet.' }));
    } else {
      section.appendChild(renderWeekTable(days, rows, todayKey));
    }

    const footer = document.createElement('div');
    footer.className = 'hub-week__footer';
    const viewFullButton = document.createElement('button');
    viewFullButton.type = 'button';
    viewFullButton.className = 'btn btn--ghost btn--pill';
    viewFullButton.append('View Full Timetable ', createIcon('arrow-right', { size: 16 }));
    viewFullButton.addEventListener('click', () => {
      const allEntries = rows.flatMap((row) => Array.from(row.cellsByDate.values()).flat());
      const classroomId = pickPrimaryClassroomId(allEntries);
      if (classroomId) onOpenTimetable(classroomId);
    });
    footer.appendChild(viewFullButton);
    section.appendChild(footer);
  }

  function renderWeekTable(days, rows, todayKey) {
    const scrollWrapper = document.createElement('div');
    scrollWrapper.className = 'hub-week-table-wrapper';

    const table = document.createElement('div');
    table.className = 'hub-week-table';
    table.style.gridTemplateColumns = `88px repeat(${days.length}, minmax(120px, 1fr))`;

    // Header row: a blank corner cell, then one per day.
    const corner = document.createElement('div');
    corner.className = 'hub-week-table__corner';
    table.appendChild(corner);

    days.forEach((dateKey) => {
      const [year, month, day] = dateKey.split('-').map(Number);
      const cell = document.createElement('div');
      cell.className = 'hub-week-table__day-header';
      if (dateKey === todayKey) cell.classList.add('hub-week-table__day-header--today');
      cell.textContent = `${WEEKDAY_LABELS[new Date(year, month - 1, day).getDay()]} ${day}`;
      table.appendChild(cell);
    });

    rows.forEach((row) => {
      const timeCell = document.createElement('div');
      timeCell.className = 'hub-week-table__time';
      timeCell.textContent = row.startTime ? personalHubService.formatPeriodTime(row.startTime) : '—';
      table.appendChild(timeCell);

      days.forEach((dateKey) => {
        const cell = document.createElement('div');
        cell.className = 'hub-week-table__cell';
        if (dateKey === todayKey) cell.classList.add('hub-week-table__cell--today');

        const dayEntries = row.cellsByDate.get(dateKey) || [];
        if (dayEntries.length === 0) {
          const dash = document.createElement('span');
          dash.className = 'hub-week-table__empty';
          dash.textContent = '—';
          cell.appendChild(dash);
        } else {
          dayEntries.forEach((entry) => {
            const entryEl = document.createElement('button');
            entryEl.type = 'button';
            entryEl.className = 'hub-week-entry';
            tint(entryEl, colorFor(entry.classroomId).hex, { bg: 14, text: 70 });
            entryEl.addEventListener('click', () => onOpenTimetable(entry.classroomId));

            const subject = document.createElement('span');
            subject.className = 'hub-week-entry__subject';
            subject.textContent = entry.subjectTitle;

            const context = document.createElement('span');
            context.className = 'hub-week-entry__context';
            context.textContent = `P${entry.periodNumber} · ${entry.classroomName}`;

            entryEl.append(subject, context);
            cell.appendChild(entryEl);
          });
        }

        table.appendChild(cell);
      });
    });

    scrollWrapper.appendChild(table);
    return scrollWrapper;
  }

  // --- Management ------------------------------------------------------

  function renderManagementSection() {
    const section = document.createElement('section');
    section.className = 'hub-section hub-management';

    const header = document.createElement('div');
    header.className = 'hub-section__header';
    const title = document.createElement('h2');
    title.className = 'hub-section__title';
    title.textContent = 'Management';
    header.appendChild(title);
    section.appendChild(header);

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'hub-management__row';
    row.addEventListener('click', onOpenCurriculumManagement);

    row.appendChild(createIconBadge('book-open', 'notebook', { size: 40 }));

    const text = document.createElement('span');
    text.className = 'hub-management__text';
    const rowTitle = document.createElement('span');
    rowTitle.className = 'hub-management__row-title';
    rowTitle.textContent = 'Curriculum Packs';
    const rowDescription = document.createElement('span');
    rowDescription.className = 'hub-management__row-description';
    rowDescription.textContent = 'Browse and manage curriculum packs across your classrooms and programs.';
    text.append(rowTitle, rowDescription);
    row.appendChild(text);

    row.appendChild(createIcon('arrow-right', { size: 18, className: 'hub-management__chevron' }));

    section.appendChild(row);
    return section;
  }
}
