/**
 * ui/student-portal/views/StudentAchievementsView.js
 *
 * Recognition earned, from the student's own point of view — the same
 * underlying recognition categories ClassMate's Recognition Wall
 * already computes (see studentProgressService.js), just framed as
 * "things I've earned" rather than "who's leading." Live Firestore
 * data — see services/studentPortalDataService.js.
 */

import { getAchievements } from '../../../services/studentPortalDataService.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';

export async function renderStudentAchievementsView(container) {
  container.innerHTML = '';

  const achievements = await getAchievements();

  const wrapper = document.createElement('div');
  wrapper.className = 'student-achievements';

  const title = document.createElement('h1');
  title.className = 'student-section__title';
  title.textContent = 'My Achievements';
  wrapper.appendChild(title);

  if (achievements.length === 0) {
    wrapper.appendChild(createEmptyStateElement({ message: 'No achievements yet \u2014 keep going!' }));
  } else {
    const list = document.createElement('div');
    list.className = 'student-achievements__list';
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
      // earnedOn isn't tracked per-badge yet (see models/Student.js) —
      // only render the line if there's something real to show,
      // rather than a blank or "null" line.
      if (achievement.earnedOn) {
        const earnedOn = document.createElement('p');
        earnedOn.className = 'student-achievements__item-meta';
        earnedOn.textContent = achievement.earnedOn;
        text.appendChild(earnedOn);
      }

      item.append(icon, text);
      list.appendChild(item);
    });
    wrapper.appendChild(list);
  }

  container.appendChild(wrapper);
}
