/**
 * ui/student-portal/views/StudentAssessmentResultsView.js
 *
 * The first implementation of this app's permanent event-detail
 * pattern (see config/studentEventNavigation.js's own header comment
 * for the full shape this establishes) — reached by tapping an
 * "assessment_published" event card in the Journey feed.
 *
 * Shows only the current student's own information for one
 * Assessment: name, type, date, academic year, then every included
 * Subject with that subject's own marks (or "Marks not yet published"
 * if none exist yet). Every number here is read fresh, every time
 * this screen opens, via
 * services/studentPortalDataService.js's getAssessmentResultsForCurrentStudent()
 * — never from the StudentEvent that navigated here, which only ever
 * carried this Assessment's id. If a teacher edits a mark after
 * publishing, reopening this page shows the new value automatically,
 * because nothing here was ever cached from the moment of publishing.
 */

import { getAssessmentResultsForCurrentStudent } from '../../../services/studentPortalDataService.js';
import { createBackButton } from '../../components/BackButton.js';
import { createEmptyStateElement } from '../../components/EmptyState.js';

export async function renderStudentAssessmentResultsView(container, { assessmentId, onBack }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'student-assessment-results';

  const header = document.createElement('div');
  header.className = 'student-assessment-results__header';
  header.appendChild(createBackButton(onBack));
  wrapper.appendChild(header);

  const results = await getAssessmentResultsForCurrentStudent(assessmentId);

  if (!results) {
    // Covers every reason this can fail to resolve — no active
    // profile, a deleted classroom, a student no longer on the
    // roster, or (most likely here) an Assessment that no longer
    // exists — a stale or broken link degrades to a real, friendly
    // empty state, never a crash.
    wrapper.appendChild(
      createEmptyStateElement({ message: "We couldn't load these results right now. They may have been removed." })
    );
    container.appendChild(wrapper);
    return;
  }

  const title = document.createElement('h1');
  title.className = 'student-assessment-results__title';
  title.textContent = results.title;
  wrapper.appendChild(title);

  const meta = document.createElement('dl');
  meta.className = 'student-assessment-results__meta';
  meta.append(
    createMetaRow('Type', results.type),
    createMetaRow('Date', results.date),
    createMetaRow('Academic Year', results.academicYear)
  );
  wrapper.appendChild(meta);

  const subjectsHeading = document.createElement('h2');
  subjectsHeading.className = 'student-assessment-results__subjects-heading';
  subjectsHeading.textContent = 'Subjects';
  wrapper.appendChild(subjectsHeading);

  if (results.subjects.length === 0) {
    wrapper.appendChild(createEmptyStateElement({ message: 'No subjects are included in this assessment.' }));
  } else {
    const subjectsList = document.createElement('div');
    subjectsList.className = 'student-assessment-results__subjects-list';
    results.subjects.forEach((subject) => {
      subjectsList.appendChild(createSubjectRow(subject));
    });
    wrapper.appendChild(subjectsList);
  }

  container.appendChild(wrapper);
}

function createMetaRow(label, value) {
  const row = document.createElement('div');
  row.className = 'student-assessment-results__meta-row';

  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value || '\u2014';

  row.append(dt, dd);
  return row;
}

function createSubjectRow(subject) {
  const row = document.createElement('div');
  row.className = 'student-assessment-results__subject-row';

  const name = document.createElement('p');
  name.className = 'student-assessment-results__subject-name';
  name.textContent = subject.subjectTitle;
  row.appendChild(name);

  const marks = document.createElement('p');
  marks.className = 'student-assessment-results__subject-marks';
  marks.textContent =
    subject.marks == null ? 'Marks not yet published' : `${subject.marks} / ${subject.maximumMarks}`;
  row.appendChild(marks);

  return row;
}
