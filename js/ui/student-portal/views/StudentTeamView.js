/**
 * ui/student-portal/views/StudentTeamView.js
 *
 * "Team" — renders the exact same board Class Mode has always shown
 * (see ui/components/TeamStandingsBoard.js and, underneath it,
 * TeamCard.js/ClassModeStudentRow.js) — the canonical implementation,
 * never a copy. "One component, two consumers," per explicit product
 * decision: teachers and students look at the same competition.
 *
 * Currently identical in content to what Journey's own landing page
 * already shows above its other sections — a known, deliberate
 * redundancy for this milestone, not an oversight. Team's own future
 * role (browsing every team, richer roster exploration) isn't built
 * yet; when it is, this becomes the page that content lives on,
 * rather than existing purely to repeat what Journey already shows.
 *
 * Reads the live classroom directly from
 * services/studentPortalDataService.js's own single subscription
 * (loadCurrentStudentAndClassroom()) — the same source every other
 * Student Portal screen already uses. Real-time updates are automatic:
 * whenever the live classroom changes, this view is re-rendered with
 * the fresh snapshot, and the shared board recomputes standings fresh
 * every time it's drawn.
 *
 * Only `onTap` (open a student's public profile) and `onTapTeam` (open
 * that team's page) are wired — `onSwipeLeft`/`onLongPress` are
 * deliberately omitted entirely, not just hidden: teacher-only
 * gestures have no place in the Student Portal at all.
 */

import { loadCurrentStudentAndClassroom } from '../../../services/studentPortalDataService.js';
import { createTeamStandingsBoardElement } from '../../components/TeamStandingsBoard.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';

export async function renderStudentTeamView(container, { onNavigateToStudentProfile, onNavigateToTeam } = {}) {
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

  wrapper.appendChild(
    createTeamStandingsBoardElement({
      classroom: found.classroom,
      onTap: (student) => onNavigateToStudentProfile?.(student.id),
      onTapTeam: (teamId) => onNavigateToTeam?.(teamId),
    })
  );

  container.appendChild(wrapper);
}
