/**
 * ui/views/LandingView.js
 *
 * ClassMate's own entry point — shown at the bare root (#/), before
 * any product-specific screen or auth check. Presents as a single,
 * self-contained application launch screen: ClassMate is the only
 * branding shown here, with the Teacher Portal and Student Portal as
 * its two entry points.
 *
 * "Continue as Teacher" leads into the existing ClassMate app,
 * unchanged; "Continue as Student" leads into the Student Portal (see
 * ui/student-portal/). No Google sign-in happens here; each portal's
 * own auth flow still runs exactly as it always has, once a visitor
 * has picked one.
 *
 * Deliberately not auth-gated and not classroom-aware — this screen
 * exists one level above both, at the platform layer.
 */

import { createIconBadge, ICON_CATEGORIES } from '../components/Icon.js';

export function renderLandingView(container, { onContinueAsTeacher, onContinueAsStudent }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'landing-view';

  const title = document.createElement('h1');
  title.className = 'landing-view__title';
  const titleClass = document.createElement('span');
  titleClass.className = 'landing-view__title-class';
  titleClass.textContent = 'Class';
  const titleMate = document.createElement('span');
  titleMate.className = 'landing-view__title-mate';
  titleMate.textContent = 'Mate';
  title.append(titleClass, titleMate);

  const subtitle = document.createElement('p');
  subtitle.className = 'landing-view__subtitle';
  subtitle.textContent = 'Everything you need to run your classroom.';

  wrapper.append(title, subtitle);

  const journeys = document.createElement('div');
  journeys.className = 'landing-view__journeys';

  const teacherCard = createJourneyCard({
    icon: 'chalkboard-easel',
    category: 'teacher',
    title: 'Teacher Portal',
    description: 'Manage students, groups, recognition, notebooks and classroom progress.',
    buttonLabel: 'Enter Teacher Portal',
    onSelect: onContinueAsTeacher,
  });

  const studentCard = createJourneyCard({
    icon: 'graduation-cap',
    category: 'student',
    title: 'Student Portal',
    description: 'View your progress, achievements, notebook updates and learning journey.',
    buttonLabel: 'Enter Student Portal',
    onSelect: onContinueAsStudent,
  });

  journeys.append(teacherCard, studentCard);
  wrapper.appendChild(journeys);
  container.appendChild(wrapper);
}

function createJourneyCard({ icon, category, title, description, buttonLabel, onSelect }) {
  const card = document.createElement('div');
  card.className = 'landing-view__journey-card';

  const iconEl = createIconBadge(icon, category, { size: 48 });
  iconEl.classList.add('landing-view__journey-icon');

  const titleEl = document.createElement('h2');
  titleEl.className = 'landing-view__journey-title';
  titleEl.textContent = title;

  const descriptionEl = document.createElement('p');
  descriptionEl.className = 'landing-view__journey-description';
  descriptionEl.textContent = description;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--primary btn--large';
  button.textContent = buttonLabel;
  // Categories that define their own "button" brand color override the
  // default primary-blue button styling, which is tied to each
  // teacher's personal accent-color preference (see
  // services/accentColorService.js) and would otherwise make this
  // pre-login landing screen's buttons vary per teacher.
  //
  // Deliberately NOT ICON_CATEGORIES[category].button for 'teacher':
  // that config's teacher tint (#5ea6da, the "Ocean" accent-color
  // default) is meant for in-app icon badges, not this fixed brand
  // treatment — this screen has its own fixed pairing instead, so its
  // "Class"/button/icon all agree with each other and with the
  // wordmark, regardless of what any signed-in teacher later picks as
  // their personal accent. #5ea5d9 per explicit browser-feedback
  // instruction (round 2, 2026-09-11) — a lighter shade than the
  // #1565C0 this used round 1, confirmed against a screenshot as too
  // dark. Note this is intentionally NOT the same value as Ocean's
  // #5ea6da above, even though the two are visually close — a
  // deliberate, explicitly-specified brand constant, not a reference to
  // that accent-color preset. Student's stays ICON_CATEGORIES-driven
  // since that value (#ff9b65) already matches the brand orange exactly
  // and this feedback round explicitly said not to touch it.
  const LANDING_BRAND_COLOR = { teacher: '#5ea5d9', student: ICON_CATEGORIES.student?.button };
  const categoryButtonColor = LANDING_BRAND_COLOR[category];
  if (categoryButtonColor) {
    button.style.backgroundColor = categoryButtonColor;
    button.style.borderColor = categoryButtonColor;
    // Both portal buttons use white text, matching Student's #ff9b65
    // pairing. Teacher's #5ea5d9 computes to ~2.67:1 contrast with white
    // (below the 4.5:1 WCAG AA floor for normal text) — round 2 of
    // browser feedback swapped this to dark ink to fix that, but round 3
    // explicitly asked for white back for visual consistency with
    // Student, accepting the contrast tradeoff. If this needs revisiting,
    // darken the background rather than the text.
    button.style.setProperty('color', '#ffffff', 'important');
  }
  button.addEventListener('click', onSelect);

  // The Teacher icon badge otherwise reads its glyph color from the
  // same ICON_CATEGORIES.teacher tint the button used to — overridden
  // here for the same reason, so the badge doesn't end up a different
  // blue from the button directly below it.
  if (category === 'teacher') {
    iconEl.style.color = '#5ea5d9';
  }

  card.append(iconEl, titleEl, descriptionEl, button);
  return card;
}
