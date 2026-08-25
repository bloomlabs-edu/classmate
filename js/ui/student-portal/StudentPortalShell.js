/**
 * ui/student-portal/StudentPortalShell.js
 *
 * The Student Portal's persistent chrome: a friendly nav bar across
 * the 4 sections (Journey / Team / Recognition / Profile), with
 * whichever section is active rendered below it. Reduced from the
 * original 5 sections (Home / Achievements / Team / Learn / Profile)
 * — Home and Achievements merged into Journey, and Learn was removed
 * entirely rather than kept as a "Coming Soon" tab, matching this
 * app's own established rule that a module with nothing behind it
 * shouldn't occupy a slot on screen (see this project's CHANGELOG).
 * Learn comes back once Learning Hub is real. Recognition was added
 * back as its own tab per explicit request, reusing
 * ui/views/RecognitionScreenView.js's own existing categories/cards/
 * leaderboards directly (see
 * ui/student-portal/views/StudentRecognitionView.js) rather than
 * building a second implementation. Deliberately does NOT reuse
 * Classroom Tracker's `.tracker-header` styling — the product
 * philosophy is explicit that this is "not a restricted version of
 * Classroom Tracker," so its chrome shouldn't look like an admin
 * dashboard wearing a different hat. See styles.css's
 * `.student-portal` rules, a self-contained block not shared with any
 * Classroom Tracker view.
 *
 * Section content components are passed in rather than imported here,
 * so this file has zero knowledge of what each section actually shows
 * — it's pure navigation/layout, matching this app's established
 * "views own their content, shells own layout" split.
 */

import { createIcon } from '../components/Icon.js';
import { renderStudentNotificationBell } from './components/StudentNotificationBell.js';

const SECTIONS = [
  { id: 'journey', icon: 'graduation-cap', label: 'Journey' },
  { id: 'team', icon: 'users', label: 'Team' },
  { id: 'recognition', icon: 'trophy', label: 'Recognition' },
  { id: 'profile', icon: 'user', label: 'Profile' },
];

export function renderStudentPortalShell(container, { activeSection, onNavigateSection, renderSectionContent, onBackToLanding, notificationUnreadCount, notificationEvents, onOpenNotificationEvent, onNotificationEventsViewed }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'student-portal';

  const topBar = document.createElement('div');
  topBar.className = 'student-portal__topbar';

  // Only rendered once a caller actually passes bell data (main.js only
  // does this once a profile/classroom is actually active — see this
  // file's own header comment on why nothing here should know that
  // detail itself), so this shell still degrades to exactly its old,
  // bell-less shape for any state that somehow renders it without one.
  if (onOpenNotificationEvent) {
    const bellContainer = document.createElement('div');
    renderStudentNotificationBell(bellContainer, {
      unreadCount: notificationUnreadCount,
      events: notificationEvents,
      onOpenEvent: onOpenNotificationEvent,
      onEventsViewed: onNotificationEventsViewed,
    });
    topBar.appendChild(bellContainer);
  }

  const backLink = document.createElement('button');
  backLink.type = 'button';
  backLink.className = 'student-portal__back-link';
  backLink.appendChild(createIcon('arrow-left'));
  backLink.append('Home');
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

    const icon = createIcon(section.icon, { className: 'student-portal__tab-icon' });

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
