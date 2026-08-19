/**
 * ui/views/ProgrammeAttendanceView.js
 *
 * The dedicated Attendance screen — reached from the Learning Circle
 * dashboard's own "Mark Attendance" action
 * (ui/views/ProgrammeSessionView.js), per this round's own redesign:
 * the dashboard shows only a compact summary; the full, one-control-
 * per-student interface now lives on its own focused page rather
 * than sharing space with three other sections. The interaction
 * itself — tap to toggle Present/Absent, "⋮" for Late — is completely
 * unchanged; this file only hosts it on its own screen.
 *
 * Same DATA FLOW as every other Learning Circle screen: VIEW ->
 * services/programmeSessionService.js -> Firestore. Never mutates
 * `classroom`, never calls services/workspaceService.js's save().
 */

import * as learningProgrammeService from '../../services/learningProgrammeService.js';
import * as programmeSessionService from '../../services/programmeSessionService.js';
import { isSessionEditable, resolveSessionRoster } from '../components/ProgrammeSessionHelpers.js';
import { buildAttendanceSection } from '../components/ProgrammeAttendanceControls.js';
import { createSaveIndicatorController } from '../components/ProgrammeSessionSaveIndicator.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { formatDateKey } from '../../utils/dateHelpers.js';

export async function renderProgrammeAttendanceView(container, { classroom, programmeId, sessionId, onBack }) {
  container.innerHTML = '';

  const programme = learningProgrammeService.getLearningProgrammeById(classroom, programmeId);
  if (!programme) {
    container.appendChild(createEmptyStateElement({ message: 'This Learning Programme could not be found.' }));
    return;
  }

  const session = await programmeSessionService.getSessionById(classroom.id, sessionId);
  if (!session) {
    container.appendChild(createEmptyStateElement({ message: 'This session could not be found.' }));
    return;
  }

  const editable = isSessionEditable(session, programme);
  const roster = resolveSessionRoster(classroom, programme, session, editable);

  const wrapper = document.createElement('div');
  wrapper.className = 'programme-session-view';

  const header = document.createElement('header');
  header.className = 'tracker-header';
  header.appendChild(createBackButton(onBack));
  const titleBlock = document.createElement('div');
  titleBlock.className = 'tracker-header__title-block';
  const title = document.createElement('h1');
  title.className = 'tracker-header__title';
  title.textContent = 'Attendance';
  titleBlock.appendChild(title);
  const subtitle = document.createElement('p');
  subtitle.className = 'tracker-header__subtitle';
  subtitle.textContent = `${programme.name} \u00b7 ${formatDateKey(session.date)}${editable ? '' : ' \u00b7 Read-only'}`;
  titleBlock.appendChild(subtitle);
  header.appendChild(titleBlock);
  wrapper.appendChild(header);

  const { element: saveIndicator, persistPatch } = createSaveIndicatorController(classroom.id, session);
  wrapper.appendChild(saveIndicator);

  if (roster.length === 0) {
    wrapper.appendChild(
      createEmptyStateElement({
        message: editable ? 'No active members yet \u2014 add students from Settings to begin.' : 'No students were recorded in this session.',
      })
    );
  } else {
    wrapper.appendChild(buildAttendanceSection(programme, session, roster, editable, persistPatch));
  }

  container.appendChild(wrapper);
}
