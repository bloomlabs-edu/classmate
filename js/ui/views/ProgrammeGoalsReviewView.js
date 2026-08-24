/**
 * ui/views/ProgrammeGoalsReviewView.js
 *
 * The dedicated Daily Goals review screen — reached from the
 * Learning Circle dashboard's own "View / Review Goals" action. Shows
 * each roster student's own selected goal per category, its outcome,
 * and an "Edit Goal" action — never the suggestion library by
 * default, matching this project's own explicit "Teacher Mode must
 * never show the suggestion library automatically" direction. The
 * interaction itself is unchanged from an earlier UX-correction
 * round; this file only hosts it on its own focused screen instead of
 * sharing space with three other sections.
 *
 * PHASE 3 — for a session with `usesStudentEntries: true`, goals are
 * canonical in StudentEntry documents, not `session.goals` at all.
 * Rather than rewrite ui/components/ProgrammeGoalsControls.js to know
 * about two different read/write targets, this view HYDRATES
 * `session.goals` in memory from the real StudentEntry documents at
 * load time (a one-time, one-screen copy, never written back to the
 * ProgrammeSession document itself), and supplies a `saveGoal`
 * callback that redirects the actual write to
 * services/programmeSessionService.js's own StudentEntry-aware
 * saveGoalPatch(). The shared UI components stay completely unaware
 * that their data ultimately lives somewhere else — they read and
 * mutate `session.goals` exactly as they always have.
 *
 * Fetching every roster student's own StudentEntry for this one
 * session is a genuine LIST read
 * (firestoreStudentEntryRepository.js's own listStudentEntriesForSession()) —
 * safe specifically because this is the teacher's own call, whose
 * rule condition is classroom-membership-keyed (provably safe for a
 * list operation), never the student's own single-document-only
 * read path.
 */

import * as learningProgrammeService from '../../services/learningProgrammeService.js';
import * as programmeSessionService from '../../services/programmeSessionService.js';
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

  // PHASE 3 — hydrate session.goals from the real StudentEntry
  // documents, for a session that actually uses them. Every existing
  // UI function below continues to read/mutate `session.goals`
  // exactly as it always has; only where those bytes actually came
  // from, and where they're actually written back to, has changed.
  if (session.usesStudentEntries) {
    const programmeSessionRepository = await import('../../services/programmeSessionRepository.js');
    const firestoreStudentEntryRepository = await import('../../repositories/firestoreStudentEntryRepository.js');
    const entriesByStudentId = await firestoreStudentEntryRepository.listStudentEntriesForSession(programmeSessionRepository.getDb(), {
      classroomId: classroom.id,
      sessionId: session.id,
    });
    Object.entries(entriesByStudentId).forEach(([studentId, entry]) => {
      session.goals[studentId] = entry.goals || {};
    });
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
  title.textContent = 'Daily Goals';
  titleBlock.appendChild(title);
  const subtitle = document.createElement('p');
  subtitle.className = 'tracker-header__subtitle';
  subtitle.textContent = `${programme.name} \u00b7 ${formatDateKey(session.date)}${editable ? '' : ' \u00b7 Read-only'}`;
  titleBlock.appendChild(subtitle);
  header.appendChild(titleBlock);
  wrapper.appendChild(header);

  const { element: saveIndicator, persistPatch } = createSaveIndicatorController(classroom.id, session);
  wrapper.appendChild(saveIndicator);

  const sectionContainer = document.createElement('div');
  wrapper.appendChild(sectionContainer);

  // The teacher's own save target — StudentEntry-aware internally
  // (services/programmeSessionService.js's own saveGoalPatch()
  // branches on session.usesStudentEntries); this view and
  // ProgrammeGoalsControls.js never need to know which document a
  // given session's own goals actually end up in.
  function saveGoal(studentId, categoryId) {
    return programmeSessionService.saveGoalPatch(classroom.id, session, studentId, categoryId);
  }

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
    sectionContainer.appendChild(buildGoalsSection(programme, session, roster, editable, persistPatch, redraw, saveGoal));
  }

  redraw();
  container.appendChild(wrapper);
}
