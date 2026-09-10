/**
 * ui/student-portal/views/StudentWeeklyReportsView.js
 *
 * The Student Portal's own thin wrapper around
 * ui/views/WeeklyReportsListView.js / WeeklyReportDetailView.js — the
 * same "one component, two consumers" shape already established for
 * Recognition (see StudentRecognitionView.js's own header comment).
 * This file's only job is resolving "who is this about" (the active
 * profile's own classroom + student, via
 * services/studentPortalDataService.js) and passing `viewerStudentId`
 * so the detail view adds its one small "Your Week" personalization —
 * everything else about the report itself is identical to what a
 * teacher sees.
 *
 * Reached as a drill-down from the Recognition tab's own "View Weekly
 * Reports" link, not one of the Student Portal's four fixed bottom-nav
 * tabs — so, unlike StudentRecognitionView.js, this always renders
 * with a real back button (matching how `team/{id}` and
 * `student-profile` drill-downs already behave).
 */

import { loadCurrentStudentAndClassroom } from '../../../services/studentPortalDataService.js';
import { renderWeeklyReportsListView } from '../../views/WeeklyReportsListView.js';
import { renderWeeklyReportDetailView } from '../../views/WeeklyReportDetailView.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';

export async function renderStudentWeeklyReportsView(container, { weekStart, onBack, onSelectWeek, onNavigateWeek, onNavigateToStudentProfile } = {}) {
  container.innerHTML = '';

  const found = await loadCurrentStudentAndClassroom();

  if (!found) {
    const title = document.createElement('h1');
    title.className = 'student-section__title';
    title.textContent = '📅 Weekly Reports';
    container.appendChild(title);
    container.appendChild(createEmptyStateElement({ message: "We couldn't load Weekly Reports right now. Try again shortly." }));
    return;
  }

  if (weekStart) {
    renderWeeklyReportDetailView(container, {
      classroom: found.classroom,
      weekAnchorDateKey: weekStart,
      onBack,
      onNavigateWeek,
      onSelectStudent: onNavigateToStudentProfile,
      viewerStudentId: found.student.id,
    });
  } else {
    renderWeeklyReportsListView(container, {
      classroom: found.classroom,
      onBack,
      onSelectWeek,
    });
  }
}
