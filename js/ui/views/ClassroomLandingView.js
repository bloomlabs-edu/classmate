/**
 * ui/views/ClassroomLandingView.js
 *
 * The unified "Classroom" destination — replaces the two previous,
 * separately-weighted Dashboard cards ("Class Mode" and "Classroom")
 * with one top-level entry, per explicit product decision: a teacher
 * should not need to understand the difference between those two
 * names to know where to go. This screen is the small, in-between
 * landing page that makes the actual choice obvious once they arrive.
 *
 * Deliberately thin — it renders no classroom data of its own at
 * all. "Run Today's Class" calls the exact same onStartClassMode
 * callback DashboardView.js already had (still navigating to the
 * exact same, unmodified /classroom/{id}/class-mode route, so any
 * existing deep link or bookmark to Class Mode keeps working
 * unchanged). "Students" and "Teams & Groups" both call the exact
 * same onOpenClassroomManagement callback DashboardView.js already
 * had (still rendering the exact same, unmodified
 * ClassroomManagementView.js in place) — two entry points into one
 * existing screen, not two new ones, since that screen already shows
 * Students and Groups together.
 */

import { createIcon } from '../components/Icon.js';
import { createBackButton } from '../components/BackButton.js';

export function renderClassroomLandingView(container, { onBack, onStartClassMode, onOpenClassroomManagement }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'classroom-landing';

  const header = document.createElement('div');
  header.className = 'learning-management__header';
  header.appendChild(createBackButton(onBack));
  const title = document.createElement('h1');
  title.className = 'learning-management__title';
  title.textContent = 'Classroom';
  header.appendChild(title);
  wrapper.appendChild(header);

  const runClassButton = document.createElement('button');
  runClassButton.type = 'button';
  runClassButton.className = 'btn btn--primary classroom-landing__run-button';
  runClassButton.appendChild(createIcon('play', { size: 18 }));
  runClassButton.append('Run Today\u2019s Class');
  runClassButton.addEventListener('click', onStartClassMode);
  wrapper.appendChild(runClassButton);

  const manageSection = document.createElement('div');
  manageSection.className = 'learning-management__section';

  const manageHeading = document.createElement('h2');
  manageHeading.className = 'learning-management__step-heading';
  manageHeading.textContent = 'Manage Classroom';
  manageSection.appendChild(manageHeading);

  const manageActions = document.createElement('div');
  manageActions.className = 'classroom-landing__manage-actions';

  const studentsButton = document.createElement('button');
  studentsButton.type = 'button';
  studentsButton.className = 'btn btn--secondary classroom-landing__manage-button';
  studentsButton.appendChild(createIcon('users', { size: 18 }));
  studentsButton.append('Students');
  studentsButton.addEventListener('click', onOpenClassroomManagement);

  const teamsButton = document.createElement('button');
  teamsButton.type = 'button';
  teamsButton.className = 'btn btn--secondary classroom-landing__manage-button';
  teamsButton.appendChild(createIcon('users', { size: 18 }));
  teamsButton.append('Teams & Groups');
  teamsButton.addEventListener('click', onOpenClassroomManagement);

  manageActions.append(studentsButton, teamsButton);
  manageSection.appendChild(manageActions);
  wrapper.appendChild(manageSection);

  container.appendChild(wrapper);
}
