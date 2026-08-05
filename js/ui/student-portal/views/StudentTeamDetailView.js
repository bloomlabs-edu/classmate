/**
 * ui/student-portal/views/StudentTeamDetailView.js
 *
 * Deliberately minimal — Milestone 2's own scope stops at "navigation
 * works," not the full team exploration experience (browsing roster
 * details, per-member stats). This exists so tapping a team header in
 * ui/components/TeamStandingsBoard.js has a real, distinct
 * destination to verify against.
 *
 * Each roster row is tappable, navigating into
 * StudentPublicProfileView.js — the same destination
 * TeamStandingsBoard's own onTap already uses, so there is only ever
 * one way a student reaches another student's profile, not two.
 */

import { loadCurrentStudentAndClassroom } from '../../../services/studentPortalDataService.js';
import { createBackButton } from '../../components/BackButton.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';

export async function renderStudentTeamDetailView(container, { teamId, onBack, onNavigateToStudentProfile }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'student-team-detail';
  wrapper.appendChild(createBackButton(onBack));

  const found = await loadCurrentStudentAndClassroom();
  const team = found ? found.classroom.teams.find((t) => t.id === teamId) : null;

  if (!team) {
    wrapper.appendChild(createEmptyStateElement({ message: "This team isn't available right now." }));
    container.appendChild(wrapper);
    return;
  }

  const name = document.createElement('h1');
  name.className = 'student-team-detail__name';
  name.textContent = team.name;
  wrapper.appendChild(name);

  const list = document.createElement('ul');
  list.className = 'student-team-detail__roster';
  team.students.forEach((student) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'student-team-detail__roster-item';
    button.textContent = student.name;
    button.addEventListener('click', () => onNavigateToStudentProfile(student.id));
    item.appendChild(button);
    list.appendChild(item);
  });
  wrapper.appendChild(list);

  container.appendChild(wrapper);
}
