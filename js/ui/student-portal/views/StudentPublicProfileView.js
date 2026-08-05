/**
 * ui/student-portal/views/StudentPublicProfileView.js
 *
 * Deliberately minimal — Milestone 2's own scope stops at "navigation
 * works," not the full public profile experience (stars, badges,
 * streaks, Journey/Learning Hub placeholders). Those are explicit
 * future milestones. This exists so tapping a student row in
 * ui/components/TeamStandingsBoard.js has a real, distinct
 * destination to verify against, rather than a fired callback with
 * nowhere to land.
 *
 * Reads via studentPortalDataService.js's own live classroom
 * (loadCurrentStudentAndClassroom()) — never a separate read — so
 * this already benefits from the Student Portal's single live
 * subscription without any extra wiring.
 */

import { loadCurrentStudentAndClassroom } from '../../../services/studentPortalDataService.js';
import { createAvatarElement } from '../../components/AvatarDisplay.js';
import { createBackButton } from '../../components/BackButton.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';

export async function renderStudentPublicProfileView(container, { studentId, onBack }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'student-public-profile';
  wrapper.appendChild(createBackButton(onBack));

  const found = await loadCurrentStudentAndClassroom();
  const student = found ? findStudentById(found.classroom, studentId) : null;

  if (!student) {
    wrapper.appendChild(createEmptyStateElement({ message: "This student's profile isn't available right now." }));
    container.appendChild(wrapper);
    return;
  }

  const header = document.createElement('div');
  header.className = 'student-public-profile__header';
  header.appendChild(createAvatarElement({ studentId: student.id, name: student.name, size: 64, useDefaultIfMissing: true }));

  const name = document.createElement('h1');
  name.className = 'student-public-profile__name';
  name.textContent = student.name;
  header.appendChild(name);

  wrapper.append(header);
  container.appendChild(wrapper);
}

function findStudentById(classroom, studentId) {
  for (const team of classroom.teams) {
    const found = team.students.find((s) => s.id === studentId);
    if (found) return found;
  }
  return null;
}
