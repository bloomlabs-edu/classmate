/**
 * ui/components/TeacherPortalSidebar.js
 *
 * The persistent left navigation shell for the Teacher Classroom
 * workspace — new, per the approved reference images. Rendered into
 * its own top-level container (#teacher-sidebar in index.html),
 * separate from #app (see js/main.js), so every existing view file
 * keeps rendering into #app completely unchanged; this is a new
 * navigation LAYER on top of existing functionality, never a
 * replacement for how any view itself works.
 *
 * Nav items reuse existing routes wherever one already exists for
 * that concept. Two items have no existing 1:1 destination and reuse
 * the closest existing screen instead, documented here rather than
 * silently guessed:
 *   - "Students" -> the existing Class Mode / Tracker route
 *     (#/classroom/{id}/class-mode) — this is where the real student
 *     roster already lives today; there is no separate "Students
 *     list" screen elsewhere in the app.
 *   - "Reports" -> the existing Scoreboard Archive route
 *     (#/classroom/{id}/scoreboard-archive) — the closest existing
 *     historical-reporting surface; there is no dedicated "Reports"
 *     screen elsewhere in the app.
 *   - "Learning Circle" -> the existing Teaching Programmes list route
 *     (#/classroom/{id}/learning-programmes) — Learning Circle is a
 *     student-facing view of a Learning Programme
 *     (ui/student-portal/views/StudentLearningCircleView.js); there is
 *     no separate teacher-facing Learning Circle screen, only the
 *     Programme itself, which a teacher already manages from there.
 *
 * Every nav item renders with equal visual weight — the `starred`
 * flag below is generic, reusable infrastructure (see renderNavList())
 * but nothing currently sets it; Timetable's earlier star marker was a
 * development/reference-only marker, removed per explicit product
 * decision (Phase S), not a design feature to preserve or replace.
 */

import { createIcon } from './Icon.js';
import * as router from '../router.js';

const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: 'home', path: (classroomId) => `/classroom/${classroomId}` },
  { id: 'timetable', label: 'Timetable', icon: 'calendar', path: (classroomId) => `/classroom/${classroomId}/timetable` },
  { id: 'students', label: 'Students', icon: 'users', path: (classroomId) => `/classroom/${classroomId}/class-mode` },
  { id: 'goals', label: 'Goals & Progress', icon: 'award', path: (classroomId) => `/classroom/${classroomId}/goals` },
  { id: 'notebooks', label: 'Notebooks', icon: 'book-open', path: (classroomId) => `/classroom/${classroomId}/notebooks` },
  { id: 'assessments', label: 'Assessments', icon: 'clipboard-list', path: (classroomId) => `/classroom/${classroomId}/assessments` },
  { id: 'teachingProgrammes', label: 'Teaching Programmes', icon: 'graduation-cap', path: (classroomId) => `/classroom/${classroomId}/learning-programmes` },
  { id: 'classFeed', label: 'Class Feed', icon: 'message-circle', path: (classroomId) => `/classroom/${classroomId}/feed` },
  { id: 'learningCircle', label: 'Learning Circle', icon: 'users', path: (classroomId) => `/classroom/${classroomId}/learning-programmes` },
  { id: 'reports', label: 'Reports', icon: 'bar-chart-3', path: (classroomId) => `/classroom/${classroomId}/scoreboard-archive` },
];

/** Every existing router route name that should highlight one of the nav items above as active. Routes with no entry here (settings, setup, studentProfile, recognition, diagnostics, activitiesList, activityRoster, workRequestRoster, learningManagement, curriculumManagement) simply show the sidebar with nothing highlighted — none of them has a clean 1:1 nav item, and inventing one would misrepresent where they actually sit in this navigation. */
const ROUTE_NAME_TO_NAV_ID = {
  dashboard: 'home',
  timetable: 'timetable',
  tracker: 'students',
  goalManagement: 'goals',
  notebookTracker: 'notebooks',
  workRequestCreate: 'notebooks',
  notebookCheckpoints: 'notebooks',
  assessments: 'assessments',
  learningProgrammesList: 'teachingProgrammes',
  learningProgrammeOverview: 'teachingProgrammes',
  learningProgrammeSettings: 'teachingProgrammes',
  programmeSession: 'teachingProgrammes',
  programmeSessionAttendance: 'teachingProgrammes',
  programmeSessionGoals: 'teachingProgrammes',
  programmeSessionObservations: 'teachingProgrammes',
  feed: 'classFeed',
  scoreboardArchive: 'reports',
  scoreboardArchiveDetail: 'reports',
};

