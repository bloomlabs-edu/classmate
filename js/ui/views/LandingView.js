/**
 * ui/views/LandingView.js
 *
 * Classroom Tracker's own entry point — shown at the bare root (#/),
 * before any product-specific screen or auth check. "Bloom Labs" is
 * the umbrella ecosystem this product lives under, not the product
 * itself, so it appears here only as a small secondary label above
 * the real title: Classroom Tracker. The two journeys below are
 * Classroom Tracker's own Teacher Portal and Student Portal — two
 * experiences within this one product, not two modes of "Bloom Labs"
 * itself. The hierarchy this screen communicates is:
 *
 *   Bloom Labs
 *     -> Classroom Tracker
 *          -> Teacher Portal / Student Portal
 *
 * "Continue as Teacher" leads into the existing Classroom Tracker app,
 * unchanged; "Continue as Student" leads into the Student Portal (see
 * ui/student-portal/). No Google sign-in happens here; each portal's
 * own auth flow still runs exactly as it always has, once a visitor
 * has picked one.
 *
 * Deliberately not auth-gated and not classroom-aware — this screen
 * exists one level above both, at the platform layer. Framing it this
 * way (one product's own entry point, with the umbrella brand kept
 * small) is specifically what makes it straightforward to introduce
 * Learning Hub later as a sibling product under the same Bloom Labs
 * umbrella, without needing to redesign this screen's hierarchy again
 * — a future version of this page would show Classroom Tracker and
 * Learning Hub as two *products* to choose between, each still small-
 * labeled under Bloom Labs, rather than retrofitting a third "mode"
 * into what today reads as one product's own two portals.
 */

export function renderLandingView(container, { onContinueAsTeacher, onContinueAsStudent }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'landing-view';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'landing-view__eyebrow';
  eyebrow.textContent = 'by Bloom Labs';

  const title = document.createElement('h1');
  title.className = 'landing-view__title';
  title.textContent = 'Classroom Tracker';

  const subtitle = document.createElement('p');
  subtitle.className = 'landing-view__subtitle';
  subtitle.textContent = 'Two portals, built around two different questions.';

  wrapper.append(eyebrow, title, subtitle);

  const journeys = document.createElement('div');
  journeys.className = 'landing-view__journeys';

  const teacherCard = createJourneyCard({
    icon: '\ud83d\udcca',
    title: 'Teacher Portal',
    description: '\u201cHow is my classroom doing?\u201d \u2014 manage groups, recognition, notebooks, and progress.',
    buttonLabel: 'Enter Teacher Portal',
    onSelect: onContinueAsTeacher,
  });

  const studentCard = createJourneyCard({
    icon: '\ud83c\udf93',
    title: 'Student Portal',
    description: '\u201cHow am I doing?\u201d \u2014 your own progress and achievements, built around your perspective.',
    buttonLabel: 'Enter Student Portal',
    onSelect: onContinueAsStudent,
  });

  journeys.append(teacherCard, studentCard);
  wrapper.appendChild(journeys);
  container.appendChild(wrapper);
}

function createJourneyCard({ icon, title, description, buttonLabel, onSelect }) {
  const card = document.createElement('div');
  card.className = 'landing-view__journey-card';

  const iconEl = document.createElement('span');
  iconEl.className = 'landing-view__journey-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;

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
  button.addEventListener('click', onSelect);

  card.append(iconEl, titleEl, descriptionEl, button);
  return card;
}
