/**
 * ui/views/TeacherDiagnosticsView.js
 *
 * TEMPORARY — built specifically to answer one question conclusively:
 * does the real, persisted classroom document actually contain
 * `studentEvents`, and does that match what's currently held in
 * memory? See this project's own Student Event Feed persistence
 * investigation for the full context. Remove this file, its route
 * (see ui/router.js's own 'diagnostics' entry), its entry point (see
 * ui/views/DashboardView.js), and the `case 'diagnostics'` branch in
 * main.js once that question is answered and the underlying issue is
 * resolved — this was never meant to be a permanent feature.
 *
 * Two sections, side by side, both reading the SAME requested fields
 * from two DIFFERENT sources:
 *   - "Fresh Firestore Read" — workspaceService.getClassroomOnce(),
 *     a genuine, uncached read straight through the same repository
 *     abstraction every other real read in this app already uses
 *     (see services/workspaceService.js, repositories/
 *     firestoreClassroomRepository.js) — never the in-memory object.
 *   - "In-Memory Classroom (right now)" — whatever classroomService
 *     currently holds for this classroom id, the same object every
 *     other screen in this app is actually looking at and mutating.
 *
 * A "Refresh" button re-runs the fresh read on demand, so a teacher
 * can: view this screen, go award a star/badge in Class Mode, save,
 * come back, and refresh — without navigating away and losing
 * context.
 */

import * as workspaceService from '../../services/workspaceService.js';
import * as classroomService from '../../services/classroomService.js';

export async function renderTeacherDiagnosticsView(container, { classroomId, onBack }) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'teacher-diagnostics';

  const header = document.createElement('div');
  header.className = 'teacher-diagnostics__header';

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'btn btn--text';
  backButton.textContent = '\u2190 Back';
  backButton.addEventListener('click', onBack);
  header.appendChild(backButton);

  const title = document.createElement('h1');
  title.className = 'teacher-diagnostics__title';
  title.textContent = '\ud83d\udd27 Teacher Diagnostics (temporary)';
  header.appendChild(title);

  const notice = document.createElement('p');
  notice.className = 'teacher-diagnostics__notice';
  notice.textContent = 'This screen is temporary developer tooling, built to compare the in-memory classroom against what\u2019s actually persisted. It will be removed once its purpose is served.';
  header.appendChild(notice);

  wrapper.appendChild(header);

  const sectionsRow = document.createElement('div');
  sectionsRow.className = 'teacher-diagnostics__sections';
  wrapper.appendChild(sectionsRow);

  container.appendChild(wrapper);

  async function renderSections() {
    sectionsRow.innerHTML = '';

    const inMemoryClassroom = classroomService.getClassroomById(classroomId);
    const freshClassroom = await workspaceService.getClassroomOnce(classroomId);

    sectionsRow.appendChild(
      renderDiagnosticsSection({
        title: 'In-Memory Classroom (right now)',
        subtitle: 'Whatever this app currently holds for this classroom \u2014 the same object every other screen is looking at.',
        summary: summarizeClassroom(inMemoryClassroom),
      })
    );

    sectionsRow.appendChild(
      renderDiagnosticsSection({
        title: 'Fresh Firestore Read',
        subtitle: 'A genuine, uncached read straight from persistence, through this app\u2019s own repository \u2014 never the in-memory object.',
        summary: summarizeClassroom(freshClassroom),
      })
    );
  }

  const refreshButton = document.createElement('button');
  refreshButton.type = 'button';
  refreshButton.className = 'btn btn--primary teacher-diagnostics__refresh-button';
  refreshButton.textContent = '\u21bb Refresh Fresh Read';
  refreshButton.addEventListener('click', renderSections);
  header.appendChild(refreshButton);

  await renderSections();
}

/**
 * Every requested field, computed identically regardless of which
 * source (in-memory vs. a fresh read) the classroom came from \u2014 so
 * the two sections are genuinely comparing the same things, not
 * subtly different calculations.
 */
function summarizeClassroom(classroom) {
  if (!classroom) return null;

  const students = (classroom.teams || []).flatMap((team) => team.students || []);

  return {
    id: classroom.id,
    teamCount: (classroom.teams || []).length,
    studentCount: students.length,
    assessmentCount: (classroom.assessments || []).length,
    subjectCount: (classroom.learningRecord?.subjects || []).length,
    hasStudentEvents: 'studentEvents' in classroom,
    studentEventsCount: classroom.studentEvents?.length ?? 0,
    firstStudentEvent: classroom.studentEvents?.[0] ?? null,
  };
}

function renderDiagnosticsSection({ title, subtitle, summary }) {
  const section = document.createElement('div');
  section.className = 'teacher-diagnostics__section';

  const heading = document.createElement('h2');
  heading.className = 'teacher-diagnostics__section-title';
  heading.textContent = title;
  section.appendChild(heading);

  const subtitleEl = document.createElement('p');
  subtitleEl.className = 'teacher-diagnostics__section-subtitle';
  subtitleEl.textContent = subtitle;
  section.appendChild(subtitleEl);

  if (!summary) {
    const missing = document.createElement('p');
    missing.className = 'teacher-diagnostics__missing';
    missing.textContent = '(No classroom found from this source at all.)';
    section.appendChild(missing);
    return section;
  }

  const rows = [
    ['Classroom ID', summary.id],
    ['Number of teams', summary.teamCount],
    ['Number of students', summary.studentCount],
    ['Number of assessments', summary.assessmentCount],
    ['Number of subjects', summary.subjectCount],
    ['studentEvents exists?', summary.hasStudentEvents ? 'YES' : 'NO'],
    ['studentEvents count', summary.studentEventsCount],
  ];

  const table = document.createElement('dl');
  table.className = 'teacher-diagnostics__table';
  rows.forEach(([label, value]) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = String(value);
    table.append(dt, dd);
  });
  section.appendChild(table);

  const firstEventHeading = document.createElement('h3');
  firstEventHeading.className = 'teacher-diagnostics__subheading';
  firstEventHeading.textContent = 'First event (if any)';
  section.appendChild(firstEventHeading);

  const firstEventBlock = document.createElement('pre');
  firstEventBlock.className = 'teacher-diagnostics__json-block';
  firstEventBlock.textContent = summary.firstStudentEvent ? JSON.stringify(summary.firstStudentEvent, null, 2) : '(none)';
  section.appendChild(firstEventBlock);

  return section;
}
