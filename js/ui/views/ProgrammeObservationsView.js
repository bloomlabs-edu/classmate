/**
 * ui/views/ProgrammeObservationsView.js
 *
 * The dedicated "View Observations" screen — reached from the
 * Learning Circle dashboard's own Observations block. Shows every
 * recorded observation as a card (student, note, date/time), modeled
 * directly on the existing `.note-card` convention already used for
 * teacher notes on Student Profile (see
 * ui/views/StudentProfileView.js's own renderNotesTab()) — the same
 * concept (a dated, freeform, teacher-authored entry about a
 * student), the same visual treatment, not a new one invented for
 * this screen. "+ Add Observation" opens
 * ui/components/AddObservationModal.js; no input is ever permanently
 * visible on this screen, per this project's own explicit redesign
 * instruction.
 *
 * No removal action exists here — this round's own authorization
 * only asked for Activity removal, not Observation removal, and
 * "do not overbuild" applies equally to a capability nobody asked
 * for as it does to one nobody wanted exposed by default.
 */

import * as learningProgrammeService from '../../services/learningProgrammeService.js';
import * as programmeSessionService from '../../services/programmeSessionService.js';
import { isSessionEditable, resolveSessionRoster } from '../components/ProgrammeSessionHelpers.js';
import { createSaveIndicatorController } from '../components/ProgrammeSessionSaveIndicator.js';
import { openAddObservationModal } from '../components/AddObservationModal.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { formatDate, formatDateKey } from '../../utils/dateHelpers.js';

function formatDateTime(isoString) {
  const time = new Date(isoString).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return `${formatDate(isoString)} \u00b7 ${time}`;
}

export async function renderProgrammeObservationsView(container, { classroom, programmeId, sessionId, onBack }) {
  container.innerHTML = '';

  const programme = learningProgrammeService.getLearningProgrammeById(classroom, programmeId);
  if (!programme) {
    container.appendChild(createEmptyStateElement({ message: 'This Teaching Programme could not be found.' }));
    return;
  }

  const session = await programmeSessionService.getSessionById(classroom.id, sessionId);
  if (!session) {
    container.appendChild(createEmptyStateElement({ message: 'This session could not be found.' }));
    return;
  }

  const editable = isSessionEditable(session, programme);
  const roster = resolveSessionRoster(classroom, programme, session, editable);
  // Resolved from the FULL classroom roster, not just the current
  // session roster — an observation may reference a student who has
  // since left the programme, and their name must still resolve
  // correctly (matching this project's own "historical participation
  // remains interpretable" principle).
  const allStudentsById = new Map(classroom.teams.flatMap((team) => team.students.map((student) => [student.id, student])));

  const wrapper = document.createElement('div');
  wrapper.className = 'programme-session-view';

  const header = document.createElement('header');
  header.className = 'tracker-header';
  header.appendChild(createBackButton(onBack));
  const titleBlock = document.createElement('div');
  titleBlock.className = 'tracker-header__title-block';
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = 'Observations';
  titleBlock.appendChild(title);
  const subtitle = document.createElement('p');
  subtitle.className = 'tracker-header__subtitle';
  subtitle.textContent = `${programme.name} \u00b7 ${formatDateKey(session.date)}${editable ? '' : ' \u00b7 Read-only'}`;
  titleBlock.appendChild(subtitle);
  header.appendChild(titleBlock);
  wrapper.appendChild(header);

  const { element: saveIndicator, persistPatch } = createSaveIndicatorController(classroom.id, session);
  wrapper.appendChild(saveIndicator);

  const content = document.createElement('div');
  wrapper.appendChild(content);

  function redraw() {
    content.innerHTML = '';

    // Flattened to one entry per observation (not grouped per
    // student), most recent first — matching the mockup's own card
    // list exactly.
    const allObservations = Object.entries(session.teacherObservations || {})
      .flatMap(([studentId, observations]) => observations.map((observation) => ({ studentId, ...observation })))
      .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));

    if (allObservations.length === 0) {
      content.appendChild(createEmptyStateElement({ message: 'No observations yet.' }));
    } else {
      const list = document.createElement('div');
      list.className = 'note-list';
      allObservations.forEach((observation) => {
        const card = document.createElement('div');
        card.className = 'note-card';

        const metaRow = document.createElement('div');
        metaRow.className = 'note-card__meta';
        const studentNameEl = document.createElement('span');
        studentNameEl.className = 'note-card__teacher';
        studentNameEl.textContent = allStudentsById.get(observation.studentId)?.name || 'Unknown student';
        const dateEl = document.createElement('span');
        dateEl.className = 'note-card__date';
        dateEl.textContent = formatDateTime(observation.recordedAt);
        metaRow.append(studentNameEl, dateEl);

        const contentEl = document.createElement('p');
        contentEl.className = 'note-card__content';
        contentEl.textContent = observation.note;

        card.append(metaRow, contentEl);
        list.appendChild(card);
      });
      content.appendChild(list);
    }

    if (editable && roster.length > 0) {
      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'btn btn--primary';
      addButton.textContent = '+ Add Observation';
      addButton.addEventListener('click', () => {
        openAddObservationModal({
          roster,
          onSave: async ({ studentId, note }) => {
            programmeSessionService.recordTeacherObservation(programme, session, { studentId, note });
            await persistPatch(() => programmeSessionService.saveSessionPatch(classroom.id, session.id, programmeSessionService.buildTeacherObservationPatch(session, studentId)));
            redraw();
          },
        });
      });
      content.appendChild(addButton);
    }
  }

  redraw();
  container.appendChild(wrapper);
}
