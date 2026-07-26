/**
 * ui/student-portal/views/StudentHomeView.js
 *
 * The Student Portal's landing screen — answers "How am I doing?"
 * directly, with five cards: My Stars, My Team, Recognition Wall, My
 * Journey, Continue Learning. All data comes from
 * services/studentPortalDataService.js, which now reads live
 * Firestore data for the device's remembered student profile — this
 * view has no knowledge of whether its data is real, so a future
 * change to how that data is computed is a change to that service,
 * not to this file.
 */

import { getHomeSummary } from '../../../services/studentPortalDataService.js';

export async function renderStudentHomeView(container) {
  container.innerHTML = '';

  const summary = await getHomeSummary();

  const wrapper = document.createElement('div');
  wrapper.className = 'student-home';

  const greeting = document.createElement('h1');
  greeting.className = 'student-home__greeting';
  greeting.textContent = 'How are you doing this week?';
  wrapper.appendChild(greeting);

  if (!summary) {
    // No remembered profile, or the classroom/student it points to
    // could no longer be found — shouldn't normally happen given the
    // join flow, but a real empty state beats a broken one.
    const notice = document.createElement('p');
    notice.className = 'student-home__empty-notice';
    notice.textContent = "We couldn't load your data right now. Try rejoining your classroom.";
    wrapper.appendChild(notice);
    container.appendChild(wrapper);
    return;
  }

  const cards = document.createElement('div');
  cards.className = 'student-home__cards';

  cards.appendChild(
    createCard({
      icon: '\u2b50',
      title: 'My Stars',
      value: String(summary.starsThisWeek),
      caption: 'earned this week',
    })
  );

  cards.appendChild(
    createCard({
      icon: '\ud83c\udfc6',
      title: 'My Team',
      value: summary.teamName || 'Not assigned yet',
      caption: summary.teamName
        ? summary.teamRank === 1
          ? 'Leading the class!'
          : `Ranked #${summary.teamRank}`
        : 'Ask your teacher to add you to a group',
    })
  );

  cards.appendChild(
    createCard({
      icon: '\ud83c\udf96\ufe0f',
      title: 'Recognition Wall',
      value: String(summary.recognitionCount),
      caption: summary.latestRecognition ? `Latest: ${summary.latestRecognition}` : 'Nothing yet \u2014 keep going!',
    })
  );

  cards.appendChild(
    createCard({
      icon: '\ud83d\udcc8',
      title: 'My Journey',
      value: `${summary.journeyStreak} days`,
      caption: 'current learning streak',
    })
  );

  cards.appendChild(
    createCard({
      icon: '\ud83d\udcda',
      title: 'Continue Learning',
      value: summary.learningActivityInProgress || 'Coming soon',
      caption: summary.learningActivityInProgress ? 'Pick up where you left off' : 'Learning Hub isn\u2019t open yet',
    })
  );

  wrapper.appendChild(cards);
  container.appendChild(wrapper);
}

function createCard({ icon, title, value, caption }) {
  const card = document.createElement('div');
  card.className = 'student-home__card';

  const iconEl = document.createElement('span');
  iconEl.className = 'student-home__card-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;

  const titleEl = document.createElement('h2');
  titleEl.className = 'student-home__card-title';
  titleEl.textContent = title;

  const valueEl = document.createElement('p');
  valueEl.className = 'student-home__card-value';
  valueEl.textContent = value;

  const captionEl = document.createElement('p');
  captionEl.className = 'student-home__card-caption';
  captionEl.textContent = caption;

  card.append(iconEl, titleEl, valueEl, captionEl);
  return card;
}
