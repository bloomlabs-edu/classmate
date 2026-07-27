/**
 * ui/student-portal/views/StudentJourneyView.js
 *
 * "Journey" — replaces the old separate Home and Achievements tabs
 * (see this project's CHANGELOG for the navigation-simplification
 * decision). One screen answering "how am I doing?", in order:
 * welcome, today's goal, a compact progress summary, then the detail
 * modules (Stars, Streak, Recognition Wall, Badges).
 *
 * Recognition Wall and My Badges are deliberately different data, not
 * the same thing shown twice — a real distinction worth keeping
 * straight:
 *   - Recognition Wall = getRecognitionWins(): did I (or my team, for
 *     Team Champion) win one of the computed weekly categories
 *     (Star Performer, Longest Streak, ...) — the same categories the
 *     teacher-side Recognition Wall computes.
 *   - My Badges = getAchievements(): Behaviour Badges a teacher
 *     manually awarded (Helper, Team Player, ...) — a completely
 *     separate mechanism in this app (see services/badgeService.js).
 *
 * "My Team" deliberately does NOT appear here — Team now has its own
 * full page (see StudentTeamView.js) and owns all team-related
 * content; repeating a team teaser here would be the same kind of
 * duplication this merge was meant to remove.
 *
 * All data comes from studentPortalDataService.js; this view only
 * decides what to show and how to phrase it, never fetches anything
 * itself.
 */

import { getHomeSummary, getAchievements, getRecognitionWins } from '../../../services/studentPortalDataService.js';
import { formatKeyStatistic } from '../../components/RecognitionCard.js';
import { createAvatarElement } from '../../components/AvatarDisplay.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';

export async function renderStudentJourneyView(container) {
  container.innerHTML = '';

  const [summary, achievements, recognitionWins] = await Promise.all([
    getHomeSummary(),
    getAchievements(),
    getRecognitionWins(),
  ]);

  const wrapper = document.createElement('div');
  wrapper.className = 'student-journey';

  if (!summary) {
    const notice = document.createElement('p');
    notice.className = 'student-home__empty-notice';
    notice.textContent = "We couldn't load your data right now. Try rejoining your classroom.";
    wrapper.appendChild(notice);
    container.appendChild(wrapper);
    return;
  }

  const hasAnyActivity = summary.starsThisWeek > 0 || recognitionWins.length > 0 || summary.journeyStreak > 0 || achievements.length > 0;

  // Welcome
  const greetingRow = document.createElement('div');
  greetingRow.className = 'student-journey__greeting-row';
  greetingRow.appendChild(createAvatarElement({ studentId: summary.studentId, name: summary.studentName, size: 56, useDefaultIfMissing: true }));
  const greeting = document.createElement('h1');
  greeting.className = 'student-home__greeting';
  greeting.textContent = hasAnyActivity
    ? `Welcome back, ${summary.studentName}! \ud83d\udc4b`
    : `Welcome to ${summary.classroomName}! \ud83d\udc4b`;
  greetingRow.appendChild(greeting);
  wrapper.appendChild(greetingRow);

  // Today's Goal — always shown, keeps Journey feeling active even
  // before any stars/recognition exist.
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

  // Compact Progress Summary — one line, not a re-statement of every
  // module below in full-card form. Only includes a clause once
  // there's something real to say for it.
  if (hasAnyActivity) {
    const summaryParts = [];
    if (summary.starsThisWeek > 0) summaryParts.push(`${summary.starsThisWeek} \u2b50 this week`);
    if (summary.journeyStreak > 0) summaryParts.push(`${summary.journeyStreak}-day streak`);
    if (achievements.length > 0) summaryParts.push(`${achievements.length} badge${achievements.length === 1 ? '' : 's'}`);
    if (summaryParts.length > 0) {
      const summaryStrip = document.createElement('p');
      summaryStrip.className = 'student-journey__summary-strip';
      summaryStrip.textContent = summaryParts.join(' \u00b7 ');
      wrapper.appendChild(summaryStrip);
    }
  }

  const modules = document.createElement('div');
  modules.className = 'student-home__modules';

  // Stars — always shown. Teaching copy before the first star, real
  // value once one exists.
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

  // Current Streak — only once there's a real streak to show.
  if (summary.journeyStreak > 0) {
    modules.appendChild(
      createModule({
        icon: '\ud83d\udd25',
        title: 'Current Streak',
        value: `${summary.journeyStreak} day${summary.journeyStreak === 1 ? '' : 's'}`,
        caption: 'keep it going!',
      })
    );
  }

  wrapper.appendChild(modules);

  // Recognition Wall — teacher-generated, computed weekly categories.
  // See this file's own header comment for why this is a genuinely
  // different thing from My Badges below, not a re-skin of it.
  const recognitionSection = document.createElement('div');
  recognitionSection.className = 'student-journey__section';
  const recognitionTitle = document.createElement('h2');
  recognitionTitle.className = 'student-journey__section-title';
  recognitionTitle.textContent = '\ud83c\udfc6 Recognition Wall';
  recognitionSection.appendChild(recognitionTitle);

  if (recognitionWins.length === 0) {
    recognitionSection.appendChild(
      createEmptyStateElement({ message: 'The week is just getting started \u2014 recognitions will appear here soon.' })
    );
  } else {
    const recognitionList = document.createElement('div');
    recognitionList.className = 'student-achievements__list';
    recognitionWins.forEach(({ category, winner }) => {
      const item = document.createElement('div');
      item.className = 'student-achievements__item';

      const icon = document.createElement('span');
      icon.className = 'student-achievements__item-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = category.icon;

      const text = document.createElement('div');
      const label = document.createElement('p');
      label.className = 'student-achievements__item-label';
      label.textContent = category.label;
      const stat = document.createElement('p');
      stat.className = 'student-achievements__item-meta';
      stat.textContent = formatKeyStatistic(category, winner);
      text.append(label, stat);

      item.append(icon, text);
      recognitionList.appendChild(item);
    });
    recognitionSection.appendChild(recognitionList);
  }
  wrapper.appendChild(recognitionSection);

  // My Badges — manually-awarded Behaviour Badges. See this file's
  // header comment for why this is kept distinct from Recognition
  // Wall above.
  const badgesSection = document.createElement('div');
  badgesSection.className = 'student-journey__section';
  const badgesTitle = document.createElement('h2');
  badgesTitle.className = 'student-journey__section-title';
  badgesTitle.textContent = '\ud83c\udf96\ufe0f My Badges';
  badgesSection.appendChild(badgesTitle);

  if (achievements.length === 0) {
    badgesSection.appendChild(createEmptyStateElement({ message: 'No badges yet \u2014 keep going!' }));
  } else {
    const badgesList = document.createElement('div');
    badgesList.className = 'student-achievements__list';
    achievements.forEach((achievement) => {
      const item = document.createElement('div');
      item.className = 'student-achievements__item';

      const icon = document.createElement('span');
      icon.className = 'student-achievements__item-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '\ud83c\udf96\ufe0f';

      const text = document.createElement('div');
      const label = document.createElement('p');
      label.className = 'student-achievements__item-label';
      label.textContent = achievement.label;
      text.appendChild(label);
      if (achievement.earnedOn) {
        const earnedOn = document.createElement('p');
        earnedOn.className = 'student-achievements__item-meta';
        earnedOn.textContent = achievement.earnedOn;
        text.appendChild(earnedOn);
      }

      item.append(icon, text);
      badgesList.appendChild(item);
    });
    badgesSection.appendChild(badgesList);
  }
  wrapper.appendChild(badgesSection);

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
