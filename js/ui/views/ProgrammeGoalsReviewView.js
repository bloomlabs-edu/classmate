/**
 * ui/views/ProgrammeGoalsReviewView.js
 *
 * The dedicated Daily Goals review screen — reached from the
 * Learning Circle dashboard's own "View / Review Goals" action. Shows
 * each roster student's own selected goal per category, its outcome,
 * and an "Edit Goal" action — never the suggestion library by
 * default, matching this project's own explicit "Teacher Mode must
 * never show the suggestion library automatically" direction. The
 * interaction itself is unchanged from the prior UX-correction round;
 * this file only hosts it on its own focused screen instead of
 * sharing space with three other sections.
 */

import * as learningProgrammeService from '../../services/learningProgrammeService.js';
import * as programmeSessionService from '../../services/programmeSessionService.js';
import * as studentEntryRepository from '../../repositories/firestoreStudentEntryRepository.js';
import { isSessionEditable, resolveSessionRoster } from '../components/ProgrammeSessionHelpers.js';
import { buildGoalsSection } from '../components/ProgrammeGoalsControls.js';
import { createSaveIndicatorController } from '../components/ProgrammeSessionSaveIndicator.js';
import { createBackButton } from '../components/BackButton.js';
import { createEmptyStateElement } from '../components/EmptyState.js';
import { formatDateKey } from '../../utils/dateHelpers.js';

export async function renderProgrammeGoalsReviewView(container, { classroom, programmeId, sessionId, onBack }) {
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
  // PHASE 3.7 — for a usesStudentEntries session, this replaces the
  // session's own (empty) in-memory `goals` map with the real data
  // from the secure per-category subcollection before anything below
  // reads it. A no-op for a session created before this phase.
  await programmeSessionService.hydrateSessionGoals(classroom.id, session);

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
  title.textContent = 'Daily Goals';
  titleBlock.appendChild(title);
  const subtitle = document.createElement('p');
  subtitle.className = 'tracker-header__subtitle';
  subtitle.textContent = `${programme.name} \u00b7 ${formatDateKey(session.date)}${editable ? '' : ' \u00b7 Read-only'}`;
  titleBlock.appendChild(subtitle);
  header.appendChild(titleBlock);
  wrapper.appendChild(header);

  const { element: saveIndicator, persistPatch, persistCustom } = createSaveIndicatorController(classroom.id, session);
  wrapper.appendChild(saveIndicator);

  // PHASE 3.7 \u2014 only ever invoked by ProgrammeGoalsControls.js for a
  // usesStudentEntries session (see that file's own header comment);
  // always uses the TEACHER's own default-app Firestore instance
  // (`db` omitted -> firestoreStudentEntryRepository.js's own
  // teacherDb() default), since this is a teacher-only screen.
  function goalWriter(studentId, categoryId, valueOrPatch, isNewGoal) {
    return persistCustom(() =>
      isNewGoal
        ? studentEntryRepository.createStudentEntryGoal(undefined, classroom.id, session.id, studentId, categoryId, valueOrPatch)
        : studentEntryRepository.updateStudentEntryGoal(undefined, classroom.id, session.id, studentId, categoryId, valueOrPatch)
    );
  }

  const sectionContainer = document.createElement('div');
  wrapper.appendChild(sectionContainer);

  function redraw() {
    sectionContainer.innerHTML = '';
    if (roster.length === 0) {
      sectionContainer.appendChild(
        createEmptyStateElement({
          message: editable ? 'No active members yet \u2014 add students from Settings to begin.' : 'No students were recorded in this session.',
        })
      );
      return;
    }
    sectionContainer.appendChild(buildGoalsSection(programme, session, roster, editable, persistPatch, redraw, goalWriter));
  }

  redraw();
  container.appendChild(wrapper);
}
