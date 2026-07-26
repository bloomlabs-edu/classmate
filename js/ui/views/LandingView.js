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
  title.textContent = 'ClassMate';

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
  // Categories that define their own "button" brand color (distinct
  // from the softer icon color) override the default primary-blue
  // button styling — Student's button stays the bolder ff9b65 the
  // icon badge itself doesn't use, per this app's CHANGELOG.
  const categoryButtonColor = ICON_CATEGORIES[category]?.button;
  if (categoryButtonColor) {
    button.style.backgroundColor = categoryButtonColor;
    button.style.borderColor = categoryButtonColor;
    button.style.color = '#ffffff';
  }
  button.addEventListener('click', onSelect);

  card.append(iconEl, titleEl, descriptionEl, button);
  return card;
}
