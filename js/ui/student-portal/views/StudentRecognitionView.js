/**
 * ui/student-portal/views/StudentRecognitionView.js
 *
 * "Recognition" — the Student Portal's own view of the same
 * Recognition Wall the Teacher Portal's RecognitionScreenView.js
 * already renders. "One component, two consumers," matching this
 * project's own established Team-tab convention (see
 * StudentTeamView.js's own header comment) — the exact same
 * categories, cards, and leaderboards a teacher sees, never a copy.
 *
 * Read-only throughout: onSelectStudent only ever navigates to a
 * public student profile, matching RecognitionScreenView.js's own
 * existing behavior — there is no awarding or editing capability
 * anywhere in this screen, on either side of the app.
 *
 * Renders with hideBackButton: true, since this is a top-level tab
 * (the nav bar itself is the way in and out), not a drill-down
 * reached from Journey the way "My Goals" is — matching
 * StudentTeamView.js's own plain-title convention rather than
 * StudentGoalTrackerView.js's own back-button one.
 *
 * period/categoryId are kept as local, in-memory state via a small
 * rerender() closure (the same pattern ui/views/TrackerView.js
 * already uses) rather than encoded into the URL — this is a
 * top-level tab a student browses, not a deep-linkable admin screen,
 * so no router changes were needed to add it.
 */

import { loadCurrentStudentAndClassroom } from '../../../services/studentPortalDataService.js';
import { renderRecognitionScreenView } from '../../views/RecognitionScreenView.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';

export async function renderStudentRecognitionView(container, { onNavigateToStudentProfile } = {}) {
  container.innerHTML = '';

  const found = await loadCurrentStudentAndClassroom();

  if (!found) {
    const title = document.createElement('h1');
    title.className = 'student-section__title';
    title.textContent = 'Recognition';
    container.appendChild(title);
    container.appendChild(createEmptyStateElement({ message: "We couldn't load Recognition right now. Try again shortly." }));
    return;
  }

  let period = 'week';
  let categoryId = null;

  function rerender() {
    renderRecognitionScreenView(container, {
      classroom: found.classroom,
      period,
      categoryId,
      hideBackButton: true,
      onNavigatePeriod: (newPeriod) => {
        period = newPeriod;
        categoryId = null;
        rerender();
      },
      onNavigateCategory: (newPeriod, newCategoryId) => {
        period = newPeriod;
        categoryId = newCategoryId;
        rerender();
      },
      onSelectStudent: (studentId) => onNavigateToStudentProfile?.(studentId),
    });
  }

  rerender();
}
