/**
 * ui/student-portal/views/StudentTeamView.js
 *
 * "Team" — now the shared Classroom Standings board (see
 * ui/components/ClassroomStandingsBoard.js), the exact same
 * implementation the teacher Dashboard shows, per explicit product
 * decision: one board, everywhere, never two versions.
 *
 * Reads the live classroom directly from
 * services/studentPortalDataService.js's own single subscription
 * (loadCurrentStudentAndClassroom()) — the same source every other
 * Student Portal screen already uses. Real-time updates are automatic:
 * whenever the live classroom changes, this view is re-rendered with
 * the fresh snapshot (see main.js's own subscription wiring), and the
 * shared board recomputes standings fresh every time it's drawn.
 */

import { loadCurrentStudentAndClassroom } from '../../../services/studentPortalDataService.js';
import { createClassroomStandingsBoardElement } from '../../components/ClassroomStandingsBoard.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';

export async function renderStudentTeamView(container) {
  container.innerHTML = '';

  const found = await loadCurrentStudentAndClassroom();

  const wrapper = document.createElement('div');
  wrapper.className = 'student-team';

  if (!found) {
    const title = document.createElement('h1');
    title.className = 'student-section__title';
    title.textContent = 'Team';
    wrapper.appendChild(title);
    wrapper.appendChild(createEmptyStateElement({ message: "We couldn't load standings right now. Try again shortly." }));
    container.appendChild(wrapper);
    return;
  }

  wrapper.appendChild(createClassroomStandingsBoardElement({ classroom: found.classroom }));

  container.appendChild(wrapper);
}
