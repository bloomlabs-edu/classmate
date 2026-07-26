/**
 * ui/student-portal/views/StudentTeamView.js
 *
 * A student's own group, from their side — teammates and the team's
 * combined stars, reusing the same avatar generator as everywhere
 * else in the Portal. Live Firestore data — see
 * services/studentPortalDataService.js.
 */

import { getTeamSummary } from '../../../services/studentPortalDataService.js';
import { getAvatarForPerson } from '../../../utils/avatarGenerator.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';

export async function renderStudentTeamView(container) {
  container.innerHTML = '';

  const team = await getTeamSummary();

  const wrapper = document.createElement('div');
  wrapper.className = 'student-team';

  if (!team) {
    // A real, reachable state now that this reads live data - a
    // student simply may not be assigned to a group yet.
    const title = document.createElement('h1');
    title.className = 'student-section__title';
    title.textContent = 'My Team';
    wrapper.appendChild(title);
    wrapper.appendChild(createEmptyStateElement({ message: 'Not assigned to a group yet \u2014 ask your teacher.' }));
    container.appendChild(wrapper);
    return;
  }

  const title = document.createElement('h1');
  title.className = 'student-section__title';
  title.textContent = team.teamName;
  wrapper.appendChild(title);

  const starsLine = document.createElement('p');
  starsLine.className = 'student-team__stars';
  starsLine.textContent = `${team.teamStars} \u2b50 as a team`;
  wrapper.appendChild(starsLine);

  const list = document.createElement('div');
  list.className = 'student-team__list';
  team.teammates.forEach((name) => {
    const avatar = getAvatarForPerson({ name });

    const row = document.createElement('div');
    row.className = 'student-team__row';

    const avatarEl = document.createElement('span');
    avatarEl.className = 'student-team__row-avatar';
    avatarEl.style.backgroundColor = avatar.color;
    avatarEl.textContent = avatar.initials;

    const nameEl = document.createElement('span');
    nameEl.className = 'student-team__row-name';
    nameEl.textContent = name;

    row.append(avatarEl, nameEl);
    list.appendChild(row);
  });
  wrapper.appendChild(list);

  container.appendChild(wrapper);
}
