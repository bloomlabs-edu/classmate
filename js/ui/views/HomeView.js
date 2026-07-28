/**
 * ui/views/HomeView.js
 *
 * The "My Classrooms" dashboard, shown once at least one classroom
 * exists. Computes each card's student/teacher counts via
 * classroomService's read-only selectors and hands plain numbers down to
 * the ClassroomCard component (which stays props-only).
 */

import { createClassroomCardElement } from '../components/ClassroomCard.js';
import {
  getStudentCount,
  getMemberCount,
  getDisplayName,
  getDisplaySubtitle,
} from '../../services/classroomService.js';

export function renderHomeView(container, { classrooms, onSelectClassroom, onNewClassroom, onJoinClassroom, onOpenCurriculumManagement }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'home-view';

  const header = document.createElement('div');
  header.className = 'home-view__header';

  const title = document.createElement('h1');
  title.className = 'home-view__title';
  title.textContent = 'My Classrooms';

  const actions = document.createElement('div');
  actions.className = 'home-view__actions';

  const joinButton = document.createElement('button');
  joinButton.type = 'button';
  joinButton.className = 'btn btn--ghost';
  joinButton.textContent = 'Join a Classroom';
  joinButton.addEventListener('click', onJoinClassroom);

  const newButton = document.createElement('button');
  newButton.type = 'button';
  newButton.className = 'btn btn--primary';
  newButton.textContent = '+ New Classroom';
  newButton.addEventListener('click', onNewClassroom);

  actions.append(joinButton, newButton);
  header.append(title, actions);

  const grid = document.createElement('div');
  grid.className = 'classroom-grid';

  classrooms.forEach((classroom) => {
    const card = createClassroomCardElement({
      displayName: getDisplayName(classroom),
      subtitle: getDisplaySubtitle(classroom),
      studentCount: getStudentCount(classroom),
      memberCount: getMemberCount(classroom),
      onClick: () => onSelectClassroom(classroom.id),
    });
    grid.appendChild(card);
  });

  wrapper.append(header, grid);

  if (onOpenCurriculumManagement) {
    const curriculumLink = document.createElement('button');
    curriculumLink.type = 'button';
    curriculumLink.className = 'btn btn--text home-view__curriculum-management-link';
    curriculumLink.textContent = '\u2699\ufe0f Manage Curriculum Packs';
    curriculumLink.addEventListener('click', onOpenCurriculumManagement);
    wrapper.appendChild(curriculumLink);
  }

  container.appendChild(wrapper);
}
