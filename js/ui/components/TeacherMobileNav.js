/**
 * ui/components/TeacherMobileNav.js
 *
 * The mobile bottom tab bar for the Teacher Classroom workspace, per
 * the approved reference: Home / Timetable / Students / More — shown
 * only below the desktop sidebar's own breakpoint (see
 * ui/components/TeacherPortalSidebar.js's own CSS, which hides itself
 * at the same width this shows itself at), so exactly one of the two
 * navigation surfaces is ever visible at once, never both.
 *
 * "More" deliberately does not enumerate the sidebar's remaining 6
 * items in a menu here — that's real, disclosed remaining scope, not
 * silently dropped: for now it navigates to the same Dashboard the
 * desktop sidebar's own "Home" does, which already surfaces every
 * other section as its own module grid (see ui/views/DashboardView.js).
 */

import { createIcon } from './Icon.js';
import * as router from '../router.js';

const TABS = [
  { id: 'home', label: 'Home', icon: 'home', path: (classroomId) => `/classroom/${classroomId}` },
  { id: 'timetable', label: 'Timetable', icon: 'calendar', path: (classroomId) => `/classroom/${classroomId}/timetable` },
  { id: 'students', label: 'Students', icon: 'users', path: (classroomId) => `/classroom/${classroomId}/class-mode` },
  { id: 'more', label: 'More', icon: 'settings', path: (classroomId) => `/classroom/${classroomId}` },
];

const ROUTE_NAME_TO_TAB_ID = {
  dashboard: 'home',
  timetable: 'timetable',
  tracker: 'students',
};

export function renderTeacherMobileNav(container, { classroomId, activeRouteName }) {
  container.innerHTML = '';
  container.className = 'teacher-mobile-nav';
  const activeTabId = ROUTE_NAME_TO_TAB_ID[activeRouteName] || null;

  TABS.forEach((tab) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'teacher-mobile-nav__tab';
    if (tab.id === activeTabId) button.classList.add('teacher-mobile-nav__tab--active');
    button.appendChild(createIcon(tab.icon, { size: 20 }));
    const label = document.createElement('span');
    label.textContent = tab.label;
    button.appendChild(label);
    button.addEventListener('click', () => router.navigate(tab.path(classroomId)));
    container.appendChild(button);
  });
}

export function hideTeacherMobileNav(container) {
  container.innerHTML = '';
  container.className = '';
}
