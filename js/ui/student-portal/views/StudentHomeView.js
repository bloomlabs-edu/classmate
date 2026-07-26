/**
 * ui/student-portal/views/StudentHomeView.js
 *
 * The Student Portal's landing screen — redesigned around progressive
 * disclosure (see this project's CHANGELOG for the product discussion
 * behind this). Answers "what should I do next?" rather than
 * surfacing every metric at once, several of them empty.
 *
 * Module visibility:
 *   - Welcome header, My Stars, My Team, Today's Goal — always shown.
 *     Stars and Team teach the reward system through encouraging copy
 *     before real data exists, rather than hiding the concept or
 *     showing a bare "0" / "Not assigned yet."
 *   - Recognition Wall — only once the student has at least one badge.
 *   - Learning Journey — only once there's a real, active streak.
 *   - Continue Learning — deliberately does not exist as a module at
 *     all yet (not even a "Coming soon" placeholder) since Learning
 *     Hub itself isn't built — see services/studentPortalDataService.js.
 *
 * All data comes from studentPortalDataService.js; this view only
 * decides what to show and how to phrase it, never fetches anything
 * itself.
 */

import { getHomeSummary } from '../../../services/studentPortalDataService.js';

export async function renderStudentHomeView(container) {
  container.innerHTML = '';

  const summary = await getHomeSummary();

  const wrapper = document.createElement('div');
  wrapper.className = 'student-home';

  if (!summary) {
    const notice = document.createElement('p');
    notice.className = 'student-home__empty-notice';
    notice.textContent = "We couldn't load your data right now. Try rejoining your classroom.";
    wrapper.appendChild(notice);
    container.appendChild(wrapper);
    return;
  }

  const hasAnyActivity = summary.starsThisWeek > 0 || summary.recognitionCount > 0 || summary.journeyStreak > 0;

  const greeting = document.createElement('h1');
  greeting.className = 'student-home__greeting';
  greeting.textContent = hasAnyActivity
    ? `Welcome back, ${summary.studentName}! \ud83d\udc4b`
    : `Welcome to ${summary.classroomName}! \ud83d\udc4b`;
  wrapper.appendChild(greeting);

  const modules = document.createElement('div');
  modules.className = 'student-home__modules';

  // My Stars — always shown. Teaching copy before the first star,
  // real value once one exists.
  if (summary.starsThisWeek > 0) {
    modules.appendChild(
      createModule({
        icon: '\u2b50',
        title: 'My Stars',
        value: String(summary.starsThisWeek),
        caption: summary.starsThisWeek === 1 ? 'Your first star! Keep it up.' : 'earned this week',
      })
    );
  } else {
    modules.appendChild(
      createModule({
        icon: '\u2b50',
        title: 'My Stars',
        lines: ['Your teacher awards stars during class.', "You'll see them here as you participate."],
      })
    );
  }

  // My Team — always shown. Anticipation copy before assignment
  // (including the special Ungrouped bucket, which isn't a real
  // assignment from a student's point of view), real content after.
  if (summary.teamName) {
    modules.appendChild(
      createModule({
        icon: '\ud83c\udfc6',
        title: 'My Team',
        value: summary.teamName,
        caption: summary.teamRank === 1 ? 'Leading the class!' : summary.teamRank ? `Ranked #${summary.teamRank}` : 'Your team earns stars together!',
      })
    );
  } else {
    modules.appendChild(
      createModule({
        icon: '\ud83c\udfc6',
        title: 'My Team',
        lines: ["You'll be placed into a team soon.", 'Your team earns stars together!'],
      })
    );
  }

  // Recognition Wall — only once it means something.
  if (summary.recognitionCount > 0) {
    modules.appendChild(
      createModule({
        icon: '\ud83c\udf96\ufe0f',
        title: 'Recognition Wall',
        value: String(summary.recognitionCount),
        caption: `Latest: ${summary.latestRecognition}`,
      })
    );
  }

  // Learning Journey — only once there's a real streak to show.
  if (summary.journeyStreak > 0) {
    modules.appendChild(
      createModule({
        icon: '\ud83d\udcc8',
        title: 'Learning Journey',
        value: `${summary.journeyStreak} days`,
        caption: 'current learning streak',
      })
    );
  }

  wrapper.appendChild(modules);

  // Today's Goal — always shown, keeps Home feeling active even
  // before any stars/recognition exist. Deliberately static for now;
  // this exact slot is where a future real activity feed would go
  // without restructuring anything else.
  const goal = document.createElement('div');
  goal.className = 'student-home__goal';
  const goalTitle = document.createElement('h2');
  goalTitle.className = 'student-home__goal-title';
  goalTitle.textContent = "Today's Goal";
  const goalBody = document.createElement('p');
  goalBody.className = 'student-home__goal-body';
  goalBody.textContent =
    'Participate in class. Your teacher awards stars for effort, teamwork, curiosity, and responsibility.';
  goal.append(goalTitle, goalBody);
  wrapper.appendChild(goal);

  container.appendChild(wrapper);
}

function createModule({ icon, title, value, caption, lines }) {
  const card = document.createElement('div');
  card.className = 'student-home__card';

  const iconEl = document.createElement('span');
  iconEl.className = 'student-home__card-icon';
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;

  const titleEl = document.createElement('h2');
  titleEl.className = 'student-home__card-title';
  titleEl.textContent = title;

  card.append(iconEl, titleEl);

  if (lines) {
    // Teaching/anticipation state — no number yet, just encouraging
    // explanation of what this module will eventually show.
    lines.forEach((line) => {
      const lineEl = document.createElement('p');
      lineEl.className = 'student-home__card-caption';
      lineEl.textContent = line;
      card.appendChild(lineEl);
    });
  } else {
    const valueEl = document.createElement('p');
    valueEl.className = 'student-home__card-value';
    valueEl.textContent = value;
    const captionEl = document.createElement('p');
    captionEl.className = 'student-home__card-caption';
    captionEl.textContent = caption;
    card.append(valueEl, captionEl);
  }

  return card;
}
