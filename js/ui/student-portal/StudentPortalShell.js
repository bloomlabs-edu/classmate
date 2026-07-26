/**
 * ui/student-portal/StudentPortalShell.js
 *
 * The Student Portal's persistent chrome: a friendly nav bar across
 * the 5 sections (Home / Achievements / Team / Learn / Profile), with
 * whichever section is active rendered below it. Deliberately does
 * NOT reuse Classroom Tracker's `.tracker-header` styling — the
 * product philosophy is explicit that this is "not a restricted
 * version of Classroom Tracker," so its chrome shouldn't look like an
 * admin dashboard wearing a different hat. See styles.css's
 * `.student-portal` rules, a self-contained block not shared with any
 * Classroom Tracker view.
 *
 * Section content components are passed in rather than imported here,
 * so this file has zero knowledge of what each section actually shows
 * — it's pure navigation/layout, matching this app's established
 * "views own their content, shells own layout" split.
 */

const SECTIONS = [
  { id: 'home', icon: '\ud83c\udfe0', label: 'Home' },
  { id: 'achievements', icon: '\ud83c\udfc5', label: 'Achievements' },
  { id: 'team', icon: '\ud83d\udc65', label: 'Team' },
  { id: 'learn', icon: '\ud83d\udcda', label: 'Learn' },
  { id: 'profile', icon: '\ud83d\udc64', label: 'Profile' },
];

export function renderStudentPortalShell(container, { activeSection, onNavigateSection, renderSectionContent, onBackToLanding }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'student-portal';

  const topBar = document.createElement('div');
  topBar.className = 'student-portal__topbar';

  const backLink = document.createElement('button');
  backLink.type = 'button';
  backLink.className = 'student-portal__back-link';
  backLink.textContent = '\u2190 ClassMate';
  backLink.addEventListener('click', onBackToLanding);
  topBar.appendChild(backLink);

  const nav = document.createElement('nav');
  nav.className = 'student-portal__nav';
  nav.setAttribute('aria-label', 'Student Portal sections');

  SECTIONS.forEach((section) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className =
      'student-portal__tab' + (section.id === activeSection ? ' student-portal__tab--active' : '');
    tab.setAttribute('aria-current', section.id === activeSection ? 'page' : 'false');

    const icon = document.createElement('span');
    icon.className = 'student-portal__tab-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = section.icon;

    const label = document.createElement('span');
    label.className = 'student-portal__tab-label';
    label.textContent = section.label;

    tab.append(icon, label);
    tab.addEventListener('click', () => onNavigateSection(section.id));
    nav.appendChild(tab);
  });

  const content = document.createElement('div');
  content.className = 'student-portal__content';
  renderSectionContent(content);

  wrapper.append(topBar, nav, content);
  container.appendChild(wrapper);
}
