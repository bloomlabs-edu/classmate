/**
 * ui/student-portal/components/StudentAlertsPanel.js
 *
 * "Alerts" — pending notebook submissions and upcoming published
 * tests, placed just under the Welcome greeting on the Journey page
 * per explicit product request. Data comes from
 * services/studentPortalDataService.js's own getAlertsForCurrentStudent(),
 * itself a thin combination of two existing, already-correct reads
 * (workRequestService.js's getNotebookObligationsForStudent(),
 * assessmentService.js's getUpcomingAssessments()) — no new
 * derivation logic lives here at all, only rendering.
 *
 * Pending submissions are clickable — tapping one navigates to the
 * existing Notebooks view, where the actual submission workflow
 * already lives; this panel never duplicates that flow. Upcoming
 * tests are read-only: there's no student-facing "test detail" screen
 * to navigate to before results exist.
 *
 * Renders nothing at all (returns null, appends nothing) when both
 * lists are empty, matching this app's own established rule that a
 * module with nothing behind it shouldn't occupy a slot on screen
 * (see ui/student-portal/StudentPortalShell.js's own header comment)
 * — an empty state message was considered and deliberately rejected
 * here, since "nothing pending" isn't itself alert-worthy information
 * the way it would be for, say, a scoreboard.
 */

import { formatDate } from '../../../utils/dateHelpers.js';

export function createStudentAlertsPanelElement({ pendingSubmissions = [], upcomingAssessments = [], onNavigateToNotebooks } = {}) {
  if (pendingSubmissions.length === 0 && upcomingAssessments.length === 0) return null;

  const panel = document.createElement('div');
  panel.className = 'student-alerts-panel';

  pendingSubmissions.forEach((submission) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'student-alerts-panel__row student-alerts-panel__row--actionable';
    row.addEventListener('click', () => onNavigateToNotebooks?.());

    const icon = document.createElement('span');
    icon.className = 'student-alerts-panel__icon';
    icon.textContent = '\ud83d\udcd3';
    row.appendChild(icon);

    const text = document.createElement('span');
    text.className = 'student-alerts-panel__text';
    const dueText = submission.dueDate ? ` \u2014 due ${formatDate(submission.dueDate)}` : '';
    text.textContent = `${submission.label} not submitted yet${dueText}`;
    row.appendChild(text);

    const chevron = document.createElement('span');
    chevron.className = 'student-alerts-panel__chevron';
    chevron.textContent = '\u2192';
    row.appendChild(chevron);

    panel.appendChild(row);
  });

  upcomingAssessments.forEach((assessment) => {
    const row = document.createElement('div');
    row.className = 'student-alerts-panel__row';

    const icon = document.createElement('span');
    icon.className = 'student-alerts-panel__icon';
    icon.textContent = '\ud83d\udcdd';
    row.appendChild(icon);

    const text = document.createElement('span');
    text.className = 'student-alerts-panel__text';
    text.textContent = `${assessment.title} \u2014 ${formatDate(assessment.date)}`;
    row.appendChild(text);

    panel.appendChild(row);
  });

  return panel;
}