export function routeNameToActiveNavId(routeName) {
  return ROUTE_NAME_TO_NAV_ID[routeName] || null;
}

/**
 * `classroom` and `currentUser` are read-only here — this component
 * never mutates or saves anything, only navigates (via router.navigate,
 * the same function every existing view already uses for its own
 * internal links).
 */
export function renderTeacherPortalSidebar(container, { classroom, activeRouteName }) {
  container.innerHTML = '';
  container.className = 'teacher-sidebar';

  const activeNavId = routeNameToActiveNavId(activeRouteName);

  container.appendChild(renderClassroomIdentityCard(classroom));
  container.appendChild(renderNavList(classroom.id, activeNavId));
  container.appendChild(renderInviteCoTeacherPanel(classroom));
}

/** Hides the sidebar entirely — for routes outside the Teacher Classroom workspace (landing, teacher home, student portal, standalone Curriculum Management) where it has never applied. */
export function hideTeacherPortalSidebar(container) {
  container.innerHTML = '';
  container.className = '';
}

function renderClassroomIdentityCard(classroom) {
  const card = document.createElement('div');
  card.className = 'teacher-sidebar__classroom-card';

  const label = document.createElement('p');
  label.className = 'teacher-sidebar__classroom-label';
  label.textContent = 'Current Classroom';
  card.appendChild(label);

  const name = document.createElement('h2');
  name.className = 'teacher-sidebar__classroom-name';
  name.textContent = classroom.classroomName || classroom.gradeSection;
  card.appendChild(name);

  if (classroom.classroomName) {
    const subtitle = document.createElement('p');
    subtitle.className = 'teacher-sidebar__classroom-subtitle';
    subtitle.textContent = `${classroom.gradeSection} · ${classroom.schoolName}`;
    card.appendChild(subtitle);
  }

  if (classroom.classroomJoinCode) {
    card.appendChild(renderJoinCodeRow(classroom.classroomJoinCode));
  }

  return card;
}

function renderJoinCodeRow(code) {
  const row = document.createElement('div');
  row.className = 'teacher-sidebar__join-code';

  const label = document.createElement('span');
  label.textContent = `Class code: ${code}`;
  row.appendChild(label);

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'teacher-sidebar__copy-button';
  copyButton.setAttribute('aria-label', 'Copy class code');
  copyButton.appendChild(createIcon('clipboard-list', { size: 14 }));
  copyButton.addEventListener('click', () => navigator.clipboard?.writeText(code));
  row.appendChild(copyButton);

  return row;
}

function renderNavList(classroomId, activeNavId) {
  const nav = document.createElement('nav');
  nav.className = 'teacher-sidebar__nav';

  NAV_ITEMS.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'teacher-sidebar__nav-item';
    if (item.starred) button.classList.add('teacher-sidebar__nav-item--starred');
    if (item.id === activeNavId) button.classList.add('teacher-sidebar__nav-item--active');

    button.appendChild(createIcon(item.icon, { size: 18, className: 'teacher-sidebar__nav-icon' }));

    const labelSpan = document.createElement('span');
    labelSpan.textContent = item.label;
    button.appendChild(labelSpan);

    if (item.starred) {
      const star = document.createElement('span');
      star.className = 'teacher-sidebar__star';
      star.textContent = '★';
      star.setAttribute('aria-hidden', 'true');
      button.appendChild(star);
    }

    button.addEventListener('click', () => router.navigate(item.path(classroomId)));
    nav.appendChild(button);
  });

  return nav;
}

function renderInviteCoTeacherPanel(classroom) {
  const panel = document.createElement('div');
  panel.className = 'teacher-sidebar__invite-panel';

  const title = document.createElement('p');
  title.className = 'teacher-sidebar__invite-title';
  title.textContent = 'Invite Co-Teacher';
  panel.appendChild(title);

  const hint = document.createElement('p');
  hint.className = 'teacher-sidebar__invite-hint';
  hint.textContent = 'Share your class code to invite them';
  panel.appendChild(hint);

  if (classroom.classroomJoinCode) {
    const codeRow = document.createElement('div');
    codeRow.className = 'teacher-sidebar__invite-code';
    codeRow.textContent = classroom.classroomJoinCode;

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'teacher-sidebar__copy-button';
    copyButton.setAttribute('aria-label', 'Copy class code');
    copyButton.appendChild(createIcon('clipboard-list', { size: 14 }));
    copyButton.addEventListener('click', () => navigator.clipboard?.writeText(classroom.classroomJoinCode));
    codeRow.appendChild(copyButton);

    panel.appendChild(codeRow);
  }

  return panel;
}
