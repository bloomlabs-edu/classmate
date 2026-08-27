/**
 * ui/views/PersonalHubView.js
 *
 * ClassMate Personal Hub — Phase 1. Replaces the old "My Classrooms"
 * grid (formerly ui/views/HomeView.js) as the teacher landing page at
 * #/teacher, following the approved hierarchy: Profile -> My Week ->
 * My Classrooms -> Other Classrooms -> My Schools & Programs ->
 * Management.
 *
 * Every number and list on this page is read straight from the
 * classrooms workspaceService already loaded for this uid (see
 * services/personalHubService.js for the aggregation) — nothing here
 * is mock data, and nothing here is a second Timetable/classroom/
 * permission implementation: My Week reuses
 * services/timetableService.js's own concrete-slot derivation, and
 * every classroom card reuses ui/components/ClassroomCard.js exactly
 * as HomeView.js did (including its owner-gated delete menu).
 *
 * My Schools & Programs deliberately renders each school as its own
 * self-contained card (name, classroom count/list) rather than a flat
 * list, specifically so a future Program Manager/HM phase can attach
 * more controls to one school's own card without restructuring this
 * section — see personalHubService.getSchools()'s own header comment.
 */

import { createClassroomCardElement } from '../components/ClassroomCard.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import {
  getStudentCount,
  getMemberCount,
  getDisplayName,
  getDisplaySubtitle,
} from '../../services/classroomService.js';
import * as memberService from '../../services/memberService.js';
import * as personalHubService from '../../services/personalHubService.js';
import { formatDateKey, getTodayDateKey } from '../../utils/dateHelpers.js';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function renderPersonalHubView(
  container,
  { classrooms, currentUser, onSelectClassroom, onNewClassroom, onJoinClassroom, onDeleteClassroom, onOpenCurriculumManagement, onOpenTimetable }
) {
  container.innerHTML = '';

  const uid = currentUser.uid;
  let weekAnchor = getTodayDateKey();

  const wrapper = document.createElement('div');
  wrapper.className = 'personal-hub';

  wrapper.appendChild(renderProfileHeader());

  const weekSection = document.createElement('section');
  weekSection.className = 'hub-section hub-week';
  renderWeekSection(weekSection);
  wrapper.appendChild(weekSection);

  const { managedClassrooms, otherClassrooms } = personalHubService.splitClassroomsByRole(classrooms, uid);

  wrapper.appendChild(renderMyClassroomsSection(managedClassrooms));

  if (otherClassrooms.length > 0) {
    wrapper.appendChild(renderOtherClassroomsSection(otherClassrooms));
  }

  wrapper.appendChild(renderSchoolsAndProgrammesSection());
  wrapper.appendChild(renderManagementSection());

  container.appendChild(wrapper);

  // --- Profile header -----------------------------------------------

  function renderProfileHeader() {
    const section = document.createElement('section');
    section.className = 'hub-section hub-profile';

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

    const nameBlock = document.createElement('div');
    const name = document.createElement('h1');
    name.className = 'hub-profile__name';
    name.textContent = currentUser.displayName || 'Teacher';
    nameBlock.appendChild(name);

    const roles = personalHubService.getRolesSummary(classrooms, uid);
    if (roles.length > 0) {
      const roleLine = document.createElement('p');
      roleLine.className = 'hub-profile__roles';
      roleLine.textContent = roles.join(' · ');
      nameBlock.appendChild(roleLine);
    }

    const schools = personalHubService.getSchools(classrooms);
    if (schools.length > 0) {
      const affiliations = document.createElement('p');
      affiliations.className = 'hub-profile__affiliations';
      affiliations.textContent = schools.map((s) => s.schoolName).join(' · ');
      nameBlock.appendChild(affiliations);
    }

    identity.appendChild(nameBlock);
    section.appendChild(identity);

    const stats = document.createElement('div');
    stats.className = 'hub-profile__stats';
    stats.append(
      renderStatTile(classrooms.length, classrooms.length === 1 ? 'Classroom' : 'Classrooms'),
      renderStatTile(schools.length, schools.length === 1 ? 'School' : 'Schools'),
      renderStatTile(personalHubService.countPeriodsThisWeek(classrooms, weekAnchor), 'Periods this week')
    );
    section.appendChild(stats);

    return section;
  }

  function renderStatTile(value, label) {
    const tile = document.createElement('div');
    tile.className = 'hub-stat-tile';
    const valueEl = document.createElement('span');
    valueEl.className = 'hub-stat-tile__value';
    valueEl.textContent = String(value);
    const labelEl = document.createElement('span');
    labelEl.className = 'hub-stat-tile__label';
    labelEl.textContent = label;
    tile.append(valueEl, labelEl);
    return tile;
  }

  // --- My Week ---------------------------------------------------------

  function renderWeekSection(section) {
    section.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'hub-section__header';
    const title = document.createElement('h2');
    title.className = 'hub-section__title';
    title.textContent = 'My Week';
    header.appendChild(title);
    section.appendChild(header);

    const { range, entries } = personalHubService.getWeekSchedule(classrooms, weekAnchor);

    const nav = document.createElement('div');
    nav.className = 'hub-week__nav';

    const prevButton = document.createElement('button');
    prevButton.type = 'button';
    prevButton.className = 'btn btn--ghost hub-week__nav-button';
    prevButton.setAttribute('aria-label', 'Previous week');
    prevButton.textContent = '←';
    prevButton.addEventListener('click', () => {
      weekAnchor = personalHubService.getPreviousWeekAnchor(weekAnchor);
      renderWeekSection(section);
    });

    const todayButton = document.createElement('button');
    todayButton.type = 'button';
    todayButton.className = 'btn btn--text hub-week__today-button';
    todayButton.textContent = 'This Week';
    todayButton.addEventListener('click', () => {
      weekAnchor = getTodayDateKey();
      renderWeekSection(section);
    });

    const rangeLabel = document.createElement('span');
    rangeLabel.className = 'hub-week__range';
    rangeLabel.textContent = `${formatDateKey(range.start)} – ${formatDateKey(range.end)}`;

    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.className = 'btn btn--ghost hub-week__nav-button';
    nextButton.setAttribute('aria-label', 'Next week');
    nextButton.textContent = '→';
    nextButton.addEventListener('click', () => {
      weekAnchor = personalHubService.getNextWeekAnchor(weekAnchor);
      renderWeekSection(section);
    });

    nav.append(prevButton, todayButton, rangeLabel, nextButton);
    section.appendChild(nav);

    if (entries.length === 0) {
      section.appendChild(createEmptyStateElement({ message: 'No periods scheduled this week yet.' }));
    } else {
      section.appendChild(renderWeekGrid(entries));
    }

    const footer = document.createElement('div');
    footer.className = 'hub-week__footer';
    const viewFullLink = document.createElement('button');
    viewFullLink.type = 'button';
    viewFullLink.className = 'btn btn--text';
    viewFullLink.textContent = 'View Full Timetable →';
    viewFullLink.addEventListener('click', () => {
      // No merged, cross-classroom Timetable exists (see
      // services/timetableService.js's own header comment — a
      // Timetable is owned by one classroom) — Phase 1 sends the
      // teacher to whichever classroom currently has the most periods
      // scheduled this week, the same classroom's own existing
      // Timetable route (#/classroom/{id}/timetable), never a new page.
      const busiest = [...classrooms].sort(
        (a, b) =>
          personalHubService.getWeekSchedule([b], weekAnchor).entries.length -
          personalHubService.getWeekSchedule([a], weekAnchor).entries.length
      )[0];
      if (busiest) onOpenTimetable(busiest.id);
    });
    footer.appendChild(viewFullLink);
    section.appendChild(footer);
  }

  function renderWeekGrid(entries) {
    const grid = document.createElement('div');
    grid.className = 'hub-week-grid';

    const byDate = new Map();
    for (const entry of entries) {
      if (!byDate.has(entry.date)) byDate.set(entry.date, []);
      byDate.get(entry.date).push(entry);
    }

    for (const [dateKey, dayEntries] of byDate) {
      const dayColumn = document.createElement('div');
      dayColumn.className = 'hub-week-grid__day';

      const dayHeader = document.createElement('div');
      dayHeader.className = 'hub-week-grid__day-header';
      const [year, month, day] = dateKey.split('-').map(Number);
      const weekday = WEEKDAY_LABELS[new Date(year, month - 1, day).getDay()];
      dayHeader.textContent = `${weekday} ${day}`;
      dayColumn.appendChild(dayHeader);

      dayEntries
        .sort((a, b) => a.periodNumber - b.periodNumber)
        .forEach((entry) => {
          const entryEl = document.createElement('button');
          entryEl.type = 'button';
          entryEl.className = 'hub-week-entry';
          entryEl.addEventListener('click', () => onOpenTimetable(entry.classroomId));

          const subject = document.createElement('span');
          subject.className = 'hub-week-entry__subject';
          subject.textContent = entry.subjectTitle;

          const context = document.createElement('span');
          context.className = 'hub-week-entry__context';
          // Distinguishes which classroom/school this period belongs
          // to whenever the teacher has more than one — omitted when
          // there's only one classroom in this whole week's entries,
          // since it would just repeat the same name on every card.
          context.textContent = classrooms.length > 1 ? `P${entry.periodNumber} · ${entry.classroomName}` : `P${entry.periodNumber}`;

          entryEl.append(subject, context);
          dayColumn.appendChild(entryEl);
        });

      grid.appendChild(dayColumn);
    }

    return grid;
  }

  // --- My Classrooms -----------------------------------------------------

  function renderMyClassroomsSection(list) {
    const section = document.createElement('section');
    section.className = 'hub-section';

    const header = document.createElement('div');
    header.className = 'hub-section__header';

    const title = document.createElement('h2');
    title.className = 'hub-section__title';
    title.textContent = 'My Classrooms';
    header.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'hub-section__actions';

    const joinButton = document.createElement('button');
    joinButton.type = 'button';
    joinButton.className = 'btn btn--ghost';
    joinButton.textContent = 'Join a Classroom';
    joinButton.addEventListener('click', onJoinClassroom);
    actions.appendChild(joinButton);

    // Creating a classroom has no permission gate in this app today —
    // any signed-in teacher can create one and becomes its owner (see
    // services/classroomService.js's createEmptyClassroom()) — so this
    // stays unconditional, matching HomeView.js's own prior behavior
    // exactly rather than inventing a new restriction.
    const newButton = document.createElement('button');
    newButton.type = 'button';
    newButton.className = 'btn btn--primary';
    newButton.textContent = '+ New Classroom';
    newButton.addEventListener('click', onNewClassroom);
    actions.appendChild(newButton);

    header.appendChild(actions);
    section.appendChild(header);

    if (list.length === 0) {
      section.appendChild(createEmptyStateElement({ message: 'You don’t manage any classrooms yet.' }));
      return section;
    }

    const grid = document.createElement('div');
    grid.className = 'classroom-grid';
    list.forEach((classroom) => grid.appendChild(buildClassroomCard(classroom)));
    section.appendChild(grid);

    return section;
  }

  // --- Other Classrooms ----------------------------------------------

  function renderOtherClassroomsSection(list) {
    const section = document.createElement('section');
    section.className = 'hub-section';

    const header = document.createElement('div');
    header.className = 'hub-section__header';
    const title = document.createElement('h2');
    title.className = 'hub-section__title';
    title.textContent = 'Other Classrooms I’m a Part Of';
    header.appendChild(title);
    section.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'classroom-grid';
    list.forEach((classroom) => grid.appendChild(buildClassroomCard(classroom)));
    section.appendChild(grid);

    return section;
  }

  function buildClassroomCard(classroom) {
    return createClassroomCardElement({
      displayName: getDisplayName(classroom),
      subtitle: getDisplaySubtitle(classroom),
      studentCount: getStudentCount(classroom),
      memberCount: getMemberCount(classroom),
      onClick: () => onSelectClassroom(classroom.id),
      isOwner: memberService.isOwner(classroom, uid),
      onDeleteClassroom: () => onDeleteClassroom?.(classroom.id),
    });
  }

  // --- My Schools & Programs ------------------------------------------

  function renderSchoolsAndProgrammesSection() {
    const section = document.createElement('section');
    section.className = 'hub-section';

    const header = document.createElement('div');
    header.className = 'hub-section__header';
    const title = document.createElement('h2');
    title.className = 'hub-section__title';
    title.textContent = 'My Schools & Programs';
    header.appendChild(title);
    section.appendChild(header);

    const schools = personalHubService.getSchools(classrooms);
    const programmes = personalHubService.getProgrammes(classrooms, uid);

    const grid = document.createElement('div');
    grid.className = 'hub-org-grid';

    schools.forEach((school) => {
      const card = document.createElement('div');
      card.className = 'hub-org-card';

      const name = document.createElement('h3');
      name.className = 'hub-org-card__name';
      name.textContent = school.schoolName;
      card.appendChild(name);

      const meta = document.createElement('p');
      meta.className = 'hub-org-card__meta';
      meta.textContent = `${school.classrooms.length} classroom${school.classrooms.length === 1 ? '' : 's'}`;
      card.appendChild(meta);

      grid.appendChild(card);
    });

    programmes.forEach(({ programme, classroom }) => {
      const card = document.createElement('div');
      card.className = 'hub-org-card hub-org-card--programme';

      const badge = document.createElement('span');
      badge.className = 'hub-org-card__badge';
      badge.textContent = 'Programme';
      card.appendChild(badge);

      const name = document.createElement('h3');
      name.className = 'hub-org-card__name';
      name.textContent = programme.name;
      card.appendChild(name);

      const meta = document.createElement('p');
      meta.className = 'hub-org-card__meta';
      meta.textContent = getDisplayName(classroom);
      card.appendChild(meta);

      grid.appendChild(card);
    });

    section.appendChild(grid);
    return section;
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

    const curriculumLink = document.createElement('button');
    curriculumLink.type = 'button';
    curriculumLink.className = 'btn btn--text hub-management__link';
    curriculumLink.textContent = '⚙️ Manage Curriculum Packs';
    curriculumLink.addEventListener('click', onOpenCurriculumManagement);
    section.appendChild(curriculumLink);

    return section;
  }
}
